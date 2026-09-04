/**
 * カード言語の面・線・角丸トークン（シェル内側の画面が参照する唯一の出所）。
 *
 * 正本: `akari-video-internal:tasks/2026-09-05-shell-card-polish/spec.md`。
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
 * `hairline` は外周のおよそ半分（alpha ≒ .07）。直値を書かずに済ませるため
 * `color-mix` で外周の変数から派生させる（Chromium 111+ / 実機 142 で確認済み）。
 * ライトでは `--akari-line` が `rgba(0,0,0,.13)` になるので、派生も自動で黒側へ倒れる。
 */
export const AKARI_LINE = {
    /** カード内の区切り（レール仕切り・タブ下・セクション境）。 */
    hairline: 'color-mix(in srgb, var(--akari-line) 54%, transparent)',
    /** カード外周と同じ強さ。カードの中では原則使わない。 */
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
