#!/usr/bin/env node
// build-whisper — macOS 向け whisper-cli をソースビルドして vendor へ配置する。
//
// whisper.cpp は公式バイナリ配布が Windows のみで macOS 向けが無いため（fetch-binaries.mjs の
// 通常経路が使えない）、WHISPER_CPP_SOURCE（binary-manifest.mjs）でピン留めしたバージョン
// タグのソース tarball を取得・sha256 検証し、cmake でビルドする。すべて worktree 内
// （packages/media-bin/vendor/.build-whisper/）で完結させる — システム領域には何も置かない。
//
// -DBUILD_SHARED_LIBS=OFF を明示する。既定（ON）だと libwhisper/libggml が dylib に分離され、
// whisper-cli 実行ファイルの LC_RPATH は CMake の既定挙動でビルド木の絶対パスを指す。
// 本パッケージの配布モデルは vendor/ → apps/shell/resources/vendor-ffmpeg/ →
// electron extraResources という 3 段のファイルコピーを経るため、dylib 分離のままだと
// コピー先で動的リンクが解決できない。単一の自己完結バイナリにする方が ffmpeg と同じ
// 「コピーするだけで動く」配布モデルに合致する。Metal/CoreML 等のアクセラレーション既定値には
// 触れていない（BUILD_SHARED_LIBS はリンク形態の切り替えであり高速化オプションではない）。
//
// ビルド不能環境（cmake 無し等）は ffmpeg 取得と同じベストエフォート精神で、平易なメッセージを
// 出して { supported: false } を返す（プロセスを失敗させない）。cmake はあるがビルド自体が
// 失敗した場合は実際の不具合なのでエラーを投げる。

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VENDOR_ROOT, WHISPER_CPP_SOURCE, currentTarget, vendorBinaryPath } from "../src/binary-manifest.mjs";

const MAX_REDIRECTS = 5;
const BUILD_ROOT = path.join(VENDOR_ROOT, ".build-whisper");

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, redirectsLeft) => {
      const request = https.get(
        currentUrl,
        { headers: { "user-agent": "akari-video-media-bin-build-whisper (+https://github.com)" } },
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

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.error === undefined;
}

async function findSingleSubdirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length !== 1) {
    throw new Error(`ソース展開結果が想定外です（${dir} 直下のディレクトリ数 ${dirs.length}）`);
  }
  return path.join(dir, dirs[0].name);
}

/**
 * whisper-cli を現在の target（既定はプロセスの platform/arch）向けにソースビルドし、
 * vendor へ配置する。cmake が無い環境では失敗させず { supported: false } を返す。
 * @param {{ target?: string, force?: boolean, log?: (msg: string) => void }} [opts]
 */
