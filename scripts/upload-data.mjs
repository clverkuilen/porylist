#!/usr/bin/env node
/**
 * upload-data.mjs
 *
 * Syncs public/data/ to the porylist-data R2 bucket via the S3-compatible API.
 * Much faster than spawning wrangler per-file — runs 50 uploads in parallel.
 *
 * Requires these env vars (create an R2 API token in the Cloudflare dashboard):
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *
 * Put them in a .env.local file or export them before running:
 *   export R2_ACCOUNT_ID=...
 *   npm run upload-data
 *
 * Run with:  npm run upload-data
 * Re-runs skip unchanged files (tracked via .data-manifest.json).
 * Use --force to re-upload everything.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../public/data");
const MANIFEST_PATH = path.resolve(__dirname, "../.data-manifest.json");
const BUCKET = "porylist-data";
const CONCURRENCY = 50;
const FORCE = process.argv.includes("--force");

// ── Load env vars (support .env.local) ────────────────────────────────────────
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error(`❌ Missing R2 credentials. Set these env vars (or add to .env.local):
   R2_ACCOUNT_ID
   R2_ACCESS_KEY_ID
   R2_SECRET_ACCESS_KEY

Create an R2 API token at: https://dash.cloudflare.com/ → R2 → Manage API tokens`);
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) {
  console.error("❌ public/data/ not found. Run `npm run fetch-data` first.");
  process.exit(1);
}

// ── S3 client pointing at R2 ───────────────────────────────────────────────────
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

// ── Manifest (tracks md5 per file to skip unchanged) ──────────────────────────
const manifest = (!FORCE && fs.existsSync(MANIFEST_PATH))
  ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
  : {};

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

// ── Gather files ───────────────────────────────────────────────────────────────
const allFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".json")) allFiles.push(full);
  }
}
walk(DATA_DIR);

const toUpload = allFiles.filter((file) => {
  const key = path.relative(DATA_DIR, file).replace(/\\/g, "/");
  const hash = md5(fs.readFileSync(file));
  if (manifest[key] === hash) return false;
  return true;
});

console.log(`\n🚀 ${toUpload.length} files to upload (${allFiles.length - toUpload.length} unchanged)\n`);
if (toUpload.length === 0) { console.log("✅ All up to date."); process.exit(0); }

// ── Upload pool ────────────────────────────────────────────────────────────────
let uploaded = 0, errors = 0;
const queue = [...toUpload];

async function worker() {
  while (queue.length > 0) {
    const file = queue.shift();
    const key = path.relative(DATA_DIR, file).replace(/\\/g, "/");
    const body = fs.readFileSync(file);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }));
      manifest[key] = md5(body);
      uploaded++;
    } catch (err) {
      console.error(`\n  ✗ ${key}: ${err.message}`);
      errors++;
    }
    if ((uploaded + errors) % 100 === 0) {
      process.stdout.write(`\r  Progress: ${uploaded + errors}/${toUpload.length} (↑${uploaded} err:${errors})`);
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest));

process.stdout.write(`\r  Progress: ${toUpload.length}/${toUpload.length} (↑${uploaded} err:${errors})\n\n`);
console.log("✅ Done!");
console.log(`  Uploaded: ${uploaded}`);
if (errors > 0) console.log(`  Errors:   ${errors}`);
