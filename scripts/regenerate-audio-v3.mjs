import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  checkIntroTranscript,
  checkSharedTranscript,
  checkSilences,
  createSpeechClient,
  getMp3DurationSeconds,
  LANG_MAP,
  STT_COST_PER_MINUTE_USD,
  STT_MAX_PART_SECONDS,
  STYLE_PROMPT,
  transcribeMp3InParts,
} from "./audio-utils.mjs";

// Regenerates every fragment whose text in audio/audio-data.json differs from the
// database as *_v3.mp3 (new URL, so browsers do not play cached old audio).
// One language per run (--lang nl|en), both voices. Style prompt and speech
// recognition use that language. Each fragment gets at most 3 attempts; only an
// approved attempt is uploaded, after which text and URL are updated together.
// Old files are left untouched; rejected attempts go to tmp/.
// Default is a dry run; pass --run to execute. Optional: --only-exercise <nr>
// (that intro only), --budget <usd> (default: upper bound for 3 attempts) and
// --retry-failed (fragments rejected 3 times in an earlier run are skipped otherwise),
// --voice vrouw|man, and --force (only with --only-exercise): regenerate that intro
// even if its database text is already current; it is uploaded as
// *_v3_<timestamp>.mp3 because *_v3.mp3 already exists.

const MODEL_NAME = "gemini-3.1-flash-tts-preview";
const VOICE_MAP = { vrouw: "Leda", man: "Charon" };
const VOICES = ["vrouw", "man"];
const MAX_ATTEMPTS = 3;
const ALLOWED_SHARED_KEYS = new Set(["start_eindpositie"]);
// Gemini 3.1 Flash TTS preview: $20 / 1M audio output tokens at 25 tokens per second of audio.
const TTS_COST_PER_AUDIO_SECOND_USD = 20 / 1_000_000 * 25;
const TTS_INPUT_COST_PER_CHAR_USD = 1 / 1_000_000 / 4; // $1 / 1M input tokens, ~4 chars per token
const CHARS_PER_SECOND = 14;

const rootDir = path.resolve(process.cwd());
const DATA_FILE = path.join(rootDir, "audio", "audio-data.json");
const FAILED_DIR = path.join(rootDir, "tmp", "audio-regenerate-v3-failed");
const resultsFile = (lang) => path.join(rootDir, "tmp", `audio-regenerate-v3-${lang}-results.json`);

function parseArgs(argv) {
  const options = { lang: null, run: false, budgetUsd: null, onlyExercise: null, retryFailed: false, force: false, voice: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--lang") {
      options.lang = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--force") {
      options.force = true;
    } else if (argv[index] === "--voice") {
      options.voice = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--only-exercise") {
      options.onlyExercise = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--retry-failed") {
      options.retryFailed = true;
    } else if (argv[index] === "--run") {
      options.run = true;
    } else if (argv[index] === "--budget") {
      options.budgetUsd = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!LANG_MAP[options.lang]) throw new Error("--lang nl or --lang en is required (one language per run).");
  if (options.budgetUsd !== null && !(options.budgetUsd > 0)) throw new Error("--budget must be a positive number.");
  if (options.onlyExercise !== null && !Number.isInteger(options.onlyExercise)) throw new Error("--only-exercise requires an exercise number.");
  if (options.force && options.onlyExercise === null) throw new Error("--force is only allowed together with --only-exercise <nr>.");
  if (options.voice !== null && !VOICE_MAP[options.voice]) throw new Error("--voice must be vrouw or man.");
  return options;
}

const identity = (row) => row.kind === "intro"
  ? `intro_${row.exercise_nummer}|intro|${row.lang}|${row.voice}`
  : `${row.key}|${row.variant}|${row.lang}|${row.voice}`;

function attemptCostEstimate(text, lang) {
  const seconds = Math.ceil(text.length / CHARS_PER_SECOND);
  return seconds * TTS_COST_PER_AUDIO_SECOND_USD
    + (text.length + STYLE_PROMPT[lang].length) * TTS_INPUT_COST_PER_CHAR_USD
    + seconds / 60 * STT_COST_PER_MINUTE_USD;
}

function readResults(lang) {
  if (!existsSync(resultsFile(lang))) return { costUsd: { tts: 0, stt: 0 }, fragments: {} };
  return JSON.parse(readFileSync(resultsFile(lang), "utf8"));
}

