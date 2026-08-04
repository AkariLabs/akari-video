// Canvas 2D レンダラ: ResolvedScene を Canvas に描画する
import type {
  FilterKind,
  ResolvedClipSpec,
  ResolvedColorRamp,
  ResolvedFilterSpec,
  ResolvedGradientFill,
  ResolvedScene,
  ResolvedLayer,
  ResolvedTextContent,
  ResolvedShapeContent,
  ResolvedTextShadow,
  StarParams,
  CalloutTail,
  Timing,
} from '../atf/types'
import { glyphTransforms, caretState } from './perchar'
import { verticalLayout } from '../atf/vertical'
import { drawCrack } from './crack'
import { layerTransformMatrix, sampleLayerTransform } from './transform'
import { sampleTrackInPhase, trackPhaseHasStarted, decorPhaseActive } from './timing'

const FILTER_ORDER: FilterKind[] = [
  'brightness',
  'contrast',
  'hue-rotate',
  'saturate',
  'sepia',
  'grayscale',
  'invert',
  'blur',
]

type TrackValueMap = Map<string, number>

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function modulo01(value: number): number {
  if (!Number.isFinite(value)) return 0
  const mod = value % 1
  return mod < 0 ? mod + 1 : mod
}

export function sampleLayerTrackValues(
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
): TrackValueMap {
  const values: TrackValueMap = new Map()
  if (!layer.tracks) return values
  for (const track of layer.tracks) {
    if (!trackPhaseHasStarted(track, t, T, timing)) continue
    values.set(String(track.prop), sampleTrackInPhase(track, t, T, timing))
  }
  return values
}

function trackValue(values: TrackValueMap, ...props: string[]): number | undefined {
  for (const prop of props) {
    const value = values.get(prop)
    if (value !== undefined) return value
  }
  return undefined
}

function cssFilterPart(filter: ResolvedFilterSpec): string | undefined {
  const value = Number.isFinite(filter.value) ? filter.value : 0
  switch (filter.kind) {
    case 'blur':
      return value > 0 ? `blur(${value}px)` : undefined
    case 'hue-rotate':
      return value !== 0 ? `hue-rotate(${value}deg)` : undefined
    case 'brightness':
      return `brightness(${value})`
    case 'contrast':
      return `contrast(${value})`
    case 'saturate':
      return `saturate(${value})`
    case 'sepia':
      return `sepia(${value})`
    case 'grayscale':
      return `grayscale(${value})`
    case 'invert':
      return `invert(${value})`
  }
}

function filterKindFromTrackProp(prop: string): FilterKind | undefined {
  if (!prop.startsWith('filter.')) return undefined
  const kind = prop.slice('filter.'.length)
  return FILTER_ORDER.includes(kind as FilterKind) ? kind as FilterKind : undefined
}

export function buildFilterString(filters: ResolvedFilterSpec[], legacyBlur = 0): string {
  const parts: string[] = []
  if (legacyBlur > 0) parts.push(`blur(${legacyBlur}px)`)
  for (const filter of filters) {
    const part = cssFilterPart(filter)
    if (part) parts.push(part)
  }
  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function sampleLayerFilterString(
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
  legacyBlur = 0,
  sampledValues?: TrackValueMap,
): string {
  const values = sampledValues ?? sampleLayerTrackValues(layer, t, T, timing)
  const filters = layer.filters ? layer.filters.map(filter => ({ ...filter })) : []
  const byKind = new Map<FilterKind, number>()

  for (const [prop, value] of values) {
    const indexMatch = prop.match(/^filter\.(\d+)\.value$/)
    if (indexMatch) {
      const index = Number(indexMatch[1])
      if (filters[index]) filters[index] = { ...filters[index], value }
      continue
    }

    const kind = filterKindFromTrackProp(prop)
    if (kind) byKind.set(kind, value)
  }

  for (const kind of FILTER_ORDER) {
    const value = byKind.get(kind)
    if (value === undefined) continue
    const existingIndex = filters.findIndex(filter => filter.kind === kind)
    if (existingIndex >= 0) {
      filters[existingIndex] = { ...filters[existingIndex], value }
    } else {
      filters.push({ kind, value })
    }
  }

  return buildFilterString(filters, legacyBlur)
}

interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

function parseHexColor(color: string): RgbaColor | undefined {
  const hex = color.trim().replace(/^#/, '')
  if (![3, 4, 6, 8].includes(hex.length) || /[^0-9a-f]/i.test(hex)) return undefined
  const expand = (s: string): string => s.length === 1 ? s + s : s
  const parts = hex.length <= 4
    ? [expand(hex[0]), expand(hex[1]), expand(hex[2]), hex[3] ? expand(hex[3]) : 'ff']
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8) || 'ff']
  return {
    r: parseInt(parts[0], 16),
    g: parseInt(parts[1], 16),
    b: parseInt(parts[2], 16),
    a: parseInt(parts[3], 16) / 255,
  }
}

