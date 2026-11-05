import { v1p1beta1 } from "@google-cloud/speech";

export const LANG_MAP = {
  nl: "nl-NL",
  en: "en-US",
};

export const STYLE_PROMPT = {
  nl: "Spreek dit uit als een vriendelijke, rustige personal trainer die een cliënt persoonlijk begeleidt tijdens een rustgevende oefening. Gebruik natuurlijke pauzes bij het ademhalen en een warme, bemoedigende toon. Lees de tekst letterlijk voor, zonder woorden toe te voegen, weg te laten of te herhalen.",
  en: "Speak like a friendly, calm personal trainer coaching a client through a relaxing exercise. Use natural pauses for breathing and a warm, encouraging tone. Read the text exactly as written, without adding, omitting or repeating any words.",
};

export const STT_COST_PER_MINUTE_USD = 0.024;
// Synchronous recognize accepts at most 60 s; keep a margin.
export const STT_MAX_PART_SECONDS = 59;

// Fixed speech-recognition spellings that count as the expected words.
const transcriptionVariants = new Map([
  ["spanje", ["span", "je"]],
  ["zolang", ["zo", "lang"]],
  ["houdt", ["houd"]],
  ["knieënsteun", ["knieën", "steun"]],
]);

export function normalizeWords(value) {
  const digitWords = {
    nl: new Map([
      ["een", "1"], ["één", "1"],
      ["twee", "2"], ["tweede", "2"],
      ["drie", "3"], ["derde", "3"],
      ["vier", "4"], ["vierde", "4"],
      ["vijf", "5"], ["vijfde", "5"], ["negentig", "90"], ["honderdtwintig", "120"],
      ["vijfenveertig", "45"],
    ]),
    en: new Map([
      ["one", "1"], ["first", "1"],
      ["two", "2"], ["second", "2"],
      ["three", "3"], ["third", "3"],
      ["four", "4"], ["fourth", "4"],
      ["five", "5"], ["fifth", "5"], ["ninety", "90"], ["hundred", "100"],
      ["twenty", "20"], ["forty", "40"], ["twelve", "12"], ["degree", "degree"],
      ["degrees", "degree"],
    ]),
  };

  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap((word) => transcriptionVariants.get(word) ?? [word])
    .map((word) => {
      const setNumber = word.match(/^z([1-4])$/u);
      return setNumber?.[1] ?? digitWords.nl.get(word) ?? digitWords.en.get(word) ?? word;
    });
}

export function compareTranscript(expectedText, transcript, lang = "en", options = {}) {
  const expected = normalizeWords(expectedText);
  const actual = normalizeWords(transcript);
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    let diagonal = previous[0];
    previous[0] = expectedIndex;
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      const above = previous[actualIndex];
      const substitutionCost = expected[expectedIndex - 1] === actual[actualIndex - 1] ? 0 : 1;
      previous[actualIndex] = Math.min(
        previous[actualIndex] + 1,
        previous[actualIndex - 1] + 1,
        diagonal + substitutionCost,
      );
      diagonal = above;
    }
  }

  const editDistance = previous[actual.length];
  const agreement = expected.length === 0
    ? (actual.length === 0 ? 1 : 0)
    : Math.max(0, 1 - editDistance / expected.length);
  const shortFragment = expected.length <= 5;
  const repetitionLimit = options.repetitionRatio ?? 1.5;
  const tooLong = expected.length > 0 && (options.repetitionInclusive === false
    ? actual.length > expected.length * repetitionLimit
    : actual.length >= expected.length * repetitionLimit);
  const repeatedPhrase = hasRepeatedPhrase(expected, actual);
  const wrongLanguage = hasWrongLanguageMarkers(transcript, lang, expectedText, agreement);
  const minimumAgreement = options.minimumAgreement ?? (shortFragment ? 0.5 : 0.8);
  const isMismatch = wrongLanguage
    || tooLong
    || repeatedPhrase
    || agreement < minimumAgreement;

  return {
    expectedWordCount: expected.length,
    transcriptWordCount: actual.length,
    agreement,
    tooLong,
    wrongLanguage,
    repeatedPhrase,
    shortFragment,
    isMismatch,
  };
}

