#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, realpathSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODEL_MANIFEST, VENDOR_ROOT, modelPath } from "../src/model-manifest.mjs";

const MAX_REDIRECTS = 5;

export function downloadModel(url, destination) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      const request = https.get(
        currentUrl,
        { headers: { "user-agent": "akari-video-rvm-model-fetch (+https://github.com)" } },
        (response) => {
          const { statusCode } = response;
          if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
            response.resume();
            if (redirectsLeft <= 0) {
              reject(new Error(`too many redirects fetching ${url}`));
              return;
            }
            attempt(new URL(response.headers.location, currentUrl).toString(), redirectsLeft - 1);
            return;
          }
          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`GET ${currentUrl} -> HTTP ${statusCode}`));
            return;
          }
          const file = createWriteStream(destination, { flags: "wx" });
          response.pipe(file);
          file.on("finish", () => file.close((error) => (error ? reject(error) : resolve())));
          file.on("error", reject);
        },
      );
      request.on("error", reject);
    };
    attempt(url, MAX_REDIRECTS);
  });
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

export async function ensureModel(
  model = "mobilenetv3",
  { vendorRoot = VENDOR_ROOT, download = downloadModel, log = () => {} } = {},
) {
  const entry = MODEL_MANIFEST[model];
  if (!entry) throw new Error(`--model は ${Object.keys(MODEL_MANIFEST).join(" / ")} のいずれかです`);
  const destination = modelPath(model, vendorRoot);
  await mkdir(vendorRoot, { recursive: true });

  if (existsSync(destination)) {
    const actual = await sha256File(destination);
    if (actual === entry.sha256) return destination;
    await rm(destination, { force: true });
    throw new Error(
      `sha256 不一致: ${destination}\n  期待値: ${entry.sha256}\n  実際値: ${actual}\n` +
        "不正な既存モデルを削除しました。取得を中止します。",
    );
  }

  const partial = `${destination}.partial-${process.pid}-${Date.now()}`;
  try {
    log(`matte-rvm: 取得中 ${entry.url}`);
    await download(entry.url, partial);
    const actual = await sha256File(partial);
    if (actual !== entry.sha256) {
      throw new Error(
        `sha256 不一致: ${entry.url}\n  期待値: ${entry.sha256}\n  実際値: ${actual}\n` +
          "配布元の内容が変わった、またはダウンロードが破損しています。取得を中止しました。",
      );
    }
    await rename(partial, destination);
    log(`matte-rvm: ${model} -> ${path.relative(VENDOR_ROOT, destination)}`);
    return destination;
  } finally {
    await rm(partial, { force: true });
  }
}

function parseModel(argv) {
  if (argv.length === 0) return "mobilenetv3";
  if (argv.length === 2 && argv[0] === "--model" && argv[1] && !argv[1].startsWith("--")) {
    return argv[1];
  }
  throw new Error("使い方: node scripts/fetch-models.mjs [--model mobilenetv3|resnet50]");
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  ensureModel(parseModel(process.argv.slice(2)), { log: (message) => console.log(message) })
    .then((destination) => console.log(`matte-rvm: 完了（${destination}）`))
    .catch((error) => {
      console.error(`matte-rvm: モデル取得に失敗しました — ${error.message}`);
      process.exitCode = 1;
    });
}
