// per-character アニメーション: 文字分割 + グリフ変形計算
import type { GlyphClass, GlyphStyle, PerChar, ResolvedLayer, ResolvedTextContent, Timing, Value } from '../atf/types'
import { evalExprWithHas } from '../atf/expr'
import { phaseContains, phaseLocalTime, sampleTrackInPhase, trackPhaseHasStarted } from './timing'

/** グリフ変形データ */
export interface GlyphTransform {
  ch: string
  /** ベースX位置（字詰め結果） */
  x: number
  /** per-char トラックによる追加 X オフセット */
  dx: number
  /** per-char トラックによる追加 Y オフセット（float込み） */
  dy: number
  /** 静的フォントサイズ倍率（字詰めにも反映） */
  fontScale: number
  scale: number
  rotation: number
  opacity: number
  blur?: number
  /** per-glyph 色。未指定なら本文色を使う */
  color?: string
  /** per-glyph フォントファミリー（GlyphStyle.font 由来）。未指定なら本文フォントを使う */
  font?: string
  /** per-glyph ウェイト（GlyphStyle.weight 由来）。未指定なら本文ウェイトを使う */
  weight?: number
}

interface StaticGlyphStyle {
  fontScale: number
  dx: number
  dy: number
  rotation: number
  color?: string
  opacity: number
  /** per-glyph フォントファミリー（GlyphStyle.font 由来） */
  font?: string
  /** per-glyph ウェイト（GlyphStyle.weight 由来） */
  weight?: number
}

/** seed / index / salt から [0, 1) を返す決定論ハッシュ */
export function hash01(seed: number, index: number, salt: number): number {
  let h = (seed | 0) ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0xc2b2ae35, 0x27d4eb2d)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 0x100000000
}

/**
 * GlyphStyle.dy（Value）を解決する。数値ならそのまま px。{expr} なら、このグリフの
 * レイヤーの基準フォントサイズ（content.size。shrink-to-fit 適用後の値。このグリフ
 * 自身の classStyle/glyphStyle による sizeScale は含まない——team-lead 裁定「content.size
 * に対する比率」に合わせた基準点）を式スコープの `size` として評価する（例:
 * `{"expr": "size * 23 / 86"}` で shrink-to-fit 後も比率が保たれる）。
 * {var} はここでは未対応（perChar にテンプレ変数の束縛を引き回す設計が必要なため）。
 */
function resolveGlyphDy(dy: Value, baseContentSize: number): number {
  if (typeof dy === 'number') return dy
  if (typeof dy === 'string') {
    const n = parseFloat(dy)
    return Number.isFinite(n) ? n : 0
  }
  if ('expr' in dy) {
    return evalExprWithHas(dy.expr, { size: baseContentSize }, new Set(['size']))
  }
  return 0
}

function applyGlyphStyle(base: StaticGlyphStyle, style: GlyphStyle | undefined, mode: 'override' | 'compose', baseSize: number): void {
  if (!style) return
  if (style.sizeScale !== undefined) base.fontScale = mode === 'override' ? style.sizeScale : base.fontScale * style.sizeScale
  if (style.dx !== undefined) base.dx = mode === 'override' ? style.dx : base.dx + style.dx
  if (style.dy !== undefined) {
    const dyResolved = resolveGlyphDy(style.dy, baseSize)
    base.dy = mode === 'override' ? dyResolved : base.dy + dyResolved
  }
  if (style.rotation !== undefined) base.rotation = mode === 'override' ? style.rotation : base.rotation + style.rotation
  if (style.color !== undefined) base.color = style.color
  if (style.opacity !== undefined) base.opacity = mode === 'override' ? style.opacity : base.opacity * style.opacity
  // バイリンガル混植用フォント/ウェイト設定（後勝ち）
  if (style.font !== undefined) base.font = style.font
  if (style.weight !== undefined) base.weight = style.weight
}

function randomAmp(seed: number, index: number, salt: number, amp: number | undefined): number {
  if (amp === undefined) return 0
  return (hash01(seed, index, salt) - 0.5) * 2 * amp
}

/** grapheme 先頭コードポイントから文字クラスを判定する */
export function classifyGlyph(ch: string): GlyphClass {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return 'symbol'
  if (cp >= 0x3040 && cp <= 0x309f) return 'hiragana'
  if ((cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) return 'katakana'
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) return 'kanji'
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'latin'
  if (cp >= 0x30 && cp <= 0x39) return 'digit'
  return 'symbol'
}

