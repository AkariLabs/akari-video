import { cubicBezierAt } from './caption-motion.js';

export type CaptionWordRole =
  | 'plain'
  | 'karaoke'
  | 'pop'
  | 'reveal-word'
  | 'emphasis-bang'
  | 'emphasis-pulse';

export interface CaptionWordTiming {
  role: CaptionWordRole;
  delaySec: number;
  durationSec: number;
  emPx?: number;
}

export interface CaptionWordState {
  mix: number;
  visible: boolean;
  opacity: number;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
}

export interface CaptionWordRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface CaptionWordTileToken {
  lineIndex: number;
  rect: CaptionWordRect;
  timing: CaptionWordTiming | null;
  tokenIndex?: number;
  /** Cue-wide grapheme and parent word identities, present only for char markup. */
  charIndex?: number;
  wordIndex?: number;
  rectIndex?: number;
  role?: CaptionWordRole;
  style?: string | null;
}

export interface CaptionWordTileMeasurement {
  emPx: number;
  tokens: readonly CaptionWordTileToken[];
  lines: readonly CaptionWordRect[];
  plate?: CaptionWordRect | null;
  wordCount?: number;
  reveal?: boolean;
  revealDelay?: number;
  revealDuration?: number;
}

export interface CaptionWordTile {
  /** Opt-in identity for animator lookup; padding tiles have no token. */
  token?: CaptionWordTileToken;
  static: {
    x: number;
    y: number;
    width: number;
    height: number;
    mix: number;
    visible: boolean;
    opacity: number;
  };
  timing: CaptionWordTiming | null;
}

const identity = (): CaptionWordState => ({
  mix: 0,
  visible: true,
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1
});

const RECT_KEYS = ['x', 'y', 'width', 'height', 'right', 'bottom'] as const;

function captionRectsEqual(left: CaptionWordRect, right: CaptionWordRect): boolean {
  return RECT_KEYS.every((key) => left[key] === right[key]);
}

function captionTimingsEqual(left: CaptionWordTiming | null, right: CaptionWordTiming | null): boolean {
  if (left === null || right === null) return left === right;
  return left.role === right.role
    && left.delaySec === right.delaySec
    && left.durationSec === right.durationSec
    && left.emPx === right.emPx;
}

