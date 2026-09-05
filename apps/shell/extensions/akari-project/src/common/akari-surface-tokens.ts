/**
 * カード言語の面・線・角丸トークン（シェル内側の画面が参照する唯一の出所）。
 *
 * 正本: 内部リポ akari-video-internal のカード意匠 spec（2026-09-05）。
 * 外殻（4 枚のカードの隙間・角丸・ヘアライン）は akari-theme の
 * `akari-shell-card-layout.ts` が持つ。ここが決めるのは**カードの中身**だけ。
 *
 * 値は必ず `--akari-*` 変数の参照にする（直値を書くとライトテーマで壊れる）。
 * `--akari-*` は akari-theme の `akari-css-variable-force-contribution.ts` が
 * ダーク / ライト両方のパレットから供給するので、参照している限り両テーマで成立する。
 *
 * 変数名と役割の対応が 1 段ずれている点に注意（既存変数名を変えないための措置）:
 *   --akari-ground   = 地（#050505 / ライト #ececec）… カードの外
 *   --akari-bg       = カード面（#0a0a0a / #ffffff）
 *   --akari-card     = 持ち上げ面（#141414 / #f5f5f5）… ここでは raised と呼ぶ
 *   --akari-elevated = ホバー・選択（#1a1a1a / #e5e5e5）
 */

/** 面の階層（spec §1）。`ground` はカードの中には出さない。 */
export const AKARI_SURFACE = {
    /** カードの地。タブ帯・ペインの下地。 */
    card: 'var(--akari-bg)',
    /** カード内のパネル・リスト項目・入力欄・アクティブタブ。 */
    raised: 'var(--akari-card)',
    /** ホバー・選択。 */
    elevated: 'var(--akari-elevated)'
} as const;

/**
 * 線の階層（spec §2）。カード外周 `--akari-line`（alpha .13）が最強で、
 * **カードの中にはそれより強い線を置かない**。
 *
 * `hairline` の正は akari-theme が供給する **`--akari-line-inner`（不透明値）**。
 * フォールバックの `color-mix` は、その変数がまだ無いビルドのための保険で、
 * **カード面（`--akari-bg` = #0a0a0a）の上ではピクセル等価**（どちらも #1b1b1b）。
 *
 * 半透明ではなく不透明を正にしている理由（レーン A 指摘・実測で確認）:
 * 半透明の線は下地に乗って明るくなるので、raised（#141414）の上に置くと
 * 実効 #242424 まで浮き上がり、カード外周の実効値（card 面の上で #2a2a2a）と
 * ほぼ並んでしまう = 階層が成立しない。不透明 #1b1b1b ならどの面の上でも
 * 外周より確実に弱い。ライトは `--akari-line-inner` が #ededed へ入れ替わる。
 */
export const AKARI_LINE = {
    /** カード内の区切り（レール仕切り・タブ下・セクション境）。 */
    hairline: 'var(--akari-line-inner, color-mix(in srgb, var(--akari-line) 54%, transparent))',
    /** カード外周と同じ強さ。カードの中では原則使わない（浮くダイアログの輪郭のみ）。 */
    edge: 'var(--akari-line)',
    /** 選択・フォーカスを示す線（面ではなくアクセント色で示す）。 */
    accent: 'var(--akari-accent)'
} as const;

/** そのまま `border` / `borderBottom` へ渡せる 1px の形（spec §2: 線は必ず 1px）。 */
export const AKARI_BORDER = {
    hairline: `1px solid ${AKARI_LINE.hairline}`,
    edge: `1px solid ${AKARI_LINE.edge}`,
    accent: `1px solid ${AKARI_LINE.accent}`,
    /**
     * 枠を持たない項目・チップ（spec §2 の原則）。1px 分の寸法だけ残して線は描かない
     * ので、選択時に `borderColor` をアクセントへ差し替えてもレイアウトが動かない。
     */
    ghost: '1px solid transparent'
} as const;

/** 角丸（spec §3）。カード 12 / パネル・リスト項目・入力欄 8 / チップ・小ボタン・タブ 6。 */
export const AKARI_RADIUS = {
    card: 12,
    panel: 8,
    chip: 6
} as const;

/** 文字色。`--theia-editorWidget-foreground`(#cccccc) はパレット外なので使わない。 */
export const AKARI_INK = 'var(--akari-ink)';

/**
 * いちばん弱い前景（状態を示す小さな点・補助記号）。
 * `--akari-faint` が無いビルドでは `--theia-descriptionForeground`（実測 #717171 で
 * パレットの faint #737373 とほぼ同値）へ落ちる。
 */
export const AKARI_FAINT = 'var(--akari-faint, var(--theia-descriptionForeground))';
