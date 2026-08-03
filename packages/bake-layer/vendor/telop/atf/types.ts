// ATF（Akari Telop Format）型定義 v0.2
// 変数・式・実測を使ったレスポンシブテロップテンプレートのスキーマ

/** プロパティの三態: 定数 / 変数参照 / 式 */
export type Value = number | string | { var: string } | { expr: string }

/** テンプレート変数定義 */
export interface Variable {
  key: string
  /**
   * 'font' は 2026-08-03 拡張（fontFamily ツマミ）: 値は CSS フォントスタック文字列。
   * UI は options から選択制にする（同梱フォントだけを選ばせて環境差を出さないため）
   * 'select' は同日拡張（標準アニメツマミ）: 値は options 内の id 文字列。
   */
  type: 'text' | 'color' | 'number' | 'font' | 'select'
  label: string
  default: string | number
  /** UI / AI 操作面で同じ要素に属するツマミを束ねるグループ id */
  group?: string
  /** テンプレート間でツマミの意味を横断検索するための固定 role 語彙 */
  role?: string
  optional?: boolean
  /** type='font' / 'select' 用の選択肢。font は CSS stack、select は安定 id */
  options?: string[]
}

/** イージング種別 */
export type NamedEase = 'linear' | 'in-cubic' | 'out-cubic' | 'inout-cubic' | 'out-back' | 'step'
export type CubicBezierEase = `cubic-bezier(${string})`
export type StepsEase = `steps(${string})`
export type Ease = NamedEase | CubicBezierEase | StepsEase

/** アニメーションキーフレーム */
export interface Key {
  t: number
  v: number
  ease?: Ease
}

export type FilterKind =
  | 'brightness'
  | 'contrast'
  | 'hue-rotate'
  | 'saturate'
  | 'sepia'
  | 'grayscale'
  | 'invert'
  | 'blur'

export type FilterTrackProp =
  | `filter.${FilterKind}`
  | `filter.${number}.value`

export type ShadowTrackProp =
  | `shadow.${'blur' | 'x' | 'y' | 'offsetX' | 'offsetY' | 'colorT'}`
  | `shadow.${number}.${'blur' | 'x' | 'y' | 'offsetX' | 'offsetY' | 'colorT'}`
  | `shadows.${number}.${'blur' | 'x' | 'y' | 'offsetX' | 'offsetY' | 'colorT'}`

export type ClipTrackProp =
  | 'clip.top'
  | 'clip.right'
  | 'clip.bottom'
  | 'clip.left'
  | 'clip.cx'
  | 'clip.cy'
  | 'clip.x'
  | 'clip.y'
  | 'clip.r'
  | 'clip.radius'
  | `clip.polygon.${number}.x`
  | `clip.polygon.${number}.y`

export type GradientTrackProp =
  | 'gradient.offset'
  | 'fill.offset'
  | 'fillGradient.offset'
  | `strokes.${number}.gradient.offset`

export type TextColorTrackProp = 'colorT' | 'color.t'

export type TrackProp =
  | 'x'
  | 'y'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'skewX'
  | 'skewY'
  | 'originX'
  | 'originY'
  | 'rotateX'
  | 'rotateY'
  | 'perspectiveZ'
  | 'opacity'
  | 'blur'
  | 'wipe'
  | 'letterSpacing'
  | 'weight'
  | 'counter'
  | FilterTrackProp
  | ShadowTrackProp
  | ClipTrackProp
  | GradientTrackProp
  | TextColorTrackProp

/** 表示時間モデル */
export interface Timing {
  inDur: number
  outDur: number
  hold: 'stretch' | 'fixed'
  holdDur?: number
  previewTotal: number
  /**
   * true のとき hold フェーズを holdDur を周期としてループ再生する（CapCut のループ相当）。
   * hold ウィンドウは in/out の間の全域に広がり、その中で holdDur 周期で繰り返す。
   * 未指定/false のときは従来動作（1 回再生して静止）。
   */
  loopHold?: boolean
}

/** アニメーショントラック */
export interface Track {
  prop: TrackProp
  phase?: 'in' | 'hold' | 'out'
  keys: Key[]
}