/** Strict equality for independently inserted DOM caption measurements. */
export function captionMeasurementsEqual(
  left: CaptionWordTileMeasurement,
  right: CaptionWordTileMeasurement
): boolean {
  if (left.tokens.length !== right.tokens.length || left.lines.length !== right.lines.length) return false;
  if (left.emPx !== right.emPx
      || left.wordCount !== right.wordCount
      || left.reveal !== right.reveal
      || left.revealDelay !== right.revealDelay
      || left.revealDuration !== right.revealDuration) return false;
  if (left.plate === null || left.plate === undefined || right.plate === null || right.plate === undefined) {
    if (left.plate !== right.plate) return false;
  } else if (!captionRectsEqual(left.plate, right.plate)) return false;
  for (let index = 0; index < left.lines.length; index += 1) {
    if (!captionRectsEqual(left.lines[index]!, right.lines[index]!)) return false;
  }
  for (let index = 0; index < left.tokens.length; index += 1) {
    const a = left.tokens[index]!;
    const b = right.tokens[index]!;
    if (a.tokenIndex !== b.tokenIndex
        || a.charIndex !== b.charIndex
        || a.wordIndex !== b.wordIndex
        || a.rectIndex !== b.rectIndex
        || a.role !== b.role
        || a.style !== b.style
        || a.lineIndex !== b.lineIndex
        || !captionRectsEqual(a.rect, b.rect)
        || !captionTimingsEqual(a.timing, b.timing)) return false;
  }
  return true;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const lerp = (left: number, right: number, progress: number): number => left + (right - left) * clamp01(progress);
const easeOut = (progress: number): number => cubicBezierAt(clamp01(progress), 0, 0, 0.58, 1);
const easeInOut = (progress: number): number => cubicBezierAt(clamp01(progress), 0.42, 0, 0.58, 1);

function progressAt(timing: CaptionWordTiming, localSeconds: number): number {
  const local = Number.isFinite(localSeconds) ? localSeconds : 0;
  const delay = Number.isFinite(timing.delaySec) ? timing.delaySec : 0;
  const duration = Math.max(Number.isFinite(timing.durationSec) ? timing.durationSec : 0, 1e-9);
  return clamp01((local - delay) / duration);
}

function twoSegment(
  progress: number,
  start: number,
  middle: number,
  end: number,
  ease: (value: number) => number
): number {
  if (progress <= 0.5) return lerp(start, middle, ease(progress * 2));
  return lerp(middle, end, ease((progress - 0.5) * 2));
}

export function captionWordStateAt(timing: CaptionWordTiming, localSeconds: number): CaptionWordState {
  const state = identity();
  const progress = progressAt(timing, localSeconds);
  const emPx = Math.max(0, Number.isFinite(timing.emPx) ? Number(timing.emPx) : 0);
  switch (timing.role) {
    case 'karaoke':
      return { ...state, mix: progress };
    case 'pop': {
      const scale = twoSegment(progress, 1, 1.12, 1, easeOut);
      const translateY = twoSegment(progress, 0, -0.08 * emPx, 0, easeOut);
      return { ...state, scaleX: scale, scaleY: scale, translateY };
    }
    case 'reveal-word':
      return { ...state, visible: progress > 0, opacity: progress };
    case 'emphasis-bang': {
      const eased = easeOut(progress);
      const opacity = eased;
      const scale = lerp(1.6, 1, eased);
      return { ...state, visible: opacity > 0, opacity, scaleX: scale, scaleY: scale };
    }
    case 'emphasis-pulse': {
      const scale = twoSegment(progress, 1, 1.25, 1, easeInOut);
      return { ...state, scaleX: scale, scaleY: scale };
    }
    case 'plain':
    default:
      return state;
  }
}

export function captionRevealGroupStateAt(
  delaySec: number,
  durationSec: number,
  localSeconds: number,
  emPx: number
): { opacity: number; translateY: number } {
  const progress = progressAt({ role: 'plain', delaySec, durationSec }, localSeconds);
  const em = Math.max(0, Number.isFinite(emPx) ? emPx : 0);
  if (progress <= 0.12) {
    const interval = progress / 0.12;
    return { opacity: interval, translateY: lerp(0.18 * em, 0, interval) };
  }
  if (progress <= 0.9999) return { opacity: 1, translateY: 0 };
  if (progress >= 1) return { opacity: 0, translateY: 0 };
  return { opacity: lerp(1, 0, (progress - 0.9999) / 0.0001), translateY: 0 };
}

function integerTile(x: number, y: number, width: number, height: number): CaptionWordTile['static'] {
  return { x, y, width, height, mix: 0, visible: true, opacity: 1 };
}

export function buildCaptionWordTiles(
  measurement: CaptionWordTileMeasurement,
  size: { width: number; height: number; textureRect?: CaptionWordRect; includeTokens?: boolean }
): CaptionWordTile[] | null {
  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('caption tile dimensions must be positive integers');
  }
  if (!measurement || measurement.tokens.length === 0) return null;
  const textureRect = size.textureRect ?? {
    x: 0, y: 0, width, height, right: width, bottom: height
  };
  const cropLeft = Math.max(0, Math.floor(textureRect.x));
  const cropTop = Math.max(0, Math.floor(textureRect.y));
  const cropRight = Math.min(width, Math.ceil(textureRect.right));
  const cropBottom = Math.min(height, Math.ceil(textureRect.bottom));
  if (cropRight <= cropLeft || cropBottom <= cropTop) {
    throw new Error('caption texture rectangle must overlap the frame');
  }
  const margin = Math.ceil(0.35 * Math.max(0, Number(measurement.emPx) || 0));
  const byLine = new Map<number, CaptionWordTileToken[]>();
  for (const token of measurement.tokens) {
    const list = byLine.get(token.lineIndex) ?? [];
    list.push(token);
    byLine.set(token.lineIndex, list);
  }
  const strips = [...byLine.entries()].map(([lineIndex, tokens]) => {
    const line = measurement.lines[lineIndex] ?? {
      x: 0,
      width,
      right: width,
      y: Math.min(...tokens.map((token) => token.rect.y)),
      height: 0,
      bottom: Math.max(...tokens.map((token) => token.rect.bottom))
    };
    return {
      lineIndex,
      tokens: tokens.sort((left, right) => left.rect.x - right.rect.x
        || (left.tokenIndex ?? 0) - (right.tokenIndex ?? 0)),
      top: Math.max(cropTop, Math.floor(line.y - margin)),
      bottom: Math.min(cropBottom, Math.ceil(line.bottom + margin))
    };
  }).sort((left, right) => left.top - right.top || left.lineIndex - right.lineIndex);
  for (let index = 0; index + 1 < strips.length; index += 1) {
    const current = strips[index]!;
    const next = strips[index + 1]!;
    if (current.bottom > next.top) {
      const boundary = Math.round((current.bottom + next.top) / 2);
      current.bottom = boundary;
      next.top = boundary;
    }
  }
  const tiles: CaptionWordTile[] = [];
  let cursorY = cropTop;
  for (const strip of strips) {
    if (strip.top > cursorY) {
      tiles.push({
        static: integerTile(cropLeft, cursorY, cropRight - cropLeft, strip.top - cursorY),
        timing: null
      });
    }
    const starts = strip.tokens.map((token, index) => index === 0
      ? Math.max(cropLeft, Math.round(token.rect.x) - margin)
      : Math.max(cropLeft, Math.min(cropRight, Math.round(
          (strip.tokens[index - 1]!.rect.right + token.rect.x) / 2
        ))));
    const tokenEnd = Math.min(cropRight, Math.round(strip.tokens.at(-1)!.rect.right) + margin);
    const stripHeight = strip.bottom - strip.top;
    if (starts[0]! > cropLeft && stripHeight > 0) {
      tiles.push({
        static: integerTile(cropLeft, strip.top, starts[0]! - cropLeft, stripHeight),
        timing: null
      });
    }
    for (const [index, token] of strip.tokens.entries()) {
      const start = starts[index]!;
      const end = index + 1 < starts.length ? starts[index + 1]! : tokenEnd;
      if (end <= start || stripHeight <= 0) continue;
      tiles.push({ static: integerTile(start, strip.top, end - start, stripHeight), timing: token.timing,
        ...(size.includeTokens ? { token } : {}) });
    }
    if (tokenEnd < cropRight && stripHeight > 0) {
      tiles.push({
        static: integerTile(tokenEnd, strip.top, cropRight - tokenEnd, stripHeight),
        timing: null
      });
    }
    cursorY = strip.bottom;
  }
  if (cursorY < cropBottom) {
    tiles.push({
      static: integerTile(cropLeft, cursorY, cropRight - cropLeft, cropBottom - cursorY),
      timing: null
    });
  }
  const area = tiles.reduce((sum, tile) => sum + tile.static.width * tile.static.height, 0);
  const cropArea = (cropRight - cropLeft) * (cropBottom - cropTop);
  if (area !== cropArea) {
    throw new Error(`caption tile partition does not cover the texture rectangle: ${area}/${cropArea}`);
  }
  return tiles;
}

export function captionWordTextureRect(
  measurement: CaptionWordTileMeasurement,
  size: { width: number; height: number }
): CaptionWordRect {
  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('caption texture dimensions must be positive integers');
  }
  const rectangles = [
    ...measurement.lines,
    ...measurement.tokens.map((token) => token.rect),
    ...(measurement.plate ? [measurement.plate] : [])
  ];
  if (rectangles.length === 0) {
    return { x: 0, y: 0, width, height, right: width, bottom: height };
  }
  const marginY = Math.max(24, Math.ceil(Math.max(0, Number(measurement.emPx) || 0)));
  const y = Math.max(0, Math.floor(Math.min(...rectangles.map((rect) => rect.y)) - marginY));
  const bottom = Math.min(
    height,
    Math.ceil(Math.max(...rectangles.map((rect) => rect.bottom)) + marginY)
  );
  return { x: 0, y, width, height: bottom - y, right: width, bottom };
}
