// One-off script: uploads exercise photos to Supabase Storage and fills
// exercises.foto_url (begin) and exercises.foto_url_eind (eind).
//
// Usage:
//   node --env-file=.env.local scripts/upload-exercise-photos.mjs [photoDir] [--dry-run]
//
// photoDir defaults to ./exercise_photos and must contain files named
// oefening_<NN>_foto_<N>.jpeg. Only foto_1 (begin) and foto_2 (eind) are used.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "exercise-media";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const photoDir = args.find((a) => !a.startsWith("--")) ?? "exercise_photos";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Group files by exercise number: { 1: { 1: "file", 2: "file" }, ... }
const pattern = /^oefening_(\d+)_foto_(\d+)\.jpe?g$/i;
const photos = new Map();
for (const file of await readdir(photoDir)) {
  const match = file.match(pattern);
  if (!match) {
    console.warn(`Skipping unrecognised file: ${file}`);
    continue;
  }
  const [, nummer, fotoNr] = match.map(Number);
  if (!photos.has(nummer)) photos.set(nummer, {});
  photos.get(nummer)[fotoNr] = file;
}

const { data: exercises, error: fetchError } = await supabase
  .from("exercises")
  .select("nummer, foto_url, foto_url_eind");
if (fetchError) {
  console.error("Could not read exercises:", fetchError.message);
  process.exit(1);
}
const byNummer = new Map(exercises.map((e) => [e.nummer, e]));

if (dryRun) {
  console.log(`Dry run — ${photos.size} exercises found in ${photoDir}\n`);
  for (const nummer of [...photos.keys()].sort((a, b) => a - b)) {
    const files = photos.get(nummer);
    const row = byNummer.get(nummer);
    console.log(
      `#${nummer}: begin=${files[1] ?? "-"} eind=${files[2] ?? "-"} | ` +
        (row
          ? `db foto_url=${row.foto_url ?? "null"} foto_url_eind=${row.foto_url_eind ?? "null"}`
          : "NO MATCHING ROW IN DB"),
    );
  }
  const missing = exercises.filter((e) => !photos.has(e.nummer)).map((e) => e.nummer);
  if (missing.length) console.log(`\nDB exercises without photos: ${missing.join(", ")}`);
  process.exit(0);
}

// a. Create the public bucket if it doesn't exist yet.
const { data: existingBucket } = await supabase.storage.getBucket(BUCKET);
if (existingBucket) {
  console.log(`Bucket "${BUCKET}" already exists.`);
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) {
    console.error(`Could not create bucket "${BUCKET}":`, error.message);
    process.exit(1);
  }
  console.log(`Created public bucket "${BUCKET}".`);
}

async function upload(file, objectPath) {
  const body = await readFile(path.join(photoDir, file));
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, body, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

// b–d. Upload begin/eind per exercise and store the public URLs.
let failures = 0;
for (const nummer of [...photos.keys()].sort((a, b) => a - b)) {
  const files = photos.get(nummer);
  try {
    if (!byNummer.has(nummer)) throw new Error("no matching row in exercises");
    if (!files[1]) throw new Error("foto_1 (begin) missing");

    const fotoUrl = await upload(files[1], `${nummer}/begin.jpeg`);
    const fotoUrlEind = files[2] ? await upload(files[2], `${nummer}/eind.jpeg`) : null;

    const { error } = await supabase
      .from("exercises")
      .update({ foto_url: fotoUrl, foto_url_eind: fotoUrlEind })
      .eq("nummer", nummer);
    if (error) throw new Error(`db update: ${error.message}`);

    console.log(
      `#${nummer}: begin.jpeg ← ${files[1]}` +
        (files[2] ? `, eind.jpeg ← ${files[2]}` : ", no eind photo"),
    );
  } catch (err) {
    failures++;
    console.error(`#${nummer}: FAILED — ${err.message}`);
  }
}

console.log(`\nDone. ${photos.size - failures} succeeded, ${failures} failed.`);
process.exit(failures ? 1 : 0);
