import { readCredentials } from "../../../creator-root/src/index.mjs";

export class CredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialsError";
    this.exitCode = 2;
  }
}

export function resolveFalKey({ env = process.env, credentialsFile } = {}) {
  const fromEnv = typeof env.FAL_KEY === "string" ? env.FAL_KEY.trim() : "";
  if (fromEnv) return { key: fromEnv, key_source: "env:FAL_KEY" };

  try {
    const fromFile = readCredentials(credentialsFile ? { ...env, AKARI_CREDENTIALS_FILE: credentialsFile } : env).values.get("FAL_KEY")?.trim();
    if (fromFile) return { key: fromFile, key_source: "file:credentials.env" };
  } catch (error) {
    if (error?.code !== "ENOENT") throw new CredentialsError("credentials.env を読めません");
  }
  throw new CredentialsError("FAL_KEY が env にも credentials.env にもありません");
}
