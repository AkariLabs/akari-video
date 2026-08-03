// ATF → ResolvedScene の変換（変数解決 + 式評価 + 実測）
import type { AtfDoc, AtfLayer, ClipSpec, GradientFill, PerChar, ResolvedClipSpec, ResolvedGradientFill, ResolvedLayer, ResolvedScene, ResolvedTextContent, ResolvedShapeContent, TextContent, ShapeContent, Value } from './types'
import type { MeasureText } from './measure'
import { verticalLayout } from './vertical'
import { evalExprWithHas } from './expr'
import { classifyGlyph } from '../render/perchar'
import { isEmphasizedAt, parseTextRuns, type TextRun } from './text-runs'

// --- テキスト堅牢化（shrink-to-fit）定数 ---
// 2026-07-22 telop-tunables タスクで追加（vendor/PROVENANCE.md 参照）。
// どんな長さのテキストでもキャンバスからはみ出さないよう、フォントサイズを
// 自動縮小するための既定パラメータ。
// マージンは意図的に 0（= キャンバス境界そのもの）。カタログには「速報」バッジのように
// x=0 でキャンバス左端に意図的にフラッシュ配置するデザインが複数あり、パーセンテージ
// マージンを設けるとそれらの既定表示まで縮小されてしまう（後方互換の破壊）。
// ここでの堅牢化は「絶対にフレーム外へはみ出させない」ことが目的であり、
// タイトルセーフ的な内側余白の強制ではない。
/** キャンバス各辺に確保する安全マージン（stage 寸法比）。0 = キャンバス境界と同じ */
const FIT_SAFE_MARGIN_FRAC = 0
/** 反復収縮の最大試行回数（canvas measureText はサイズにほぼ線形なので数回で収束する） */
const FIT_MAX_ITERATIONS = 4
/** 縮小してよい下限（絶対px）。これ未満には縮めない（完全に不可視になるのを防ぐ） */
const FIT_ABSOLUTE_MIN_PX = 10
/** 既定の最小スケール（元サイズに対する比率）。layer.fit.minScale で上書き可能 */
const FIT_DEFAULT_MIN_SCALE = 0.3

/** テンプレート全体 bbox 上の 9 点アンカーを相対座標へ変換する。 */
export const ANCHOR_FRACS: Record<NonNullable<AtfDoc['anchor']>, { fracX: number; fracY: number }> = {
  tl: { fracX: 0, fracY: 0 },
  tc: { fracX: 0.5, fracY: 0 },
  tr: { fracX: 1, fracY: 0 },
  ml: { fracX: 0, fracY: 0.5 },
  mc: { fracX: 0.5, fracY: 0.5 },
  mr: { fracX: 1, fracY: 0.5 },
  bl: { fracX: 0, fracY: 1 },
  bc: { fracX: 0.5, fracY: 1 },
  br: { fracX: 1, fracY: 1 },
}

export interface ResolvedLayersBBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** 解決済み（visibleIf 適用後）レイヤーの transform / size から自然 bbox を求める。 */
export function resolvedLayersBBox(layers: ResolvedLayer[]): ResolvedLayersBBox | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const layer of layers) {
    // 進捗 0% のバーなど、面積を持たず描画されない縮退レイヤーは視覚コンテンツの
    // アンカーを定義しない。座標だけを union すると、不可視レイヤーが全体を歪める。
    if (!(layer.size.w > 0) || !(layer.size.h > 0)) continue
    const layerLeft = layer.transform.x - layer.transform.anchor.x * layer.size.w
    const layerTop = layer.transform.y - layer.transform.anchor.y * layer.size.h
    const layerRight = layerLeft + layer.size.w
    const layerBottom = layerTop + layer.size.h
    if (![layerLeft, layerTop, layerRight, layerBottom].every(Number.isFinite)) continue
    left = Math.min(left, layerLeft)
    top = Math.min(top, layerTop)
    right = Math.max(right, layerRight)
    bottom = Math.max(bottom, layerBottom)
  }

  if (![left, top, right, bottom].every(Number.isFinite)) return null
  return { left, top, right, bottom }
}

function hash01(seed: number, index: number, salt: number): number {
  let h = (seed | 0) ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0xc2b2ae35, 0x27d4eb2d)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 0x100000000
}

