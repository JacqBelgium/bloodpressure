import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const dir = path.join(root, "tmp", "voice-test");
const modelName = "gemini-3.1-flash-tts-preview";
const prompt =
  "Spreek dit uit als een vriendelijke, rustige personal trainer die een cliënt persoonlijk begeleidt tijdens een rustgevende oefening. Gebruik natuurlijke pauzes bij het ademhaling en een warme, bemoedigende toon.";

const nlIntro =
  "Vandaag: Back Plank, Glute Bridge. Je doet deze oefening vier keer. Bekijk eerst de foto's. Beginpositie: ga op je rug liggen, plooi de benen en plaats de hielen dicht bij het zitvlak. Kruis de armen voor de borst en trek de voorvoeten op, zodat enkel de hielen de grond raken. Adem in en span je buik-, rug- en bilspieren aan. Eindpositie: adem uit en hef het bekken van de grond, tot schouders, bekken en knieën op één rechte lijn liggen. Houd deze positie vast zolang de timer loopt.";

const enIntro =
  "Today: Back Plank, Glute Bridge. You will do this exercise four times. First, look at the photos. Starting position: lie on your back, bend your knees and place your heels close to your glutes. Cross your arms over your chest and pull your toes up, so that only your heels touch the floor. Breathe in and tighten your abdominal, back and glute muscles. End position: breathe out and lift your hips off the floor, until your shoulders, hips and knees form one straight line. Hold this position while the timer runs.";

const voiceSets = {
  nl: {
    vrouw: ["Kore", "Leda"],
    man: ["Charon", "Puck"],
  },
  en: {
    vrouw: ["Kore", "Leda"],
    man: ["Charon", "Puck"],
  },
};

function ensureDir() {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createOutputPath(language, gender, voiceName) {
  return path.join(dir, `${language}_${gender}_${voiceName}.mp3`);
}

async function synthesizeText({ languageCode, voiceName, text, outputPath }) {
  const client = new TextToSpeechClient();

  const response = await client.synthesizeSpeech({
    input: {
      text,
      prompt,
    },
    voice: {
      languageCode,
      name: voiceName,
      modelName,
    },
    audioConfig: {
      audioEncoding: "MP3",
      sampleRateHertz: 24000,
    },
  });

  const audioContent = response[0]?.audioContent;
  if (!audioContent || audioContent.length === 0) {
    throw new Error(`No audioContent returned for ${voiceName} (${languageCode}).`);
  }

  writeFileSync(outputPath, audioContent);
  const stats = statSync(outputPath);
  console.log(`${path.relative(root, outputPath)} (${stats.size} bytes)`);
  return stats.size;
}

async function testSingleVoice() {
  const languageCode = "nl-NL";
  const voiceName = "Kore";
  const outputPath = createOutputPath("nl", "vrouw", voiceName);

  console.log(`Testing single voice: ${voiceName} (${languageCode})`);
  await synthesizeText({
    languageCode,
    voiceName,
    text: "Hallo, ik test de Gemini-TTS API met ADC.",
    outputPath,
  });

  const fileSize = statSync(outputPath).size;
  if (fileSize < 10000) {
    throw new Error(`Test audio unexpectedly small: ${fileSize} bytes`);
  }

  console.log(`Single-voice test succeeded (${fileSize} bytes).`);
  return outputPath;
}

async function generateAllVoices() {
  const tasks = [];

  for (const [language, groups] of Object.entries(voiceSets)) {
    const languageCode = language === "nl" ? "nl-NL" : "en-US";
    const text = language === "nl" ? nlIntro : enIntro;

    for (const [gender, voices] of Object.entries(groups)) {
      for (const voiceName of voices) {
        tasks.push(
          synthesizeText({
            languageCode,
            voiceName,
            text,
            outputPath: createOutputPath(language, gender, voiceName),
          }),
        );
      }
    }
  }

  return Promise.all(tasks);
}

async function main() {
  ensureDir();

  const existingFiles = readdirSync(dir).filter((entry) => entry.toLowerCase().endsWith(".txt"));
  for (const file of existingFiles) {
    const filePath = path.join(dir, file);
    if (existsSync(filePath)) {
      console.log(`Removing legacy file: ${path.relative(root, filePath)}`);
      rmSync(filePath, { force: true });
    }
  }

  await testSingleVoice();
  await generateAllVoices();

  const generated = readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".mp3"))
    .sort();

  if (generated.length === 0) {
    throw new Error(`No MP3 files were generated in ${dir}.`);
  }

  const failures = [];
  for (const file of generated) {
    const fullPath = path.join(dir, file);
    const size = statSync(fullPath).size;
    if (size < 10000) {
      failures.push(`${file} (${size} bytes)`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Generated files are too small: ${failures.join(", ")}`);
  }

  console.log("\nGenerated MP3 files:");
  for (const file of generated) {
    const size = statSync(path.join(dir, file)).size;
    console.log(`${file}  ${size} bytes`);
  }

  console.log(`\nSUCCESS: ${generated.length} MP3 files generated and verified in ${path.relative(root, dir)}.`);
}

main().catch((error) => {
  console.error("VOICE TEST GENERATION FAILED");
  console.error(error.stack || String(error));
  process.exit(1);
});