export async function buildWhisperCli({ target = currentTarget(), force = false, log = () => {} } = {}) {
  if (!target.startsWith("darwin-")) {
    log(`build-whisper: ${target} はソースビルド対象外です（win32 は fetch-binaries.mjs の通常経路を使用）。`);
    return { supported: false, reason: "not-darwin" };
  }

  const dest = vendorBinaryPath("whisper-cli", target);
  if (existsSync(dest) && !force) {
    log(`build-whisper: 既に存在するためスキップします: ${path.relative(VENDOR_ROOT, dest)}`);
    return { supported: true, whisperCli: dest, skipped: true };
  }

  if (!commandExists("cmake")) {
    log(
      "build-whisper: cmake が見つかりません。whisper-cli のソースビルドをスキップします " +
        "（システムへの自動インストールはしません — 必要なら手動で cmake を導入してください）。",
    );
    return { supported: false, reason: "cmake-missing" };
  }

  const startedAt = Date.now();
  await rm(BUILD_ROOT, { recursive: true, force: true });
  await mkdir(BUILD_ROOT, { recursive: true });

  const archivePath = path.join(BUILD_ROOT, `whisper.cpp-${WHISPER_CPP_SOURCE.tag}.tar.gz`);
  log(`build-whisper: ソース取得中 ${WHISPER_CPP_SOURCE.url}`);
  await download(WHISPER_CPP_SOURCE.url, archivePath);

  const actualSha = await sha256File(archivePath);
  if (actualSha !== WHISPER_CPP_SOURCE.sha256) {
    throw new Error(
      `sha256 不一致: ${WHISPER_CPP_SOURCE.url}\n  期待値: ${WHISPER_CPP_SOURCE.sha256}\n  実際値: ${actualSha}\n` +
        "配布元の内容が変わった、またはダウンロードが破損しています。ビルドを中止しました。",
    );
  }

  const extractDir = path.join(BUILD_ROOT, "src");
  await mkdir(extractDir, { recursive: true });
  const extractResult = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit" });
  if (extractResult.status !== 0) {
    throw new Error(`tar -xf ${archivePath} が失敗しました（exit ${extractResult.status}）`);
  }
  const sourceDir = await findSingleSubdirectory(extractDir);

  const buildDir = path.join(BUILD_ROOT, "build");
  log(`build-whisper: cmake configure（${sourceDir}）`);
  const configure = spawnSync(
    "cmake",
    ["-S", sourceDir, "-B", buildDir, "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF"],
    { stdio: "inherit" },
  );
  if (configure.status !== 0) {
    throw new Error(`cmake configure が失敗しました（exit ${configure.status}）`);
  }

  const jobs = Math.max(1, os.cpus()?.length ?? 1);
  log(`build-whisper: cmake build --target whisper-cli -j${jobs}`);
  const build = spawnSync(
    "cmake",
    ["--build", buildDir, "--target", "whisper-cli", "--config", "Release", "-j", String(jobs)],
    { stdio: "inherit" },
  );
  if (build.status !== 0) {
    throw new Error(`cmake --build が失敗しました（exit ${build.status}）`);
  }

  const builtBinary = path.join(buildDir, "bin", "whisper-cli");
  if (!existsSync(builtBinary)) {
    throw new Error(`ビルド後に想定した成果物がありません: ${builtBinary}`);
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(builtBinary, dest);
  await chmod(dest, 0o755);

  // -DBUILD_SHARED_LIBS=OFF で単一バイナリになる想定だが、想定外に dylib が残った場合に
  // 備えた保険（コストがほぼ無いため常に実施）。存在すれば同ディレクトリへ並べてコピーする。
  const buildBinDir = path.join(buildDir, "bin");
  const buildBinEntries = await readdir(buildBinDir, { withFileTypes: true }).catch(() => []);
  const strayDylibs = buildBinEntries.filter((e) => e.isFile() && e.name.endsWith(".dylib"));
  for (const dylib of strayDylibs) {
    const dylibDest = path.join(path.dirname(dest), dylib.name);
    await copyFile(path.join(buildBinDir, dylib.name), dylibDest);
    log(`build-whisper: 想定外の dylib を同梱しました（保険）: ${path.relative(VENDOR_ROOT, dylibDest)}`);
  }

  const helpResult = spawnSync(dest, ["--help"], { stdio: "pipe", encoding: "utf8" });
  if (helpResult.status !== 0) {
    throw new Error(
      `ビルドした whisper-cli の --help が exit ${helpResult.status} でした` +
        `（stderr: ${helpResult.stderr?.slice(0, 500) ?? ""}）`,
    );
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const sizeBytes = (await stat(dest)).size;
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
  log(
    `build-whisper: 完了 — ${path.relative(VENDOR_ROOT, dest)}（${sizeMb}MB, ${elapsedSeconds}s, ` +
      `dylib companions: ${strayDylibs.length}）--help exit 0 確認済み`,
  );

  return {
    supported: true,
    whisperCli: dest,
    elapsedSeconds: Number(elapsedSeconds),
    sizeBytes,
    dylibCompanions: strayDylibs.map((e) => e.name),
  };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  const forceFlag = process.argv.includes("--force");
  buildWhisperCli({ force: forceFlag, log: (msg) => console.log(msg) })
    .then((result) => {
      if (result.supported === false) {
        console.log(`build-whisper: スキップしました（reason: ${result.reason}）。`);
        return;
      }
      console.log(`build-whisper: whisper-cli -> ${result.whisperCli}`);
    })
    .catch((error) => {
      console.error(`build-whisper: 失敗しました — ${error.message}`);
      process.exit(1);
    });
}
