/**
 * Lightweight file-based JSON persistence.
 * Each store is a single JSON file under ./data/.
 * Reads are synchronous on first load; writes are synchronous to keep things simple.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadStore<T>(name: string, defaults: T): T {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return defaults;
  }
}

export function saveStore<T>(name: string, data: T): void {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}
