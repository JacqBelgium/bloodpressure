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

export function normalizeWords(value) {
  const digitWords = {
    nl: new Map([
      ["een", "1"], ["één", "1"], ["eerste", "1"],
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
      expectedIndex -= 1;
    } else {
      actualOnly.push(actualWords[actualIndex - 1]);
      actualIndex -= 1;
    }
  }
  return {
    count: rows[expectedWords.length][actualWords.length],
    expectedOnly: expectedOnly.reverse(),
    actualOnly: actualOnly.reverse(),
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

export function getMp3DurationSeconds(bytes) {
  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const sampleRates = [[44100, 48000, 32000], [22050, 24000, 16000], [11025, 12000, 8000]];
  let duration = 0;
  let frameCount = 0;

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

    duration += (version === 3 ? 1152 : 576) / sampleRate;
    frameCount += 1;
    offset += frameLength;
  }

  if (frameCount === 0) throw new Error("Could not determine MP3 duration from frame headers.");
  return duration;
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
