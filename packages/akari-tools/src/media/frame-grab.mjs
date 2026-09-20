// 静止画 1 枚ずつの取得（`akari media grab --separate`）のシーク計画と実行。
//
// ── なぜ二段構えなのか（不具合メモ第9項） ──
// ffmpeg のシークは `-ss` を `-i` の前に置くか後に置くかで意味が変わる。
//   `-i` の後（出力側シーク）: 先頭から全フレームをデコードして目的時刻まで捨てる。
//     32 分地点なら 32 分ぶんのデコードが走る（第9項の実測: 一眼素材 3 枚で数分以上）。
//   `-i` の前（入力側シーク）: コンテナの索引で直近のキーフレームへ飛ぶ。時刻に依らずほぼ一定。
//
// 入力側シークだけに置き換えると、索引の壊れた・欠けた素材でシーク先が目的時刻を越えて
// 着地したときに「要求した時刻より後のフレーム」が返る（`-accurate_seek` は既定 on だが、
// 着地点が目的時刻より後ろだと捨てるものが無いので救えない）。用途は話者・カメラ確認の
// 代表フレームなので時刻の正確さが要る。よって:
//   1. 入力側 `-ss` で PREROLL 秒手前へ飛ぶ（高速。キーフレーム境界へ丸められてよい）
//   2. 出力側 `-ss` で目的時刻まで精密に捨てる（フレーム選択規則は従来と同一）
// 1 と 2 の秒数は µs 整数で分割する（`splitSeekMicros`）。ffmpeg 内部の時刻比較は
// AV_TIME_BASE = µs 整数なので、入力側 + 出力側 = 従来の出力側単独と同じ閾値になり、
// 「最初に pts >= 目的時刻となるフレーム」という選択規則が 1 µs もずれない。
//
// ── 精度の実行時保証 ──
// 最も早い出力の filter chain に `showinfo` を足し、デコード開始フレームの時刻を読む。
// それが目的時刻を越えていたら（= 入力側シークが目的地点を飛び越えた素材）、
// その時刻は従来の出力側シーク単独（`legacyFrameGrabArguments`）でやり直す。
// これで精度は従来と同一以上、最悪時のコストも従来と同じに収まる。
//
// ── 近接時刻の一括抽出 ──
// 1 プロセスに複数出力を並べると、入力のデコードは 1 回で済み、各出力が自分の
// 出力側 `-ss` の位置だけを書き出す（最後の出力が 1 コマ書いた時点で ffmpeg は止まる）。
// まとめる条件は「直前の時刻との差 <= GRAB_BATCH_GAP_SECONDS」の連鎖。閾値の根拠は
// 実素材（1920x1080 h264 29.97fps・16.8GB・キーフレーム間隔 0.5005s 実測）の 32 分地点で
// 同じ 3 枚（1920 / 1922 / 1924s）を取った実測 2 点:
//   - 3 プロセスに分けて入力側シークで取ると 1.415s → 1 枚ぶんの固定費 ≈ 0.47s
//     （spawn + 索引シーク + PREROLL 1s + キーフレーム間隔ぶんのデコード）
//   - 1 パス（1919→1924s の 5 秒ぶん）にまとめると 0.896s
//     → デコード + scale の実効速度 ≈ 実時間の 5.6 倍
// まとめると隙間ぶん（gap 秒）を余分にデコードし、分けると上の固定費を余分に払う。
// 釣り合うのは gap ≈ 0.47s × 5.6 ≈ 2.6s なので、少し内側の 2.5s を採る。
// 離れた時刻を無理にまとめると隙間ぶんのデコードが丸損なので、この閾値は控えめに置く
// （32 分離れた 2 枚をまとめると 32 分ぶんデコードする = 第9項の再現）。
// 1 パスの上限コマ数はコンタクトシート契約と同じ 12（出力ごとに encoder + filter graph を
// 抱えるので無制限にはしない）。

import { runChecked } from "./common.mjs";

// 入力側シークで目的時刻の手前に取る余裕（秒）。索引のずれと open-GOP の参照を跨ぐため。
export const GRAB_PREROLL_SECONDS = 1;
// 一括抽出でまとめる時刻の近さ（秒）。上のコメントの測り取りが根拠。
export const GRAB_BATCH_GAP_SECONDS = 2.5;
// 1 パスに並べる出力の上限。コンタクトシート契約（1 枚最大 12 コマ）と同じ数に合わせる。
export const GRAB_BATCH_MAX_FRAMES = 12;

const MICROS_PER_SECOND = 1_000_000;
// showinfo の pts_time と出力側シークの比較許容（µs 丸めぶんだけ）。
const VERIFY_EPSILON_SECONDS = 1e-6;

export function toMicros(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) throw new Error(`時刻が不正です: ${seconds}`);
  return Math.max(0, Math.round(value * MICROS_PER_SECOND));
}

export function secondsArgument(micros) {
  return (micros / MICROS_PER_SECOND).toFixed(6);
}

// 目的時刻を「入力側シーク + 出力側シーク」へ µs 整数で分割する。和は常に目的時刻。
export function splitSeekMicros(micros, prerollMicros) {
  const inputSeekMicros = Math.max(0, micros - prerollMicros);
  return { inputSeekMicros, outputSeekMicros: micros - inputSeekMicros };
}

