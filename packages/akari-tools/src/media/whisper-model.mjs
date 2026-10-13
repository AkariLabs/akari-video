import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// アプリの backend（esbuild の cjs 出力）にも束ねられるので、top-level await を含む ../i18n.mjs ではなく
// bin/tools.mjs と同じ i18n の本体から引く。
import { t as toolsText } from "../../../i18n/index.mjs";

/**
 * 認識モデルの既定（アプリの初回セットアップ / 設定 → 道具 と同じもの）。
 * アプリ側 (tool-install.ts) もここを参照するので、URL と sha256 の正本はこの 1 か所。
 * HF の `resolve/main` はブランチ追従だが、内容が変われば sha256 不一致で失敗するので版固定と同じ効果になる。
 */
export const WHISPER_MODEL = {
  file: "ggml-large-v3-turbo-q5_0.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
  sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
};

/** `~/.akari/tools/models`（whisper-model-candidates.mjs の探索対象と一致させる）。 */
export function whisperModelsDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".akari", "tools", "models");
}

async function sha256OfFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * モデルを tmp に落として sha256 を検証してから rename する。置き済みで sha256 が合えば何もしない。
 * model / fetchImpl / homeDir は差し替え可能（テストは小さい偽ファイルで回す）。
 */
export async function installWhisperModel({ homeDir = os.homedir(), fetchImpl = fetch, model = WHISPER_MODEL, onProgress } = {}) {
  const directory = whisperModelsDir(homeDir);
  const destination = path.join(directory, model.file);
  if (existsSync(destination) && statSync(destination).isFile() && await sha256OfFile(destination) === model.sha256) {
    return { outcome: "unchanged", message: toolsText("tools.whisper.cli.alreadyReady", { path: destination }), path: destination };
  }
  await mkdir(directory, { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    const response = await fetchImpl(model.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers?.get?.("content-length")) || undefined;
    const hash = createHash("sha256");
    const output = createWriteStream(temporary);
    let downloaded = 0;
    const write = (chunk) => new Promise((resolve, reject) => output.write(chunk, (error) => error ? reject(error) : resolve()));
    const take = async (chunk) => {
      hash.update(chunk);
      await write(chunk);
      downloaded += chunk.length;
      onProgress?.({ downloadedBytes: downloaded, totalBytes: total });
    };
    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await take(value);
        }
      } else {
        await take(Buffer.from(await response.arrayBuffer()));
      }
    } finally {
      await new Promise((resolve) => output.end(resolve));
    }
    if (hash.digest("hex") !== model.sha256) {
      return { outcome: "failed", message: toolsText("tools.whisper.cli.verifyFailed"), path: destination };
    }
    await rename(temporary, destination);
    return { outcome: "installed", message: toolsText("tools.whisper.cli.installed", { path: destination }), path: destination };
  } catch (error) {
    return { outcome: "failed", message: toolsText("tools.whisper.cli.downloadFailed", { error: error instanceof Error ? error.message : String(error) }), path: destination };
  } finally {
    await rm(temporary, { force: true });
  }
}
