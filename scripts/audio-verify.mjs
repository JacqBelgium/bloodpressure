import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  compareTranscript,
  classifyVerification,
  createSpeechClient,
  getIntroDeviation,
  getMp3DurationSeconds,
  LANG_MAP,
  STT_COST_PER_MINUTE_USD,
  transcribeMp3,
} from "./audio-utils.mjs";

const rootDir = path.resolve(process.cwd());
const { loadEnvConfig } = nextEnv;
const COST_SOURCE = "https://cloud.google.com/speech-to-text/pricing";
const FREE_MONTHLY_SECONDS = 60 * 60;
const RESULTS_FILE = path.join(rootDir, "tmp", "audio-verify-results.json");
const REPORT_FILE = path.join(rootDir, "tmp", "audio-verify-report.md");

function parseArgs(args) {
  const options = { scope: "shared", estimateOnly: false, priorAudioSeconds: 0, priorSharedOutput: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--scope") {
      options.scope = args[index + 1];
      index += 1;
    } else if (args[index] === "--estimate-only") {
      options.estimateOnly = true;
    } else if (args[index] === "--prior-audio-seconds") {
      options.priorAudioSeconds = Number(args[index + 1]);
      index += 1;
    } else if (args[index] === "--prior-shared-output") {
      options.priorSharedOutput = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  if (!["shared", "intros"].includes(options.scope)) {
    throw new Error("--scope must be shared or intros.");
  }
  if (!Number.isFinite(options.priorAudioSeconds) || options.priorAudioSeconds < 0) {
    throw new Error("--prior-audio-seconds must be a non-negative number.");
  }
  return options;
}

async function fetchAudio(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio download failed (${response.status} ${response.statusText})`);
  return Buffer.from(await response.arrayBuffer());
}

async function getRows(supabase, scope) {
  const table = scope === "shared" ? "audio_fragments" : "audio_intro_fragments";
  const columns = scope === "shared"
    ? "key,variant,lang,voice,text,url"
    : "exercise_nummer,lang,voice,text,url";
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .not("url", "is", null)
    .order(scope === "shared" ? "key" : "exercise_nummer");
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return data ?? [];
}

function rowName(row, scope) {
  return scope === "shared"
    ? `${row.key} variant=${row.variant}`
    : `exercise=${row.exercise_nummer}`;
}

function formatUsd(value) {
  return `$${value.toFixed(4)} USD`;
}

async function prepareAudio(rows) {
  const prepared = [];
  const errors = [];
  for (const row of rows) {
    if (!LANG_MAP[row.lang]) {
      errors.push({ row, error: `Unsupported language code: ${row.lang}` });
      continue;
    }
    if (!row.url || !row.text) {
      errors.push({ row, error: "Missing audio URL or expected text" });
      continue;
    }
    try {
      const bytes = await fetchAudio(row.url);
      const durationSeconds = getMp3DurationSeconds(bytes);
      prepared.push({ row, bytes, durationSeconds, billedSeconds: Math.ceil(durationSeconds) });
    } catch (error) {
      errors.push({ row, error: String(error?.message ?? error) });
    }
  }
  return { prepared, errors };
}

function printEstimate(scope, prepared, errors, priorAudioSeconds) {
  const billedSeconds = prepared.reduce((total, item) => total + item.billedSeconds, 0);
  const listPriceEstimate = billedSeconds / 60 * STT_COST_PER_MINUTE_USD;
  const freeSecondsRemaining = Math.max(0, FREE_MONTHLY_SECONDS - priorAudioSeconds);
  const estimatedBillableSeconds = Math.max(0, billedSeconds - freeSecondsRemaining);
  const estimatedInvoiceCost = estimatedBillableSeconds / 60 * STT_COST_PER_MINUTE_USD;
  console.log(`Speech-to-Text scope: ${scope}; audio rows: ${prepared.length}; unavailable rows: ${errors.length}`);
  console.log(`Language codes: ${Object.values(LANG_MAP).join(", ")}; pricing assumption: v1 without data logging, $0.024 per audio minute, each row rounded up to the next second.`);
  console.log(`Audio duration: ${prepared.reduce((total, item) => total + item.durationSeconds, 0).toFixed(1)} sec; billable estimate: ${billedSeconds} sec (${(billedSeconds / 60).toFixed(2)} min).`);
  console.log(`EXPECTED SPEECH-TO-TEXT LIST-PRICE: ${formatUsd(listPriceEstimate)} (not including possible storage/network charges).`);
  console.log(`Estimated incremental invoice cost if the monthly 60-minute free tier had no usage before the specified ${priorAudioSeconds} prior seconds: ${formatUsd(estimatedInvoiceCost)} (${estimatedBillableSeconds} billable seconds after remaining free allowance).`);
  console.log("Actual invoice cost may be higher if there was other Speech-to-Text usage this month; the script cannot inspect remaining account allowance.");
  console.log(`Pricing source: ${COST_SOURCE}`);
  for (const { row, error } of errors) console.error(`UNAVAILABLE ${rowName(row, scope)} lang=${row.lang} voice=${row.voice}: ${error}`);
  return { billedSeconds, listPriceEstimate, estimatedInvoiceCost };
}

function readResults() {
  if (!existsSync(RESULTS_FILE)) {
    return {
      version: 1,
      costs: { sharedBilledSeconds: 548, sharedListPriceUsd: 0.2192, introBilledSeconds: 0, introListPriceUsd: 0 },
      shared: [],
      intros: [],
    };
  }
  return JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
}

function saveResults(results) {
  writeFileSync(RESULTS_FILE, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

function importPriorSharedOutput(outputPath, databaseRows) {
  if (!outputPath || !existsSync(outputPath)) {
    throw new Error("The previous shared check output is required to preserve the 30 transcripts; use --prior-shared-output <path>. No Speech-to-Text calls were made.");
  }
  const output = readFileSync(outputPath, "utf8");
  const oldRows = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line.startsWith("{\"key\":")) continue;
    try {
      const item = JSON.parse(line);
      if (typeof item.key === "string" && typeof item.transcript === "string") oldRows.push(item);
    } catch {
      // Ignore lines that resemble JSON but are not complete result rows.
    }
  }
  const byIdentity = new Map(oldRows.map((row) => [`${row.key}|${row.variant}|${row.lang}|${row.voice}`, row]));
  if (byIdentity.size !== 30) {
    throw new Error(`Expected 30 detailed transcripts in ${outputPath}, found ${byIdentity.size}; refusing to re-transcribe shared files.`);
  }

  const priorMetadata = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^Checked (.+?) lang=(nl|en) voice=(vrouw|man): ([\d.]+)% word agreement; (\d+)\/(\d+) words\.$/u);
    if (!match) continue;
    const [, name, language, voice, agreement, transcriptWordCount, expectedWordCount] = match;
    const shared = name.match(/^(.+) variant=(\d+)$/u);
    if (!shared) continue;
    priorMetadata.set(`${shared[1]}|${shared[2]}|${language}|${voice}`, {
      agreement: Number(agreement) / 100,
      transcriptWordCount: Number(transcriptWordCount),
      expectedWordCount: Number(expectedWordCount),
    });
  }

  return databaseRows.map((row) => {
    const identity = `${row.key}|${row.variant}|${row.lang}|${row.voice}`;
    const previous = byIdentity.get(identity);
    const metadata = priorMetadata.get(identity);
    if (!previous) {
      if (!metadata || metadata.agreement < 0.8
        || metadata.transcriptWordCount > metadata.expectedWordCount * 1.5) {
        throw new Error(`Prior output does not prove this row passed: ${identity}; refusing to repeat recognition.`);
      }
      return {
        key: row.key,
        variant: row.variant,
        language: row.lang,
        voice: row.voice,
        status: "PASSED_PREVIOUS_STRICT_CHECK_TRANSCRIPT_NOT_STORED",
      };
    }
    const comparison = classifyVerification({ expectedText: row.text, transcript: previous.transcript }, row.lang);
    return {
      kind: "shared",
      key: row.key,
      variant: row.variant,
      language: row.lang,
      voice: row.voice,
      intendedText: row.text,
      transcript: previous.transcript,
      url: row.url,
      previousScore: previous.agreement,
      previousExpectedWordCount: previous.expectedWordCount,
      previousTranscriptWordCount: previous.transcriptWordCount,
      agreement: comparison.agreement,
      expectedWordCount: comparison.expectedWordCount,
      transcriptWordCount: comparison.transcriptWordCount,
      wrongLanguage: comparison.wrongLanguage,
      repeated: comparison.tooLong || comparison.repeatedPhrase,
      classification: comparison.classification,
      status: comparison.isMismatch ? "FLAGGED" : "PASSED_REANALYZED",
    };
  });
}

function makeReport(results) {
  const rows = [...results.shared, ...results.intros]
    .filter((row) => typeof row.transcript === "string")
    .map((row) => {
      const options = row.kind === "intro"
        ? { minimumAgreement: 0.9, repetitionRatio: 1.15, repetitionInclusive: false }
        : {};
      const comparison = classifyVerification({ expectedText: row.intendedText, transcript: row.transcript }, row.language, options);
      const introDeviation = row.kind === "intro"
        ? getIntroDeviation(row.intendedText, row.transcript)
        : null;
      const durationMismatch = row.kind === "intro" && row.durationRatio > 1.4;
      const normalByAllowedIntroDifferences = row.kind === "intro"
        && introDeviation.onlyAllowedDifferences
        && !comparison.wrongLanguage;
      const classification = comparison.wrongLanguage
        ? "TAAL FOUT"
        : (durationMismatch && !normalByAllowedIntroDifferences
          ? "ANDERE AFWIJKING"
          : (normalByAllowedIntroDifferences
            ? "NORMAAL"
            : (comparison.isMismatch ? comparison.classification : "OK")));
      const textMismatch = normalByAllowedIntroDifferences ? false : comparison.isMismatch;
      const record = {
        ...row,
        ...comparison,
        isMismatch: textMismatch || durationMismatch,
        classification,
        introDeviation,
        status: textMismatch || durationMismatch ? "FLAGGED" : "PASSED",
      };
      row.agreement = comparison.agreement;
      row.expectedWordCount = comparison.expectedWordCount;
      row.transcriptWordCount = comparison.transcriptWordCount;
      row.wrongLanguage = comparison.wrongLanguage;
      row.repeated = comparison.tooLong || comparison.repeatedPhrase;
      row.classification = classification;
      row.status = record.status;
      row.normalizedClassification = classification;
      if (introDeviation) {
        row.differenceCount = introDeviation.differenceCount;
        row.deviationDescription = introDeviation.description;
        row.onlyAllowedDifferences = introDeviation.onlyAllowedDifferences;
      }
      return record;
    });
  const mismatches = rows.filter((row) => row.isMismatch || row.durationRatio > 1.4);
  const groups = {
    "TAAL FOUT": mismatches.filter((row) => row.wrongLanguage),
    HERHALING: mismatches.filter((row) => !row.wrongLanguage && (row.tooLong || row.repeatedPhrase)),
    "ANDERE AFWIJKING": mismatches.filter((row) => row.classification === "ANDERE AFWIJKING"),
    NORMAAL: rows.filter((row) => row.kind === "intro"
      && row.introDeviation?.onlyAllowedDifferences
      && !row.wrongLanguage),
  };

  const makeTable = (tableRows) => {
    if (tableRows.length === 0) return "Geen.\n";
    const lines = [
      "| key | variant | taal | stem | bedoelde tekst | uitgeschreven tekst | score | afwijkende woorden | toelichting | duur | url |",
      "|---|---:|---|---|---|---|---:|---:|---|---:|---|",
    ];
    for (const row of tableRows) {
      const cell = (value) => String(value ?? "").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
      const key = row.key ?? `exercise_${row.exerciseNumber}`;
      const variant = row.variant ?? "intro";
      const duration = row.durationSeconds == null ? "—" : `${row.durationSeconds.toFixed(2)} s (${row.durationRatio.toFixed(2)}× verwacht)`;
      const deviationCount = row.kind === "intro" ? row.introDeviation?.differenceCount ?? 0 : "—";
      const description = row.kind === "intro" ? row.introDeviation?.description ?? "" : "";
      lines.push(`| ${cell(key)} | ${cell(variant)} | ${cell(row.language)} | ${cell(row.voice)} | ${cell(row.intendedText)} | ${cell(row.transcript)} | ${(row.agreement * 100).toFixed(1)}% | ${deviationCount} | ${cell(description)} | ${duration} | ${cell(row.url)} |`);
    }
    return `${lines.join("\n")}\n`;
  };

  const lines = ["# Audioverificatierapport", "", `Gemarkeerd: ${mismatches.length}; normaal (alleen getallen/graden, genoemde Engelse oefentermen of leestekens): ${groups.NORMAAL.length}.`, ""];
  for (const group of ["TAAL FOUT", "HERHALING", "ANDERE AFWIJKING"]) {
    lines.push(`## ${group}`, "", makeTable(groups[group]), "");
  }
  lines.push("## NORMAAL", "", `Aantal: ${groups.NORMAAL.length}`, "");
  const remainingIntroRows = mismatches.filter((row) => row.kind === "intro" && row.classification !== "NORMAAL");
  lines.push(`## Intro's: overige afwijkingen (${remainingIntroRows.length})`, "", makeTable(remainingIntroRows), "");
  lines.push("## Kosten", "", `Gedeelde fragmenten: ${results.costs.sharedListPriceUsd.toFixed(4)} USD lijstprijs (${results.costs.sharedBilledSeconds} seconden).`);
  lines.push(`Introfragmenten: ${results.costs.introListPriceUsd.toFixed(4)} USD lijstprijs (${results.costs.introBilledSeconds} seconden).`);
  lines.push(`Totaal lijstprijs: ${(results.costs.sharedListPriceUsd + results.costs.introListPriceUsd).toFixed(4)} USD.`, "");
  writeFileSync(REPORT_FILE, `${lines.join("\n")}\n`, "utf8");
  return { groups, mismatches, rows };
}

