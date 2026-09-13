import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export class CredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialsError";
    this.exitCode = 2;
  }
}

function parseEnv(text) {
  const values = new Map();
  for (const original of text.split(/\r?\n/u)) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    values.set(name, value);
  }
  return values;
}

export function resolveFalKey({ env = process.env, credentialsFile } = {}) {
  const fromEnv = typeof env.FAL_KEY === "string" ? env.FAL_KEY.trim() : "";
  if (fromEnv) return { key: fromEnv, key_source: "env:FAL_KEY" };

  const file = credentialsFile
    ?? env.AKARI_CREDENTIALS_FILE
    ?? path.join(os.homedir(), ".config", "akari-video", "credentials.env");
  try {
    const fromFile = parseEnv(readFileSync(file, "utf8")).get("FAL_KEY")?.trim();
    if (fromFile) return { key: fromFile, key_source: "file:credentials.env" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw new CredentialsError("credentials.env を読めません");
  }
  throw new CredentialsError("FAL_KEY が env にも credentials.env にもありません");
}