function splitTextForPerChar(perChar: PerChar, text: string, runs?: TextRun[]): string[] {
  if (perChar.split === 'word') {
    return Array.from(text.matchAll(/\S+/g)).flatMap((match) => {
      const start = match.index ?? 0
      const end = start + match[0].length
      const cuts = new Set([start, end])
      for (const run of runs ?? []) {
        if (run.start > start && run.start < end) cuts.add(run.start)
        if (run.end > start && run.end < end) cuts.add(run.end)
      }
      const offsets = Array.from(cuts).sort((a, b) => a - b)
      return offsets.slice(0, -1).map((at, index) => text.slice(at, offsets[index + 1]))
    })
  }
  return splitTextForGrapheme(text)
}

function splitTextForGrapheme(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), seg => seg.segment)
  }
  return Array.from(text)
}

function perCharFontScale(perChar: PerChar, ch: string, index: number): number {
  let fontScale = 1
  const classStyle = perChar.classStyles?.[classifyGlyph(ch)]
  if (classStyle?.sizeScale !== undefined) fontScale = classStyle.sizeScale

  const glyphStyles = perChar.glyphStyles
  if (glyphStyles && glyphStyles.styles.length > 0) {
    const style = glyphStyles.repeat
      ? glyphStyles.styles[index % glyphStyles.styles.length]
      : glyphStyles.styles[index]
    if (style?.sizeScale !== undefined) fontScale = style.sizeScale
  }

  const randomize = perChar.randomize
  if (randomize?.sizeAmp !== undefined) {
    fontScale *= 1 + (hash01(randomize.seed, index, 1) - 0.5) * 2 * randomize.sizeAmp
  }
  return fontScale
}

function measureTextLayer(
  text: string,
  font: string,
  size: number,
  weight: number | undefined,
  perChar: PerChar | undefined,
  measure: MeasureText,
  letterSpacing: number,
  runs?: TextRun[],
  emphasisStyle?: { scale: number; weight?: number },
): { width: number; height: number } {
  const hasRunStyle = !!runs?.some((run) => run.emphasis) && emphasisStyle !== undefined
  if (!hasRunStyle && !perChar?.classStyles && !perChar?.glyphStyles && !perChar?.randomize?.sizeAmp) {
    const base = measure(text, font, size, weight)
    // 字間: 文字間スペースは (文字数 - 1) ぶん追加
    const charCount = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length
      : Array.from(text).length
    const extra = letterSpacing > 0 && charCount > 1 ? letterSpacing * (charCount - 1) : 0
    return { width: base.width + extra, height: base.height }
  }

  if (hasRunStyle && !perChar) {
    let width = 0
    let height = 0
    for (const run of runs ?? []) {
      const runText = text.slice(run.start, run.end)
      const runScale = run.emphasis ? emphasisStyle?.scale ?? 1 : 1
      const runWeight = run.emphasis ? emphasisStyle?.weight ?? weight : weight
      const measured = measure(runText, font, size * runScale, runWeight)
      width += measured.width
      height = Math.max(height, measured.height)
    }
    const charCount = splitTextForGrapheme(text).length
    if (letterSpacing > 0 && charCount > 1) width += letterSpacing * (charCount - 1)
    return { width, height }
  }

  const chars = perChar ? splitTextForPerChar(perChar, text, runs) : splitTextForGrapheme(text)
  if (chars.length === 0) return measure(text, font, size, weight)

  let width = 0
  let height = 0
  let offset = 0
  for (let i = 0; i < chars.length; i++) {
    const emphasized = isEmphasizedAt(runs, text.indexOf(chars[i], offset))
    const runScale = emphasized ? emphasisStyle?.scale ?? 1 : 1
    const perGlyphScale = perChar ? perCharFontScale(perChar, chars[i], i) : 1
    const glyphSize = size * runScale * perGlyphScale
    const glyphWeight = emphasized ? emphasisStyle?.weight ?? weight : weight
    const measured = measure(chars[i], font, glyphSize, glyphWeight)
    width += measured.width
    if (i < chars.length - 1) width += letterSpacing
    height = Math.max(height, measured.height)
    offset = text.indexOf(chars[i], offset) + chars[i].length
  }
  return { width, height }
}

