import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  classifyVerification,
  createSpeechClient,
  compareTranscript,
  getMp3DurationSeconds,
  getWordDifferences,
  LANG_MAP,
  normalizeIntroMeaningfulWords,
  STT_COST_PER_MINUTE_USD,
  STYLE_PROMPT,
  transcribeMp3,
} from "./audio-utils.mjs";

// Regenerates the approved shared fragments and English intros as *_v2.mp3,
// verifies each with language-matched speech recognition and only then
// replaces the URL.
// Old files are left untouched. Default is a dry run; pass --run to execute.

const MODEL_NAME = "gemini-3.1-flash-tts-preview";
const VOICE_MAP = { vrouw: "Leda", man: "Charon" };
const MAX_ATTEMPTS = 3; // 1 + 2 extra
const BUDGET_USD = 1.0;
const INTRO_TARGETS = [[17, "vrouw"], [9, "vrouw"]];
const INTRO_MIN_AGREEMENT = 0.9;
const INTRO_MAX_DURATION_RATIO = 1.4;
// Gemini 3.1 Flash TTS preview: $20 / 1M audio output tokens at 25 tokens per second of audio.
const TTS_COST_PER_AUDIO_SECOND_USD = 20 / 1_000_000 * 25;
const TTS_INPUT_COST_PER_CHAR_USD = 1 / 1_000_000 / 4; // $1 / 1M input tokens, ~4 chars per token
const CHARS_PER_SECOND = 14;
const WORST_CASE_SECONDS_FACTOR = 2; // budget guard reserves twice the expected duration per attempt

const rootDir = path.resolve(process.cwd());
const RESULTS_FILE = path.join(rootDir, "tmp", "audio-regenerate-v2-results.json");
const FAILED_DIR = path.join(rootDir, "tmp", "audio-regenerate-v2-failed");

const isTarget = (row) => row.lang === "en"
  || (row.key === "openingszin" && row.variant === 3 && row.lang === "nl" && row.voice === "vrouw");
const identity = (row) => row.kind === "intro"
  ? `intro_${row.exercise_nummer}|intro|${row.lang}|${row.voice}`
  : `${row.key}|${row.variant}|${row.lang}|${row.voice}`;

function checkShared(row, transcript) {
  const check = classifyVerification({ expectedText: row.text, transcript }, row.lang);
  return { agreement: check.agreement, classification: check.classification, passed: check.classification === "OK" || check.classification === "NORMAAL" };
}

// Intros: >= 90% agreement after normalising numbers/degrees and English exercise
// terms, no wrong language or repetition, and duration <= 1.4x expected.
function checkIntro(row, transcript, durationSeconds) {
  const expected = normalizeIntroMeaningfulWords(row.text);
  const actual = normalizeIntroMeaningfulWords(transcript);
  const diff = getWordDifferences(expected, actual);
  const agreement = expected.length === 0 ? 0 : Math.max(0, 1 - diff.count / expected.length);
  const base = compareTranscript(row.text, transcript, row.lang, { minimumAgreement: 0, repetitionRatio: 1.15, repetitionInclusive: false });
  const durationRatio = durationSeconds / (row.text.length / CHARS_PER_SECOND);
  const reasons = [];
  if (agreement < INTRO_MIN_AGREEMENT) reasons.push("agreement");
  if (durationRatio > INTRO_MAX_DURATION_RATIO) reasons.push("duration");
  if (base.wrongLanguage) reasons.push("language");
  if (base.tooLong || base.repeatedPhrase) reasons.push("repetition");
  return {
    agreement,
    durationRatio,
    missingWords: diff.expectedOnly,
    extraWords: diff.actualOnly,
    classification: reasons.length === 0 ? "OK" : `FAIL: ${reasons.join(", ")}`,
    passed: reasons.length === 0,
  };
}

function readResults() {
  if (!existsSync(RESULTS_FILE)) return { costUsd: { tts: 0, stt: 0 }, fragments: {} };
  return JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
}