/** per-character アニメーション設定 */
export interface GlyphStyle {
  /** フォントサイズ倍率（既定 1） */
  sizeScale?: number
  /** 静的 X オフセット(px) */
  dx?: number
  /**
   * 静的 Y オフセット。数値なら従来通り固定 px。Value（{expr}）を渡すと、レイヤーの
   * 基準フォントサイズ（content.size。shrink-to-fit 適用後の値。このグリフ自身の
   * sizeScale は含まない）を式スコープ変数 `size` として参照できる（例:
   * `{"expr": "size * 23 / 86"}` で content.size に比例したオフセットになり、
   * shrink-to-fit で縮小しても比率が保たれる）。
   * `{var: ...}`（テンプレ変数参照）は非対応（perChar 側にテンプレ変数の束縛を
   * 引き回す設計が必要になるため、2026-07-22 dy-ratio-fix では対象外）。
   */
  dy?: Value
  /** 静的回転(deg) */
  rotation?: number
  /** per-glyph 色（リテラルのみ。変数/式は P1 対象外） */
  color?: string
  /** 静的不透明度倍率 0..1 */
  opacity?: number
  /** per-glyph フォントファミリー上書き（バイリンガル混植用）*/
  font?: string
  /** per-glyph ウェイト上書き（100-900）*/
  weight?: number
}

export type GlyphClass = 'hiragana' | 'katakana' | 'kanji' | 'latin' | 'digit' | 'symbol'

export interface PerCharRandomize {
  seed: number
  /** sizeScale を ±sizeAmp 倍率で揺らす（0.25 = ±25%） */
  sizeAmp?: number
  /** X ジッター振幅(px) */
  dxAmp?: number
  /** Y ジッター振幅(px) */
  dyAmp?: number
  /** 回転ジッター振幅(deg) */
  rotAmp?: number
  /** index 決定論で色を選ぶ */
  palette?: string[]
}

export interface PerChar {
  split: 'grapheme' | 'word'
  stagger: number
  order?: 'ltr' | 'center-out'
  tracks: Track[]
  glyphStyles?: {
    repeat?: boolean
    styles: GlyphStyle[]
  }
  classStyles?: Partial<Record<GlyphClass, GlyphStyle>>
  randomize?: PerCharRandomize
  loop?: {
    float?: { amp: number; periodSec: number; phaseByIndex: number }
    spin?: { degPerSec: number }
    /** X 方向の高速往復（破損ネオン等に） */
    shake?: { ampX: number; periodSec: number }
    /** 矩形波点滅（opacity を high/low で交互切替） */
    blink?: { periodSec: number; low?: number; seed?: number }
  }
  /**
   * カラオケ点灯設定。各グリフの開始時刻を過ぎたら active.color に切替える。
   */
  active?: {
    color: string
    mode?: 'flash'
    /** グリフ開始時刻（秒）の配列。省略時は stagger 由来の遅延を使う */
    times?: number[]
  }
  /**
   * タイプライター用の点滅カーソル。
   * 打鍵位置（まだ表示されていない最初の文字の手前）に表示され、
   * 打ち終わると末尾で点滅して待機する。order='ltr' 前提。
   */
  caret?: {
    /** カーソル文字（既定 '▋'。'|' や '_' も可） */
    char?: string
    /** 点滅 1 周期の半分（秒、既定 0.5）。打鍵中は常時点灯し打ち終わってから点滅する */
    blinkSec?: number
    /** カーソル色（リテラルのみ。省略時は本文色を使う） */
    color?: string
  }
}

/** 再利用可能な入退場エフェクトのフェーズ */
export type EffectPhase = 'in' | 'out'

/** per-character エフェクトが指定する文字分割・遅延設定 */
export type EffectPerChar = Omit<PerChar, 'tracks'>

/** phase 付き track 束を名前付きで再利用するエフェクト */
export interface Effect {
  id: string
  name: string
  phase: EffectPhase
  perChar?: EffectPerChar
  tracks: Track[]
}