/** GradientFill の Value を文字列へ解決する */
function resolveGradientFill(
  fill: GradientFill,
  resolveStr: (v: Value, fallback?: string) => string,
): ResolvedGradientFill {
  return {
    type: fill.type,
    stops: fill.stops.map((stop) => ({ at: stop.at, color: resolveStr(stop.color) })),
    shimmer: fill.shimmer,
  }
}

/** ClipSpec（Value 混在）→ ResolvedClipSpec（数値のみ）に解決する */
function resolveClip(
  clip: ClipSpec,
  resolveNum: (v: Value, fallback?: number) => number,
): ResolvedClipSpec {
  if (clip.type === 'inset') {
    return {
      type: 'inset',
      top: clip.top !== undefined ? resolveNum(clip.top) : undefined,
      right: clip.right !== undefined ? resolveNum(clip.right) : undefined,
      bottom: clip.bottom !== undefined ? resolveNum(clip.bottom) : undefined,
      left: clip.left !== undefined ? resolveNum(clip.left) : undefined,
    }
  }
  if (clip.type === 'polygon') {
    return {
      type: 'polygon',
      points: clip.points.map((p) => ({ x: resolveNum(p.x), y: resolveNum(p.y) })),
    }
  }
  // circle
  return {
    type: 'circle',
    cx: resolveNum(clip.cx),
    cy: resolveNum(clip.cy),
    r: resolveNum(clip.r),
  }
}

/**
 * ATF ドキュメントを具体値の ResolvedScene に変換する
 * @param doc ATF ドキュメント
 * @param bindings 変数バインディング（外部から渡す値）
 * @param aspect アスペクト比文字列（例: '16:9'）
 * @param measure テキスト実測関数
 */