function saveResults(results) {
  writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

const totalCost = (results) => results.costUsd.tts + results.costUsd.stt;

function attemptCostEstimate(text) {
  const seconds = Math.ceil(text.length / CHARS_PER_SECOND * WORST_CASE_SECONDS_FACTOR);
  return seconds * TTS_COST_PER_AUDIO_SECOND_USD
    + (text.length + 300) * TTS_INPUT_COST_PER_CHAR_USD
    + seconds / 60 * STT_COST_PER_MINUTE_USD;
}

async function main() {
  nextEnv.loadEnvConfig(rootDir);
  const run = process.argv.includes("--run");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.from("audio_fragments")
    .select("key,variant,lang,voice,text,url").order("lang").order("voice").order("key").order("variant");
  if (error) throw new Error(`Could not load audio_fragments: ${error.message}`);
  const sharedTargets = data.filter(isTarget).map((row) => ({ ...row, kind: "shared" }));
  if (sharedTargets.length !== 51) throw new Error(`Expected 51 shared target rows, found ${sharedTargets.length}; stopping.`);

  const { data: introData, error: introError } = await supabase.from("audio_intro_fragments")
    .select("exercise_nummer,lang,voice,text,url").eq("lang", "en")
    .in("exercise_nummer", INTRO_TARGETS.map(([number]) => number));
  if (introError) throw new Error(`Could not load audio_intro_fragments: ${introError.message}`);
  const introTargets = INTRO_TARGETS.map(([number, voice]) => introData.find((row) => row.exercise_nummer === number && row.voice === voice))
    .filter(Boolean).map((row) => ({ ...row, kind: "intro" }));
  if (introTargets.length !== 2) throw new Error(`Expected 2 intro target rows, found ${introTargets.length}; stopping.`);
  const targets = [...sharedTargets, ...introTargets];

  const expectedSinglePass = targets.reduce((sum, row) => sum + attemptCostEstimate(row.text) / WORST_CASE_SECONDS_FACTOR, 0);
  console.log(`Targets: ${targets.length}; estimated cost of one pass: $${expectedSinglePass.toFixed(3)}; budget $${BUDGET_USD}.`);
  if (!run) {
    console.log("Dry run: nothing generated. Pass --run to execute.");
    return;
  }

  mkdirSync(FAILED_DIR, { recursive: true });
  const results = readResults();
  const tts = new TextToSpeechClient();
  const stt = createSpeechClient();
  let budgetStopped = false;

  try {
    for (const row of targets) {
      const id = identity(row);
      if (results.fragments[id]?.status === "REPLACED") continue;
      const isIntro = row.kind === "intro";
      const baseName = isIntro
        ? `${row.exercise_nummer}/audio_intro_${row.lang}_${row.voice}_v2`
        : `shared/${row.key}_${row.variant}_${row.lang}_${row.voice}_v2`;
      const objectPath = `${baseName}.mp3`;
      const record = { kind: row.kind, key: isIntro ? `intro_${row.exercise_nummer}` : row.key, variant: isIntro ? "intro" : row.variant, lang: row.lang, voice: row.voice, intendedText: row.text, oldUrl: row.url, attempts: [], status: "PENDING", newUrl: null };
      results.fragments[id] = record;

      let passedBytes = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (totalCost(results) + attemptCostEstimate(row.text) > BUDGET_USD) {
          budgetStopped = true;
          break;
        }
        const [response] = await tts.synthesizeSpeech({
          input: { text: row.text, prompt: STYLE_PROMPT[row.lang] },
          voice: { languageCode: LANG_MAP[row.lang], name: VOICE_MAP[row.voice], modelName: MODEL_NAME },
          audioConfig: { audioEncoding: "MP3", sampleRateHertz: 24000 },
        }, { timeout: 120000 });
        const bytes = Buffer.from(response.audioContent);
        const duration = getMp3DurationSeconds(bytes);
        results.costUsd.tts += duration * TTS_COST_PER_AUDIO_SECOND_USD
          + (row.text.length + STYLE_PROMPT[row.lang].length) * TTS_INPUT_COST_PER_CHAR_USD;

        const transcript = await transcribeMp3(stt, bytes, row.lang);
        results.costUsd.stt += Math.ceil(duration) / 60 * STT_COST_PER_MINUTE_USD;
        const check = isIntro ? checkIntro(row, transcript, duration) : checkShared(row, transcript);
        const { passed } = check;
        record.attempts.push({ attempt, transcript, durationSeconds: duration, ...check });
        saveResults(results);
        console.log(`${id} attempt ${attempt}: ${check.classification} ${(check.agreement * 100).toFixed(1)}% "${transcript}"`);

        if (passed) { passedBytes = bytes; break; }
        writeFileSync(path.join(FAILED_DIR, `${baseName.replace("/", "_")}_attempt${attempt}.mp3`), bytes);
      }

      if (!passedBytes) {
        record.status = budgetStopped ? "NOT_RUN_BUDGET" : "FAILED_VERIFICATION";
        saveResults(results);
        if (budgetStopped) break;
        continue;
      }

      const { error: uploadError } = await supabase.storage.from("exercise-media")
        .upload(objectPath, passedBytes, { upsert: false, contentType: "audio/mpeg" });
      if (uploadError) {
        record.status = `UPLOAD_FAILED: ${uploadError.message}`;
        saveResults(results);
        continue;
      }
      const newUrl = supabase.storage.from("exercise-media").getPublicUrl(objectPath).data.publicUrl;
      const update = isIntro
        ? supabase.from("audio_intro_fragments").update({ url: newUrl }, { count: "exact" })
          .eq("exercise_nummer", row.exercise_nummer).eq("lang", row.lang).eq("voice", row.voice)
        : supabase.from("audio_fragments").update({ url: newUrl }, { count: "exact" })
          .eq("key", row.key).eq("variant", row.variant).eq("lang", row.lang).eq("voice", row.voice);
      const { error: updateError, count } = await update;
      record.status = updateError || count !== 1 ? `DB_UPDATE_FAILED: ${updateError?.message ?? `${count} rows`}` : "REPLACED";
      record.newUrl = newUrl;
      saveResults(results);
    }
  } finally {
    await stt.close();
    await tts.close();
  }

  const all = Object.values(results.fragments);
  console.log(`Replaced: ${all.filter((r) => r.status === "REPLACED").length}; not replaced: ${all.filter((r) => r.status !== "REPLACED").length}.`);
  console.log(`Cost this round (estimate): TTS $${results.costUsd.tts.toFixed(4)}, STT $${results.costUsd.stt.toFixed(4)}, total $${totalCost(results).toFixed(4)}.`);
  if (budgetStopped) console.log(`Stopped at the $${BUDGET_USD} budget limit.`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