// requests: [{ time, outputPath }]（呼び出し順）
// → [{ inputSeekMicros, frames: [{ time, micros, outputPath, outputSeekMicros }] }]（時刻昇順）
export function buildFrameGrabPlan(requests, options = {}) {
  const prerollMicros = toMicros(options.preroll ?? GRAB_PREROLL_SECONDS);
  const gapMicros = toMicros(options.gap ?? GRAB_BATCH_GAP_SECONDS);
  const maxFrames = options.maxFrames ?? GRAB_BATCH_MAX_FRAMES;
  if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new Error("maxFrames は 1 以上の整数で指定してください");

  // 同じ出力ファイルを指す指定は 1 回の抽出にまとめる。1 プロセスから同じパスを
  // 二重に開かせないため。従来（1 枚ずつ順に上書き）と同じ「後の指定が残る」形にする。
  const byOutputPath = new Map();
  for (const request of requests) {
    byOutputPath.set(request.outputPath, { ...request, micros: toMicros(request.time) });
  }
  const sorted = [...byOutputPath.values()].sort((left, right) => left.micros - right.micros);

  const groups = [];
  for (const frame of sorted) {
    const current = groups.at(-1);
    const near = current && frame.micros - current.lastMicros <= gapMicros;
    if (near && current.frames.length < maxFrames) {
      current.lastMicros = frame.micros;
      current.frames.push(frame);
      continue;
    }
    groups.push({ firstMicros: frame.micros, lastMicros: frame.micros, frames: [frame] });
  }

  return groups.map((group) => {
    const { inputSeekMicros } = splitSeekMicros(group.firstMicros, prerollMicros);
    return {
      inputSeekMicros,
      frames: group.frames.map((frame) => ({
        time: frame.time,
        micros: frame.micros,
        outputPath: frame.outputPath,
        outputSeekMicros: frame.micros - inputSeekMicros,
      })),
    };
  });
}

// 1 パスぶんの ffmpeg 引数列。`-ss`（入力側）は必ず `-i` より前に置く — 第9項の再発防止。
export function frameGrabArguments({ inputPath, pass, filter, verify = true }) {
  const args = [
    "-hide_banner",
    // showinfo でデコード開始フレームの時刻を読むため info まで上げる
    //（stderr は runChecked が抱えるだけで、成功時は誰にも見せない）。
    "-loglevel", verify ? "info" : "error",
    "-nostdin", "-y",
    "-ss", secondsArgument(pass.inputSeekMicros),
    "-i", inputPath,
  ];
  for (const [index, frame] of pass.frames.entries()) {
    args.push(
      "-ss", secondsArgument(frame.outputSeekMicros),
      "-frames:v", "1",
      // 最も早い出力だけ showinfo を足す。その出力が 1 コマ書いた時点で
      // その filter chain へのフレーム供給は止まるので、ログ量も最小で済む。
      "-vf", verify && index === 0 ? `${filter},showinfo` : filter,
      frame.outputPath,
    );
  }
  return args;
}

// 従来（第9項の修正前）と同じ出力側シーク単独の引数列。入力側シークが目的時刻を
// 越えた素材のやり直し用。遅いが、先頭から全部デコードするので取り違えは起こらない。
export function legacyFrameGrabArguments({ inputPath, frame, filter }) {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", inputPath,
    "-ss", secondsArgument(frame.micros ?? toMicros(frame.time)),
    "-frames:v", "1",
    "-vf", filter,
    frame.outputPath,
  ];
}

// showinfo が報告した最初のフレーム時刻（入力側シーク起点の相対秒）。見つからなければ null。
export function firstDecodedSeconds(stderr) {
  let earliest = null;
  for (const match of String(stderr ?? "").matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    if (earliest === null || value < earliest) earliest = value;
  }
  return earliest;
}

// デコード開始フレームより後ろにある目的時刻は、従来と同じフレームが選ばれることが
// 保証される（候補集合が同一）。開始フレームより前の目的時刻はやり直す。
export function staleFrames(pass, firstDecoded) {
  if (firstDecoded === null) return [];
  return pass.frames.filter(
    (frame) => frame.outputSeekMicros / MICROS_PER_SECOND < firstDecoded - VERIFY_EPSILON_SECONDS,
  );
}

// options は runChecked へ渡す実行オプション（spawn 差し替え等）。シーク計画のツマミは plan 側。
export function grabFrames({ ffmpeg, inputPath, requests, filter, options = {}, plan = {}, onWarning }) {
  const passes = buildFrameGrabPlan(requests, plan);
  for (const pass of passes) {
    const result = runPass({ ffmpeg, inputPath, pass, filter, options, onWarning });
    const firstDecoded = firstDecodedSeconds(result?.stderr);
    for (const frame of staleFrames(pass, firstDecoded)) {
      onWarning?.(
        `grab: 入力側シークが t=${secondsArgument(frame.micros)}s を越えました`
        + `（デコード開始 ${secondsArgument(pass.inputSeekMicros)}s + ${firstDecoded}s）。`
        + "素材の索引が信頼できないため、この 1 枚は先頭からデコードしてやり直します（時間がかかります）。",
      );
      runChecked(ffmpeg, legacyFrameGrabArguments({ inputPath, frame, filter }), options);
    }
  }
  return passes;
}

// showinfo が無い ffmpeg ビルド（filter を落として作られたもの）でも取得自体は落とさない。
// その場合は精度の実行時検査だけを諦める（シークの二段構えは効いたまま）。
function runPass({ ffmpeg, inputPath, pass, filter, options, onWarning }) {
  try {
    return runChecked(ffmpeg, frameGrabArguments({ inputPath, pass, filter }), options);
  } catch (error) {
    if (!String(error?.message ?? "").includes("showinfo")) throw error;
    onWarning?.("grab: この ffmpeg は showinfo filter を持たないため、シーク位置の検査を省略します。");
    return runChecked(ffmpeg, frameGrabArguments({ inputPath, pass, filter, verify: false }), options);
  }
}
