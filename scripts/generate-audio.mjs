import { appendFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import {
  compareTranscript,
  createSpeechClient,
  LANG_MAP,
  STYLE_PROMPT,
  transcribeMp3,
} from "./audio-utils.mjs";

const MODEL_NAME = "gemini-3.1-flash-tts-preview";
const VOICE_MAP = {
  vrouw: "Leda",
  man: "Charon",
};
const PRICING_SOURCE = "https://cloud.google.com/text-to-speech/pricing";

const rootDir = path.resolve(process.cwd());
const dataFile = path.join(rootDir, "audio", "audio-data.json");
const logFile = path.join(rootDir, "scripts", "generate-audio.log");
const retryDelaysMs = [5000, 15000, 45000];
let lastGoogleCallAt = 0;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(logFile, `${line}\n`, "utf8");
}

function logError(message, error) {
  const details = error?.stack || String(error);
  const line = `[${new Date().toISOString()}] ERROR ${message}\n${details}`;
  console.error(line);
  appendFileSync(logFile, `${line}\n`, "utf8");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  const message = String(error?.message ?? error).toUpperCase();
  return ["429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED", "UNAVAILABLE", "INTERNAL", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].some((value) => code === value || message.includes(value))
    || ["4", "8", "13", "14"].includes(code)
    || message.includes("QUOTA")
    || message.includes("TEMPORARY");
}

async function synthesizeWithRetry(client, request, objectPath) {
  let retryIndex = 0;
  while (true) {
    const waitForSpacing = Math.max(0, 2000 - (Date.now() - lastGoogleCallAt));
    if (waitForSpacing > 0) await delay(waitForSpacing);

    try {
      log(`Google TTS request started: ${objectPath}`);
      const response = await client.synthesizeSpeech(request, { retry: null, timeout: 120000 });
      lastGoogleCallAt = Date.now();
      log(`Google TTS request succeeded: ${objectPath}`);
      return response[0]?.audioContent;
    } catch (error) {
      lastGoogleCallAt = Date.now();
      logError(`Google TTS request failed for ${objectPath}`, error);
      if (!isRetryableError(error) || retryIndex >= retryDelaysMs.length) {
        throw error;
      }

      const waitMs = retryDelaysMs[retryIndex];
      retryIndex += 1;
      log(`Retry ${retryIndex}/${retryDelaysMs.length} for ${objectPath} after ${waitMs / 1000}s`);
      await delay(waitMs);
    }
  }
}

async function synthesizeVerifiedWithRetry(ttsClient, speechClient, request, objectPath, lang, expectedText) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const audioContent = await synthesizeWithRetry(ttsClient, request, objectPath);
    if (!audioContent) throw new Error(`No audio returned for ${objectPath}`);

    const bytes = Buffer.isBuffer(audioContent) ? audioContent : Buffer.from(audioContent);
    const transcript = await transcribeMp3(speechClient, bytes, lang);
    const comparison = compareTranscript(expectedText, transcript);
    if (!comparison.isMismatch) {
      log(`Speech verification passed for ${objectPath}: ${(comparison.agreement * 100).toFixed(1)}% agreement, ${comparison.transcriptWordCount}/${comparison.expectedWordCount} words (attempt ${attempt}/3)`);
      return audioContent;
    }

    log(`Speech verification failed for ${objectPath}: ${(comparison.agreement * 100).toFixed(1)}% agreement, ${comparison.transcriptWordCount}/${comparison.expectedWordCount} words; transcript="${transcript}" (attempt ${attempt}/3)`);
  }

  throw new Error(`Speech verification failed after 2 additional generations for ${objectPath}; audio was not uploaded.`);
}

async function getExistingUrlKeys(supabase, table, lang, voice) {
  const { data, error } = await supabase
    .from(table)
    .select(table === "audio_intro_fragments" ? "exercise_nummer,url" : "key,variant,url")
    .eq("lang", lang)
    .eq("voice", voice)
    .not("url", "is", null);
  if (error) throw new Error(`Could not check existing ${table} rows for ${lang}/${voice}: ${error.message}`);

  return new Set((data ?? []).map((row) => table === "audio_intro_fragments"
    ? String(row.exercise_nummer)
    : `${row.key}:${row.variant}`));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    sharedOnly: false,
    force: false,
    onlyExercise: null,
    onlyKey: null,
    lang: null,
    voice: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--shared-only") options.sharedOnly = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--only-exercise") {
      options.onlyExercise = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--only-key") {
      const key = argv[index + 1];
      if (!key || key.startsWith("--")) {
        throw new Error("--only-key requires a shared fragment key.");
      }
      options.onlyKey = key;
      index += 1;
    } else if (arg === "--lang") {
      options.lang = argv[index + 1];
      index += 1;
    } else if (arg === "--voice") {
      options.voice = argv[index + 1];
      index += 1;
    }
  }

  if (options.onlyExercise !== null && Number.isNaN(options.onlyExercise)) {
    throw new Error("--only-exercise requires a numeric value.");
  }

  if (options.onlyKey !== null && (!options.onlyKey || options.onlyExercise !== null)) {
    throw new Error("--only-key requires a key and cannot be combined with --only-exercise.");
  }

  if (options.lang && !LANG_MAP[options.lang]) {
    throw new Error("--lang must be nl or en.");
  }

  if (options.voice && !VOICE_MAP[options.voice]) {
    throw new Error("--voice must be vrouw or man.");
  }

  return options;
}

