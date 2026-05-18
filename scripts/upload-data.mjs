#!/usr/bin/env node
/**
 * upload-data.mjs
 *
 * Syncs public/data/ to the porylist-data R2 bucket using Wrangler.
 * Run with:  npm run upload-data
 *
 * Only uploads files that don't exist in the bucket yet, unless
 * --force is passed (re-uploads everything).
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../public/data");
const BUCKET = "porylist-data";

const FORCE = process.argv.includes("--force");

if (!fs.existsSync(DATA_DIR)) {
  console.error("❌ public/data/ not found. Run `npm run fetch-data` first.");
  process.exit(1);
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

console.log(`🚀 Uploading ${files.length} files to R2 bucket "${BUCKET}"...\n`);

let uploaded = 0;
let skipped = 0;
let errors = 0;
const BATCH = 20;

for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);
  await Promise.all(
    batch.map(async (file) => {
      const key = path.relative(DATA_DIR, file).replace(/\\/g, "/");
      try {
        execSync(
          `npx wrangler r2 object put "${BUCKET}/${key}" --file="${file}" --content-type="application/json" ${FORCE ? "" : "--if-none-match=\"*\""}`,
          { stdio: "pipe" },
        );
        uploaded++;
      } catch (err) {
        const msg = err.stderr?.toString() ?? err.message;
        // Wrangler exits non-zero for 412 (precondition failed = already exists)
        if (msg.includes("412") || msg.includes("PreconditionFailed") || msg.includes("already exists")) {
          skipped++;
        } else {
          errors++;
          console.error(`  ✗ ${key}: ${msg.slice(0, 120)}`);
        }
      }
    }),
  );
  process.stdout.write(
    `\r  Progress: ${Math.min(i + BATCH, files.length)}/${files.length} (↑${uploaded} skipped:${skipped} err:${errors})`,
  );
}

console.log(`\n\n✅ Done!`);
console.log(`  Uploaded: ${uploaded}`);
console.log(`  Skipped (already in bucket): ${skipped}`);
if (errors > 0) console.log(`  Errors: ${errors}`);