const languageMarkers = {
  nl: new Set(["de", "het", "een", "je", "en", "om", "nu", "voor"]),
  en: new Set(["the", "you", "your", "and", "is", "to", "now", "for"]),
};

const languageVocabulary = {
  nl: new Set("de het een je en om nu voor vandaag tijd om bloeddruk een handje te helpen dat was laatste set heel goed gedaan tot volgende keer klaar fijn er bent laten we beginnen oefeningen oefening vier keer bekijk eerst fotos beginpositie ga op rug liggen houd vast rustig ademhalen volgende".split(" ")),
  en: new Set("the you your and is to now for today time give blood pressure a helping hand that was last set very well done see next time ready exercise good see lets get started".split(" ")),
};

function hasWrongLanguageMarkers(transcript, expectedLang, expectedText = "", agreement = 1) {
  const expectedMarkers = languageMarkers[expectedLang];
  const otherMarkers = languageMarkers[expectedLang === "nl" ? "en" : "nl"];
  if (!expectedMarkers || !transcript.trim()) return false;
  const words = transcript
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const expectedCount = words.filter((word) => expectedMarkers.has(word)).length;
  const otherCount = words.filter((word) => otherMarkers.has(word)).length;
  const expectedVocabulary = languageVocabulary[expectedLang];
  const otherVocabulary = languageVocabulary[expectedLang === "nl" ? "en" : "nl"];
  const vocabularyWords = words.filter((word) => word.length > 1);
  const expectedVocabularyCount = vocabularyWords.filter((word) => expectedVocabulary.has(word)).length;
  const otherVocabularyCount = vocabularyWords.filter((word) => otherVocabulary.has(word)).length;
  const expectedTokens = normalizeWords(expectedText);
  const transcriptExpectedOverlap = expectedTokens.length === 0
    ? 0
    : words.filter((word) => expectedTokens.includes(word)).length / expectedTokens.length;

  if (otherCount >= 2 && otherCount > expectedCount) return true;
  if (vocabularyWords.length === 0 || transcriptExpectedOverlap >= 0.7) return false;
  if (agreement < 0.5 && vocabularyWords.length <= 2) return true;
  if (vocabularyWords.length >= 3 && otherVocabularyCount >= 2
    && otherVocabularyCount > expectedVocabularyCount) return true;

  const minimumExpectedMarkers = Math.max(1, Math.ceil(vocabularyWords.length * 0.15));
  if (agreement < 0.8 && expectedCount < minimumExpectedMarkers) return true;

  const looksClearlyEnglish = /\b(the|you|your|and|is|to|now|for|a|of|in|with|was|were)\b/iu.test(transcript);
  const looksClearlyDutch = /\b(de|het|een|je|en|om|nu|voor|vandaag|dat|op|met|van|zijn|doe)\b/iu.test(transcript);
  return expectedLang === "en" ? looksClearlyDutch : looksClearlyEnglish;
}

function hasRepeatedPhrase(expected, actual) {
  if (expected.length < 3 || actual.length < expected.length * 1.35) return false;
  for (let phraseLength = Math.min(expected.length, Math.floor(actual.length / 2)); phraseLength >= 3; phraseLength -= 1) {
    for (let start = 0; start <= expected.length - phraseLength; start += 1) {
      const phrase = expected.slice(start, start + phraseLength);
      let occurrences = 0;
      for (let actualStart = 0; actualStart <= actual.length - phraseLength; actualStart += 1) {
        if (phrase.every((word, index) => actual[actualStart + index] === word)) occurrences += 1;
      }
      if (occurrences >= 2) return true;
    }
  }
  return false;
}

