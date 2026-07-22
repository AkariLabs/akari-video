// 割れガラスのヒビ描画（amix「BAKI BAKI 合成」を踏襲）
// 衝撃点から放射状クラック + 同心円クラック（破片境界）を決定論的に生成する。
// シード付き PRNG なので毎フレーム同じ形になる（プレビュー/リプレイで安定）。
import type { ResolvedCrackParams } from '../atf/types'

/** mulberry32: 軽量・決定論的な 32bit PRNG（[0,1) を返す） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 描画に最低限必要な 2D コンテキストの部分型（テストでモックしやすいよう絞る） */
export interface CrackDrawCtx {
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  globalAlpha: number
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
}

/** 放射クラックの各本の基準角度を決める（同心円が破片境界としてこの角度を結ぶ） */
export function crackAngles(crack: ResolvedCrackParams): number[] {
  const n = Math.max(0, Math.round(crack.radial))
  if (n === 0) return []
  const rand = mulberry32(crack.seed)
  const angles: number[] = []
  for (let i = 0; i < n; i++) {
    const base = (i / n) * Math.PI * 2
    // 等間隔から jitter ぶんだけ角度を散らす（破片サイズを不均一にする）
    const a = base + (rand() - 0.5) * crack.jitter * ((Math.PI * 2) / n)
    angles.push(a)
  }
  return angles
}

/**
 * レイヤーローカル座標系 [0,w]×[0,h] にヒビを描く。
 * 呼び出し側で globalAlpha / transform は適用済みの前提（drawShape 内から呼ぶ）。
 */
export function drawCrack(ctx: CrackDrawCtx, crack: ResolvedCrackParams, w: number, h: number): void {
  const n = Math.max(0, Math.round(crack.radial))
  if (n === 0 || w <= 0 || h <= 0) return

  const rand = mulberry32(crack.seed >>> 0)
  const cx = crack.impact.x * w
  const cy = crack.impact.y * h
  const maxR = (Math.hypot(w, h) / 2) * crack.spread
  const angles = crackAngles(crack)

  ctx.save()
  ctx.globalAlpha *= Math.max(0, Math.min(1, crack.opacity))
  ctx.strokeStyle = crack.color
  ctx.lineWidth = crack.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 放射クラック: 衝撃点から外周へ。数セグメントに分けて少し蛇行させる。
  for (let i = 0; i < n; i++) {
    const a = angles[i]
    const len = maxR * (0.7 + rand() * 0.3)
    const segs = 4
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    for (let s = 1; s <= segs; s++) {
      const r = (len * s) / segs
      const ja = a + (rand() - 0.5) * crack.jitter * 0.5
      ctx.lineTo(cx + Math.cos(ja) * r, cy + Math.sin(ja) * r)
    }
    ctx.stroke()

    // たまに枝分かれを生やして「ピシッ」と割れた感じを出す
    if (rand() < 0.5) {
      const br = len * (0.35 + rand() * 0.3)
      const ba = a + (rand() - 0.5) * 0.7
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * br * 0.6, cy + Math.sin(a) * br * 0.6)
      ctx.lineTo(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br)
      ctx.stroke()
    }
  }

  // 同心円クラック: 放射角を結ぶギザギザ多角形 = 破片の境界
  const m = Math.max(0, Math.round(crack.concentric))
  for (let ring = 1; ring <= m; ring++) {
    const rr = maxR * (ring / (m + 1))
    ctx.beginPath()
    for (let i = 0; i <= n; i++) {
      const a = angles[i % n]
      const jr = rr * (0.82 + rand() * 0.32)
      const x = cx + Math.cos(a) * jr
      const y = cy + Math.sin(a) * jr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }

  ctx.restore()
}