/** テキストコンテンツ */
export interface ColorRamp {
  stops: { at: number; color: Value }[]
  mode?: 'rgb' | 'step'
}

export interface GradientFill {
  type: 'linear-v' | 'linear-h'
  stops: { at: number; color: Value }[]
  /** 位置オフセット（0..1）。Track.prop='gradient.offset' で時間制御できる */
  offset?: Value
  /**
   * シマー（ハイライト帯スウィープ）設定。
   * periodSec 周期で白いハイライト帯が左→右へ流れる。
   */
  shimmer?: {
    /** スウィープ周期（秒） */
    periodSec: number
    /** ハイライト帯の幅（0..1、全幅比。既定 0.25） */
    width?: number
    /** ハイライト色（既定 rgba(255,255,255,0.85)） */
    color?: string
  }
}

export type PatternKind = 'dots' | 'stripes' | 'check' | 'diamond' | 'hearts' | 'stars' | 'hazard'

/**
 * 文字内を敷き詰める柄塗り（ドット/ストライプ/チェック/ダイヤ/ハート/星/危険ハザード）。
 * fill（グラデ）より優先して文字の塗りに使われる。タイルを生成し createPattern('repeat') で塗る。
 */
export interface PatternFill {
  kind: PatternKind
  /** 柄（モチーフ）の色 */
  color: Value
  /** 下地色（省略時は透明＝下の通常塗りが透ける） */
  bg?: Value
  /** タイル倍率（既定 1） */
  scale?: Value
  /** 回転角（度・stripes/hazard 等で使用。既定 0） */
  angle?: Value
}

export interface TextStrokeSpec {
  color: Value
  /** 縁の太さ（px）。Value で変数・式による調整が可能 */
  width: Value
  /** 縁そのものにグラデをかける（strokeStyle に gradient を渡す） */
  fill?: GradientFill
}
/** blur/x/y も Value で変数・式による調整が可能 */
export interface TextShadow {
  color: Value
  blur: Value
  x: Value
  y: Value
  /** Track.prop='shadow(s).N.colorT' で stops 上を移動する */
  colorRamp?: ColorRamp
}

export interface FilterSpec {
  kind: FilterKind
  value: Value
}

export type ClipInsetSpec = {
  type: 'inset'
  /** 各辺から隠す割合（0..1）。Track.prop='clip.top' などで上書き可能 */
  top?: Value
  right?: Value
  bottom?: Value
  left?: Value
}

export type ClipPolygonSpec = {
  type: 'polygon'
  /** レイヤー内の相対座標（0..1） */
  points: { x: Value; y: Value }[]
}

export type ClipCircleSpec = {
  type: 'circle'
  /** 中心は相対座標（0..1）、半径はレイヤー対角基準の割合 */
  cx: Value
  cy: Value
  r: Value
}

export type ClipSpec = ClipInsetSpec | ClipPolygonSpec | ClipCircleSpec