export function classifyVerification(record, lang, options = {}) {
  const comparison = compareTranscript(record.expectedText, record.transcript, lang, options);
  const expectedWords = normalizeWords(record.expectedText);
  const actualWords = normalizeWords(record.transcript);
  const numbersAndSpellingOnly = expectedWords.length === actualWords.length
    && expectedWords.every((word, index) => word === actualWords[index]
      || (word.length >= 3 && actualWords[index].length >= 3
        && levenshtein(word, actualWords[index]) <= 1));
  const exactMatch = expectedWords.length === actualWords.length
    && expectedWords.every((word, index) => word === actualWords[index]);

  let classification = numbersAndSpellingOnly && !exactMatch ? "NORMAAL" : "OK";
  if (comparison.wrongLanguage) classification = "TAAL FOUT";
  else if (comparison.tooLong || comparison.repeatedPhrase) classification = "HERHALING";
  else if (numbersAndSpellingOnly && !exactMatch) classification = "NORMAAL";
  else if (comparison.isMismatch) classification = "ANDERE AFWIJKING";

  return { ...comparison, classification };
}

const introEnglishTerms = new Set([
  "back", "prone", "wall", "sit", "single", "leg", "deadlift", "push", "up", "hold",
  "forefoot", "stance", "arm", "pull", "sumo", "squat", "split", "plank", "level",
  "glute", "bridge", "birddog",
]);

function normalizeIntroWords(value) {
  const words = normalizeWords(value.replace(/(\d)\s*°/gu, "$1 degree"));
  const converted = words.map((word) => word === "graden" ? "degree" : word);
  const normalized = [];
  for (let index = 0; index < converted.length; index += 1) {
    if (converted[index] === "1" && converted[index + 1] === "100" && converted[index + 2] === "and" && converted[index + 3] === "20") {
      normalized.push("120");
      index += 3;
      continue;
    }
    if (converted[index] === "40" && converted[index + 1] === "5") {
      normalized.push("45");
      index += 1;
      continue;
    }
    normalized.push(converted[index]);
  }
  const withDegrees = [];
  for (let index = 0; index < normalized.length; index += 1) {
    if (["45", "90", "120"].includes(normalized[index]) && normalized[index + 1] === "degree") {
      withDegrees.push(`${normalized[index]}degree`);
      index += 1;
    } else {
      withDegrees.push(normalized[index]);
    }
  }
  return withDegrees;
}

export function normalizeIntroMeaningfulWords(value) {
  return normalizeIntroWords(value).filter((word) => !introEnglishTerms.has(word));
}

export function getIntroDeviation(expectedText, transcript) {
  const expectedRaw = normalizeIntroWords(expectedText);
  const actualRaw = normalizeIntroWords(transcript);
  const expectedMeaningful = normalizeIntroMeaningfulWords(expectedText);
  const actualMeaningful = normalizeIntroMeaningfulWords(transcript);
  const differences = getWordDifferences(expectedRaw, actualRaw);
  const onlyAllowedDifferences = getWordDifferences(expectedMeaningful, actualMeaningful).count === 0;
  const fragments = [];
  if (differences.expectedOnly.length > 0) fragments.push(`ontbreekt/anders: ${differences.expectedOnly.join(", ")}`);
  if (differences.actualOnly.length > 0) fragments.push(`extra/anders: ${differences.actualOnly.join(", ")}`);
  return {
    differenceCount: differences.count,
    onlyAllowedDifferences,
    description: onlyAllowedDifferences
      ? "Alleen getallen/graden, genoemde Engelse oefentermen of leestekens."
      : fragments.join("; ") || "Woordverschillen na normalisatie.",
  };
}

