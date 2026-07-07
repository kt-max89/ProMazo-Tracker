/**
 * Lightweight file-based JSON persistence.
 * Each store is a single JSON file under ./data/.
 *
 * Writes are atomic: we write to a temp file then rename, so a crash
 * mid-write can never leave a truncated/corrupt store file.
 */
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = path.resolve("data");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Create the data directory on module load.
ensureDataDir();

export function loadStore<T>(name: string, defaults: T): T {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    // Log the corruption so it's visible; return defaults rather than crashing.
    // NOTE: the NEXT save will overwrite the corrupt file with fresh data.
    console.error(`[persist] Failed to parse ${file}:`, err);
    return defaults;
  }
}

export function saveStore<T>(name: string, data: T): void {
  ensureDataDir(); // defensive: recreate dir if it was removed after boot
  const file = path.join(DATA_DIR, `${name}.json`);
  const json = JSON.stringify(data, null, 2);

  // Write atomically: temp file → fsync → rename
  const tmp = path.join(os.tmpdir(), `promazo-${name}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, json, "utf-8");
    // fsync so the OS flushes to disk before rename
    const fd = fs.openSync(tmp, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    // Clean up the temp file on failure
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}