export interface TextContent {
  text: Value
  /** フォントサイズ（px）。Value で変数・式による動的サイズ変更が可能 */
  size: Value
  /** CSS フォントスタック。Value 化（2026-08-03）で fontFamily ツマミ（type='font' 変数）を参照できる */
  font?: Value
  /** フォントウェイト（100〜900）。Value 化（2026-08-03）で fontWeight ツマミを参照できる */
  weight?: Value
  color: Value
  /** `**…**` で指定した強調ランへ適用するスタイル（全フィールド Value）。 */
  emphasisStyle?: {
    /** 省略時は本文色 */
    color?: Value
    /** 本文 font size に対する倍率。省略時は 1 */
    scale?: Value
    /** 省略時は本文 weight */
    weight?: Value
  }
  /** Track.prop='colorT' で stops 上を移動する本文色アニメーション */
  colorRamp?: ColorRamp
  align?: 'left' | 'center' | 'right'
  /**
   * 縦書き（縦組み）。true で文字を上→下、列を右→左（\n が列区切り）に並べる。
   * レイアウトは fontSize 基準の固定送り（字送り = size + letterSpacing、列送り = size × 1.2）。
   * レイヤーの transform/filter/shadow アニメはブロック全体に従来どおり適用される。
   */
  vertical?: boolean
  stroke?: { color: Value; width: Value }
  fill?: GradientFill
  /** 柄塗り（ドット/ストライプ等）。fill より優先して文字塗りに使う。 */
  patternFill?: PatternFill
  strokes?: TextStrokeSpec[]
  shadow?: TextShadow
  /**
   * 多重シャドウ（shadows 優先。shadow と併存可）。
   * 各 shadow に対して fill を 1 回描画し、最後に通常の描画を行う。
   */
  shadows?: TextShadow[]
  /**
   * 内側シャドウ（グリフ内側に落ちる影）。多重可。fill の上に source-atop で内側だけ描く。
   * 単一テキストレイヤ（透明背景上）前提。複合 doc で text の下に不透明レイヤがあると被る。
   */
  innerShadows?: TextShadow[]
  /** 内側光彩（グリフ内側のグロー）。offset 0 の内側シャドウに相当。 */
  innerGlow?: { color: Value; blur: Value }
  /** 簡易ベベル（左上ハイライト＋右下シャドウの内側2パスで立体感を出す）。 */
  bevel?: { light: Value; dark: Value; size: Value }
  /**
   * 字間（px）。Track.prop='letterSpacing' で上書き可能。
   * canvas2d では ctx.letterSpacing、perChar では advance に加算する。
   */
  letterSpacing?: Value
  /**
   * カウンター設定。テキストの代わりに進行に応じた数値を描画する。
   * Track.prop='counter'（0..1）で進行を制御。track なしは常に終値を表示。
   */
  counter?: {
    /** 開始値・終了値は Value で変数バインド可能（価格・スコア等の差し替え用） */
    from: Value
    to: Value
    decimals?: number
    prefix?: string
    suffix?: string
    useGrouping?: boolean
  }
}

/**
 * 割れガラスのヒビ装飾パラメータ（amix「BAKI BAKI 合成」を踏襲）。
 * 衝撃点から放射状クラック + 同心円クラックを決定論的に描く。
 */
export interface CrackParams {
  /** 衝撃点（レイヤー内の相対座標 0..1） */
  impact?: { x: number; y: number }
  /** 放射クラックの本数 */
  radial?: number
  /** 同心円クラック（破片境界）の本数 */
  concentric?: number
  /** ヒビの広がり半径（0..1、レイヤー対角の半分が 1.0 基準） */
  spread?: number
  /** 破片の歪み量（0..1。大きいほどギザギザ） */
  jitter?: number
  /** ヒビ色 */
  color: Value
  /** 線の太さ(px) */
  width?: number
  /** ヒビ全体の不透明度 0..1 */
  opacity?: number
  /** 決定的描画のシード（同じ値なら毎フレーム同じヒビ） */
  seed?: number
}

/** star shape 追加設定 */
export interface StarParams {
  /** 頂点（ギザ数）の数。既定 12 */
  points?: number
  /** 内円比率（0..1、既定 0.5） */
  innerRatio?: number
}

/** 吹き出しの尻尾設定 */
export interface CalloutTail {
  side: 'bottom' | 'top' | 'left' | 'right'
  /** 尻尾の付け根の位置（辺上の 0..1。既定 0.5） */
  at?: number
  /** 尻尾の底辺幅（px） */
  w?: number
  /** 尻尾の高さ（px） */
  h?: number
}

/** シェイプコンテンツ（矩形帯 / 割れガラスヒビ / スター） */
export interface ShapeContent {
  shape: 'rect' | 'crack' | 'star'
  fill: Value
  /** shape にグラデをかける（fill より優先。shimmer も有効） */
  fillGradient?: GradientFill
  cornerRadius?: number
  /** shape='crack' のときのヒビ設定 */
  crack?: CrackParams
  /** shape='star' のときのギザギザ設定 */
  star?: StarParams
  /** 吹き出しの尻尾（rect 系に付加する三角） */
  calloutTail?: CalloutTail
}