function textStrokeOutset(content: ResolvedTextContent): number {
  if (content.strokes && content.strokes.length > 0) {
    return Math.max(...content.strokes.map(stroke => stroke.width))
  }
  return content.stroke?.width ?? 0
}

/**
 * 静的 per-glyph スタイルを合成する（ベース → classStyles → glyphStyles → randomize）。
 * baseSize はレイヤーの解決済みフォントサイズ（content.size。shrink-to-fit 後の値）で、
 * GlyphStyle.dy が Value（{expr}）のときの `size` スコープ解決に使う。
 */
function staticGlyphStyle(perChar: PerChar, ch: string, index: number, baseSize: number): StaticGlyphStyle {
  const style: StaticGlyphStyle = {
    fontScale: 1,
    dx: 0,
    dy: 0,
    rotation: 0,
    opacity: 1,
  }

  applyGlyphStyle(style, perChar.classStyles?.[classifyGlyph(ch)], 'override', baseSize)

  const glyphStyles = perChar.glyphStyles
  if (glyphStyles && glyphStyles.styles.length > 0) {
    const glyphStyle = glyphStyles.repeat
      ? glyphStyles.styles[index % glyphStyles.styles.length]
      : glyphStyles.styles[index]
    applyGlyphStyle(style, glyphStyle, 'override', baseSize)
  }

  const randomize = perChar.randomize
  if (randomize) {
    style.fontScale *= 1 + randomAmp(randomize.seed, index, 1, randomize.sizeAmp)
    style.dx += randomAmp(randomize.seed, index, 2, randomize.dxAmp)
    style.dy += randomAmp(randomize.seed, index, 3, randomize.dyAmp)
    style.rotation += randomAmp(randomize.seed, index, 4, randomize.rotAmp)
    if (style.color === undefined && randomize.palette && randomize.palette.length > 0) {
      const colorIndex = Math.floor(hash01(randomize.seed, index, 5) * randomize.palette.length)
      style.color = randomize.palette[colorIndex]
    }
  }

  style.opacity = Math.max(0, Math.min(1, style.opacity))
  return style
}

/**
 * 文字列を grapheme クラスタ単位で分割する
 * Intl.Segmenter が使えない環境では Array.from フォールバック
 */
export function splitGraphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(s), seg => seg.segment)
  }
  return Array.from(s)
}

/** Canvas 測定用の軽量コンテキスト取得 */
function getCtx2d(): { font: string; measureText: (s: string) => { width: number } } | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(1, 1)
      return oc.getContext('2d') as { font: string; measureText: (s: string) => { width: number } } | null
    }
    if (typeof document !== 'undefined') {
      return document.createElement('canvas').getContext('2d')
    }
  } catch {
    // ignore
  }
  return null
}

/** 文字分割 + 実測幅 + 字詰め結果（glyphTransforms と caretState で共有） */
interface GlyphLayout {
  chars: string[]
  charWidths: number[]
  /** 各グリフの開始 X（align 込み、anchor 原点基準の相対値） */
  glyphXPositions: number[]
  totalWidth: number
}

/** perChar 設定に従って本文を文字（または単語）配列へ分割する */
function splitContent(perChar: ResolvedLayer['perChar'], text: string): string[] {
  if (!perChar) return []
  return perChar.split === 'grapheme' ? splitGraphemes(text) : text.split(/\s+/).filter(Boolean)
}

/**
 * 文字を実測して字詰め X 座標を求める
 * @param content 解決済みテキストコンテンツ
 * @param chars 文字配列
 * @param fontScales per-glyph フォントスケール配列（省略時は全て 1）
 * @param glyphFonts per-glyph フォントファミリー配列（省略時はコンテンツのフォントを使う）
 * @param glyphWeights per-glyph ウェイト配列（省略時はコンテンツのウェイトを使う）
 * @param letterSpacing 字間（px）。advance に加算する
 */
