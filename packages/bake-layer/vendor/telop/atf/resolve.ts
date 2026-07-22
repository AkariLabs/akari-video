// ATF → ResolvedScene の変換（変数解決 + 式評価 + 実測）
import type { AtfDoc, AtfLayer, ClipSpec, GradientFill, PerChar, ResolvedClipSpec, ResolvedGradientFill, ResolvedLayer, ResolvedScene, ResolvedTextContent, ResolvedShapeContent, TextContent, ShapeContent, Value } from './types'
import type { MeasureText } from './measure'
import { verticalLayout } from './vertical'
import { evalExprWithHas } from './expr'
import { classifyGlyph } from '../render/perchar'

function hash01(seed: number, index: number, salt: number): number {
  let h = (seed | 0) ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0xc2b2ae35, 0x27d4eb2d)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 0x100000000
}

function splitTextForPerChar(perChar: PerChar, text: string): string[] {
  if (perChar.split === 'word') return text.split(/\s+/).filter(Boolean)
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
): { width: number; height: number } {
  if (!perChar?.classStyles && !perChar?.glyphStyles && !perChar?.randomize?.sizeAmp) {
    const base = measure(text, font, size, weight)
    // 字間: 文字間スペースは (文字数 - 1) ぶん追加
    const charCount = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length
      : Array.from(text).length
    const extra = letterSpacing > 0 && charCount > 1 ? letterSpacing * (charCount - 1) : 0
    return { width: base.width + extra, height: base.height }
  }

  const chars = splitTextForPerChar(perChar, text)
  if (chars.length === 0) return measure(text, font, size, weight)

  let width = 0
  let height = 0
  for (let i = 0; i < chars.length; i++) {
    const glyphSize = size * perCharFontScale(perChar, chars[i], i)
    const measured = measure(chars[i], font, glyphSize, weight)
    width += measured.width
    if (i < chars.length - 1) width += letterSpacing
    height = Math.max(height, measured.height)
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
      const text = resolveStr(c.text)
      const font = c.font ?? 'system-ui'
      // size は Value なので数値へ解決する
      const resolvedSize = resolveNum(c.size, 0)
      // letterSpacing は Value（なければ 0）
      const resolvedLetterSpacing = c.letterSpacing !== undefined ? resolveNum(c.letterSpacing, 0) : 0
      // 縦書きは fontSize 基準の固定送りでブロック寸法を算出（measure は不要）
      const { width, height } = c.vertical
        ? verticalLayout(text, resolvedSize, resolvedLetterSpacing)
        : measureTextLayer(text, font, resolvedSize, c.weight, layer.perChar, measure, resolvedLetterSpacing)
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
        size: resolvedSize,
        font: c.font,
        weight: c.weight,
        color: resolveStr(c.color, '#ffffff'),
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
    const to = layer.transform.opacity ? resolveNum(layer.transform.opacity, 1) : 1
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

  // 元の配列順に並べ直す（描画順を維持）
  const orderedLayers = doc.layers
    .filter(l => resolvedMap.has(l.id))
    .map(l => resolvedMap.get(l.id)!)

  return { stage, timing: doc.timing, layers: orderedLayers }
}