function loadData() {
  if (!existsSync(dataFile)) {
    throw new Error(`Data file not found: ${dataFile}`);
  }

  const raw = readFileSync(dataFile, "utf8");
  return JSON.parse(raw);
}

function getSelectedIntroFragments(data, options) {
  if (options.onlyKey) return [];

  let records = data.intro_fragments;

  if (options.onlyExercise !== null) {
    records = records.filter((item) => item.exercise_nummer === options.onlyExercise);
  }

  if (options.lang) {
    records = records.filter((item) => item.lang === options.lang);
  }

  return records;
}

function getSelectedSharedFragments(data, options) {
  let records = data.shared_fragments;

  if (options.onlyKey) {
    records = records.filter((item) => item.key === options.onlyKey);
  }

  if (options.lang) {
    records = records.filter((item) => item.lang === options.lang);
  }

  return records;
}

function countTextLength(records) {
  return records.reduce((total, item) => total + item.text.length, 0);
}

function getDryRunSummary(data, options) {
  const introRecords = getSelectedIntroFragments(data, options);
  const sharedRecords = getSelectedSharedFragments(data, options);
  if (options.onlyKey && sharedRecords.length === 0) {
    throw new Error(`No shared fragments found for key "${options.onlyKey}" and the selected language.`);
  }
  const totalFragmentCount = introRecords.length + sharedRecords.length;
  const totalChars = countTextLength(introRecords) + countTextLength(sharedRecords);

  const introCountByLang = { nl: 0, en: 0 };
  for (const item of introRecords) {
    introCountByLang[item.lang] += 1;
  }

  const sharedCountByLang = { nl: 0, en: 0 };
  for (const item of sharedRecords) {
    sharedCountByLang[item.lang] += 1;
  }

  const estimatedCost = "pricing not published for Gemini preview model; use the public pricing page for the authoritative rate: " + PRICING_SOURCE;

  return {
    introCountByLang,
    sharedCountByLang,
    totalFragmentCount,
    totalChars,
    estimatedCost,
    introRecords,
    sharedRecords,
  };
}

async function dryRun(data, options) {
  const summary = getDryRunSummary(data, options);

  log("Dry run: no audio or uploads will be generated.");
  log(`Intro fragments by language: nl=${summary.introCountByLang.nl}, en=${summary.introCountByLang.en}`);
  log(`Shared fragments by language: nl=${summary.sharedCountByLang.nl}, en=${summary.sharedCountByLang.en}`);
  log(`Selected fragment count: ${summary.totalFragmentCount}`);
  log(`Selected text characters: ${summary.totalChars}`);
  log(`Expected cost: ${summary.estimatedCost}`);
}

async function ensureBucketExists(supabase) {
  const { data: existingBucket, error: getBucketError } = await supabase.storage.getBucket("exercise-media");
  if (getBucketError && getBucketError.message !== "Bucket not found") {
    throw new Error(`Could not inspect bucket: ${getBucketError.message}`);
  }

  if (!existingBucket) {
    const { error: createError } = await supabase.storage.createBucket("exercise-media", { public: true });
    if (createError) {
      throw new Error(`Could not create bucket "exercise-media": ${createError.message}`);
    }
  }
}