function parseRgbColor(color: string): RgbaColor | undefined {
  const match = color.trim().match(/^rgba?\((.+)\)$/i)
  if (!match) return undefined
  const parts = match[1].split(',').map(part => part.trim())
  if (parts.length < 3) return undefined
  const parseChannel = (part: string): number => {
    if (part.endsWith('%')) return clamp01(parseFloat(part) / 100) * 255
    return Math.max(0, Math.min(255, parseFloat(part)))
  }
  const parseAlpha = (part: string | undefined): number => {
    if (part === undefined) return 1
    if (part.endsWith('%')) return clamp01(parseFloat(part) / 100)
    return clamp01(parseFloat(part))
  }
  const r = parseChannel(parts[0])
  const g = parseChannel(parts[1])
  const b = parseChannel(parts[2])
  const a = parseAlpha(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return undefined
  return { r, g, b, a }
}

function parseColor(color: string): RgbaColor | undefined {
  return parseHexColor(color) ?? parseRgbColor(color)
}

function rgbaToCss(color: RgbaColor): string {
  const r = Math.round(color.r)
  const g = Math.round(color.g)
  const b = Math.round(color.b)
  if (color.a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(color.a * 1000) / 1000})`
}

function interpolateColor(a: string, b: string, ratio: number): string | undefined {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return undefined
  const t = clamp01(ratio)
  return rgbaToCss({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
    a: ca.a + (cb.a - ca.a) * t,
  })
}

function normalizedColorStops(stops: { at: number; color: string }[]): { at: number; color: string }[] {
  return stops
    .filter(stop => Number.isFinite(stop.at))
    .map(stop => ({ at: clamp01(stop.at), color: stop.color }))
    .sort((a, b) => a.at - b.at)
}

function sampleColorStops(
  stops: { at: number; color: string }[],
  progress: number,
  fallback: string,
  mode: 'rgb' | 'step' = 'rgb',
): string {
  const sorted = normalizedColorStops(stops)
  if (sorted.length === 0) return fallback
  const t = clamp01(progress)
  if (t <= sorted[0].at) return sorted[0].color
  const last = sorted[sorted.length - 1]
  if (t >= last.at) return last.color

  let left = sorted[0]
  let right = last
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].at) {
      right = sorted[i]
      left = sorted[i - 1]
      break
    }
  }
  if (mode === 'step' || right.at === left.at) return left.color
  return interpolateColor(left.color, right.color, (t - left.at) / (right.at - left.at)) ?? left.color
}

export function sampleColorRamp(ramp: ResolvedColorRamp | undefined, progress: number | undefined, fallback: string): string {
  if (!ramp || progress === undefined) return fallback
  return sampleColorStops(ramp.stops, progress, fallback, ramp.mode ?? 'rgb')
}

export function shiftedGradientStops(
  stops: { at: number; color: string }[],
  offset = 0,
): { at: number; color: string }[] {
  const sorted = normalizedColorStops(stops)
  if (sorted.length === 0) return []
  const delta = modulo01(offset)
  if (delta === 0) return sorted

  const boundaryColor = sampleColorStops(sorted, modulo01(-delta), sorted[0].color)
  const shifted = sorted
    .map(stop => ({ at: modulo01(stop.at + delta), color: stop.color }))
    .filter(stop => stop.at > 1e-6 && stop.at < 1 - 1e-6)
  return [
    { at: 0, color: boundaryColor },
    ...shifted.sort((a, b) => a.at - b.at),
    { at: 1, color: boundaryColor },
  ]
}

function sampleGradient(fill: ResolvedGradientFill | undefined, offset: number | undefined): ResolvedGradientFill | undefined {
  if (!fill || offset === undefined) return fill
  return { ...fill, offset }
}

function sampleTextShadow(
  shadow: ResolvedTextShadow,
  values: TrackValueMap,
  index?: number,
): ResolvedTextShadow {
  const prefix = index === undefined ? 'shadow' : `shadows.${index}`
  const colorT = trackValue(values, `${prefix}.colorT`, index === undefined ? 'colorT' : `shadow.${index}.colorT`)
  return {
    ...shadow,
    color: sampleColorRamp(shadow.colorRamp, colorT, shadow.color),
    blur: trackValue(values, `${prefix}.blur`, index === undefined ? 'shadow.blur' : `shadow.${index}.blur`) ?? shadow.blur,
    x: trackValue(values, `${prefix}.x`, `${prefix}.offsetX`, index === undefined ? 'shadow.offsetX' : `shadow.${index}.offsetX`) ?? shadow.x,
    y: trackValue(values, `${prefix}.y`, `${prefix}.offsetY`, index === undefined ? 'shadow.offsetY' : `shadow.${index}.offsetY`) ?? shadow.y,
  }
}

export function sampleTextContentStyles(
  content: ResolvedTextContent,
  values: TrackValueMap,
): ResolvedTextContent {
  const gradientOffset = trackValue(values, 'gradient.offset', 'fill.offset')
  return {
    ...content,
    color: sampleColorRamp(content.colorRamp, trackValue(values, 'colorT', 'color.t'), content.color),
    fill: sampleGradient(content.fill, gradientOffset),
    strokes: content.strokes?.map((stroke, index) => ({
      ...stroke,
      fill: sampleGradient(stroke.fill, trackValue(values, `strokes.${index}.gradient.offset`) ?? gradientOffset),
    })),
    shadow: content.shadow ? sampleTextShadow(content.shadow, values) : undefined,
    shadows: content.shadows?.map((shadow, index) => sampleTextShadow(shadow, values, index)),
  }
}

export function sampleLayerTextContent(
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
  sampledValues?: TrackValueMap,
): ResolvedTextContent {
  return sampleTextContentStyles(layer.content as ResolvedTextContent, sampledValues ?? sampleLayerTrackValues(layer, t, T, timing))
}

function sampleShapeContentStyles(
  content: ResolvedShapeContent,
  values: TrackValueMap,
): ResolvedShapeContent {
  return {
    ...content,
    fillGradient: sampleGradient(content.fillGradient, trackValue(values, 'fillGradient.offset', 'gradient.offset')),
  }
}

function sampleClipFromValues(clip: ResolvedClipSpec | undefined, values: TrackValueMap): ResolvedClipSpec | undefined {
  if (clip?.type === 'inset') {
    return {
      type: 'inset',
      top: trackValue(values, 'clip.top') ?? clip.top ?? 0,
      right: trackValue(values, 'clip.right') ?? clip.right ?? 0,
      bottom: trackValue(values, 'clip.bottom') ?? clip.bottom ?? 0,
      left: trackValue(values, 'clip.left') ?? clip.left ?? 0,
    }
  }

  if (clip?.type === 'polygon') {
    return {
      type: 'polygon',
      points: clip.points.map((point, index) => ({
        x: trackValue(values, `clip.polygon.${index}.x`) ?? point.x,
        y: trackValue(values, `clip.polygon.${index}.y`) ?? point.y,
      })),
    }
  }

  if (clip?.type === 'circle') {
    return {
      type: 'circle',
      cx: trackValue(values, 'clip.cx', 'clip.x') ?? clip.cx,
      cy: trackValue(values, 'clip.cy', 'clip.y') ?? clip.cy,
      r: trackValue(values, 'clip.r', 'clip.radius') ?? clip.r,
    }
  }

  if (['clip.top', 'clip.right', 'clip.bottom', 'clip.left'].some(prop => values.has(prop))) {
    return {
      type: 'inset',
      top: trackValue(values, 'clip.top') ?? 0,
      right: trackValue(values, 'clip.right') ?? 0,
      bottom: trackValue(values, 'clip.bottom') ?? 0,
      left: trackValue(values, 'clip.left') ?? 0,
    }
  }

  if (['clip.cx', 'clip.cy', 'clip.x', 'clip.y', 'clip.r', 'clip.radius'].some(prop => values.has(prop))) {
    return {
      type: 'circle',
      cx: trackValue(values, 'clip.cx', 'clip.x') ?? 0.5,
      cy: trackValue(values, 'clip.cy', 'clip.y') ?? 0.5,
      r: trackValue(values, 'clip.r', 'clip.radius') ?? 0,
    }
  }

  return undefined
}

export function sampleLayerClip(
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
  sampledValues?: TrackValueMap,
): ResolvedClipSpec | undefined {
  return sampleClipFromValues(layer.clip, sampledValues ?? sampleLayerTrackValues(layer, t, T, timing))
}

export function buildClipPath(
  ctx: CanvasRenderingContext2D,
  clip: ResolvedClipSpec,
  w: number,
  h: number,
): void {
  ctx.beginPath()
  if (clip.type === 'inset') {
    const top = clamp01(clip.top ?? 0) * h
    const right = clamp01(clip.right ?? 0) * w
    const bottom = clamp01(clip.bottom ?? 0) * h
    const left = clamp01(clip.left ?? 0) * w
    ctx.rect(left, top, Math.max(0, w - left - right), Math.max(0, h - top - bottom))
    return
  }

  if (clip.type === 'polygon') {
    if (clip.points.length === 0) {
      ctx.rect(0, 0, w, h)
      return
    }
    clip.points.forEach((point, index) => {
      const x = clamp01(point.x) * w
      const y = clamp01(point.y) * h
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    return
  }

  ctx.arc(clamp01(clip.cx) * w, clamp01(clip.cy) * h, Math.max(0, clip.r) * Math.hypot(w, h), 0, Math.PI * 2)
}

function appendFilterString(base: string, next: string): string {
  if (base === 'none') return next
  if (next === 'none') return base
  return `${base} ${next}`
}

/**
 * シーンを Canvas に描画する
 * @param ctx Canvas 2D context
 * @param scene 解決済みシーン
 * @param t 現在時刻（秒）
 * @param T preview の全体尺（秒）
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: ResolvedScene, t: number, T?: number): void {
  const { width, height, bg } = scene.stage
  const total = T ?? scene.timing?.previewTotal ?? scene.stage.duration

  // 背景クリア
  ctx.clearRect(0, 0, width, height)
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)
  }

  // レイヤー順に描画（配列の前が奥、後ろが手前）
  for (const layer of scene.layers) {
    drawLayer(ctx, layer, t, total, scene.timing)
  }
}

/** レイヤーを描画する */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: ResolvedLayer,
  t: number,
  T: number,
  timing: Timing | undefined,
): void {
  const transform = sampleLayerTransform(layer, t, T, timing)
  const trackValues = sampleLayerTrackValues(layer, t, T, timing)

  if (transform.opacity <= 0) return

  // decorPhase 指定時、そのフェーズ窓の外では静的装飾（filters / clip / content.shadows）を
  // 抑止し、素のテキスト＋モーション（transform/opacity/blur 等）だけを描く。
  // motion 由来の blur（transform.blur）は装飾ではないので維持する。
  const decorActive = layer.decorPhase ? decorPhaseActive(layer.decorPhase, t, T, timing) : true

  ctx.save()
  // 例外時も必ず restore する（1 レイヤーの失敗で ctx にクリップ/変形が残留すると
  // 以降の全フレーム・全テンプレが不可視になる事故を防ぐ）
  try {
  ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity))

  // anchor を原点にして変換
  const { w, h } = layer.size
  const matrix = layerTransformMatrix(transform, w, h, layer.transform.anchor)
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
  const layerFilter = decorActive
    ? sampleLayerFilterString(layer, t, T, timing, transform.blur, trackValues)
    : buildFilterString([], transform.blur)
  ctx.filter = layerFilter

  // 汎用 clip を優先し、未指定時だけ従来の wipe clip を適用する
  const clip = decorActive ? sampleLayerClip(layer, t, T, timing, trackValues) : undefined
  if (clip) {
    buildClipPath(ctx, clip, w, h)
    ctx.clip()
  } else if (transform.wipe !== undefined && layer.wipe) {
    const { axis, from } = layer.wipe
    const wipeRatio = transform.wipe
    ctx.beginPath()
    if (axis === 'x') {
      const clipW = w * wipeRatio
      const clipX = from === 'end' ? w * (1 - wipeRatio) : 0
      ctx.rect(clipX, 0, clipW, h)
    } else {
      const clipH = h * wipeRatio
      const clipY = from === 'end' ? h * (1 - wipeRatio) : 0
      ctx.rect(0, clipY, w, clipH)
    }
    ctx.clip()
  }

  if (layer.type === 'shape') {
    drawShape(ctx, sampleShapeContentStyles(layer.content as ResolvedShapeContent, trackValues), w, h, t)
  } else if (layer.type === 'text') {
    const sampled = sampleTextContentStyles(layer.content as ResolvedTextContent, trackValues)
    // decorPhase 窓外ではシャドウ（残像グロー等）を焼き込まない
    const content = decorActive ? sampled : { ...sampled, shadow: undefined, shadows: undefined }
    if (layer.perChar) {
      drawPerChar(ctx, layer, content, t, w, T, timing, transform, layerFilter)
    } else {
      drawText(ctx, content, w, transform, t)
    }
  }
  } finally {
    ctx.filter = 'none'
    ctx.restore()
  }
}

/** roundRect フォールバック付き矩形パス */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const cr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + cr, y)
  ctx.lineTo(x + w - cr, y)
  ctx.arcTo(x + w, y, x + w, y + cr, cr)
  ctx.lineTo(x + w, y + h - cr)
  ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
  ctx.lineTo(x + cr, y + h)
  ctx.arcTo(x, y + h, x, y + h - cr, cr)
  ctx.lineTo(x, y + cr)
  ctx.arcTo(x, y, x + cr, y, cr)
  ctx.closePath()
}

/**
 * star shape パスを描く（ギザギザ爆発バッジ）
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param outerR 外円半径
 * @param innerR 内円半径
 * @param points 頂点数（ギザ数）
 */
export function buildStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points: number,
): void {
  const count = points * 2
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const px = cx + Math.cos(angle) * r
    const py = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/**
 * 吹き出しの尻尾を追加したパスを作成する（角丸 rect + 三角）
 * roundRectPath を先に呼ばず、このメソッドが完全なパスを構築する
 */
export function buildCalloutPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number,
  tail: CalloutTail,
): void {
  const cr = Math.min(cornerRadius, w / 2, h / 2)
  const at = tail.at ?? 0.5
  const tailW = tail.w ?? 20
  const tailH = tail.h ?? 14

  // 角丸矩形 + 尻尾を単一パスで構築する
  ctx.beginPath()

  if (tail.side === 'bottom') {
    const tailCX = x + w * at
    // 上辺
    ctx.moveTo(x + cr, y)
    ctx.lineTo(x + w - cr, y)
    ctx.arcTo(x + w, y, x + w, y + cr, cr)
    // 右辺
    ctx.lineTo(x + w, y + h - cr)
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
    // 下辺右（尻尾の右側）
    ctx.lineTo(tailCX + tailW / 2, y + h)
    // 尻尾（下向き三角）
    ctx.lineTo(tailCX, y + h + tailH)
    ctx.lineTo(tailCX - tailW / 2, y + h)
    // 下辺左
    ctx.lineTo(x + cr, y + h)
    ctx.arcTo(x, y + h, x, y + h - cr, cr)
    // 左辺
    ctx.lineTo(x, y + cr)
    ctx.arcTo(x, y, x + cr, y, cr)
  } else if (tail.side === 'top') {
    const tailCX = x + w * at
    // 上辺左（尻尾の左側）
    ctx.moveTo(x + cr, y)
    ctx.lineTo(tailCX - tailW / 2, y)
    // 尻尾（上向き三角）
    ctx.lineTo(tailCX, y - tailH)
    ctx.lineTo(tailCX + tailW / 2, y)
    // 上辺右
    ctx.lineTo(x + w - cr, y)
    ctx.arcTo(x + w, y, x + w, y + cr, cr)
    // 右辺
    ctx.lineTo(x + w, y + h - cr)
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
    // 下辺
    ctx.lineTo(x + cr, y + h)
    ctx.arcTo(x, y + h, x, y + h - cr, cr)
    // 左辺
    ctx.lineTo(x, y + cr)
    ctx.arcTo(x, y, x + cr, y, cr)
  } else if (tail.side === 'left') {
    const tailCY = y + h * at
    // 上辺
    ctx.moveTo(x + cr, y)
    ctx.lineTo(x + w - cr, y)
    ctx.arcTo(x + w, y, x + w, y + cr, cr)
    // 右辺
    ctx.lineTo(x + w, y + h - cr)
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
    // 下辺
    ctx.lineTo(x + cr, y + h)
    ctx.arcTo(x, y + h, x, y + h - cr, cr)
    // 左辺下（尻尾の下側）
    ctx.lineTo(x, tailCY + tailW / 2)
    // 尻尾（左向き三角）
    ctx.lineTo(x - tailH, tailCY)
    ctx.lineTo(x, tailCY - tailW / 2)
    // 左辺上
    ctx.lineTo(x, y + cr)
    ctx.arcTo(x, y, x + cr, y, cr)
  } else {
    // right
    const tailCY = y + h * at
    // 上辺
    ctx.moveTo(x + cr, y)
    ctx.lineTo(x + w - cr, y)
    ctx.arcTo(x + w, y, x + w, y + cr, cr)
    // 右辺上（尻尾の上側）
    ctx.lineTo(x + w, tailCY - tailW / 2)
    // 尻尾（右向き三角）
    ctx.lineTo(x + w + tailH, tailCY)
    ctx.lineTo(x + w, tailCY + tailW / 2)
    // 右辺下
    ctx.lineTo(x + w, y + h - cr)
    ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
    // 下辺
    ctx.lineTo(x + cr, y + h)
    ctx.arcTo(x, y + h, x, y + h - cr, cr)
    // 左辺
    ctx.lineTo(x, y + cr)
    ctx.arcTo(x, y, x + cr, y, cr)
  }
  ctx.closePath()
}

/**
 * shimmer（ハイライト帯スウィープ）を重ね描きする
 * @param ctx Canvas 2D context
 * @param t 現在時刻（秒）
 * @param x bbox の左端 X
 * @param y bbox の上端 Y（描画時には 0 基準）
 * @param w bbox 幅
 * @param h bbox 高さ
 * @param shimmer shimmer 設定
 */
export function buildShimmerGradient(
  ctx: CanvasRenderingContext2D,
  t: number | undefined,
  x: number,
  w: number,
  shimmer: { periodSec: number; width?: number; color?: string },
): CanvasGradient {
  const { periodSec, width = 0.25, color = 'rgba(255,255,255,0.85)' } = shimmer
  // 帯の中心位置（0..1 + オーバーフロー分）。t 非有限時は 0 扱い（NaN グラデ防止）
  const safeT = Number.isFinite(t) ? (t as number) : 0
  const phase = periodSec > 0 ? (safeT % periodSec) / periodSec : 0
  // 帯は画面外左から始まり画面外右まで流れる。totalWidth × 1.5 の範囲をスウィープ
  const totalSpan = w * (1 + width)
  const center = x - w * width / 2 + totalSpan * phase
  const halfW = Math.max(1, w * width / 2)

  const shimGrad = ctx.createLinearGradient(center - halfW, 0, center + halfW, 0)
  shimGrad.addColorStop(0, 'rgba(255,255,255,0)')
  shimGrad.addColorStop(0.5, color)
  shimGrad.addColorStop(1, 'rgba(255,255,255,0)')
  return shimGrad
}

/**
 * テキストのシマー: 帯グラデを fillStyle にして同じ文字をもう一度塗る。
 * 帯矩形を直接描くと文字形にマスクされず「灰色の帯」が見えてしまうため、
 * グリフ自体を再塗りして自然にマスクする。
 */
function drawTextShimmer(
  ctx: CanvasRenderingContext2D,
  t: number | undefined,
  text: string,
  x: number,
  y: number,
  bboxX: number,
  bboxW: number,
  shimmer: { periodSec: number; width?: number; color?: string },
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = buildShimmerGradient(ctx, t, bboxX, bboxW, shimmer)
  ctx.fillText(text, x, y)
  ctx.restore()
}

/**
 * GradientFill からグラデーション CanvasGradient を生成する
 * @param ctx Canvas 2D context
 * @param fill グラデーション設定
 * @param x bbox 左端
 * @param y bbox 上端
 * @param w bbox 幅
 * @param h bbox 高さ
 */
export function buildGradient(
  ctx: CanvasRenderingContext2D,
  fill: ResolvedGradientFill,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient {
  const cx = x + w / 2
  const cy = y + h / 2
  let gradient: CanvasGradient
  if (fill.type === 'linear-h') {
    gradient = ctx.createLinearGradient(x, cy, x + w, cy)
  } else {
    // linear-v（縦グラデ）
    gradient = ctx.createLinearGradient(cx, y, cx, y + h)
  }
  for (const stop of shiftedGradientStops(fill.stops, fill.offset ?? 0)) {
    gradient.addColorStop(stop.at, stop.color)
  }
  return gradient
}

/** シェイプ（rect / crack / star）を描画する */
function drawShape(
  ctx: CanvasRenderingContext2D,
  content: ResolvedShapeContent,
  w: number,
  h: number,
  t: number,
): void {
  // 割れガラスのヒビ
  if (content.shape === 'crack') {
    if (content.crack) drawCrack(ctx, content.crack, w, h)
    return
  }

  // fillGradient があればグラデ優先、なければ fill color
  if (content.fillGradient) {
    ctx.fillStyle = buildGradient(ctx, content.fillGradient, 0, 0, w, h)
  } else {
    ctx.fillStyle = content.fill
  }

  /** 形状パスを現在の fillStyle で塗る（shimmer 重ね塗りでも同じパスを使う） */
  const fillShapePath = (): void => {
    if (content.shape === 'star') {
      const star: StarParams = content.star ?? {}
      const points = star.points ?? 12
      const innerRatio = star.innerRatio ?? 0.5
      const cx = w / 2
      const cy = h / 2
      const outerR = Math.min(w, h) / 2
      const innerR = outerR * innerRatio
      buildStarPath(ctx, cx, cy, outerR, innerR, points)
      ctx.fill()
      return
    }
    // rect（calloutTail 含む）
    const cr = content.cornerRadius ?? 0
    if (content.calloutTail) {
      buildCalloutPath(ctx, 0, 0, w, h, cr, content.calloutTail)
      ctx.fill()
    } else if (cr > 0) {
      roundRectPath(ctx, 0, 0, w, h, cr)
      ctx.fill()
    } else {
      ctx.fillRect(0, 0, w, h)
    }
  }

  fillShapePath()

  // shimmer は同じ形状パスを帯グラデで再塗りする（矩形をそのまま描くと形状外へはみ出す）
  if (content.fillGradient?.shimmer) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = buildShimmerGradient(ctx, t, 0, w, content.fillGradient.shimmer)
    fillShapePath()
    ctx.restore()
  }
}

function applyTextShadow(ctx: CanvasRenderingContext2D, shadow: { color: string; blur: number; x: number; y: number }): void {
  ctx.shadowColor = shadow.color
  ctx.shadowBlur = shadow.blur
  ctx.shadowOffsetX = shadow.x
  ctx.shadowOffsetY = shadow.y
}

function clearTextShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function textStrokeOutset(content: ResolvedTextContent): number {
  if (content.strokes && content.strokes.length > 0) {
    return Math.max(...content.strokes.map(stroke => stroke.width))
  }
  return content.stroke?.width ?? 0
}

/**
 * テキストの fill スタイルを生成する（グラデまたはベタ色）
 * glyphSize は実際に描くフォントサイズ（px）。bbox の高さとして使う。
 * x0 は bbox 左端（テキスト描画の基準 X）、w は bbox 幅。
 */
/** ハート1個のパス（柄タイル用）。 */
function drawHeartPath(c: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const s = size
  c.beginPath()
  c.moveTo(cx, cy + s * 0.3)
  c.bezierCurveTo(cx - s, cy - s * 0.4, cx - s * 0.5, cy - s, cx, cy - s * 0.3)
  c.bezierCurveTo(cx + s * 0.5, cy - s, cx + s, cy - s * 0.4, cx, cy + s * 0.3)
  c.closePath()
}

/**
 * 柄塗り用タイルを生成し repeat パターンを返す（DOM canvas 前提。無ければ null でフォールバック）。
 * dots/stripes/check/diamond/hearts/stars/hazard を手続き的に描く。
 */
function buildTextPattern(
  ctx: CanvasRenderingContext2D,
  pf: NonNullable<ResolvedTextContent['patternFill']>,
): CanvasPattern | null {
  if (typeof document === 'undefined') return null
  const s = Math.max(0.3, pf.scale || 1)
  const u = Math.max(8, Math.round(26 * s))
  const tile = document.createElement('canvas')
  tile.width = u
  tile.height = u
  const tc = tile.getContext('2d')
  if (!tc) return null
  if (pf.bg) {
    tc.fillStyle = pf.bg
    tc.fillRect(0, 0, u, u)
  }
  tc.fillStyle = pf.color
  tc.strokeStyle = pf.color
  switch (pf.kind) {
    case 'dots': {
      const r = u * 0.15
      for (const [px, py] of [[u * 0.25, u * 0.25], [u * 0.75, u * 0.75]]) {
        tc.beginPath()
        tc.arc(px, py, r, 0, Math.PI * 2)
        tc.fill()
      }
      break
    }
    case 'stripes': {
      tc.lineWidth = u * 0.34
      tc.beginPath()
      tc.moveTo(0, u * 0.5)
      tc.lineTo(u, u * 0.5)
      tc.stroke()
      break
    }
    case 'check': {
      tc.fillRect(0, 0, u / 2, u / 2)
      tc.fillRect(u / 2, u / 2, u / 2, u / 2)
      break
    }
    case 'diamond': {
      tc.save()
      tc.translate(u / 2, u / 2)
      tc.rotate(Math.PI / 4)
      const d = u * 0.44
      tc.fillRect(-d / 2, -d / 2, d, d)
      tc.restore()
      break
    }
    case 'hearts':
      drawHeartPath(tc, u / 2, u * 0.58, u * 0.34)
      tc.fill()
      break
    case 'stars':
      buildStarPath(tc, u / 2, u / 2, u * 0.4, u * 0.18, 5)
      tc.fill()
      break
    case 'hazard': {
      tc.save()
      tc.translate(u / 2, u / 2)
      tc.rotate(Math.PI / 4)
      tc.fillRect(-u, -u * 0.2, u * 2, u * 0.4)
      tc.restore()
      break
    }
  }
  const pat = ctx.createPattern(tile, 'repeat')
  if (pat && pf.angle && typeof DOMMatrix !== 'undefined' && typeof pat.setTransform === 'function') {
    pat.setTransform(new DOMMatrix().rotate(pf.angle))
  }
  return pat
}

function textFillStyle(
  ctx: CanvasRenderingContext2D,
  content: ResolvedTextContent,
  glyphSize: number,
  x0: number,
  w: number,
  fallbackColor: string,
): string | CanvasGradient | CanvasPattern {
  // 柄塗りが最優先（fill グラデより優先）。生成不可なら以降へフォールバック。
  if (content.patternFill) {
    const pat = buildTextPattern(ctx, content.patternFill)
    if (pat) return pat
  }
  if (!content.fill) return fallbackColor
  const top = -glyphSize * 0.8
  const bottom = glyphSize * 0.2
  const bboxH = bottom - top
  return buildGradient(ctx, content.fill, x0, top, w, bboxH)
}

/**
 * counter テキストを整形する
 */
export function formatCounter(
  counter: { from: number; to: number; decimals: number; prefix: string; suffix: string; useGrouping: boolean },
  progress: number,
): string {
  const value = counter.from + (counter.to - counter.from) * progress
  let numStr: string
  if (counter.useGrouping) {
    numStr = value.toLocaleString(undefined, {
      minimumFractionDigits: counter.decimals,
      maximumFractionDigits: counter.decimals,
    })
  } else {
    numStr = value.toFixed(counter.decimals)
  }
  return counter.prefix + numStr + counter.suffix
}

/**
 * shimmer 帯の中心位置（0..1）を計算する純関数（テスト可能）
 * @param t 現在時刻（秒）
 * @param periodSec 周期（秒）
 */
export function shimmerPhase(t: number, periodSec: number): number {
  if (periodSec <= 0) return 0
  return (t % periodSec) / periodSec
}

/**
 * weight track 値を 100 単位へ丸める
 */
export function roundWeight(val: number): number {
  return Math.round(val / 100) * 100
}

/**
 * グリフ内側エフェクト（内側シャドウ / 内側光彩 / 簡易ベベル）を描く。
 *
 * 既に塗られたグリフの上に `source-atop` で重ね、輪郭をなぞった影を内向きに落として
 * 「内側だけ」に効果を出す。単一テキストレイヤ（透明背景上）前提。テロップは各 item が
 * 専用 renderCanvas に描かれるため安全だが、text の下に不透明レイヤを持つ複合 doc では
 * その下地にも被る（その用途では使わない想定）。
 */
function drawInnerTextEffects(
  ctx: CanvasRenderingContext2D,
  content: ResolvedTextContent,
  text: string,
  x: number,
  y: number,
): void {
  const passes: { color: string; blur: number; dx: number; dy: number }[] = []
  for (const sh of content.innerShadows ?? []) {
    passes.push({ color: sh.color, blur: sh.blur, dx: sh.x, dy: sh.y })
  }
  if (content.innerGlow) {
    passes.push({ color: content.innerGlow.color, blur: content.innerGlow.blur, dx: 0, dy: 0 })
  }
  if (content.bevel) {
    const s = content.bevel.size
    const b = Math.max(1, s * 0.8)
    passes.push({ color: content.bevel.light, blur: b, dx: -s, dy: -s })
    passes.push({ color: content.bevel.dark, blur: b, dx: s, dy: s })
  }
  if (passes.length === 0) return
  for (const p of passes) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.shadowColor = p.color
    ctx.shadowBlur = p.blur
    ctx.shadowOffsetX = p.dx
    ctx.shadowOffsetY = p.dy
    // グリフ輪郭を薄くなぞり、その内向きのぼかし影をグリフ内側に落とす。
    ctx.lineWidth = Math.max(1, p.blur * 0.5)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = p.color
    ctx.strokeText(text, x, y)
    ctx.restore()
  }
}

/**
 * テキストの stroke + fill を描く（shadow 込み）。
 * 多重シャドウ（shadows[]）をサポートする。
 */
function drawTextRun(
  ctx: CanvasRenderingContext2D,
  content: ResolvedTextContent,
  text: string,
  x: number,
  y: number,
  glyphSize: number,
  bboxX: number,
  bboxW: number,
  fillColor: string,
  t?: number,
): void {
  // strokes は fill グラデを持つ可能性があるので ResolvedTextContent.strokes の型に統一する
  type StrokeSpec = { color: string; width: number; fill?: ResolvedGradientFill }
  const strokes: StrokeSpec[] = content.strokes && content.strokes.length > 0
    ? content.strokes
    : content.stroke
      ? [{ ...content.stroke }]
      : []

  /** stroke 1 本を描くヘルパー */
  function drawStroke(stroke: StrokeSpec): void {
    if (stroke.fill) {
      ctx.strokeStyle = buildGradient(ctx, stroke.fill, bboxX, -glyphSize * 0.8, bboxW, glyphSize)
    } else {
      ctx.strokeStyle = stroke.color
    }
    ctx.lineWidth = stroke.width * 2
    ctx.lineJoin = 'round'
    ctx.strokeText(text, x, y)
  }

  // shadows[] による多重シャドウパス
  if (content.shadows && content.shadows.length > 0) {
    for (const shadow of content.shadows) {
      applyTextShadow(ctx, shadow)
      // 最外縁ストロークも影を落とす（中抜き文字 = 透明フィルではフィルが影を落とせず、
      // グローが消えてしまうため。輪郭形状からグローが出るのが期待挙動）
      if (strokes.length > 0) drawStroke(strokes[0])
      ctx.fillStyle = textFillStyle(ctx, content, glyphSize, bboxX, bboxW, fillColor)
      ctx.fillText(text, x, y)
    }
    clearTextShadow(ctx)
    // 通常の strokes + fill
    for (const stroke of strokes) drawStroke(stroke)
    const fs = textFillStyle(ctx, content, glyphSize, bboxX, bboxW, fillColor)
    ctx.fillStyle = fs
    ctx.fillText(text, x, y)
    // グリフ内側エフェクト（内側シャドウ/光彩/ベベル）
    drawInnerTextEffects(ctx, content, text, x, y)
    // shimmer（グリフ形にマスクして再塗り）
    if (content.fill?.shimmer) {
      drawTextShimmer(ctx, t, text, x, y, bboxX, bboxW, content.fill.shimmer)
    }
    return
  }

  // 従来の単一シャドウ処理
  let shadowPending = content.shadow !== undefined

  for (const stroke of strokes) {
    if (shadowPending) applyTextShadow(ctx, content.shadow!)
    drawStroke(stroke)
    if (shadowPending) {
      clearTextShadow(ctx)
      shadowPending = false
    }
  }

  if (shadowPending) applyTextShadow(ctx, content.shadow!)
  const fs = textFillStyle(ctx, content, glyphSize, bboxX, bboxW, fillColor)
  ctx.fillStyle = fs
  ctx.fillText(text, x, y)
  if (shadowPending) clearTextShadow(ctx)

  // グリフ内側エフェクト（内側シャドウ/光彩/ベベル）
  drawInnerTextEffects(ctx, content, text, x, y)
  // shimmer（グリフ形にマスクして再塗り）
  if (content.fill?.shimmer) {
    drawTextShimmer(ctx, t, text, x, y, bboxX, bboxW, content.fill.shimmer)
  }
}

/**
 * 縦書き（縦組み）テキストを描画する。列右→左・文字上→下に 1 グリフずつ描く。
 * stroke/shadow/fill グラデは drawTextRun 経由でグリフごとに適用する。
 * レイヤーの transform/filter は呼び出し元（drawLayer）でブロック全体に掛かっている。
 */
function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  content: ResolvedTextContent,
  letterSpacing: number,
  baseWeight: number | undefined,
  t?: number,
): void {
  const size = content.size
  const cellSize = size * (content.runs ? content.emphasisStyle?.scale ?? 1 : 1)
  const v = verticalLayout(content.text, cellSize, letterSpacing)
  const strokeOutset = textStrokeOutset(content)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  let columnOffset = 0
  for (let i = 0; i < v.columns.length; i += 1) {
    // 右→左: 列 0 を右端に置く（bbox は [strokeOutset, strokeOutset + blockW]）
    const xCenter = strokeOutset + v.width - v.colStep * (i + 0.5)
    const chars = v.columns[i]
    let charOffset = columnOffset
    for (let j = 0; j < chars.length; j += 1) {
      const yCenter = strokeOutset + v.charStep * (j + 0.5)
      const emphasized = !!content.runs?.some(
        (run) => run.emphasis && charOffset >= run.start && charOffset < run.end,
      )
      const glyphSize = size * (emphasized ? content.emphasisStyle?.scale ?? 1 : 1)
      const glyphWeight = emphasized
        ? content.emphasisStyle?.weight ?? baseWeight
        : baseWeight
      ctx.font = glyphWeight
        ? `${glyphWeight} ${glyphSize}px ${content.font ?? 'system-ui'}`
        : `${glyphSize}px ${content.font ?? 'system-ui'}`
      const glyphContent = emphasized && content.emphasisStyle?.color !== undefined
        ? { ...content, fill: undefined, patternFill: undefined }
        : content
      // グリフ中心を原点にして描く（グラデ/シャドウのローカル座標が一致するように）
      ctx.save()
      ctx.translate(xCenter, yCenter)
      drawTextRun(
        ctx,
        glyphContent,
        chars[j],
        0,
        0,
        glyphSize,
        -glyphSize / 2,
        glyphSize,
        emphasized ? content.emphasisStyle?.color ?? content.color : content.color,
        t,
      )
      ctx.restore()
      charOffset += chars[j].length
    }
    columnOffset += content.text.split('\n')[i].length + 1
  }
}

/** テキスト（単純 fillText/strokeText）を描画する */
function drawText(
  ctx: CanvasRenderingContext2D,
  content: ResolvedTextContent,
  w: number,
  transform: ReturnType<typeof sampleLayerTransform>,
  t?: number,
): void {
  // weight track による上書き
  const baseWeight = transform.weight !== undefined
    ? roundWeight(transform.weight)
    : content.weight

  // 一枚描きの letterSpacing（ctx.letterSpacing はブラウザで対応済み）
  const letterSpacing = transform.letterSpacing ?? content.letterSpacing ?? 0

  const fontStr = baseWeight
    ? `${baseWeight} ${content.size}px ${content.font ?? 'system-ui'}`
    : `${content.size}px ${content.font ?? 'system-ui'}`
  ctx.font = fontStr

  // 縦書きは専用パス（列右→左・文字上→下。counter/align は対象外）
  if (content.vertical) {
    drawVerticalText(ctx, content, letterSpacing, baseWeight, t)
    return
  }

  ctx.textBaseline = 'top'

  // letterSpacing を設定する（Canvas 2D API: Chrome 99+ 対応）
  if (letterSpacing !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ctx as any).letterSpacing = `${letterSpacing}px`
  }

  // align に応じて x オフセットを決める
  const strokeOutset = textStrokeOutset(content)
  let textX = 0
  switch (content.align) {
    case 'center': textX = w / 2; ctx.textAlign = 'center'; break
    case 'right': textX = w - strokeOutset; ctx.textAlign = 'right'; break
    default: textX = strokeOutset; ctx.textAlign = 'left'; break
  }

  // counter があれば数値テキストを描画、なければ通常テキスト
  let displayText = content.text
  if (content.counter) {
    const counterProgress = transform.counter ?? 1
    displayText = formatCounter(content.counter, counterProgress)
  }

  if (content.runs && content.emphasisStyle && !content.counter) {
    const textWidth = Math.max(0, content.measuredWidth - strokeOutset * 2)
    let cursorX = strokeOutset
    if (content.align === 'center') cursorX = w / 2 - textWidth / 2
    else if (content.align === 'right') cursorX = w - strokeOutset - textWidth

    ctx.textAlign = 'left'
    const innerHeight = Math.max(0, content.measuredHeight - strokeOutset * 2)
    for (let index = 0; index < content.runs.length; index += 1) {
      const run = content.runs[index]
      const runText = content.text.slice(run.start, run.end)
      if (runText.length === 0) continue
      const runSize = content.size * (run.emphasis ? content.emphasisStyle.scale : 1)
      const runWeight = run.emphasis
        ? content.emphasisStyle.weight ?? baseWeight
        : baseWeight
      ctx.font = runWeight
        ? `${runWeight} ${runSize}px ${content.font ?? 'system-ui'}`
        : `${runSize}px ${content.font ?? 'system-ui'}`
      if (letterSpacing !== 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(ctx as any).letterSpacing = '0px'
      }
      const graphemeCount = typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(runText)).length
        : Array.from(runText).length
      const runWidth = ctx.measureText(runText).width + letterSpacing * Math.max(0, graphemeCount - 1)
      if (letterSpacing !== 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(ctx as any).letterSpacing = `${letterSpacing}px`
      }
      const runY = strokeOutset + (innerHeight - runSize) / 2
      const runContent = run.emphasis && content.emphasisStyle.color !== undefined
        ? { ...content, fill: undefined, patternFill: undefined }
        : content
      drawTextRun(
        ctx,
        runContent,
        runText,
        cursorX,
        runY,
        runSize,
        strokeOutset,
        textWidth,
        run.emphasis ? content.emphasisStyle.color ?? content.color : content.color,
        t,
      )
      cursorX += runWidth
      if (letterSpacing !== 0 && index < content.runs.length - 1) cursorX += letterSpacing
    }

    if (letterSpacing !== 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(ctx as any).letterSpacing = '0px'
    }
    return
  }

  // shimmer は時刻 t に依存するため必ず引き渡す（未指定だと NaN グラデで例外になる）
  // y の +size*0.1: レイヤー box 高さは実測 1.2×size（measure.ts）。em ボックス（1.0×size）を
  // box 内で上下対称に置くための補正で、perChar 経路（drawPerChar の glyphY）・カーソル経路と
  // 同一。これが無いと em が box 上端に張り付き、anchor 中央合わせのテキストが約 0.1×size
  // 上ずれする（2026-08-03 テロップ棚の全体上ずれの根本原因）。
  drawTextRun(ctx, content, displayText, textX, strokeOutset + content.size * 0.1, content.size, 0, w, content.color, t)

  // letterSpacing リセット
  if (letterSpacing !== 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ctx as any).letterSpacing = '0px'
  }
}

/** per-character テキストを描画する */
function drawPerChar(
  ctx: CanvasRenderingContext2D,
  layer: ResolvedLayer,
  content: ResolvedTextContent,
  t: number,
  w: number,
  T: number,
  timing: Timing | undefined,
  transform: ReturnType<typeof sampleLayerTransform>,
  layerFilter: string,
): void {
  const glyphs = glyphTransforms(layer, t, T, timing)
  if (glyphs.length === 0) return

  // align に応じてベース X オフセット
  let baseOffsetX = 0
  if (content.align === 'center') baseOffsetX = w / 2
  else if (content.align === 'right') baseOffsetX = w
  const strokeOutset = textStrokeOutset(content)

  // weight track による全体ウェイト上書き
  const trackWeight = transform.weight !== undefined ? roundWeight(transform.weight) : undefined

  let currentFontStr: string | undefined
  const fontForGlyph = (glyph: ReturnType<typeof glyphTransforms>[number]): string => {
    const glyphSize = content.size * glyph.fontScale
    // per-glyph font/weight（GlyphStyle.font / GlyphStyle.weight）優先
    const glyphFont = glyph.font ?? content.font ?? 'system-ui'
    const glyphWeight = glyph.weight ?? trackWeight ?? content.weight
    return glyphWeight
      ? `${glyphWeight} ${glyphSize}px ${glyphFont}`
      : `${glyphSize}px ${glyphFont}`
  }

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // 重なり時の z-order: 先頭文字を最前面にするため逆順に描く（後の文字ほど背面）。
  // 例「サンプル」→ 末尾「ル」ではなく先頭「サ」が一番上に来る。painter 順を反転する
  // だけで各グリフの位置・変形は不変。重ならない（typewriter 等）ケースには影響しない。
  for (let gi = glyphs.length - 1; gi >= 0; gi -= 1) {
    const glyph = glyphs[gi]
    if (glyph.opacity <= 0) continue

    const fontStr = fontForGlyph(glyph)
    if (fontStr !== currentFontStr) {
      ctx.font = fontStr
      currentFontStr = fontStr
    }

    ctx.save()
    ctx.globalAlpha *= Math.max(0, Math.min(1, glyph.opacity))

    // グリフのベース位置に移動
    const glyphX = baseOffsetX + glyph.x + glyph.dx
    const glyphSize = content.size * glyph.fontScale
    const glyphY = content.runs
      ? strokeOutset + (Math.max(0, content.measuredHeight - strokeOutset * 2) - glyphSize) / 2 + glyph.dy
      : strokeOutset + content.size * 0.1 + glyph.dy

    ctx.translate(glyphX, glyphY)
    if (glyph.rotation !== 0) ctx.rotate((glyph.rotation * Math.PI) / 180)
    if (glyph.scale !== 1) ctx.scale(glyph.scale, glyph.scale)
    if (glyph.blur && glyph.blur > 0) {
      ctx.filter = appendFilterString(layerFilter, `blur(${glyph.blur}px)`)
    }

    const glyphContent = glyph.emphasis && content.emphasisStyle?.color !== undefined
      ? { ...content, fill: undefined, patternFill: undefined }
      : content
    drawTextRun(ctx, glyphContent, glyph.ch, 0, 0, glyphSize, 0, glyphSize * 1.2, glyph.color ?? content.color, t)

    ctx.restore()
  }

  // タイプライターの点滅カーソルを打鍵位置に描画する
  const caret = caretState(layer, t, T, timing)
  if (caret && caret.visible) {
    const fontStr = content.weight
      ? `${content.weight} ${content.size}px ${content.font ?? 'system-ui'}`
      : `${content.size}px ${content.font ?? 'system-ui'}`
    ctx.save()
    ctx.translate(baseOffsetX + caret.x, strokeOutset + content.size * 0.1)
    ctx.font = fontStr
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = caret.color
    ctx.fillText(caret.char, 0, 0)
    ctx.restore()
  }
}