export function resolve(
  doc: AtfDoc,
  bindings: Record<string, string | number>,
  aspect: string | undefined,
  measure: MeasureText,
): ResolvedScene {
  // (1) variables を bindings で上書き（無ければ default）
  const vars: Record<string, string | number> = {}
  for (const v of doc.variables) {
    vars[v.key] = v.key in bindings ? bindings[v.key] : v.default
  }

  // has() で使う: 値が空文字でなく定義されている変数のキーセット
  const hasKeys = new Set<string>()
  for (const v of doc.variables) {
    if (v.key in bindings) {
      const val = bindings[v.key]
      if (val !== '' && val !== undefined) hasKeys.add(v.key)
    } else if (!v.optional) {
      hasKeys.add(v.key)
    }
  }

  // (2) stage を aspect で確定（byAspect マージ）
  let stageWidth = doc.stage.width
  let stageHeight = doc.stage.height
  if (aspect && doc.stage.byAspect?.[aspect]) {
    const override = doc.stage.byAspect[aspect]
    stageWidth = override.width
    stageHeight = override.height
  }
  const stage = {
    width: stageWidth,
    height: stageHeight,
    fps: doc.stage.fps,
    duration: doc.stage.duration,
    bg: doc.stage.bg,
  }

  // スコープに stage 定数を注入
  const baseScope: Record<string, number> = {
    '@stage.width': stageWidth,
    '@stage.height': stageHeight,
    '@stage.duration': doc.stage.duration,
  }

  // 数値変数は直接スコープに入れる。
  // 呼び出し側（例: akari-video）が bindings をすべて文字列で渡すケースに備え、
  // number 型として宣言された変数は文字列値も parseFloat して式スコープに入れる
  // （{var} 経由は resolveNum で既に parseFloat 済み。式中の素の変数参照と挙動を揃える）。
  for (const v of doc.variables) {
    const val = vars[v.key]
    if (typeof val === 'number') {
      baseScope[v.key] = val
    } else if (v.type === 'number' && typeof val === 'string') {
      const n = parseFloat(val)
      if (Number.isFinite(n)) baseScope[v.key] = n
    }
  }

  // (3) レイヤーの依存解決を topo-sort
  // 各レイヤーの式が参照する @otherId.* を辺とする
  const layerMap = new Map<string, AtfLayer>()
  for (const layer of doc.layers) {
    layerMap.set(layer.id, layer)
  }

  // 依存関係の抽出: 式中の @layerId.* パターン
  function extractLayerDeps(layer: AtfLayer): string[] {
    const deps = new Set<string>()
    const exprs = collectExprs(layer)
    for (const expr of exprs) {
      const matches = expr.matchAll(/@([a-zA-Z0-9_]+)\./g)
      for (const m of matches) {
        const refId = m[1]
        if (refId !== 'stage' && layerMap.has(refId)) {
          deps.add(refId)
        }
      }
    }
    return Array.from(deps)
  }

  // レイヤー内のすべての式文字列を収集
  function collectExprs(layer: AtfLayer): string[] {
    const exprs: string[] = []
    const collect = (v: Value) => {
      if (typeof v === 'object' && v !== null && 'expr' in v) exprs.push(v.expr)
    }
    collect(layer.transform.x)
    collect(layer.transform.y)
    if (layer.transform.rotation) collect(layer.transform.rotation)
    if (layer.transform.opacity) collect(layer.transform.opacity)
    if (layer.transform.skewX) collect(layer.transform.skewX)
    if (layer.transform.skewY) collect(layer.transform.skewY)
    if (layer.size) {
      collect(layer.size.w)
      collect(layer.size.h)
    }
    if (layer.visibleIf) exprs.push(layer.visibleIf.expr)
    if (layer.type === 'text') {
      const c = layer.content as TextContent
      collect(c.text)
      collect(c.size)
      collect(c.color)
      if (c.font !== undefined) collect(c.font)
      if (c.weight !== undefined) collect(c.weight)
      if (c.emphasisStyle?.color !== undefined) collect(c.emphasisStyle.color)
      if (c.emphasisStyle?.scale !== undefined) collect(c.emphasisStyle.scale)
      if (c.emphasisStyle?.weight !== undefined) collect(c.emphasisStyle.weight)
      if (c.letterSpacing !== undefined) collect(c.letterSpacing)
      if (c.stroke) {
        collect(c.stroke.color)
        collect(c.stroke.width)
      }
      if (c.fill) {
        for (const stop of c.fill.stops) collect(stop.color)
      }
      if (c.strokes) {
        for (const stroke of c.strokes) {
          collect(stroke.color)
          collect(stroke.width)
          if (stroke.fill) {
            for (const stop of stroke.fill.stops) collect(stop.color)
          }
        }
      }
      if (c.shadow) {
        collect(c.shadow.color)
        collect(c.shadow.blur)
        collect(c.shadow.x)
        collect(c.shadow.y)
      }
      if (c.shadows) {
        for (const sh of c.shadows) {
          collect(sh.color)
          collect(sh.blur)
          collect(sh.x)
          collect(sh.y)
        }
      }
      if (c.counter) {
        collect(c.counter.from)
        collect(c.counter.to)
      }
    } else {
      const c = layer.content as ShapeContent
      collect(c.fill)
      if (c.crack) collect(c.crack.color)
      if (c.fillGradient) {
        for (const stop of c.fillGradient.stops) collect(stop.color)
      }
    }
    return exprs
  }

  // Kahn's algorithm による topo-sort
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>()
  for (const layer of doc.layers) {
    inDegree.set(layer.id, 0)
    adjList.set(layer.id, [])
  }
  for (const layer of doc.layers) {
    const deps = extractLayerDeps(layer)
    for (const dep of deps) {
      // dep → layer の辺（dep が先に解決される必要がある）
      adjList.get(dep)!.push(layer.id)
      inDegree.set(layer.id, (inDegree.get(layer.id) ?? 0) + 1)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  const sortedIds: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    sortedIds.push(id)
    for (const next of adjList.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }
  if (sortedIds.length !== doc.layers.length) {
    throw new Error('循環参照が検出されました')
  }

  // (4) レイヤーを順番に解決する
  const scope: Record<string, number> = { ...baseScope }
  const resolvedMap = new Map<string, ResolvedLayer>()
  const resolvedLayers: ResolvedLayer[] = []

  for (const id of sortedIds) {
    const layer = layerMap.get(id)!

    // visibleIf チェック
    if (layer.visibleIf) {
      const visible = evalExprWithHas(layer.visibleIf.expr, scope, hasKeys)
      if (visible === 0) continue
    }

    // Value を解決するヘルパー（数値）
    const resolveNum = (v: Value, fallback = 0): number => {
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseFloat(v) || fallback
      if ('var' in v) {
        const val = vars[v.var]
        if (typeof val === 'number') return val
        if (typeof val === 'string') return parseFloat(val) || fallback
        return fallback
      }
      if ('expr' in v) return evalExprWithHas(v.expr, scope, hasKeys)
      return fallback
    }

    // Value を解決するヘルパー（文字列）
    const resolveStr = (v: Value, fallback = ''): string => {
      if (typeof v === 'number') return String(v)
      if (typeof v === 'string') return v
      if ('var' in v) {
        const val = vars[v.var]
        return val !== undefined ? String(val) : fallback
      }
      if ('expr' in v) return String(evalExprWithHas(v.expr, scope, hasKeys))
      return fallback
    }

    let resolvedContent: ResolvedTextContent | ResolvedShapeContent
    let measuredW = 0
    let measuredH = 0

    if (layer.type === 'text') {
      const c = layer.content as TextContent
      const parsedText = parseTextRuns(resolveStr(c.text))
      const text = parsedText.text
      // font / weight は Value（2026-08-03 fontFamily / fontWeight ツマミ対応）。
      // 実測（measureBlock）より前に解決しないと、ツマミでフォントを替えたとき
      // 実測と描画が食い違う
      const font = c.font !== undefined ? resolveStr(c.font, 'system-ui') : 'system-ui'
      const weightNum = c.weight !== undefined ? resolveNum(c.weight, 0) : 0
      const resolvedWeight = Number.isFinite(weightNum) && weightNum > 0 ? weightNum : undefined
      const resolvedColor = resolveStr(c.color, '#ffffff')
      const emphasisScaleNum = c.emphasisStyle?.scale !== undefined
        ? resolveNum(c.emphasisStyle.scale, 1)
        : 1
      const emphasisWeightNum = c.emphasisStyle?.weight !== undefined
        ? resolveNum(c.emphasisStyle.weight, 0)
        : 0
      const resolvedEmphasisStyle = c.emphasisStyle
        ? {
            color: c.emphasisStyle.color !== undefined
              ? resolveStr(c.emphasisStyle.color, resolvedColor)
              : undefined,
            scale: Number.isFinite(emphasisScaleNum) && emphasisScaleNum > 0 ? emphasisScaleNum : 1,
            weight: Number.isFinite(emphasisWeightNum) && emphasisWeightNum > 0
              ? emphasisWeightNum
              : resolvedWeight,
          }
        : undefined
      const resolvedRuns = parsedText.parsed && resolvedEmphasisStyle && parsedText.runs.some((run) => run.emphasis)
        ? parsedText.runs
        : undefined
      // size は Value なので数値へ解決する（shrink-to-fit で縮小しうるため let）
      let resolvedSize = resolveNum(c.size, 0)
      // letterSpacing は Value（なければ 0）
      const resolvedLetterSpacing = c.letterSpacing !== undefined ? resolveNum(c.letterSpacing, 0) : 0
      const isVertical = !!c.vertical
      // ストローク幅は Value（変数・式）を許可するため、測定前に数値へ解決する
      const resolvedStroke = c.stroke
        ? { color: resolveStr(c.stroke.color), width: resolveNum(c.stroke.width, 0) }
        : undefined
      const resolvedStrokes = c.strokes?.map((stroke) => ({
        color: resolveStr(stroke.color),
        width: resolveNum(stroke.width, 0),
        fill: stroke.fill ? resolveGradientFill(stroke.fill, resolveStr) : undefined,
      }))
      const strokeOutset = resolvedStrokes && resolvedStrokes.length > 0
        ? Math.max(...resolvedStrokes.map((s) => s.width))
        : resolvedStroke?.width ?? 0

      // 縦書き/横書き共通の実測ヘルパー（現在の resolvedSize で測る）
      const measureBlock = (size: number): { width: number; height: number } =>
        isVertical
          ? verticalLayout(
              text,
              size * (resolvedRuns ? resolvedEmphasisStyle?.scale ?? 1 : 1),
              resolvedLetterSpacing,
            )
          : measureTextLayer(
              text,
              font,
              size,
              resolvedWeight,
              layer.perChar,
              measure,
              resolvedLetterSpacing,
              resolvedRuns,
              resolvedEmphasisStyle,
            )

      // --- テキスト堅牢化（shrink-to-fit） ---
      // どんな長さのテキストでもキャンバス安全域（+ layer.fit の任意指定）からはみ出さないよう、
      // フォントサイズを反復的に縮小する。安全域は anchor と（既に確定済みの）transform 位置から
      // 算出する（このレイヤー自身の @id.width 等はまだスコープに無いため、self 参照はしない）。
      const anchorX = layer.transform.anchor.x
      const anchorY = layer.transform.anchor.y
      // 位置ツマミ（posX / posY / xOffset / yOffset）はキャンバス外への意図的な移動にも使う
      // （画面外から入る/出る演出前提・2026-08-03 オーナー裁定）。shrink-to-fit の安全域は
      // ツマミの現在値ではなく既定値で評価し、「動かしたら文字が縮む」誤発動を防ぐ。
      const fitScope: Record<string, number> = { ...scope }
      for (const variable of doc.variables) {
        if (!['posX', 'posY', 'xOffset', 'yOffset'].includes(variable.key)) continue
        const def = typeof variable.default === 'number' ? variable.default : parseFloat(String(variable.default))
        if (Number.isFinite(def)) fitScope[variable.key] = def
      }
      const resolveNumForFit = (v: Value, fallback = 0): number => {
        if (typeof v === 'number') return v
        if (typeof v === 'string') return parseFloat(v) || fallback
        if ('var' in v) {
          if (v.var in fitScope) return fitScope[v.var]
          const val = vars[v.var]
          if (typeof val === 'number') return val
          if (typeof val === 'string') return parseFloat(val) || fallback
          return fallback
        }
        if ('expr' in v) return evalExprWithHas(v.expr, fitScope, hasKeys)
        return fallback
      }
      const tx0 = resolveNumForFit(layer.transform.x)
      const ty0 = resolveNumForFit(layer.transform.y)
      const marginX = stageWidth * FIT_SAFE_MARGIN_FRAC
      const marginY = stageHeight * FIT_SAFE_MARGIN_FRAC
      const canvasMaxW = Math.max(
        0,
        Math.min(
          anchorX > 0 ? (tx0 - marginX) / anchorX : Infinity,
          anchorX < 1 ? (stageWidth - marginX - tx0) / (1 - anchorX) : Infinity,
        ),
      )
      const canvasMaxH = Math.max(
        0,
        Math.min(
          anchorY > 0 ? (ty0 - marginY) / anchorY : Infinity,
          anchorY < 1 ? (stageHeight - marginY - ty0) / (1 - anchorY) : Infinity,
        ),
      )
      const fitMaxW = layer.fit?.maxWidth !== undefined ? resolveNum(layer.fit.maxWidth, Infinity) : Infinity
      const fitMaxH = layer.fit?.maxHeight !== undefined ? resolveNum(layer.fit.maxHeight, Infinity) : Infinity
      const effectiveMaxW = Math.min(canvasMaxW, fitMaxW)
      const effectiveMaxH = Math.min(canvasMaxH, fitMaxH)

      if (text.length > 0 && (Number.isFinite(effectiveMaxW) || Number.isFinite(effectiveMaxH))) {
        const originalSize = resolvedSize
        const minScale = layer.fit?.minScale ?? FIT_DEFAULT_MIN_SCALE
        const floor = Math.max(originalSize * minScale, FIT_ABSOLUTE_MIN_PX)
        for (let iter = 0; iter < FIT_MAX_ITERATIONS; iter += 1) {
          const measured = measureBlock(resolvedSize)
          const totalW = measured.width + strokeOutset * 2
          const totalH = measured.height + strokeOutset * 2
          const ratioW = Number.isFinite(effectiveMaxW) && totalW > effectiveMaxW ? effectiveMaxW / totalW : 1
          const ratioH = Number.isFinite(effectiveMaxH) && totalH > effectiveMaxH ? effectiveMaxH / totalH : 1
          const ratio = Math.min(ratioW, ratioH)
          if (ratio >= 0.995) break
          resolvedSize = Math.max(resolvedSize * ratio, floor)
          if (resolvedSize <= floor) {
            // 下限に到達。念のためもう一度測定してループを抜ける
            break
          }
        }
      }

      const { width, height } = measureBlock(resolvedSize)
      measuredW = width + strokeOutset * 2
      measuredH = height + strokeOutset * 2

      // カウンター設定を正規化（from/to は Value）
      const resolvedCounter = c.counter
        ? {
            from: resolveNum(c.counter.from, 0),
            to: resolveNum(c.counter.to, 0),
            decimals: c.counter.decimals ?? 0,
            prefix: c.counter.prefix ?? '',
            suffix: c.counter.suffix ?? '',
            useGrouping: c.counter.useGrouping ?? false,
          }
        : undefined

      const textContent: ResolvedTextContent = {
        text,
        runs: resolvedRuns,
        emphasisStyle: resolvedRuns ? resolvedEmphasisStyle : undefined,
        size: resolvedSize,
        font: c.font !== undefined ? font : undefined,
        weight: resolvedWeight,
        color: resolvedColor,
        align: c.align,
        vertical: c.vertical,
        stroke: resolvedStroke,
        measuredWidth: measuredW,
        measuredHeight: measuredH,
        letterSpacing: resolvedLetterSpacing,
        counter: resolvedCounter,
      }
      if (c.fill) {
        textContent.fill = resolveGradientFill(c.fill, resolveStr)
      }
      if (c.patternFill) {
        textContent.patternFill = {
          kind: c.patternFill.kind,
          color: resolveStr(c.patternFill.color, '#ffffff'),
          bg: c.patternFill.bg !== undefined ? resolveStr(c.patternFill.bg) : undefined,
          scale: c.patternFill.scale !== undefined ? resolveNum(c.patternFill.scale, 1) : 1,
          angle: c.patternFill.angle !== undefined ? resolveNum(c.patternFill.angle, 0) : 0,
        }
      }
      if (resolvedStrokes) {
        textContent.strokes = resolvedStrokes
      }
      if (c.shadow) {
        textContent.shadow = {
          color: resolveStr(c.shadow.color),
          blur: resolveNum(c.shadow.blur, 0),
          x: resolveNum(c.shadow.x, 0),
          y: resolveNum(c.shadow.y, 0),
        }
      }
      if (c.shadows) {
        textContent.shadows = c.shadows.map((sh) => ({
          color: resolveStr(sh.color),
          blur: resolveNum(sh.blur, 0),
          x: resolveNum(sh.x, 0),
          y: resolveNum(sh.y, 0),
        }))
      }
      if (c.innerShadows) {
        textContent.innerShadows = c.innerShadows.map((sh) => ({
          color: resolveStr(sh.color),
          blur: resolveNum(sh.blur, 0),
          x: resolveNum(sh.x, 0),
          y: resolveNum(sh.y, 0),
        }))
      }
      if (c.innerGlow) {
        textContent.innerGlow = {
          color: resolveStr(c.innerGlow.color),
          blur: resolveNum(c.innerGlow.blur, 0),
        }
      }
      if (c.bevel) {
        textContent.bevel = {
          light: resolveStr(c.bevel.light),
          dark: resolveStr(c.bevel.dark),
          size: resolveNum(c.bevel.size, 0),
        }
      }
      resolvedContent = textContent
    } else {
      const c = layer.content as ShapeContent
      resolvedContent = {
        shape: c.shape,
        fill: resolveStr(c.fill, '#000000'),
        fillGradient: c.fillGradient ? resolveGradientFill(c.fillGradient, resolveStr) : undefined,
        cornerRadius: c.cornerRadius,
        crack: c.crack
          ? {
              impact: c.crack.impact ?? { x: 0.5, y: 0.45 },
              radial: c.crack.radial ?? 10,
              concentric: c.crack.concentric ?? 3,
              spread: c.crack.spread ?? 1,
              jitter: c.crack.jitter ?? 0.35,
              color: resolveStr(c.crack.color, '#ffffff'),
              width: c.crack.width ?? 1.5,
              opacity: c.crack.opacity ?? 0.85,
              seed: c.crack.seed ?? 1,
            }
          : undefined,
        star: c.star,
        calloutTail: c.calloutTail,
      } satisfies ResolvedShapeContent
    }

    // size の解決（text の場合は測定値をデフォルトに）
    const defaultW = layer.type === 'text' ? measuredW : 0
    const defaultH = layer.type === 'text' ? measuredH : 0
    // 縦書きテキストは横書き前提の明示 size を無視し、縦ブロック実測を採用する
    // （明示 size は横帯型で縦書きブロックと形が合わず、bounds/中央配置がズレるため）
    const verticalText = layer.type === 'text' && !!(layer.content as TextContent).vertical
    const sizeW = verticalText ? measuredW : layer.size ? resolveNum(layer.size.w, defaultW) : defaultW
    const sizeH = verticalText ? measuredH : layer.size ? resolveNum(layer.size.h, defaultH) : defaultH

    // transform の解決
    const tx = resolveNum(layer.transform.x)
    const ty = resolveNum(layer.transform.y)
    const tr = layer.transform.rotation ? resolveNum(layer.transform.rotation) : 0
    const to = layer.transform.opacity !== undefined ? resolveNum(layer.transform.opacity, 1) : 1
    const tSkewX = layer.transform.skewX ? resolveNum(layer.transform.skewX) : 0
    const tSkewY = layer.transform.skewY ? resolveNum(layer.transform.skewY) : 0

    const resolved: ResolvedLayer = {
      id: layer.id,
      type: layer.type,
      content: resolvedContent,
      transform: {
        x: tx,
        y: ty,
        anchor: layer.transform.anchor,
        rotation: tr,
        opacity: to,
        skewX: tSkewX,
        skewY: tSkewY,
      },
      size: { w: sizeW, h: sizeH },
      tracks: layer.tracks,
      perChar: layer.perChar,
      // decorPhase は描画側のゲーティング判定に使うため素通しする
      decorPhase: layer.decorPhase,
      // clip: ClipSpec（Value 混在）→ ResolvedClipSpec（数値）へ解決
      clip: layer.clip ? resolveClip(layer.clip, resolveNum) : undefined,
      // wipe 設定を正規化（from のデフォルトを 'start' に）
      wipe: layer.wipe ? { axis: layer.wipe.axis, from: layer.wipe.from ?? 'start' } : undefined,
    }

    // (4) @id.* スコープの追加
    // 位置: anchor を考慮した bbox から算出
    const left = tx - layer.transform.anchor.x * sizeW
    const top = ty - layer.transform.anchor.y * sizeH
    scope[`@${id}.width`] = sizeW
    scope[`@${id}.height`] = sizeH
    scope[`@${id}.left`] = left
    scope[`@${id}.right`] = left + sizeW
    scope[`@${id}.top`] = top
    scope[`@${id}.bottom`] = top + sizeH
    scope[`@${id}.cx`] = left + sizeW / 2
    scope[`@${id}.cy`] = top + sizeH / 2

    resolvedMap.set(id, resolved)
    resolvedLayers.push(resolved)
  }

  // doc.anchor を宣言したテンプレートだけ、全レイヤー解決後の自然 bbox を 1 回だけ
  // posX / posY の中央基準座標へ剛体移動する。anchor 未宣言の旧 ad-hoc doc は完全に従来どおり。
  if (doc.anchor) {
    const naturalBBox = resolvedLayersBBox(resolvedLayers)
    if (naturalBBox) {
      const { fracX, fracY } = ANCHOR_FRACS[doc.anchor]
      const naturalAnchorX = naturalBBox.left + fracX * (naturalBBox.right - naturalBBox.left)
      const naturalAnchorY = naturalBBox.top + fracY * (naturalBBox.bottom - naturalBBox.top)
      const numericVar = (key: string): number => {
        const value = vars[key]
        const parsed = typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? parseFloat(value)
            : NaN
        return Number.isFinite(parsed) ? parsed : 0
      }
      const targetX = stageWidth / 2 + numericVar('posX')
      const targetY = stageHeight / 2 + numericVar('posY')
      const shiftX = targetX - naturalAnchorX
      const shiftY = targetY - naturalAnchorY

      for (const layer of resolvedLayers) {
        layer.transform.x += shiftX
        layer.transform.y += shiftY
      }
    }
  }

  // 元の配列順に並べ直す（描画順を維持）
  const orderedLayers = doc.layers
    .filter(l => resolvedMap.has(l.id))
    .map(l => resolvedMap.get(l.id)!)

  return { stage, timing: doc.timing, layers: orderedLayers }
}