async function main() {
  loadEnvConfig(rootDir);
  const options = parseArgs(process.argv.slice(2));
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local or the environment.");
  }

  const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const results = readResults();
  if (options.scope === "intros" && results.shared.length === 0) {
    const sharedRows = await getRows(supabase, "shared");
    results.shared = importPriorSharedOutput(options.priorSharedOutput, sharedRows);
    saveResults(results);
  }

  const rows = await getRows(supabase, options.scope);
  if (rows.length === 0) throw new Error(`No ${options.scope} audio rows with URLs were found.`);
  const keyForRow = (row) => options.scope === "shared"
    ? `${row.key}|${row.variant}|${row.lang}|${row.voice}`
    : `${row.exercise_nummer}|${row.lang}|${row.voice}`;
  const completed = new Set((options.scope === "shared" ? results.shared : results.intros)
    .filter((row) => row.transcript !== undefined)
    .map((row) => options.scope === "shared"
      ? `${row.key}|${row.variant}|${row.language}|${row.voice}`
      : `${row.exerciseNumber}|${row.language}|${row.voice}`));
  const pendingRows = rows.filter((row) => !completed.has(keyForRow(row)));
  console.log(`Preparing ${pendingRows.length}/${rows.length} uncached ${options.scope} audio rows for language-matched transcription.`);
  const { prepared, errors } = await prepareAudio(pendingRows);
  const priorAudioSeconds = options.priorAudioSeconds || results.costs.sharedBilledSeconds;
  const { listPriceEstimate, estimatedInvoiceCost } = printEstimate(
    options.scope,
    prepared,
    errors,
    priorAudioSeconds,
  );
  if (options.estimateOnly) return;
  if (prepared.length === 0) {
    const report = makeReport(results);
    saveResults(results);
    console.log(`No new transcription required; report updated at ${REPORT_FILE}.`);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(report.groups).map(([name, group]) => [name, group.length])), null, 2));
    console.log(`Intro list-price: ${formatUsd(results.costs.introListPriceUsd)}; total list-price: ${formatUsd(results.costs.sharedListPriceUsd + results.costs.introListPriceUsd)}.`);
    console.log(`Estimated invoice amount after monthly free tier, assuming no earlier Speech-to-Text usage: ${formatUsd(Math.max(0, results.costs.sharedBilledSeconds + results.costs.introBilledSeconds - FREE_MONTHLY_SECONDS) / 60 * STT_COST_PER_MINUTE_USD)}.`);
    return;
  }

  console.log("Starting Speech-to-Text; results are cached after each successful row. No uploads or database changes are performed.");
  const failures = [...errors];
  let successfulBilledSeconds = 0;
  const speechClient = createSpeechClient();
  try {
    for (const item of prepared) {
      const { row } = item;
      const language = row.lang;
      const expectedText = row.text;
      try {
        const transcript = await transcribeMp3(speechClient, item.bytes, language);
        successfulBilledSeconds += item.billedSeconds;
        const isIntro = options.scope === "intros";
        const comparisonOptions = isIntro
          ? { minimumAgreement: 0.9, repetitionRatio: 1.15, repetitionInclusive: false }
          : {};
        const comparison = compareTranscript(expectedText, transcript, language, comparisonOptions);
        const expectedDurationSeconds = expectedText.length / 14;
        const durationRatio = expectedDurationSeconds > 0 ? item.durationSeconds / expectedDurationSeconds : 0;
        const durationMismatch = isIntro && durationRatio > 1.4;
        const record = {
          kind: isIntro ? "intro" : "shared",
          key: isIntro ? null : row.key,
          variant: isIntro ? null : row.variant,
          exerciseNumber: isIntro ? row.exercise_nummer : null,
          language,
          voice: row.voice,
          intendedText: expectedText,
          transcript,
          url: row.url,
          agreement: comparison.agreement,
          expectedWordCount: comparison.expectedWordCount,
          transcriptWordCount: comparison.transcriptWordCount,
          wrongLanguage: comparison.wrongLanguage,
          repeated: comparison.tooLong || comparison.repeatedPhrase,
          durationSeconds: item.durationSeconds,
          expectedDurationSeconds,
          durationRatio,
          status: comparison.isMismatch || durationMismatch ? "FLAGGED" : "PASSED",
          billedSeconds: item.billedSeconds,
        };
        const target = isIntro ? results.intros : results.shared;
        const identity = keyForRow(row);
        const existingIndex = target.findIndex((saved) => (isIntro
          ? `${saved.exerciseNumber}|${saved.language}|${saved.voice}`
          : `${saved.key}|${saved.variant}|${saved.language}|${saved.voice}`) === identity);
        if (existingIndex === -1) target.push(record);
        else target[existingIndex] = record;

        if (isIntro) {
          results.costs.introBilledSeconds += item.billedSeconds;
          results.costs.introListPriceUsd = results.costs.introBilledSeconds / 60 * STT_COST_PER_MINUTE_USD;
        } else {
          results.costs.sharedBilledSeconds += item.billedSeconds;
          results.costs.sharedListPriceUsd = results.costs.sharedBilledSeconds / 60 * STT_COST_PER_MINUTE_USD;
        }
        saveResults(results);
        console.log(`Checked ${rowName(row, options.scope)} lang=${language} voice=${row.voice}: ${(comparison.agreement * 100).toFixed(1)}%; duration ${item.durationSeconds.toFixed(2)}s / expected ${expectedDurationSeconds.toFixed(2)}s (${durationRatio.toFixed(2)}x); ${record.status}.`);
      } catch (error) {
        failures.push({ row, error: String(error?.message ?? error) });
        console.error(`FAILED ${rowName(row, options.scope)} lang=${language} voice=${row.voice}: ${String(error?.message ?? error)}`);
      }
    }
  } finally {
    await speechClient.close();
  }

  const report = makeReport(results);
  saveResults(results);
  console.log(`\nReport saved: ${REPORT_FILE}`);
  console.log(`Results saved: ${RESULTS_FILE}`);
  console.log(`Intro speech billing measured: ${results.costs.introBilledSeconds} sec; list-price total: ${formatUsd(results.costs.introListPriceUsd)}.`);
  console.log(`All checks total list price: ${formatUsd(results.costs.sharedListPriceUsd + results.costs.introListPriceUsd)}; estimated cost after known shared usage and remaining free allowance: ${formatUsd(Math.max(0, results.costs.sharedBilledSeconds + results.costs.introBilledSeconds - FREE_MONTHLY_SECONDS) / 60 * STT_COST_PER_MINUTE_USD)}.`);
  for (const [group, groupRows] of Object.entries(report.groups)) {
    console.log(`\n${group}: ${groupRows.length}`);
    if (group === "NORMAAL") continue;
    for (const record of groupRows) {
      console.log(JSON.stringify({
        key: record.key ?? `exercise_${record.exerciseNumber}`,
        variant: record.variant ?? "intro",
        language: record.language,
        voice: record.voice,
        intendedText: record.intendedText,
        transcript: record.transcript,
        score: record.agreement,
        durationSeconds: record.durationSeconds,
        durationRatio: record.durationRatio,
        url: record.url,
      }));
    }
  }
  console.log(`\nSpeech-to-Text completion: ${results.intros.length}/${rows.length} intro rows cached; failed requests: ${failures.length}. Pending estimated list price: ${formatUsd(listPriceEstimate)}; estimated invoice cost: ${formatUsd(estimatedInvoiceCost)}; successfully billed this run: ${formatUsd(successfulBilledSeconds / 60 * STT_COST_PER_MINUTE_USD)}.`);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`audio-verify failed: ${error?.stack ?? error}`);
    process.exitCode = 1;
  });
}