function saveResults(lang, results) {
  writeFileSync(resultsFile(lang), `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

const totalCost = (results) => results.costUsd.tts + results.costUsd.stt;

// Timeouts and temporary unavailability return no audio, so a retry does not
// count as an attempt.
const TTS_RETRY_DELAYS_MS = [10000, 30000];
const isTransientError = (error) => [4, 8, 13, 14].includes(error?.code)
  || /DEADLINE_EXCEEDED|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|ECONNRESET|ETIMEDOUT|timeout/iu.test(String(error?.message ?? error));

async function synthesizeWithRetry(tts, request, id) {
  for (let retry = 0; ; retry += 1) {
    try {
      const [response] = await tts.synthesizeSpeech(request, { timeout: 120000, retry: null });
      return response;
    } catch (error) {
      if (!isTransientError(error) || retry >= TTS_RETRY_DELAYS_MS.length) throw error;
      console.log(`${id}: TTS error (${String(error?.message ?? error).slice(0, 80)}); retry ${retry + 1}/${TTS_RETRY_DELAYS_MS.length} in ${TTS_RETRY_DELAYS_MS[retry] / 1000}s.`);
      await new Promise((resolve) => setTimeout(resolve, TTS_RETRY_DELAYS_MS[retry]));
    }
  }
}

// Targets: database rows (both voices) whose text differs from audio-data.json.
// The new text comes from audio-data.json; the old text guards the update.
async function loadTargets(supabase, data, lang, forceExercise = null) {
  const { data: introRows, error: introError } = await supabase.from("audio_intro_fragments")
    .select("exercise_nummer,lang,voice,text,url").eq("lang", lang).order("exercise_nummer").order("voice");
  if (introError) throw new Error(`Could not load audio_intro_fragments: ${introError.message}`);
  const { data: sharedRows, error: sharedError } = await supabase.from("audio_fragments")
    .select("key,variant,lang,voice,text,url").eq("lang", lang).order("key").order("variant").order("voice");
  if (sharedError) throw new Error(`Could not load audio_fragments: ${sharedError.message}`);

  const targets = [];
  for (const fragment of data.intro_fragments.filter((item) => item.lang === lang)) {
    for (const voice of VOICES) {
      const row = introRows.find((item) => item.exercise_nummer === fragment.exercise_nummer && item.voice === voice);
      if (!row) throw new Error(`No database row for intro ${fragment.exercise_nummer} ${lang} ${voice}; stopping.`);
      if (row.text !== fragment.text || fragment.exercise_nummer === forceExercise) targets.push({ kind: "intro", exercise_nummer: row.exercise_nummer, lang, voice, text: fragment.text, oldText: row.text, oldUrl: row.url });
    }
  }
  for (const fragment of data.shared_fragments.filter((item) => item.lang === lang)) {
    for (const voice of VOICES) {
      const row = sharedRows.find((item) => item.key === fragment.key && item.variant === fragment.variant && item.voice === voice);
      if (!row) throw new Error(`No database row for ${fragment.key} ${fragment.variant} ${lang} ${voice}; stopping.`);
      if (row.text === fragment.text) continue;
      if (!ALLOWED_SHARED_KEYS.has(fragment.key)) throw new Error(`Unexpected text change in shared fragment ${fragment.key} ${fragment.variant} ${lang}; stopping.`);
      targets.push({ kind: "shared", key: row.key, variant: row.variant, lang, voice, text: fragment.text, oldText: row.text, oldUrl: row.url });
    }
  }
  return targets;
}

function printSummary(targets, lang) {
  const intros = targets.filter((row) => row.kind === "intro");
  const shared = targets.filter((row) => row.kind === "shared");
  const chars = (rows) => rows.reduce((sum, row) => sum + row.text.length, 0);
  const onePass = targets.reduce((sum, row) => sum + attemptCostEstimate(row.text, lang), 0);
  const longest = Math.max(0, ...targets.map((row) => row.text.length / CHARS_PER_SECOND));
  console.log(`Language: ${lang} (${LANG_MAP[lang]}); voices: ${VOICES.join(", ")}.`);
  for (const voice of VOICES) {
    console.log(`  ${voice}: intros ${intros.filter((row) => row.voice === voice).length}, shared ${shared.filter((row) => row.voice === voice).length}`);
  }
  console.log(`Fragments: ${targets.length} (intros ${intros.length}, shared ${shared.length}).`);
  console.log(`Characters: ${chars(targets)} (intros ${chars(intros)}, shared ${chars(shared)}); style prompt ${STYLE_PROMPT[lang].length} characters per call.`);
  console.log(`Estimated audio: ${Math.round(chars(targets) / CHARS_PER_SECOND)} s; longest fragment ~${longest.toFixed(0)} s.`);
  console.log(`Cost estimate: one pass $${onePass.toFixed(3)}; upper bound with ${MAX_ATTEMPTS} attempts $${(onePass * MAX_ATTEMPTS).toFixed(3)}.`);
  if (longest > STT_MAX_PART_SECONDS * 2 * 0.7) console.log(`WARNING: longest fragment is close to the ${STT_MAX_PART_SECONDS * 2} s limit for recognition in two parts.`);
  return onePass;
}

async function main() {
  nextEnv.loadEnvConfig(rootDir);
  const options = parseArgs(process.argv.slice(2));
  const { lang } = options;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const allTargets = await loadTargets(supabase, data, lang, options.force ? options.onlyExercise : null);
  const results = readResults(lang);
  // --only-exercise: just that intro (both voices unless --voice), no shared fragments.
  let targets = options.onlyExercise === null
    ? allTargets
    : allTargets.filter((row) => row.kind === "intro" && row.exercise_nummer === options.onlyExercise);
  if (options.voice !== null) targets = targets.filter((row) => row.voice === options.voice);
  if (options.onlyExercise !== null || options.voice !== null) console.log(`Selection${options.onlyExercise !== null ? ` exercise ${options.onlyExercise}` : ""}${options.voice ? ` voice ${options.voice}` : ""}${options.force ? " (forced)" : ""}: ${targets.length} of ${allTargets.length} targets.`);
  // A forced run can overwrite neither *_v3.mp3 nor an earlier forced file.
  const suffix = options.force ? `_v3_${new Date().toISOString().replace(/\D/gu, "").slice(0, 14)}` : "_v3";
  if (!options.retryFailed && !options.force) {
    const failed = targets.filter((row) => results.fragments[identity(row)]?.status === "FAILED_VERIFICATION");
    for (const row of failed) console.log(`Skipping ${identity(row)}: rejected ${MAX_ATTEMPTS} times earlier (use --retry-failed).`);
    targets = targets.filter((row) => !failed.includes(row));
  }
  console.log(`Cost already recorded for ${lang}: $${totalCost(results).toFixed(3)}.`);
  const onePass = printSummary(targets, lang);
  const budgetUsd = options.budgetUsd ?? onePass * MAX_ATTEMPTS;
  // The budget covers this run only; earlier runs are recorded separately.
  const costBeforeRun = totalCost(results);
  console.log(`Budget for this run: $${budgetUsd.toFixed(3)}.`);
  if (!options.run) {
    console.log("Dry run: nothing generated, uploaded or changed. Pass --run to execute.");
    return;
  }
  if (targets.length === 0) {
    console.log("Nothing to regenerate.");
    return;
  }

  mkdirSync(FAILED_DIR, { recursive: true });
  const tts = new TextToSpeechClient();
  const stt = createSpeechClient();
  let budgetStopped = false;

  try {
    for (const row of targets) {
      const id = identity(row);
      const isIntro = row.kind === "intro";
      const baseName = isIntro
        ? `${row.exercise_nummer}/audio_intro_${row.lang}_${row.voice}${suffix}`
        : `shared/${row.key}_${row.variant}_${row.lang}_${row.voice}${suffix}`;
      const objectPath = `${baseName}.mp3`;
      const record = { kind: row.kind, key: isIntro ? `intro_${row.exercise_nummer}` : row.key, variant: isIntro ? "intro" : row.variant, lang: row.lang, voice: row.voice, intendedText: row.text, oldText: row.oldText, oldUrl: row.oldUrl, attempts: [], status: "PENDING", newUrl: null };
      results.fragments[id] = record;

      let passedBytes = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (totalCost(results) - costBeforeRun + attemptCostEstimate(row.text, lang) > budgetUsd) {
          budgetStopped = true;
          break;
        }
        const response = await synthesizeWithRetry(tts, {
          input: { text: row.text, prompt: STYLE_PROMPT[lang] },
          voice: { languageCode: LANG_MAP[lang], name: VOICE_MAP[row.voice], modelName: MODEL_NAME },
          audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
        }, id);
        const bytes = Buffer.from(response.audioContent);
        const duration = getMp3DurationSeconds(bytes);
        results.costUsd.tts += duration * TTS_COST_PER_AUDIO_SECOND_USD
          + (row.text.length + STYLE_PROMPT[lang].length) * TTS_INPUT_COST_PER_CHAR_USD;

        const { transcript, partSeconds } = await transcribeMp3InParts(stt, bytes, lang);
        results.costUsd.stt += partSeconds.reduce((sum, seconds) => sum + Math.ceil(seconds), 0) / 60 * STT_COST_PER_MINUTE_USD;
        const check = isIntro
          ? checkIntroTranscript(row.text, transcript, lang, duration)
          : checkSharedTranscript(row.text, transcript, lang, duration);
        const silence = checkSilences(bytes);
        check.longestSilenceSeconds = silence.longestSilenceSeconds;
        check.longestSilenceAt = silence.longestSilenceAt;
        check.listenReasons = [];
        if (check.listen) check.listenReasons.push(`3 words missing in a row ("${check.longestMissingRun.join(" ")}")`);
        if (silence.reject) {
          check.passed = false;
          check.classification = check.classification.startsWith("FAIL") ? `${check.classification}, silence` : "FAIL: silence";
        } else if (silence.listen) {
          check.listenReasons.push(`silence of ${silence.longestSilenceSeconds.toFixed(1)} s at ${silence.longestSilenceAt.toFixed(1)} s`);
        }
        check.listen = check.listenReasons.length > 0;
        record.attempts.push({ attempt, transcript, durationSeconds: duration, partSeconds, ...check });
        saveResults(lang, results);
        console.log(`${id} attempt ${attempt}: ${check.classification} ${(check.agreement * 100).toFixed(1)}% "${transcript}"`);

        if (check.passed) { passedBytes = bytes; break; }
        writeFileSync(path.join(FAILED_DIR, `${baseName.replace("/", "_")}_attempt${attempt}.mp3`), bytes);
      }

      if (!passedBytes) {
        record.status = budgetStopped ? "NOT_RUN_BUDGET" : "FAILED_VERIFICATION";
        saveResults(lang, results);
        if (budgetStopped) break;
        continue;
      }

      const { error: uploadError } = await supabase.storage.from("exercise-media")
        .upload(objectPath, passedBytes, { upsert: false, contentType: "audio/mpeg" });
      if (uploadError) {
        record.status = `UPLOAD_FAILED: ${uploadError.message}`;
        saveResults(lang, results);
        continue;
      }
      const newUrl = supabase.storage.from("exercise-media").getPublicUrl(objectPath).data.publicUrl;
      const update = isIntro
        ? supabase.from("audio_intro_fragments").update({ text: row.text, url: newUrl }, { count: "exact" })
          .eq("exercise_nummer", row.exercise_nummer).eq("lang", row.lang).eq("voice", row.voice).eq("text", row.oldText)
        : supabase.from("audio_fragments").update({ text: row.text, url: newUrl }, { count: "exact" })
          .eq("key", row.key).eq("variant", row.variant).eq("lang", row.lang).eq("voice", row.voice).eq("text", row.oldText);
      const { error: updateError, count } = await update;
      record.status = updateError || count !== 1 ? `DB_UPDATE_FAILED: ${updateError?.message ?? `${count} rows`}` : "REPLACED";
      record.newUrl = newUrl;
      saveResults(lang, results);
    }
  } finally {
    await stt.close();
    await tts.close();
  }

  const all = Object.values(results.fragments);
  console.log(`Replaced: ${all.filter((r) => r.status === "REPLACED").length}; not replaced: ${all.filter((r) => r.status !== "REPLACED").length}.`);
  for (const record of all.filter((r) => r.status !== "REPLACED")) console.log(`  ${record.key} ${record.variant} ${record.lang} ${record.voice}: ${record.status}`);
  for (const record of all.filter((r) => r.status === "REPLACED")) {
    const approved = record.attempts.findLast((attempt) => attempt.passed);
    if (approved?.listen) console.log(`  BELUISTER DIT: ${record.key} ${record.lang} ${record.voice}: ${(approved.listenReasons ?? [`3 words missing in a row ("${approved.longestMissingRun.join(" ")}")`]).join("; ")} ${record.newUrl}`);
  }
  console.log(`Cost this run (estimate): $${(totalCost(results) - costBeforeRun).toFixed(4)}.`);
  console.log(`Cost this language (estimate): TTS $${results.costUsd.tts.toFixed(4)}, STT $${results.costUsd.stt.toFixed(4)}, total $${totalCost(results).toFixed(4)}.`);
  if (budgetStopped) console.log(`Stopped at the $${budgetUsd.toFixed(3)} budget limit.`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
