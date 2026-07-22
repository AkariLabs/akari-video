import type { Timing, Track } from '../atf/types'
import { sampleTrack } from './anim'

export type TrackPhase = NonNullable<Track['phase']>

interface PhaseWindows {
  in: [number, number]
  hold: [number, number]
  out: [number, number]
}

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function windows(T: number, timing: Timing): PhaseWindows {
  const total = positive(T)
  const requestedIn = positive(timing.inDur)
  const requestedOut = positive(timing.outDur)
  const requestedSum = requestedIn + requestedOut
  const scale = requestedSum > total && requestedSum > 0 ? total / requestedSum : 1

  const inDur = requestedIn * scale
  const outDur = requestedOut * scale
  const inEnd = inDur
  const outStart = Math.max(inEnd, total - outDur)
  // loopHold 時は hold ウィンドウを in/out の間の全域に広げる（その中で holdDur 周期にループ）
  const fixedWindow = timing.hold === 'fixed' && !timing.loopHold
  const holdDur = fixedWindow
    ? positive(timing.holdDur)
    : Math.max(0, outStart - inEnd)
  const holdEnd = fixedWindow
    ? Math.min(outStart, inEnd + holdDur)
    : outStart

  return {
    in: [0, inEnd],
    hold: [inEnd, holdEnd],
    out: [outStart, total],
  }
}

function authoredPhaseDuration(phase: TrackPhase, T: number, timing: Timing): number {
  if (phase === 'in') return positive(timing.inDur)
  if (phase === 'out') return positive(timing.outDur)
  // loopHold 時は holdDur を「ループ 1 周期」として扱う（ウィンドウ全域ではなく周期）
  if (timing.loopHold) return positive(timing.holdDur)
  if (timing.hold === 'fixed') return positive(timing.holdDur)

  const [start, end] = phaseWindow('hold', T, timing)
  return Math.max(0, end - start)
}

export function phaseWindow(phase: TrackPhase, T: number, timing: Timing): [number, number] {
  return windows(T, timing)[phase]
}

export function phaseLocalTime(phase: TrackPhase, t: number, T: number, timing: Timing): number {
  const [start, end] = phaseWindow(phase, T, timing)
  const actualDuration = Math.max(0, end - start)
  const authoredDuration = authoredPhaseDuration(phase, T, timing)

  // loopHold: hold ウィンドウ内を holdDur 周期でループ（始端前は 0、以降は周期で巻き戻す）
  if (phase === 'hold' && timing.loopHold && authoredDuration > 0) {
    if (t <= start) return 0
    return (t - start) % authoredDuration
  }

  if (t <= start) return 0
  if (t >= end) return authoredDuration
  if (actualDuration <= 0) return 0

  const elapsed = t - start
  if ((phase === 'in' || phase === 'out') && authoredDuration > 0) {
    return Math.min(authoredDuration, elapsed * (authoredDuration / actualDuration))
  }
  return Math.min(authoredDuration, elapsed)
}

export function phaseTimeToAbsolute(phase: TrackPhase, localT: number, T: number, timing: Timing): number {
  const [start, end] = phaseWindow(phase, T, timing)
  const actualDuration = Math.max(0, end - start)
  const authoredDuration = authoredPhaseDuration(phase, T, timing)
  const t = positive(localT)

  if (actualDuration <= 0) return start
  if (phase === 'hold') return Math.min(end, start + t)
  if (authoredDuration <= 0) return start

  const ratio = Math.max(0, Math.min(1, t / authoredDuration))
  return start + actualDuration * ratio
}

export function sampleTrackInPhase(track: Track, t: number, T: number, timing?: Timing): number {
  if (!timing) return sampleTrack(track, t)
  return sampleTrack(track, phaseLocalTime(track.phase ?? 'hold', t, T, timing))
}

export function phaseHasStarted(phase: TrackPhase, t: number, T: number, timing?: Timing): boolean {
  if (!timing) return true
  const [start] = phaseWindow(phase, T, timing)
  return t >= start
}

export function trackPhaseHasStarted(track: Track, t: number, T: number, timing?: Timing): boolean {
  return phaseHasStarted(track.phase ?? 'hold', t, T, timing)
}

export function phaseContains(phase: TrackPhase, t: number, T: number, timing?: Timing): boolean {
  if (!timing) return true
  const [start, end] = phaseWindow(phase, T, timing)
  return t >= start && t <= end
}

/**
 * 静的装飾（filters / clip / content.shadows）を、指定 decorPhase がアクティブな間だけ
 * 描画してよいかを返す。トラックの phase ゲートと違い「静的」装飾はフェーズに無関係で
 * 全フレーム描画されてしまうため、これで窓を絞る。
 *   - 'in'   : t <= inEnd（登場フェーズ中のみ）
 *   - 'hold' : t >= inEnd（中央安定〜退場。登場では抑止）
 *   - 'out'  : t >= outStart（退場フェーズ中のみ）
 * timing 無し時は常に true（従来動作）。
 */
export function decorPhaseActive(phase: TrackPhase, t: number, T: number, timing?: Timing): boolean {
  if (!timing) return true
  const w = windows(T, timing)
  if (phase === 'in') return t <= w.in[1]
  if (phase === 'out') return t >= w.out[0]
  return t >= w.hold[0]
}
