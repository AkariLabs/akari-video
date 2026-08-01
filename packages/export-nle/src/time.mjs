// 時間表現の量子化と各形式への整形。
// edit.json は秒 float、FCPXML は有理数秒（"1001/30000s"）、xmeml は整数フレーム。
// すべての出力時刻はフレーム境界へ丸めてから整形する（丸めずに書くと FCPX が
// 「not on an edit frame boundary」警告を出し、xmeml では 1 フレームずれが積もる）。

const NTSC_FAMILIES = [
  { fps: 24000 / 1001, numerator: 1001, denominator: 24000, timebase: 24 },
  { fps: 30000 / 1001, numerator: 1001, denominator: 30000, timebase: 30 },
  { fps: 60000 / 1001, numerator: 1001, denominator: 60000, timebase: 60 },
];

const FPS_EPSILON = 0.005;

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x || 1;
}

// fps → 1 フレームの尺（有理数秒）。NTSC 系（23.976 / 29.97 / 59.94）は 1001 系へ、
// 整数 fps は 1/fps へ。それ以外は ms 精度で有理数化する。
export function frameDuration(fps) {
  for (const family of NTSC_FAMILIES) {
    if (Math.abs(fps - family.fps) < FPS_EPSILON) {
      return { numerator: family.numerator, denominator: family.denominator };
    }
  }
  if (Number.isInteger(fps)) return { numerator: 1, denominator: fps };
  const denominator = Math.round(fps * 1000);
  const divisor = gcd(1000, denominator);
  return { numerator: 1000 / divisor, denominator: denominator / divisor };
}

export function exactFps(fd) {
  return fd.denominator / fd.numerator;
}

// 秒 → フレーム番号（最近傍丸め）。
export function toFrames(seconds, fd) {
  return Math.round((seconds * fd.denominator) / fd.numerator);
}

// 秒 → FCPXML の有理数秒文字列。フレーム境界へ量子化してから約分する。
export function fcpTime(seconds, fd) {
  const frames = toFrames(seconds, fd);
  const numerator = frames * fd.numerator;
  if (numerator === 0) return "0s";
  const divisor = gcd(numerator, fd.denominator);
  const n = numerator / divisor;
  const d = fd.denominator / divisor;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

// FCPXML format 要素の frameDuration 属性値。
export function fcpFrameDuration(fd) {
  return fd.numerator === 1 && fd.denominator === 1
    ? "1s"
    : `${fd.numerator}/${fd.denominator}s`;
}

// xmeml の rate 要素（整数 timebase + ntsc フラグ）。
export function xmemlRate(fps) {
  for (const family of NTSC_FAMILIES) {
    if (Math.abs(fps - family.fps) < FPS_EPSILON) {
      return { timebase: family.timebase, ntsc: true };
    }
  }
  return { timebase: Math.round(fps), ntsc: false };
}

// SRT のタイムスタンプ "HH:MM:SS,mmm"。
export function srtTime(seconds) {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
