#!/usr/bin/env node

// dummy-helper.mjs — vision-tracks-helper の代役（配管テスト専用）。
//
// 実 Vision 検出は行わず、stdin から届く raw BGRA フレームを実ヘルパーと同じ
// フレーミング（width * height * 4 バイト = 1 フレーム）で読み捨てる。フレームを
// 1 枚読むごとに固定パターンの JSON Lines を 1 行 stdout へ書く。フレーム数を
// 実際に stdin から数えるため、ffmpeg のデコード段が実フレームで動く限り
// vision-tracks.mjs のトラックファイル組み立て（t の割り付け・samples 件数・
// analysis.json への追記）を実ヘルパーと同じ配管で検証できる。
//
// パターン: 偶数フレームは顔・手とも検出あり（固定座標）、奇数フレームは検出ゼロ
// （空配列）。「検出ゼロのフレームも t を残す」契約 §2 の挙動を配管テストで踏める。

import { argv, exit, stdin, stdout } from "node:process";

function parseArgs() {
  const options = { width: 0, height: 0, kinds: ["face", "hand"] };
  for (let i = 2; i < argv.length; i += 1) {
    const name = argv[i];
    const value = argv[i + 1];
    if (name === "--width") options.width = Number(value);
    else if (name === "--height") options.height = Number(value);
    else if (name === "--kinds") options.kinds = value.split(",");
    // --joint-confidence / --metrics は配管テストでは無視する。
    if (["--width", "--height", "--kinds", "--joint-confidence", "--metrics"].includes(name)) i += 1;
  }
  return options;
}

const FIXED_FACE = {
  box: [0.1, 0.2, 0.3, 0.4],
  conf: 0.9,
  landmarks: {
    left_pupil: [0.2, 0.3],
    right_pupil: [0.3, 0.3],
    left_eye: [[0.18, 0.28], [0.22, 0.28]],
    right_eye: [[0.28, 0.28], [0.32, 0.28]],
    outer_lips: [[0.2, 0.5], [0.3, 0.5]],
    inner_lips: [[0.22, 0.5], [0.28, 0.5]],
    left_eyebrow: [[0.17, 0.25], [0.22, 0.23]],
    right_eyebrow: [[0.28, 0.23], [0.33, 0.25]],
    face_contour: [[0.12, 0.3], [0.14, 0.48], [0.25, 0.58], [0.36, 0.48], [0.38, 0.3]],
  },
};

const FIXED_HAND = {
  chirality: "right",
  conf: 0.8,
  joints: {
    thumb_tip: [0.4, 0.6],
    index_tip: [0.5, 0.5],
  },
};

async function readExactly(count) {
  let filled = 0;
  const parts = [];
  for await (const chunk of stdin) {
    parts.push(chunk);
    filled += chunk.length;
    if (filled >= count) break;
  }
  return filled >= count;
}

async function main() {
  const options = parseArgs();
  if (!options.width || !options.height) {
    stdout.write(`${JSON.stringify({ error: "--width and --height are required" })}\n`);
    exit(1);
  }
  const frameBytes = options.width * options.height * 4;

  // stdin をフレーム単位で読み捨てる。Node の for-await はバイト境界を保証しないため、
  // 単純化のため「合計バイト数」で数える（テスト用ダミーであり、実ヘルパーの
  // readExactly のような厳密なフレーム境界検査までは不要）。
  let totalBytes = 0;
  let frameIndex = 0;
  for await (const chunk of stdin) {
    totalBytes += chunk.length;
    while (totalBytes >= frameBytes * (frameIndex + 1)) {
      const line = {};
      const hasDetection = frameIndex % 2 === 0;
      if (options.kinds.includes("face")) line.face = hasDetection ? [FIXED_FACE] : [];
      if (options.kinds.includes("hand")) line.hand = hasDetection ? [FIXED_HAND] : [];
      stdout.write(`${JSON.stringify(line)}\n`);
      frameIndex += 1;
    }
  }
  exit(0);
}

await main();
