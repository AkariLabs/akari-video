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
    readonly family: "dissolve";
}, {
    readonly id: "fade";
    readonly xfadeName: "fade";
    readonly labelJa: "クロスフェード";
    readonly category: "フェード";
    readonly previewKind: "fade";
    readonly glyph: "F";
    readonly family: "fade";
}, {
    readonly id: "fade-black";
    readonly xfadeName: "fadeblack";
    readonly labelJa: "黒フェード";
    readonly category: "フェード";
    readonly previewKind: "fade-black";
    readonly glyph: "B";
    readonly family: "fade-black";
}, {
    readonly id: "fade-white";
    readonly xfadeName: "fadewhite";
    readonly labelJa: "白フェード";
    readonly category: "フェード";
    readonly previewKind: "fade-white";
    readonly glyph: "W";
    readonly family: "fade-white";
}, {
    readonly id: "fade-grays";
    readonly xfadeName: "fadegrays";
    readonly labelJa: "モノクロフェード";
    readonly category: "フェード";
    readonly previewKind: "fade-grays";
    readonly glyph: "G";
    readonly family: "fade-grays";
}, {
    readonly id: "wipe-left";
    readonly xfadeName: "wipeleft";
    readonly labelJa: "ワイプ（左へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-left";
    readonly glyph: "←";
    readonly family: "wipe";
    readonly direction: "left";
}, {
    readonly id: "wipe-right";
    readonly xfadeName: "wiperight";
    readonly labelJa: "ワイプ（右へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-right";
    readonly glyph: "→";
    readonly family: "wipe";
    readonly direction: "right";
}, {
    readonly id: "wipe-up";
    readonly xfadeName: "wipeup";
    readonly labelJa: "ワイプ（上へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-up";
    readonly glyph: "↑";
    readonly family: "wipe";
    readonly direction: "up";
}, {
    readonly id: "wipe-down";
    readonly xfadeName: "wipedown";
    readonly labelJa: "ワイプ（下へ）";
    readonly category: "ワイプ";
    readonly previewKind: "wipe-down";
    readonly glyph: "↓";
    readonly family: "wipe";
    readonly direction: "down";
}, {
    readonly id: "radial";
    readonly xfadeName: "radial";
    readonly labelJa: "時計ワイプ";
    readonly category: "ワイプ";
    readonly previewKind: "radial";
    readonly glyph: "◷";
    readonly family: "radial";
}, {
    readonly id: "slide-left";
    readonly xfadeName: "slideleft";
    readonly labelJa: "スライド（左へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-left";
    readonly glyph: "←";
    readonly family: "slide";
    readonly direction: "left";
}, {
    readonly id: "slide-right";
    readonly xfadeName: "slideright";
    readonly labelJa: "スライド（右へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-right";
    readonly glyph: "→";
    readonly family: "slide";
    readonly direction: "right";
}, {
    readonly id: "slide-up";
    readonly xfadeName: "slideup";
    readonly labelJa: "スライド（上へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-up";
    readonly glyph: "↑";
    readonly family: "slide";
    readonly direction: "up";
}, {
    readonly id: "slide-down";
    readonly xfadeName: "slidedown";
    readonly labelJa: "スライド（下へ）";
    readonly category: "スライド";
    readonly previewKind: "slide-down";
    readonly glyph: "↓";
    readonly family: "slide";
    readonly direction: "down";
}, {
    readonly id: "cover-left";
    readonly xfadeName: "coverleft";
    readonly labelJa: "カバー（左へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-left";
    readonly glyph: "←";
    readonly family: "cover";
    readonly direction: "left";
}, {
    readonly id: "cover-right";
    readonly xfadeName: "coverright";
    readonly labelJa: "カバー（右へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-right";
    readonly glyph: "→";
    readonly family: "cover";
    readonly direction: "right";
}, {
    readonly id: "cover-up";
    readonly xfadeName: "coverup";
    readonly labelJa: "カバー（上へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-up";
    readonly glyph: "↑";
    readonly family: "cover";
    readonly direction: "up";
}, {
    readonly id: "cover-down";
    readonly xfadeName: "coverdown";
    readonly labelJa: "カバー（下へ）";
    readonly category: "カバー";
    readonly previewKind: "cover-down";
    readonly glyph: "↓";
    readonly family: "cover";
    readonly direction: "down";
}, {
    readonly id: "reveal-left";
    readonly xfadeName: "revealleft";
    readonly labelJa: "リビール（左へ）";
    readonly category: "リビール";
    readonly previewKind: "reveal-left";
    readonly glyph: "←";
    readonly family: "reveal";
    readonly direction: "left";
}, {
    readonly id: "reveal-right";
    readonly xfadeName: "revealright";
    readonly labelJa: "リビール（右へ）";
    readonly category: "リビール";
    readonly previewKind: "reveal-right";
    readonly glyph: "→";
    readonly family: "reveal";
    readonly direction: "right";
}, {
    readonly id: "reveal-down";
    readonly xfadeName: "revealdown";
    readonly labelJa: "上からリビール";
    readonly category: "リビール";
    readonly previewKind: "reveal-down";
    readonly glyph: "↓";
    readonly family: "reveal";
    readonly direction: "down";
}, {
    readonly id: "reveal-up";
    readonly xfadeName: "revealup";
    readonly labelJa: "下からリビール";
    readonly category: "リビール";
    readonly previewKind: "reveal-up";
    readonly glyph: "↑";
    readonly family: "reveal";
    readonly direction: "up";
}, {
    readonly id: "circle-open";
    readonly xfadeName: "circleopen";
    readonly labelJa: "サークル（開く）";
    readonly category: "形状";
    readonly previewKind: "circle-open";
    readonly glyph: "○";
    readonly family: "circle";
    readonly direction: "open";
}, {
    readonly id: "circle-close";
    readonly xfadeName: "circleclose";
    readonly labelJa: "サークル（閉じる）";
    readonly category: "形状";
    readonly previewKind: "circle-close";
    readonly glyph: "●";
    readonly family: "circle";
    readonly direction: "close";
}, {
    readonly id: "zoom-in";
    readonly xfadeName: "zoomin";
    readonly labelJa: "ズームイン";
    readonly category: "変形";
    readonly previewKind: "zoom-in";
    readonly glyph: "＋";
    readonly family: "zoom-in";
}, {
    readonly id: "squeeze-h";
    readonly xfadeName: "squeezeh";
    readonly labelJa: "スクイーズ（縦つぶし）";
    readonly category: "変形";
    readonly previewKind: "squeeze-h";
    readonly glyph: "↕";
    readonly family: "squeeze";
    readonly direction: "h";
}, {
    readonly id: "squeeze-v";
    readonly xfadeName: "squeezev";
    readonly labelJa: "スクイーズ（横つぶし）";
    readonly category: "変形";
    readonly previewKind: "squeeze-v";
    readonly glyph: "↔";
    readonly family: "squeeze";
    readonly direction: "v";
}, {
    readonly id: "blur";
    readonly xfadeName: "hblur";
    readonly labelJa: "ブラー";
    readonly category: "質感";
    readonly previewKind: "blur";
    readonly glyph: "B";
    readonly family: "blur";
}, {
    readonly id: "pixelize";
    readonly xfadeName: "pixelize";
    readonly labelJa: "ピクセレート";
    readonly category: "質感";
    readonly previewKind: "pixelize";
    readonly glyph: "P";
    readonly family: "pixelize";
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
export type TransitionFamily = TransitionDefinition['family'];
export type TransitionDirection = 'left' | 'right' | 'up' | 'down' | 'open' | 'close' | 'h' | 'v';
export interface TransitionFamilyDefinition {
    readonly family: TransitionFamily;
    /** 向きを持たない family は空配列。 */
    readonly directions: readonly TransitionDirection[];
}
/** 選ぶ画面に並べる単位。向き違いを 1 つにまとめた 15 件で、順序は正準表の初出順。 */
export declare const TRANSITION_FAMILIES: readonly TransitionFamilyDefinition[];
export declare function transitionFamilyOf(type: unknown): {
    family: TransitionFamily;
    direction?: TransitionDirection;
} | undefined;
/** family と向きから保存用の type を引く。向きを持つ family に向きを渡さなければ undefined。 */
export declare function transitionTypeOf(family: unknown, direction?: unknown): TransitionType | undefined;
/** 辞書のキー。名前そのものは UI の辞書が持ち、ここは引き方だけを決める。 */
export declare function transitionFamilyLabelKey(family: string): string;
export declare function transitionDirectionLabelKey(direction: string): string;
export declare const TRANSITION_UNKNOWN_LABEL_KEY = "transition.family.label.unknown";
export declare const TRANSITION_NAME_WITH_DIRECTION_KEY = "transition.name.format.withDirection";
export {};