/** ATF レイヤー */
export interface AtfLayer {
  id: string
  type: 'text' | 'shape'
  content: TextContent | ShapeContent
  transform: {
    x: Value
    y: Value
    anchor: { x: number; y: number }
    rotation?: Value
    opacity?: Value
    /** X 方向の傾き（度）。ctx.transform で rotation と併用可能 */
    skewX?: Value
    /** Y 方向の傾き（度）。ctx.transform で rotation と併用可能 */
    skewY?: Value
  }
  size?: { w: Value; h: Value }
  tracks?: Track[]
  perChar?: PerChar
  visibleIf?: { expr: string }
  /** Canvas filter チェーン。各 value は filter.* track で上書き可能 */
  filters?: FilterSpec[]
  /** wipe より汎用的な clip-path 相当のクリップ */
  clip?: ClipSpec
  /**
   * 静的装飾（filters / clip / content.shadows）を適用するフェーズを限定する。
   * 指定すると、そのフェーズがアクティブな間だけ装飾を描画し、それ以外は素のテキストを描く。
   * 複数スロット合成（in/out/loop）で、ある 1 スロットの装飾（残像グロー等）が
   * 他フェーズへ漏れ出すのを防ぐために使う。未指定なら従来どおり全フレーム装飾を描画。
   *   - 'in'   : t <= inEnd の間のみ装飾
   *   - 'hold' : t >= inEnd の間のみ装飾（登場フェーズでは抑止）
   *   - 'out'  : t >= outStart の間のみ装飾
   */
  decorPhase?: 'in' | 'hold' | 'out'
  /**
   * ワイプ（クリップ）設定。Track.prop='wipe'（0..1）で表示割合を制御する。
   * wipe track がなければクリップなし（従来動作）。
   */
  wipe?: {
    axis: 'x' | 'y'
    from?: 'start' | 'end'
  }
  /**
   * テキストの安全域収縮（shrink-to-fit）設定。text レイヤーにのみ適用（2026-07-22
   * telop-tunables タスクで追加。vendor/PROVENANCE.md 参照）。
   * 指定が無くても全 text レイヤーは常にキャンバス安全域（stage 寸法比のマージン、
   * anchor 基準）に収まるよう自動でフォントサイズを縮小する。ここで maxWidth/maxHeight を
   * 指定すると、それよりタイトな安全域（例: バッジ枠内に収める）を追加で強制できる。
   */
  fit?: {
    /** テキストブロックの最大幅（px、ストローク太さ込み）。Value 可（変数・式） */
    maxWidth?: Value
    /** テキストブロックの最大高さ（px、ストローク太さ込み）。Value 可 */
    maxHeight?: Value
    /** 縮小してよい下限（元サイズに対する倍率、既定 0.3 = 30%まで） */
    minScale?: number
  }
}

/** ステージ設定 */
export interface Stage {
  width: number
  height: number
  fps: number
  duration: number
  bg: string
  byAspect?: Record<string, { width: number; height: number }>
}

/** ATF ドキュメント（テンプレート本体） */
export interface AtfDoc {
  format: 'atf'
  version: '0.1' | '0.2'
  id: string
  kind: 'lower-third' | 'caption' | 'popup' | 'corner' | 'free'
  stage: Stage
  timing?: Timing
  /** variables の表示・操作単位。旧テンプレートとの互換のため optional */
  groups?: Array<{ id: string; label: string }>
  /** テンプレート全体 bbox 上の 9 点アンカー。旧 doc との互換のため optional */
  anchor?: 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
  variables: Variable[]
  layers: AtfLayer[]
}

// === 解決済み型 ===

export interface ResolvedColorRamp {
  stops: { at: number; color: string }[]
  mode?: 'rgb' | 'step'
}

/** 解決済みグラデーションフィル */
export interface ResolvedGradientFill {
  type: 'linear-v' | 'linear-h'
  stops: { at: number; color: string }[]
  offset?: number
  shimmer?: {
    periodSec: number
    width?: number
    color?: string
  }
}

export interface ResolvedTextShadow {
  color: string
  blur: number
  x: number
  y: number
  colorRamp?: ResolvedColorRamp
}