export function getWordDifferences(expectedWords, actualWords) {
  const rows = Array.from({ length: expectedWords.length + 1 }, () => Array(actualWords.length + 1).fill(0));
  for (let expectedIndex = 0; expectedIndex <= expectedWords.length; expectedIndex += 1) rows[expectedIndex][0] = expectedIndex;
  for (let actualIndex = 0; actualIndex <= actualWords.length; actualIndex += 1) rows[0][actualIndex] = actualIndex;
  for (let expectedIndex = 1; expectedIndex <= expectedWords.length; expectedIndex += 1) {
    for (let actualIndex = 1; actualIndex <= actualWords.length; actualIndex += 1) {
      rows[expectedIndex][actualIndex] = Math.min(
        rows[expectedIndex - 1][actualIndex] + 1,
        rows[expectedIndex][actualIndex - 1] + 1,
        rows[expectedIndex - 1][actualIndex - 1]
          + (expectedWords[expectedIndex - 1] === actualWords[actualIndex - 1] ? 0 : 1),
      );
    }
  }

  let expectedIndex = expectedWords.length;
  let actualIndex = actualWords.length;
  const expectedOnly = [];
  const actualOnly = [];
  // Longest run of consecutive expected words that were not heard at all
  // (deletions only; words heard differently do not count).
  let missingRun = [];
  let longestMissingRun = [];
  while (expectedIndex > 0 || actualIndex > 0) {
    if (expectedIndex > 0 && actualIndex > 0
      && expectedWords[expectedIndex - 1] === actualWords[actualIndex - 1]
      && rows[expectedIndex][actualIndex] === rows[expectedIndex - 1][actualIndex - 1]) {
      expectedIndex -= 1;
      actualIndex -= 1;
    } else if (expectedIndex > 0 && actualIndex > 0
      && rows[expectedIndex][actualIndex] === rows[expectedIndex - 1][actualIndex - 1] + 1) {
      expectedOnly.push(expectedWords[expectedIndex - 1]);
      actualOnly.push(actualWords[actualIndex - 1]);
      expectedIndex -= 1;
      actualIndex -= 1;
    } else if (expectedIndex > 0 && rows[expectedIndex][actualIndex] === rows[expectedIndex - 1][actualIndex] + 1) {
      expectedOnly.push(expectedWords[expectedIndex - 1]);
      missingRun.unshift(expectedWords[expectedIndex - 1]);
      if (missingRun.length > longestMissingRun.length) longestMissingRun = [...missingRun];
      expectedIndex -= 1;
      continue;
    } else {
      actualOnly.push(actualWords[actualIndex - 1]);
      actualIndex -= 1;
    }
    missingRun = [];
  }
  return {
    count: rows[expectedWords.length][actualWords.length],
    expectedOnly: expectedOnly.reverse(),
    actualOnly: actualOnly.reverse(),
    longestMissingRun,
  };
}

function levenshtein(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

// Reads MPEG audio layer III frame headers. `bits` is part2_3_length of the first
// granule/channel: the number of audio data bits, close to zero in silence.
function readMp3Frames(bytes) {
  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const sampleRates = [[44100, 48000, 32000], [22050, 24000, 16000], [11025, 12000, 8000]];
  const frames = [];

  for (let offset = 0; offset + 4 <= bytes.length;) {
    const header = bytes.readUInt32BE(offset);
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) {
      offset += 1;
      continue;
    }

    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleRateIndex = (header >>> 10) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const versionIndex = version === 3 ? 0 : version === 2 ? 1 : 2;
    const bitrate = (version === 3 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex];
    const sampleRate = sampleRates[versionIndex][sampleRateIndex];
    const frameLength = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate)
      + ((header >>> 9) & 1);
    if (offset + frameLength > bytes.length) break;

    const mono = ((header >>> 6) & 3) === 3;
    const sideInfoStart = offset + 4 + (((header >>> 16) & 1) === 0 ? 2 : 0);
    const bitsPosition = version === 3 ? (mono ? 18 : 20) : (mono ? 9 : 10);
    const byteIndex = sideInfoStart + (bitsPosition >> 3);
    const window = byteIndex + 3 <= bytes.length
      ? (bytes[byteIndex] << 16) | (bytes[byteIndex + 1] << 8) | bytes[byteIndex + 2]
      : 0;
    frames.push({
      offset,
      seconds: (version === 3 ? 1152 : 576) / sampleRate,
      bits: (window >>> (12 - (bitsPosition & 7))) & 0xfff,
    });
    offset += frameLength;
  }

  if (frames.length === 0) throw new Error("Could not determine MP3 duration from frame headers.");
  return frames;
}