async function actualGenerate(data, options) {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set for non-dry-run generation.");
  }

  const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  log("Checking storage bucket exercise-media");
  await ensureBucketExists(supabase);

  const client = new TextToSpeechClient();
  const speechClient = createSpeechClient();
  const userVoice = options.voice ?? "vrouw";
  const selectedLangs = options.lang ? [options.lang] : ["nl", "en"];
  const failures = [];

  if (options.sharedOnly || options.onlyKey) {
    for (const lang of selectedLangs) {
      const records = getSelectedSharedFragments(data, { ...options, lang });
      const existing = await getExistingUrlKeys(supabase, "audio_fragments", lang, userVoice);
      for (const fragment of records) {
        const voiceName = VOICE_MAP[userVoice];
        const languageCode = LANG_MAP[lang];
        const text = fragment.text;
        const objectPath = `shared/${fragment.key}_${fragment.variant}_${lang}_${userVoice}.mp3`;
        const key = `${fragment.key}:${fragment.variant}`;

        if (existing.has(key)) {
          log(`Skipping existing fragment with URL: ${objectPath}`);
          continue;
        }

        const request = {
          input: { text, prompt: STYLE_PROMPT[lang] },
          voice: { languageCode, name: voiceName, modelName: MODEL_NAME },
          audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
        };

        try {
          const audioContent = await synthesizeVerifiedWithRetry(client, speechClient, request, objectPath, lang, text);

          log(`Storage upload started: ${objectPath}`);
          const { error: uploadError } = await supabase.storage
            .from("exercise-media")
            .upload(objectPath, audioContent, { upsert: false, contentType: "audio/mpeg" });
          if (uploadError) throw new Error(`Storage upload failed for ${objectPath}: ${uploadError.message}`);
          log(`Storage upload succeeded: ${objectPath}`);

          const publicUrl = supabase.storage.from("exercise-media").getPublicUrl(objectPath).data.publicUrl;
          log(`Database upsert started: ${objectPath}`);
          const { error: dbError } = await supabase.from("audio_fragments").upsert({
            key: fragment.key,
            lang,
            voice: userVoice,
            variant: fragment.variant,
            text,
            url: publicUrl,
          }, { onConflict: "key,lang,voice,variant" });
          if (dbError) throw new Error(`DB upsert failed for ${objectPath}: ${dbError.message}`);
          log(`Fragment completed: ${objectPath}`);
          existing.add(key);
        } catch (error) {
          logError(`Fragment failed after retry policy: ${objectPath}`, error);
          failures.push({ objectPath, error });
        }
      }
    }
  } else {
    for (const lang of selectedLangs) {
      const introRecords = getSelectedIntroFragments(data, { ...options, lang });
      const existing = await getExistingUrlKeys(supabase, "audio_intro_fragments", lang, userVoice);
      for (const entry of introRecords) {
        const voiceName = VOICE_MAP[userVoice];
        const languageCode = LANG_MAP[lang];
        const objectPath = `${entry.exercise_nummer}/audio_intro_${lang}_${userVoice}.mp3`;

        if (existing.has(String(entry.exercise_nummer))) {
          log(`Skipping existing intro with URL: ${objectPath}`);
          continue;
        }

        const request = {
          input: { text: entry.text, prompt: STYLE_PROMPT[lang] },
          voice: { languageCode, name: voiceName, modelName: MODEL_NAME },
          audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
        };

        try {
          const audioContent = await synthesizeVerifiedWithRetry(client, speechClient, request, objectPath, lang, entry.text);

          log(`Storage upload started: ${objectPath}`);
          const { error: uploadError } = await supabase.storage
            .from("exercise-media")
            .upload(objectPath, audioContent, { upsert: false, contentType: "audio/mpeg" });
          if (uploadError) throw new Error(`Storage upload failed for ${objectPath}: ${uploadError.message}`);
          log(`Storage upload succeeded: ${objectPath}`);

          const publicUrl = supabase.storage.from("exercise-media").getPublicUrl(objectPath).data.publicUrl;
          log(`Database upsert started: ${objectPath}`);
          const { error: dbError } = await supabase.from("audio_intro_fragments").upsert({
            exercise_nummer: entry.exercise_nummer,
            lang,
            voice: userVoice,
            text: entry.text,
            url: publicUrl,
          }, { onConflict: "exercise_nummer,lang,voice" });
          if (dbError) throw new Error(`Intro DB upsert failed for ${objectPath}: ${dbError.message}`);
          log(`Intro completed: ${objectPath}`);
          existing.add(String(entry.exercise_nummer));
        } catch (error) {
          logError(`Intro failed after retry policy: ${objectPath}`, error);
          failures.push({ objectPath, error });
        }
      }
    }
  }

  await speechClient.close();
  await client.close();
  log(`Generation summary for ${selectedLangs.join(",")}/${userVoice}: ${failures.length} fragment(s) failed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} fragment(s) failed; see ${logFile}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = loadData();

  if (options.onlyKey && getSelectedSharedFragments(data, options).length === 0) {
    throw new Error(`No shared fragments found for key "${options.onlyKey}" and the selected language.`);
  }

  if (options.dryRun) {
    await dryRun(data, options);
    return;
  }

  await actualGenerate(data, options);
}

main().catch((error) => {
  logError("generate-audio failed", error);
  process.exit(1);
});
