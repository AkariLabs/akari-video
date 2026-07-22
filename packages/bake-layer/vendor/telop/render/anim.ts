// イージング関数とキーフレーム補間
import type { Ease, Track } from '../atf/types'

const NUMBER_RE = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`
const CUBIC_BEZIER_RE = new RegExp(
  String.raw`^cubic-bezier\(\s*(${NUMBER_RE})\s*,\s*(${NUMBER_RE})\s*,\s*(${NUMBER_RE})\s*,\s*(${NUMBER_RE})\s*\)$`,
  'i',
)
const STEPS_RE = /^steps\(\s*(\d+)\s*(?:,\s*(start|end)\s*)?\)$/i

function cubicBezierValue(p1: number, p2: number, t: number): number {
  const u = 1 - t
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t
}

function cubicBezierDerivative(p1: number, p2: number, t: number): number {
  const u = 1 - t
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2)
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  let t = x
  for (let i = 0; i < 8; i++) {
    const estimate = cubicBezierValue(x1, x2, t)
    const delta = estimate - x
    if (Math.abs(delta) < 1e-7) return cubicBezierValue(y1, y2, t)

    const derivative = cubicBezierDerivative(x1, x2, t)
    if (Math.abs(derivative) < 1e-7) break

    const next = t - delta / derivative
    if (next < 0 || next > 1) break
    t = next
  }

  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    t = (lo + hi) / 2
    const estimate = cubicBezierValue(x1, x2, t)
    if (Math.abs(estimate - x) < 1e-7) break
    if (estimate < x) lo = t
    else hi = t
  }
  return cubicBezierValue(y1, y2, t)
}

function steps(count: number, jumpTerm: 'start' | 'end', t: number): number {
  if (jumpTerm === 'start') return t <= 0 ? 1 / count : Math.min(1, Math.ceil(t * count) / count)
  if (t >= 1) return 1
  return Math.floor(t * count) / count
}

/**
 * イージング関数: t01 は [0, 1] の正規化時刻
 */
export function ease(name: Ease, t01: number): number {
  const t = Math.max(0, Math.min(1, t01))
  switch (name) {
    case 'linear':
      return t
    case 'in-cubic':
      return t * t * t
    case 'out-cubic': {
      const u = 1 - t
      return 1 - u * u * u
    }
    case 'inout-cubic': {
      if (t < 0.5) return 4 * t * t * t
      const u = -2 * t + 2
      return 1 - (u * u * u) / 2
    }
    case 'out-back': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    case 'step':
      // 区間の終端でカチッと切り替わる（タイプライターの瞬間表示）
      return t >= 1 ? 1 : 0
  }

  const cubicMatch = CUBIC_BEZIER_RE.exec(name)
  if (cubicMatch) {
    const [, x1, y1, x2, y2] = cubicMatch
    return cubicBezier(Number(x1), Number(y1), Number(x2), Number(y2), t)
  }

  const stepsMatch = STEPS_RE.exec(name)
  if (stepsMatch) {
    const count = Number(stepsMatch[1])
    if (count >= 1) return steps(count, (stepsMatch[2] as 'start' | 'end' | undefined) ?? 'end', t)
  }

  return t
}

/**
 * トラックの時刻 t での値をサンプリングする
 * @param track アニメーショントラック
 * @param t 時刻（秒）
 * @returns 補間後の値
 */
export function sampleTrack(track: Track, t: number): number {
  const keys = track.keys
  if (keys.length === 0) return 0
  if (keys.length === 1) return keys[0].v

  // 範囲外は端値を返す
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v

  // 区間を線形探索して補間
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]
    const k1 = keys[i + 1]
    if (t >= k0.t && t <= k1.t) {
      const duration = k1.t - k0.t
      if (duration <= 0) return k1.v
      const t01 = (t - k0.t) / duration
      // ease は区間の開始キーの ease プロパティを使う
      const easeName: Ease = k0.ease ?? 'linear'
      const easedT = ease(easeName, t01)
      return k0.v + (k1.v - k0.v) * easedT
    }
  }
  return keys[keys.length - 1].v
}