export function getMp3DurationSeconds(bytes) {
  return readMp3Frames(bytes).reduce((total, frame) => total + frame.seconds, 0);
}

const SILENCE_BITS = 100;

// Silences of at least minSeconds between the first and last non-silent frame
// (leading and trailing silence are ignored).
export function findMp3Silences(bytes, minSeconds = 0) {
  const frames = readMp3Frames(bytes);
  const first = frames.findIndex((frame) => frame.bits >= SILENCE_BITS);
  const last = frames.findLastIndex((frame) => frame.bits >= SILENCE_BITS);
  const silences = [];
  let start = 0;
  let runStart = null;
  let runSeconds = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (index > first && index < last && frame.bits < SILENCE_BITS) {
      if (runStart === null) { runStart = start; runSeconds = 0; }
      runSeconds += frame.seconds;
    } else if (runStart !== null) {
      if (runSeconds >= minSeconds) silences.push({ start: runStart, seconds: runSeconds });
      runStart = null;
    }
    start += frame.seconds;
  }
  return silences;
}

// Silence in the middle of the speech: longer than 3 s = rejected, longer than
// 2 s = approved but marked "beluister dit" (listen). Normal pauses are <= ~1.5 s.
const LISTEN_SILENCE_SECONDS = 2;
const REJECT_SILENCE_SECONDS = 3;

export function checkSilences(bytes) {
  const silences = findMp3Silences(bytes, LISTEN_SILENCE_SECONDS);
  const longest = silences.reduce((max, silence) => (silence.seconds > (max?.seconds ?? 0) ? silence : max), null);
  return {
    longestSilenceSeconds: longest?.seconds ?? 0,
    longestSilenceAt: longest?.start ?? null,
    reject: (longest?.seconds ?? 0) > REJECT_SILENCE_SECONDS,
    listen: (longest?.seconds ?? 0) > LISTEN_SILENCE_SECONDS,
  };
}

// Splits an MP3 that is too long for one recognize call into two parts at a frame
// boundary inside the longest silence around the middle (30-70% of the duration,
// narrowed so that both parts fit within maxPartSeconds).
export function splitMp3AtSilence(bytes, maxPartSeconds = STT_MAX_PART_SECONDS) {
  const frames = readMp3Frames(bytes);
  let start = 0;
  for (const frame of frames) {
    frame.start = start;
    start += frame.seconds;
  }
  const total = start;
  if (total <= maxPartSeconds) return [bytes];
  if (total > maxPartSeconds * 2) throw new Error(`Audio of ${total.toFixed(1)} s is too long to split into two recognizable parts.`);

  const from = Math.max(total * 0.3, total - maxPartSeconds);
  const to = Math.min(total * 0.7, maxPartSeconds);
  const candidates = frames.map((frame, index) => ({ ...frame, index }))
    .filter((frame) => frame.index > 0 && frame.start >= from && frame.start <= to);
  if (candidates.length === 0) throw new Error("No split point found within the allowed range.");


  let best = null;
  for (let index = 0; index < candidates.length;) {
    if (candidates[index].bits >= SILENCE_BITS) { index += 1; continue; }
    let end = index;
    while (end + 1 < candidates.length && candidates[end + 1].bits < SILENCE_BITS
      && candidates[end + 1].index === candidates[end].index + 1) end += 1;
    if (!best || end - index > best.end - best.start) best = { start: index, end };
    index = end + 1;
  }
  const split = best
    ? candidates[Math.floor((best.start + best.end) / 2)]
    : candidates.reduce((quietest, frame) => (frame.bits < quietest.bits ? frame : quietest));
  return [bytes.subarray(0, split.offset), bytes.subarray(split.offset)];
}

export function createSpeechClient() {
  return new v1p1beta1.SpeechClient();
}

