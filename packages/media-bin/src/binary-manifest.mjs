// binary-manifest — ffmpeg / ffprobe の同梱バイナリ供給元をピン留めする表。
//
// task/2026-08-01-gpl-only-ffmpeg-swap: ffmpeg-static@5.3.0 / ffprobe-static@3.1.0 は
// (a) --enable-nonfree ビルド（再配布不可） (b) darwin/arm64 の ffprobe が x86_64 実体、という
// 2 問題を持っていたため撤去した。代わりにここでバージョン固定 + sha256 検証済みの GPL-only・
// 対象アーキテクチャ真ネイティブのビルドを直接取得する（fetch-binaries.mjs が実行）。
//
// 選定（詳細は task report.md の比較表を参照）:
// - darwin-arm64 / darwin-x64: martin-riedl.de の "Release" ビルド（バージョンタグ固定 8.1.2。
//   "snapshot" ではなく "release" を採用 — snapshot は git スナップショット単位で URL が
//   ロールするが release はタグ単位で history に残り続ける）。実測: configuration に
//   --enable-gpl はあるが --enable-nonfree は無い（darwin ビルドのみ。linux ビルドは
//   --enable-nonfree --enable-decklink を含むため不採用 — 実測で判明、選定理由の核）
// - linux-x64 / linux-arm64 / win32-x64: BtbN/FFmpeg-Builds の "gpl" バリアント
//   （--enable-gpl、--disable-libfdk-aac、--enable-nonfree 無し）。日付タグ
//   （autobuild-YYYY-MM-DD-HH-mm）でピン留め — "latest" タグはローリングのため不採用。
//   martin-riedl.de は Windows ビルドを提供していないため、win32-x64 は BtbN のみで賄う
//
// 全エントリ共通の採用条件（task.md 記載の4条件）:
//   (a) --enable-nonfree を含まない (b) 対象 OS/arch の真ネイティブ実体
//   (c) 配布元がライセンス・ソース入手先を明示 (d) バージョン固定 + sha256 検証可能

import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** ダウンロード済みバイナリの格納先（.gitignore 済み。npm install 時の postinstall が生成する）。 */
export const VENDOR_ROOT = path.join(packageRoot, "vendor");

/**
 * 現在のプロセスのプラットフォーム/アーキテクチャから manifest のキーを作る。
 * @param {string} [platform]
 * @param {string} [arch]
 */
export function currentTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * vendor 配下の解決済みバイナリパス（存在するとは限らない — 呼び出し側が existsSync で確認する）。
 * @param {"ffmpeg"|"ffprobe"} name
 * @param {string} [target]
 */
export function vendorBinaryPath(name, target = currentTarget()) {
  const exeName = target.startsWith("win32-") ? `${name}.exe` : name;
  return path.join(VENDOR_ROOT, target, exeName);
}

const MARTIN_RIEDL_LICENSE =
  "GPL-3.0-or-later build (--enable-gpl, no --enable-nonfree; libx264/libx265 dual-licensed under GPL). " +
  "Source: https://git.martin-riedl.de/ffmpeg/build-script — codec/library list: https://ffmpeg.martin-riedl.de/#info";

const BTBN_LICENSE =
  "GPL-3.0-or-later build (--enable-gpl, --disable-libfdk-aac, no --enable-nonfree). " +
  "Build recipe: https://github.com/BtbN/FFmpeg-Builds";

export const BINARY_MANIFEST = {
  "darwin-arm64": {
    label: "macOS arm64 (Apple Silicon) — martin-riedl.de release 8.1.2",
    license: MARTIN_RIEDL_LICENSE,
    entries: {
      ffmpeg: {
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1783011502_8.1.2/ffmpeg.zip",
        sha256: "ef1aa60006c7b77ce170c1608c08d8e4ba1c30c5746f2ac986ded932d0ac2c3c",
        member: "ffmpeg",
      },
      ffprobe: {
        url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1783011502_8.1.2/ffprobe.zip",
        sha256: "c39787f4af7a3932502d2d48db6f6feaaa836b48a73ef78c32cc3285df61dfaf",
        member: "ffprobe",
      },
    },
  },
  "darwin-x64": {
    label: "macOS x64 (Intel) — martin-riedl.de release 8.1.2",
    license: MARTIN_RIEDL_LICENSE,
    entries: {
      ffmpeg: {
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1783018342_8.1.2/ffmpeg.zip",
        sha256: "a52ef43883f44c219766d4b3bdde4e635b35465d0b704c01c3a0566b59775df9",
        member: "ffmpeg",
      },
      ffprobe: {
        url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1783018342_8.1.2/ffprobe.zip",
        sha256: "5408ca588c8c72b0dde3afe676d0a7acf25ef97e55ae6eba5c7bede1cda42695",
        member: "ffprobe",
      },
    },
  },
  "linux-x64": {
    label: "Linux x64 — BtbN/FFmpeg-Builds autobuild-2026-07-31-14-10 (gpl-8.1)",
    license: BTBN_LICENSE,
    entries: {
      ffmpeg: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-gpl-8.1.tar.xz",
        sha256: "09fc77be269c7053e438b7e96548e4af97604faf96a42c4a3c56a1ad74c22c0a",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-gpl-8.1/bin/ffmpeg",
      },
      ffprobe: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-gpl-8.1.tar.xz",
        sha256: "09fc77be269c7053e438b7e96548e4af97604faf96a42c4a3c56a1ad74c22c0a",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-linux64-gpl-8.1/bin/ffprobe",
      },
    },
  },
  "linux-arm64": {
    label: "Linux arm64 — BtbN/FFmpeg-Builds autobuild-2026-07-31-14-10 (gpl-8.1)",
    license: BTBN_LICENSE,
    entries: {
      ffmpeg: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-linuxarm64-gpl-8.1.tar.xz",
        sha256: "177e40c91564dec3840096f3bf1ffe696b94330585972462cfc739fa29fe0e1a",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-linuxarm64-gpl-8.1/bin/ffmpeg",
      },
      ffprobe: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-linuxarm64-gpl-8.1.tar.xz",
        sha256: "177e40c91564dec3840096f3bf1ffe696b94330585972462cfc739fa29fe0e1a",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-linuxarm64-gpl-8.1/bin/ffprobe",
      },
    },
  },
  "win32-x64": {
    label: "Windows x64 — BtbN/FFmpeg-Builds autobuild-2026-07-31-14-10 (gpl-8.1)",
    license: BTBN_LICENSE,
    entries: {
      ffmpeg: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1.zip",
        sha256: "cc4156d51387566ea8ba653fc3a04897bdf812fddf652428d9030bbf7ae24835",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1/bin/ffmpeg.exe",
      },
      ffprobe: {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1.zip",
        sha256: "cc4156d51387566ea8ba653fc3a04897bdf812fddf652428d9030bbf7ae24835",
        member: "ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1/bin/ffprobe.exe",
      },
    },
  },
};
