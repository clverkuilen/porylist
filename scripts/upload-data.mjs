#!/usr/bin/env node
/**
 * upload-data.mjs
 *
 * Syncs public/data/ to the porylist-data R2 bucket using Wrangler.
 * Run with:  npm run upload-data
 *
 * Tracks uploaded files in .data-manifest.json so re-runs skip
 * files that haven't changed. Use --force to re-upload everything.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../public/data");
const MANIFEST_PATH = path.resolve(__dirname, "../.data-manifest.json");
const BUCKET = "porylist-data";
const BATCH = 10;

const FORCE = process.argv.includes("--force");

if (!fs.existsSync(DATA_DIR)) {
  console.error("❌ public/data/ not found. Run `npm run fetch-data` first.");
  process.exit(1);
}

// Load manifest of previously uploaded files (path → md5)
const manifest = (!FORCE && fs.existsSync(MANIFEST_PATH))
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
  : {};

function md5(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

// Gather all JSON files
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".json")) files.push(full);
  }
}
walk(DATA_DIR);

// Filter to only files that have changed since last upload
const toUpload = files.filter((file) => {
  const key = path.relative(DATA_DIR, file).replace(/\\/g, "/");
  return FORCE || manifest[key] !== md5(file);
});

console.log(`🚀 ${toUpload.length} files to upload (${files.length - toUpload.length} unchanged)\n`);

if (toUpload.length === 0) {
  console.log("✅ Everything already up to date.");
  process.exit(0);
}

let uploaded = 0;
let errors = 0;

for (let i = 0; i < toUpload.length; i += BATCH) {
  const batch = toUpload.slice(i, i + BATCH);
  await Promise.all(
    batch.map(async (file) => {
      const key = path.relative(DATA_DIR, file).replace(/\\/g, "/");
      try {
        execSync(
          `npx wrangler r2 object put "${BUCKET}/${key}" --file="${file}" --content-type="application/json"`,
          { stdio: "pipe" },
        );
        manifest[key] = md5(file);
        uploaded++;
      } catch (err) {
        const msg = (err.stderr?.toString() ?? err.message).trim();
        console.error(`\n  ✗ ${key}: ${msg.slice(0, 120)}`);
        errors++;
      }
    }),
  );
  process.stdout.write(
    `\r  Progress: ${Math.min(i + BATCH, toUpload.length)}/${toUpload.length} (↑${uploaded} err:${errors})`,
  );
  // Save manifest periodically so progress isn't lost if interrupted
  if (i % 100 === 0) fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
}

// Final manifest save
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));

console.log(`\n\n✅ Done!`);
console.log(`  Uploaded: ${uploaded}`);
if (errors > 0) console.log(`  Errors:   ${errors}`);
