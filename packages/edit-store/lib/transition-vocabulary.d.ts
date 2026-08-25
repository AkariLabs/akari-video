/**
 * edit.json の transition_out.type に使える正準語彙。
 * JSON Schema はリテラル enum を保つため別置きだが、drift test でこの表と一致させる。
 */
export declare const TRANSITION_VOCABULARY: readonly [{
    readonly id: "dissolve";
    readonly xfadeName: "dissolve";
    readonly labelJa: "ディゾルブ";
    readonly category: "フェード";
    readonly previewKind: "dissolve";
    readonly glyph: "D";
}, {
    readonly id: "fade";
    readonly xfadeName: "fade";
    readonly labelJa: "クロスフェード";
    readonly category: "フェード";
    readonly previewKind: "fade";
    readonly glyph: "F";
}, {
    readonly id: "fade-black";
    readonly xfadeName: "fadeblack";
    readonly labelJa: "黒フェード";
    readonly category: "フェード";
    readonly previewKind: "fade-black";
    readonly glyph: "B";
}, {
    readonly id: "fade-white";
    readonly xfadeName: "fadewhite";
    readonly labelJa: "白フェード";
    readonly category: "フェード";
    readonly previewKind: "fade-white";
    readonly glyph: "W";
}, {
    readonly id: "fade-grays";
    readonly xfadeName: "fadegrays";
    readonly labelJa: "モノクロフェード";
    readonly category: "フェード";
    readonly previewKind: "fade-grays";
    readonly glyph: "G";
}, {
    readonly id: "wipe-left";
    readonly xfadeName: "wipeleft";
    readonly labelJa: "ワイプ（左へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-left";
    readonly glyph: "←";
}, {
    readonly id: "wipe-right";
    readonly xfadeName: "wiperight";
    readonly labelJa: "ワイプ（右へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-right";
    readonly glyph: "→";
}, {
    readonly id: "wipe-up";
    readonly xfadeName: "wipeup";
    readonly labelJa: "ワイプ（上へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-up";
    readonly glyph: "↑";
}, {
    readonly id: "wipe-down";
    readonly xfadeName: "wipedown";
    readonly labelJa: "ワイプ（下へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-down";
    readonly glyph: "↓";
}, {
    readonly id: "radial";
    readonly xfadeName: "radial";
    readonly labelJa: "時計ワイプ";
    readonly category: "ワイプ";
    readonly previewKind: "radial";
    readonly glyph: "◷";
}, {
    readonly id: "slide-left";
    readonly xfadeName: "slideleft";
    readonly labelJa: "スライド（左へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-left";
    readonly glyph: "←";
}, {
    readonly id: "slide-right";
    readonly xfadeName: "slideright";
    readonly labelJa: "スライド（右へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-right";
    readonly glyph: "→";
}, {
    readonly id: "slide-up";
    readonly xfadeName: "slideup";
    readonly labelJa: "スライド（上へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-up";
    readonly glyph: "↑";
}, {
    readonly id: "slide-down";
    readonly xfadeName: "slidedown";
    readonly labelJa: "スライド（下へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-down";
    readonly glyph: "↓";
}, {
    readonly id: "cover-left";
    readonly xfadeName: "coverleft";
    readonly labelJa: "カバー（左へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-left";
    readonly glyph: "←";
}, {
    readonly id: "cover-right";
    readonly xfadeName: "coverright";
    readonly labelJa: "カバー（右へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-right";
    readonly glyph: "→";
}, {
    readonly id: "cover-up";
    readonly xfadeName: "coverup";
    readonly labelJa: "カバー（上へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-up";
    readonly glyph: "↑";
}, {
    readonly id: "cover-down";
    readonly xfadeName: "coverdown";
    readonly labelJa: "カバー（下へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-down";
    readonly glyph: "↓";
}, {
    readonly id: "reveal-left";
    readonly xfadeName: "revealleft";
    readonly labelJa: "リビール（左へ）";
    readonly category: "リビール";
    readonly previewKind: "reveal-left";
    readonly glyph: "←";
}, {
    readonly id: "reveal-right";
    readonly xfadeName: "revealright";
    readonly labelJa: "リビール（右へ）";
    readonly category: "リビール";
    readonly previewKind: "reveal-right";
    readonly glyph: "→";
}, {
    readonly id: "reveal-down";
    readonly xfadeName: "revealdown";
    readonly labelJa: "上からリビール";
    readonly category: "リビール";
    readonly previewKind: "reveal-down";
    readonly glyph: "↓";
}, {
    readonly id: "reveal-up";
    readonly xfadeName: "revealup";
    readonly labelJa: "下からリビール";
    readonly category: "リビール";
    readonly previewKind: "reveal-up";
    readonly glyph: "↑";
}, {
    readonly id: "circle-open";
    readonly xfadeName: "circleopen";
    readonly labelJa: "サークル（開く）";
    readonly category: "形状";
    readonly previewKind: "circle-open";
    readonly glyph: "○";
}, {
    readonly id: "circle-close";
    readonly xfadeName: "circleclose";
    readonly labelJa: "サークル（閉じる）";
    readonly category: "形状";
    readonly previewKind: "circle-close";
    readonly glyph: "●";
}, {
    readonly id: "zoom-in";
    readonly xfadeName: "zoomin";
    readonly labelJa: "ズームイン";
    readonly category: "変形";
    readonly previewKind: "zoom-in";
    readonly glyph: "＋";
}, {
    readonly id: "squeeze-h";
    readonly xfadeName: "squeezeh";
    readonly labelJa: "スクイーズ（縦つぶし）";
    readonly category: "変形";
    readonly previewKind: "squeeze-h";
    readonly glyph: "↕";
}, {
    readonly id: "squeeze-v";
    readonly xfadeName: "squeezev";
    readonly labelJa: "スクイーズ（横つぶし）";
    readonly category: "変形";
    readonly previewKind: "squeeze-v";
    readonly glyph: "↔";
}, {
    readonly id: "blur";
    readonly xfadeName: "hblur";
    readonly labelJa: "ブラー";
    readonly category: "質感";
    readonly previewKind: "blur";
    readonly glyph: "B";
}, {
    readonly id: "pixelize";
    readonly xfadeName: "pixelize";
    readonly labelJa: "ピクセレート";
    readonly category: "質感";
    readonly previewKind: "pixelize";
    readonly glyph: "P";
}];
export type TransitionDefinition = typeof TRANSITION_VOCABULARY[number];
export type TransitionType = TransitionDefinition['id'];
export type TransitionCategory = TransitionDefinition['category'];
export type TransitionPreviewKind = TransitionDefinition['previewKind'];
declare const unknownTransitionTypeBrand: unique symbol;
/** 読み取り側だけが保持する、schema より先行した未知種別。書き込み API には使わない。 */
export type UnknownTransitionType = string & {
    readonly [unknownTransitionTypeBrand]: true;
};
export type ReadableTransitionType = TransitionType | UnknownTransitionType;
export declare const TRANSITION_TYPE_IDS: readonly TransitionType[];
export declare const TRANSITION_CATEGORIES: readonly TransitionCategory[];
export declare const TRANSITION_BY_ID: Readonly<Record<TransitionType, TransitionDefinition>>;
export declare function isTransitionType(value: unknown): value is TransitionType;
export {};
