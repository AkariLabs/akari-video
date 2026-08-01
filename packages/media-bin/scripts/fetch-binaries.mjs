#!/usr/bin/env node
// fetch-binaries — binary-manifest.mjs に基づき ffmpeg/ffprobe を取得・検証・展開する。
//
// npm install の postinstall から自動実行される（従来の ffmpeg-static/ffprobe-static の
// postinstall と同じタイミング）ほか、apps/shell/resources/scripts/bundle-ffmpeg-binaries.mjs
// からも ensureVendorBinaries() を直接 import して同梱前の自己修復に使う。
//
// 取得先ドメインはピン留めした配布元のみ（martin-riedl.de / github.com とそのリダイレクト先
// CDN である *.githubusercontent.com）。sha256 不一致は即エラーで停止する（サイレント続行しない）。

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BINARY_MANIFEST, VENDOR_ROOT, currentTarget, vendorBinaryPath } from "../src/binary-manifest.mjs";

const MAX_REDIRECTS = 5;

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      const request = https.get(
        currentUrl,
        { headers: { "user-agent": "akari-video-media-bin-fetch (+https://github.com)" } },
        (res) => {
          const { statusCode } = res;
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error(`too many redirects fetching ${url}`));
              return;
            }
            attempt(new URL(res.headers.location, currentUrl).toString(), redirectsLeft - 1);
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`GET ${currentUrl} -> HTTP ${statusCode}`));
            return;
          }
          const file = createWriteStream(destPath);
          res.pipe(file);
          file.on("finish", () => file.close((err) => (err ? reject(err) : resolve())));
          file.on("error", reject);
        },
      );
      request.on("error", reject);
    };
    attempt(url, MAX_REDIRECTS);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function extractArchive(archivePath, destDir) {
  // martin-riedl.de は .zip、BtbN は .tar.xz を配布する。両方とも system `tar` で展開できる
  // （macOS/Windows の tar は bsdtar = libarchive ベースで zip も読める。Linux の GNU tar は
  // xz を組み込みサポート）。新規 npm 依存（zip/xz パーサ）を増やさないための選択
  const result = spawnSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (result.error) {
    throw new Error(`tar の起動に失敗しました（${archivePath} の展開に必要です）: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tar -xf ${archivePath} が失敗しました（exit ${result.status}）`);
  }
}

/**
 * 現在の対象（既定はプロセスの platform/arch）向けに ffmpeg/ffprobe を取得・検証・配置する。
 * @param {{ target?: string, force?: boolean, log?: (msg: string) => void }} [opts]
 */
export async function ensureVendorBinaries({ target = currentTarget(), force = false, log = () => {} } = {}) {
  const config = BINARY_MANIFEST[target];
  if (!config) {
    log(`media-bin: ${target} 向けの取得先ピン留めが manifest にありません。PATH の ffmpeg/ffprobe に委ねます。`);
    return { ffmpeg: null, ffprobe: null, supported: false };
  }

  const vendorDir = path.join(VENDOR_ROOT, target);
  await mkdir(vendorDir, { recursive: true });

  const byUrl = new Map();
  for (const [name, entry] of Object.entries(config.entries)) {
    if (!byUrl.has(entry.url)) byUrl.set(entry.url, []);
    byUrl.get(entry.url).push([name, entry]);
  }

  for (const [url, entries] of byUrl) {
    const alreadyPresent = entries.every(([name]) => existsSync(vendorBinaryPath(name, target)));
    if (alreadyPresent && !force) continue;

    const expectedSha = entries[0][1].sha256;
    for (const [name, entry] of entries) {
      if (entry.sha256 !== expectedSha) {
        throw new Error(`manifest 不整合: 同一 URL (${url}) に対して ${name} の sha256 が食い違っています`);
      }
    }

    const tmpDir = await mkdtemp(path.join(tmpdir(), "akari-media-bin-"));
    try {
      const archivePath = path.join(tmpDir, path.basename(new URL(url).pathname));
      log(`media-bin: 取得中 ${url}`);
      await download(url, archivePath);

      const actualSha = await sha256File(archivePath);
      if (actualSha !== expectedSha) {
        throw new Error(
          `sha256 不一致: ${url}\n  期待値: ${expectedSha}\n  実際値: ${actualSha}\n` +
            "配布元の内容が変わった、またはダウンロードが破損しています。取得を中止しました。",
        );
      }

      const extractDir = path.join(tmpDir, "extract");
      await mkdir(extractDir, { recursive: true });
      extractArchive(archivePath, extractDir);

      for (const [name, entry] of entries) {
        const src = path.join(extractDir, entry.member);
        if (!existsSync(src)) {
          throw new Error(`展開後に想定したファイルがありません: ${entry.member}（アーカイブ: ${url}）`);
        }
        const dest = vendorBinaryPath(name, target);
        await copyFile(src, dest);
        if (!target.startsWith("win32-")) {
          await chmod(dest, 0o755);
        }
        log(`media-bin: ${name} -> ${path.relative(VENDOR_ROOT, dest)}`);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  const result = { supported: true };
  for (const name of Object.keys(config.entries)) {
    result[name] = vendorBinaryPath(name, target);
  }
  return result;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  ensureVendorBinaries({ log: (msg) => console.log(msg) })
    .then((result) => {
      if (result.supported === false) {
        console.log(
          "media-bin: このプラットフォームの同梱バイナリは提供していません。" +
            "resolveFfmpeg()/resolveFfprobe() は PATH または AKARI_FFMPEG_BIN/AKARI_FFPROBE_BIN に委ねます。",
        );
        return;
      }
      console.log(`media-bin: 完了（ffmpeg: ${result.ffmpeg} / ffprobe: ${result.ffprobe}）`);
    })
    .catch((error) => {
      console.error(`media-bin: バイナリ取得に失敗しました — ${error.message}`);
      process.exit(1);
    });
}