function layoutGlyphs(
  content: ResolvedTextContent,
  chars: string[],
  fontScales?: number[],
  glyphFonts?: (string | undefined)[],
  glyphWeights?: (number | undefined)[],
  letterSpacing = 0,
): GlyphLayout {
  let charWidths: number[]
  const ctx2d = getCtx2d()
  if (ctx2d) {
    charWidths = chars.map((ch, index) => {
      const size = content.size * (fontScales?.[index] ?? 1)
      const font = glyphFonts?.[index] ?? content.font ?? 'system-ui'
      const weight = glyphWeights?.[index] ?? content.weight
      const fontStr = weight
        ? `${weight} ${size}px ${font}`
        : `${size}px ${font}`
      ctx2d.font = fontStr
      return ctx2d.measureText(ch).width
    })
  } else {
    charWidths = chars.map((ch, index) => ch.length * content.size * (fontScales?.[index] ?? 1) * 0.6)
  }

  // letterSpacing を advance に加算（最後の文字には加算しない）
  const spacedWidths = charWidths.map((w, i) =>
    i < chars.length - 1 ? w + letterSpacing : w,
  )

  const totalWidth = spacedWidths.reduce((a, b) => a + b, 0)
  const align = content.align ?? 'left'
  const strokeOutset = textStrokeOutset(content)

  const glyphXPositions: number[] = []
  let curX = strokeOutset
  if (align === 'center') curX = -totalWidth / 2
  else if (align === 'right') curX = -strokeOutset - totalWidth
  for (let i = 0; i < chars.length; i++) {
    glyphXPositions.push(curX)
    curX += spacedWidths[i]
  }

  return { chars, charWidths, glyphXPositions, totalWidth }
}

/** index 番目の文字の stagger 遅延（秒） */
function charDelay(perChar: NonNullable<ResolvedLayer['perChar']>, index: number, count: number): number {
  if (perChar.order === 'center-out') {
    const center = (count - 1) / 2
    return Math.abs(index - center) * perChar.stagger
  }
  return index * perChar.stagger
}

/**
 * レイヤーの各グリフの変形を計算する
 * @param layer 解決済みレイヤー（type='text' かつ perChar あり）
 * @param t 現在時刻（秒）
 * @param T preview の全体尺（秒）
 * @param timing 表示時間モデル
 * @returns グリフごとの変形データ配列
 */
export function glyphTransforms(
  layer: ResolvedLayer,
  t: number,
  T = Number.POSITIVE_INFINITY,
  timing?: Timing,
): GlyphTransform[] {
  const content = layer.content as ResolvedTextContent
  const perChar = layer.perChar
  if (!perChar) return []

  const chars = splitContent(perChar, content.text)
  if (chars.length === 0) return []

  const staticStyles = chars.map((ch, index) => staticGlyphStyle(perChar, ch, index, content.size))
  // letterSpacing は content.letterSpacing を使う（track 由来の上書きは drawPerChar 側で処理）
  const letterSpacing = content.letterSpacing ?? 0
  const { glyphXPositions } = layoutGlyphs(
    content,
    chars,
    staticStyles.map(style => style.fontScale),
    staticStyles.map(style => style.font),
    staticStyles.map(style => style.weight),
    letterSpacing,
  )
  const getDelay = (index: number): number => charDelay(perChar, index, chars.length)

  return chars.map((ch, index) => {
    const staticStyle = staticStyles[index]
    const delay = getDelay(index)
    const localT = t - delay

    let dx = staticStyle.dx
    let dy = staticStyle.dy
    let scale = 1
    let rotation = staticStyle.rotation
    let opacity = staticStyle.opacity
    let blur = 0

    for (const track of perChar.tracks) {
      let val: number
      if (trackPhaseHasStarted(track, localT, T, timing)) {
        val = sampleTrackInPhase(track, localT, T, timing)
      } else if ((track.phase ?? 'hold') === 'in' && track.keys.length > 0) {
        // stagger 待ちでまだ入場していない文字は「入場前の状態」（in 先頭キー）を保つ。
        // これにより未表示の文字がデフォルト値で先に見えてしまうのを防ぐ（typewriter の肝）。
        val = track.keys[0].v
      } else {
        // hold / out の未開始は何もしない（in アニメや hold 値を上書きしないため）
        continue
      }
      switch (track.prop) {
        case 'x': dx += val; break
        case 'y': dy += val; break
        case 'scale': scale = val; break
        case 'rotation': rotation = val; break
        case 'opacity': opacity = staticStyle.opacity * val; break
        case 'blur': blur = val; break
      }
    }

    const holdActive = phaseContains('hold', t, T, timing)
    const holdT = timing ? phaseLocalTime('hold', t, T, timing) : t

    // loop.float: サイン波で dy に加算
    if (holdActive && perChar.loop?.float) {
      const { amp, periodSec, phaseByIndex } = perChar.loop.float
      dy += amp * Math.sin((2 * Math.PI * holdT) / periodSec + index * phaseByIndex)
    }

    // loop.spin: rotation に加算（平面回転 = 2D tier）
    if (holdActive && perChar.loop?.spin) {
      rotation += perChar.loop.spin.degPerSec * holdT
    }

    // loop.shake: X 方向に高速往復（破損ネオン等）
    if (holdActive && perChar.loop?.shake) {
      const { ampX, periodSec } = perChar.loop.shake
      dx += ampX * Math.sin((2 * Math.PI * holdT) / periodSec + index * 1.2)
    }

    // loop.blink: 矩形波で opacity を high/low に切替（seed で非同期位相オフセット）
    if (holdActive && perChar.loop?.blink) {
      const { periodSec, low = 0, seed } = perChar.loop.blink
      const halfPeriod = periodSec / 2
      const phaseOffset = seed !== undefined ? (seed + index) * 0.618033 * halfPeriod : 0
      const blinkT = holdT + phaseOffset
      opacity = Math.floor(blinkT / halfPeriod) % 2 === 0 ? opacity : low
    }

    // active（カラオケ点灯）: グリフの開始時刻を過ぎたら active.color に切替
    let activeColor: string | undefined = staticStyle.color
    if (perChar.active) {
      const { color: activeCol, times } = perChar.active
      const startTime = times
        ? (times[index] ?? delay)
        : delay
      if (t >= startTime) {
        activeColor = activeCol
      }
    }

    return {
      ch,
      x: glyphXPositions[index],
      dx,
      dy,
      fontScale: staticStyle.fontScale,
      scale,
      rotation,
      opacity: Math.max(0, Math.min(1, opacity)),
      blur,
      color: activeColor,
      font: staticStyle.font,
      weight: staticStyle.weight,
    }
  })
}

