import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FACE_LANDMARKER_MODEL } from "./artifacts.mjs";

export function resolveAkariHome(env = process.env) {
  const overridden = env.AKARI_HOME?.trim();
  return overridden ? path.resolve(overridden) : path.join(os.homedir(), ".akari");
}

export function faceLandmarkerModelPath(env = process.env, manifest = FACE_LANDMARKER_MODEL) {
  return path.join(resolveAkariHome(env), "models", ...manifest.relativePath.split("/"));
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function writeResponse(response, destination) {
  if (!response.ok) throw new Error(`GET ${response.url || "model"} -> HTTP ${response.status}`);
  const file = createWriteStream(destination, { flags: "wx" });
  try {
    if (!response.body) throw new Error("モデル応答に body がありません");
    for await (const chunk of response.body) {
      if (!file.write(chunk)) await new Promise((resolve) => file.once("drain", resolve));
    }
    await new Promise((resolve, reject) => file.end((error) => (error ? reject(error) : resolve())));
  } catch (error) {
    file.destroy();
    throw error;
  }
}

/**
 * Versioned URL のモデルだけを ~/.akari/models（AKARI_HOME 対応）へ置く。
 * 既存ファイルも毎回 hash 検査し、不一致を「使えるキャッシュ」として扱わない。
 */
export async function ensureFaceLandmarkerModel({
  env = process.env,
  fetchImpl = globalThis.fetch,
  manifest = FACE_LANDMARKER_MODEL,
  log = () => {},
} = {}) {
  const destination = faceLandmarkerModelPath(env, manifest);
  if (existsSync(destination)) {
    const actual = await sha256File(destination);
    if (actual !== manifest.sha256) {
      throw new Error(`モデル SHA-256 不一致: ${destination}\n期待値: ${manifest.sha256}\n実際値: ${actual}`);
    }
    return { path: destination, downloaded: false, sha256: actual };
  }
  if (typeof fetchImpl !== "function") throw new Error("モデル取得に使う fetch がありません");

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    log(`face-expression: model download ${manifest.url}`);
    const response = await fetchImpl(manifest.url, { redirect: "follow" });
    await writeResponse(response, temporary);
    const actual = await sha256File(temporary);
    if (actual !== manifest.sha256) {
      throw new Error(`モデル SHA-256 不一致: ${manifest.url}\n期待値: ${manifest.sha256}\n実際値: ${actual}`);
    }
    await rename(temporary, destination);
    return { path: destination, downloaded: true, sha256: actual };
  } finally {
    await rm(temporary, { force: true });
  }
}