export async function transcribeMp3(client, audioBytes, lang) {
  const languageCode = LANG_MAP[lang];
  if (!languageCode) throw new Error(`Unsupported language code: ${lang}`);

  const [response] = await client.recognize({
    config: {
      encoding: "MP3",
      sampleRateHertz: 24000,
      languageCode,
      model: "default",
      enableAutomaticPunctuation: false,
    },
    audio: { content: audioBytes.toString("base64") },
  });
  return (response.results ?? [])
    .map((result) => result.alternatives?.[0]?.transcript ?? "")
    .filter(Boolean)
    .join(" ");
}

// Like transcribeMp3, but audio longer than one recognize call is split at a
// silence and the two transcripts are joined. Returns the part durations for billing.
export async function transcribeMp3InParts(client, audioBytes, lang) {
  const parts = splitMp3AtSilence(audioBytes);
  const transcripts = [];
  for (const part of parts) transcripts.push(await transcribeMp3(client, Buffer.from(part), lang));
  return {
    transcript: transcripts.filter(Boolean).join(" "),
    partSeconds: parts.map((part) => getMp3DurationSeconds(Buffer.from(part))),
  };
}

const INTRO_MIN_AGREEMENT = 0.9;
const INTRO_MAX_DURATION_RATIO = 1.7;
export const MAX_FRAGMENT_SECONDS = 110;
// Consecutive expected words missing from the transcript: 4 or more = rejected,
// exactly 3 = approved but marked "beluister dit" (listen).
const REJECT_CONSECUTIVE_MISSING_WORDS = 4;
const LISTEN_CONSECUTIVE_MISSING_WORDS = 3;
const CHARS_PER_SECOND = 14;

export function checkSharedTranscript(expectedText, transcript, lang, durationSeconds = 0) {
  const check = classifyVerification({ expectedText, transcript }, lang);
  const tooLong = durationSeconds > MAX_FRAGMENT_SECONDS;
  const passed = !tooLong && (check.classification === "OK" || check.classification === "NORMAAL");
  return { agreement: check.agreement, classification: tooLong ? "FAIL: max duration" : check.classification, passed };
}

// Intros: >= 90% agreement after normalising numbers/degrees, English exercise
// terms and fixed recognition variants, no wrong language or repetition,
// duration <= 1.7x expected and at most 110 s, and no run of 4 or more
// consecutive expected words missing from the transcript.
export function checkIntroTranscript(expectedText, transcript, lang, durationSeconds) {
  const expected = normalizeIntroMeaningfulWords(expectedText);
  const actual = normalizeIntroMeaningfulWords(transcript);
  const diff = getWordDifferences(expected, actual);
  const agreement = expected.length === 0 ? 0 : Math.max(0, 1 - diff.count / expected.length);
  const base = compareTranscript(expectedText, transcript, lang, { minimumAgreement: 0, repetitionRatio: 1.15, repetitionInclusive: false });
  const durationRatio = durationSeconds / (expectedText.length / CHARS_PER_SECOND);
  const reasons = [];
  if (agreement < INTRO_MIN_AGREEMENT) reasons.push("agreement");
  if (diff.longestMissingRun.length >= REJECT_CONSECUTIVE_MISSING_WORDS) reasons.push("missing words");
  if (durationRatio > INTRO_MAX_DURATION_RATIO) reasons.push("duration");
  if (durationSeconds > MAX_FRAGMENT_SECONDS) reasons.push("max duration");
  if (base.wrongLanguage) reasons.push("language");
  if (base.tooLong || base.repeatedPhrase) reasons.push("repetition");
  return {
    agreement,
    durationRatio,
    missingWords: diff.expectedOnly,
    extraWords: diff.actualOnly,
    longestMissingRun: diff.longestMissingRun,
    listen: diff.longestMissingRun.length === LISTEN_CONSECUTIVE_MISSING_WORDS,
    classification: reasons.length === 0 ? "OK" : `FAIL: ${reasons.join(", ")}`,
    passed: reasons.length === 0,
  };
}