/** 点滅カーソルの描画状態（anchor 原点基準の相対座標。drawPerChar が baseOffsetX 等を足す） */
export interface CaretState {
  /** カーソル開始 X（glyph.x と同じ基準） */
  x: number
  char: string
  color: string
  /** この瞬間に点灯しているか（点滅 off のとき false） */
  visible: boolean
}

/**
 * タイプライター用の点滅カーソルの状態を計算する。
 * perChar.caret 未設定 / center-out / 文字なしのときは null。
 * 打鍵中（まだ表示しきっていない）はカーソルを常時点灯し、
 * 打ち終わると blinkSec 周期で点滅させる。
 */
export function caretState(
  layer: ResolvedLayer,
  t: number,
  T = Number.POSITIVE_INFINITY,
  timing?: Timing,
): CaretState | null {
  const content = layer.content as ResolvedTextContent
  const perChar = layer.perChar
  if (!perChar?.caret) return null
  // カーソルは左→右の打鍵（ltr）専用
  if (perChar.order === 'center-out') return null

  const chars = splitContent(perChar, content.text)
  if (chars.length === 0) return null

  const staticStyles = chars.map((ch, index) => staticGlyphStyle(perChar, ch, index, content.size))
  const { charWidths, glyphXPositions } = layoutGlyphs(
    content,
    chars,
    staticStyles.map(style => style.fontScale),
    staticStyles.map(style => style.font),
    staticStyles.map(style => style.weight),
    content.letterSpacing ?? 0,
  )

  // 実際に描画されるグリフ（opacity>=0.5）の数 = 打鍵済み文字数。
  // glyphTransforms と同じ計算を使うので描画と必ず一致する。
  const glyphs = glyphTransforms(layer, t, T, timing)
  const typed = glyphs.reduce((n, g) => (g.opacity >= 0.5 ? n + 1 : n), 0)

  // カーソル X: 次に打つ文字の手前。打ち終わっていれば末尾。
  const caretX = typed < chars.length
    ? glyphXPositions[typed]
    : glyphXPositions[chars.length - 1] + charWidths[chars.length - 1]

  // 打鍵中は常時点灯、打ち終わったら点滅
  const typing = typed < chars.length
  const blinkSec = perChar.caret.blinkSec ?? 0.5
  const visible = typing ? true : Math.floor(t / blinkSec) % 2 === 0

  return {
    x: caretX,
    char: perChar.caret.char ?? '▋',
    color: perChar.caret.color ?? content.color,
    visible,
  }
}