/** 解決済みテキストコンテンツ（測定済み幅/高さを含む） */
export interface ResolvedTextContent {
  text: string
  /** マーカー除去後テキスト上の強調範囲。強調スタイル宣言時だけ保持する。 */
  runs?: { start: number; end: number; emphasis: boolean }[]
  emphasisStyle?: {
    /** 明示指定時だけ保持。省略時は本文の fill / pattern を含む見た目を継承する。 */
    color?: string
    scale: number
    weight?: number
  }
  size: number
  font?: string
  weight?: number
  color: string
  colorRamp?: ResolvedColorRamp
  align?: 'left' | 'center' | 'right'
  /** 縦書き（縦組み）。TextContent.vertical の素通し */
  vertical?: boolean
  stroke?: { color: string; width: number }
  fill?: ResolvedGradientFill
  patternFill?: { kind: PatternKind; color: string; bg?: string; scale: number; angle: number }
  strokes?: { color: string; width: number; fill?: ResolvedGradientFill }[]
  shadow?: ResolvedTextShadow
  shadows?: ResolvedTextShadow[]
  innerShadows?: ResolvedTextShadow[]
  innerGlow?: { color: string; blur: number }
  bevel?: { light: string; dark: string; size: number }
  measuredWidth: number
  measuredHeight: number
  /** 解決済み字間（px）。未指定は 0 */
  letterSpacing?: number
  /** カウンター設定（解決済み）。あれば text の代わりに数値を描画する */
  counter?: {
    from: number
    to: number
    decimals: number
    prefix: string
    suffix: string
    useGrouping: boolean
  }
}

export interface ResolvedFilterSpec {
  kind: FilterKind
  value: number
}

export type ResolvedClipInsetSpec = {
  type: 'inset'
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export type ResolvedClipPolygonSpec = {
  type: 'polygon'
  points: { x: number; y: number }[]
}

export type ResolvedClipCircleSpec = {
  type: 'circle'
  cx: number
  cy: number
  r: number
}

export type ResolvedClipSpec = ResolvedClipInsetSpec | ResolvedClipPolygonSpec | ResolvedClipCircleSpec

/** 解決済みヒビパラメータ（全項目が具体値） */
export interface ResolvedCrackParams {
  impact: { x: number; y: number }
  radial: number
  concentric: number
  spread: number
  jitter: number
  color: string
  width: number
  opacity: number
  seed: number
}

/** 解決済みシェイプコンテンツ */
export interface ResolvedShapeContent {
  shape: 'rect' | 'crack' | 'star'
  fill: string
  fillGradient?: ResolvedGradientFill
  cornerRadius?: number
  crack?: ResolvedCrackParams
  star?: StarParams
  calloutTail?: CalloutTail
}

/** 解決済みレイヤー（全プロパティが具体値） */
export interface ResolvedLayer {
  id: string
  type: 'text' | 'shape'
  content: ResolvedTextContent | ResolvedShapeContent
  transform: {
    x: number
    y: number
    anchor: { x: number; y: number }
    rotation: number
    opacity: number
    /** X 方向の傾き（度）。省略時は 0（傾きなし） */
    skewX?: number
    /** Y 方向の傾き（度）。省略時は 0（傾きなし） */
    skewY?: number
  }
  size: { w: number; h: number }
  tracks?: Track[]
  perChar?: PerChar
  filters?: ResolvedFilterSpec[]
  clip?: ResolvedClipSpec
  /** 静的装飾を適用するフェーズの限定（AtfLayer.decorPhase の素通し） */
  decorPhase?: 'in' | 'hold' | 'out'
  /** ワイプ（クリップ）設定。wipe track がある場合に描画側が参照する */
  wipe?: {
    axis: 'x' | 'y'
    from: 'start' | 'end'
  }
}

/** 解決済みシーン */
export interface ResolvedScene {
  stage: {
    width: number
    height: number
    fps: number
    duration: number
    bg: string
  }
  timing?: Timing
  layers: ResolvedLayer[]
}
