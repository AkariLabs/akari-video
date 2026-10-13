/**
 * edit.json の transition_out.type に使える正準語彙。
 * JSON Schema はリテラル enum を保つため別置きだが、drift test でこの表と一致させる。
 */
export const TRANSITION_VOCABULARY = [
    { id: 'dissolve', xfadeName: 'dissolve', labelJa: 'ディゾルブ', category: 'フェード', previewKind: 'dissolve', glyph: 'D', family: 'dissolve' },
    { id: 'fade', xfadeName: 'fade', labelJa: 'クロスフェード', category: 'フェード', previewKind: 'fade', glyph: 'F', family: 'fade' },
    { id: 'fade-black', xfadeName: 'fadeblack', labelJa: '黒フェード', category: 'フェード', previewKind: 'fade-black', glyph: 'B', family: 'fade-black' },
    { id: 'fade-white', xfadeName: 'fadewhite', labelJa: '白フェード', category: 'フェード', previewKind: 'fade-white', glyph: 'W', family: 'fade-white' },
    { id: 'fade-grays', xfadeName: 'fadegrays', labelJa: 'モノクロフェード', category: 'フェード', previewKind: 'fade-grays', glyph: 'G', family: 'fade-grays' },
    { id: 'wipe-left', xfadeName: 'wipeleft', labelJa: 'ワイプ（左へ）', category: 'ワイプ', previewKind: 'wipe-left', glyph: '←', family: 'wipe', direction: 'left' },
    { id: 'wipe-right', xfadeName: 'wiperight', labelJa: 'ワイプ（右へ）', category: 'ワイプ', previewKind: 'wipe-right', glyph: '→', family: 'wipe', direction: 'right' },
    { id: 'wipe-up', xfadeName: 'wipeup', labelJa: 'ワイプ（上へ）', category: 'ワイプ', previewKind: 'wipe-up', glyph: '↑', family: 'wipe', direction: 'up' },
    { id: 'wipe-down', xfadeName: 'wipedown', labelJa: 'ワイプ（下へ）', category: 'ワイプ', previewKind: 'wipe-down', glyph: '↓', family: 'wipe', direction: 'down' },
    { id: 'radial', xfadeName: 'radial', labelJa: '時計ワイプ', category: 'ワイプ', previewKind: 'radial', glyph: '◷', family: 'radial' },
    { id: 'slide-left', xfadeName: 'slideleft', labelJa: 'スライド（左へ）', category: 'スライド', previewKind: 'slide-left', glyph: '←', family: 'slide', direction: 'left' },
    { id: 'slide-right', xfadeName: 'slideright', labelJa: 'スライド（右へ）', category: 'スライド', previewKind: 'slide-right', glyph: '→', family: 'slide', direction: 'right' },
    { id: 'slide-up', xfadeName: 'slideup', labelJa: 'スライド（上へ）', category: 'スライド', previewKind: 'slide-up', glyph: '↑', family: 'slide', direction: 'up' },
    { id: 'slide-down', xfadeName: 'slidedown', labelJa: 'スライド（下へ）', category: 'スライド', previewKind: 'slide-down', glyph: '↓', family: 'slide', direction: 'down' },
    { id: 'cover-left', xfadeName: 'coverleft', labelJa: 'カバー（左へ）', category: 'カバー', previewKind: 'cover-left', glyph: '←', family: 'cover', direction: 'left' },
    { id: 'cover-right', xfadeName: 'coverright', labelJa: 'カバー（右へ）', category: 'カバー', previewKind: 'cover-right', glyph: '→', family: 'cover', direction: 'right' },
    { id: 'cover-up', xfadeName: 'coverup', labelJa: 'カバー（上へ）', category: 'カバー', previewKind: 'cover-up', glyph: '↑', family: 'cover', direction: 'up' },
    { id: 'cover-down', xfadeName: 'coverdown', labelJa: 'カバー（下へ）', category: 'カバー', previewKind: 'cover-down', glyph: '↓', family: 'cover', direction: 'down' },
    { id: 'reveal-left', xfadeName: 'revealleft', labelJa: 'リビール（左へ）', category: 'リビール', previewKind: 'reveal-left', glyph: '←', family: 'reveal', direction: 'left' },
    { id: 'reveal-right', xfadeName: 'revealright', labelJa: 'リビール（右へ）', category: 'リビール', previewKind: 'reveal-right', glyph: '→', family: 'reveal', direction: 'right' },
    { id: 'reveal-down', xfadeName: 'revealdown', labelJa: '上からリビール', category: 'リビール', previewKind: 'reveal-down', glyph: '↓', family: 'reveal', direction: 'down' },
    { id: 'reveal-up', xfadeName: 'revealup', labelJa: '下からリビール', category: 'リビール', previewKind: 'reveal-up', glyph: '↑', family: 'reveal', direction: 'up' },
    { id: 'circle-open', xfadeName: 'circleopen', labelJa: 'サークル（開く）', category: '形状', previewKind: 'circle-open', glyph: '○', family: 'circle', direction: 'open' },
    { id: 'circle-close', xfadeName: 'circleclose', labelJa: 'サークル（閉じる）', category: '形状', previewKind: 'circle-close', glyph: '●', family: 'circle', direction: 'close' },
    { id: 'zoom-in', xfadeName: 'zoomin', labelJa: 'ズームイン', category: '変形', previewKind: 'zoom-in', glyph: '＋', family: 'zoom-in' },
    { id: 'squeeze-h', xfadeName: 'squeezeh', labelJa: 'スクイーズ（縦つぶし）', category: '変形', previewKind: 'squeeze-h', glyph: '↕', family: 'squeeze', direction: 'h' },
    { id: 'squeeze-v', xfadeName: 'squeezev', labelJa: 'スクイーズ（横つぶし）', category: '変形', previewKind: 'squeeze-v', glyph: '↔', family: 'squeeze', direction: 'v' },
    { id: 'blur', xfadeName: 'hblur', labelJa: 'ブラー', category: '質感', previewKind: 'blur', glyph: 'B', family: 'blur' },
    { id: 'pixelize', xfadeName: 'pixelize', labelJa: 'ピクセレート', category: '質感', previewKind: 'pixelize', glyph: 'P', family: 'pixelize' }
] as const;

export type TransitionDefinition = typeof TRANSITION_VOCABULARY[number];
export type TransitionType = TransitionDefinition['id'];
export type TransitionCategory = TransitionDefinition['category'];
export type TransitionPreviewKind = TransitionDefinition['previewKind'];
declare const unknownTransitionTypeBrand: unique symbol;
/** 読み取り側だけが保持する、schema より先行した未知種別。書き込み API には使わない。 */
export type UnknownTransitionType = string & { readonly [unknownTransitionTypeBrand]: true };
export type ReadableTransitionType = TransitionType | UnknownTransitionType;

export const TRANSITION_TYPE_IDS: readonly TransitionType[] =
    TRANSITION_VOCABULARY.map(entry => entry.id);

export const TRANSITION_CATEGORIES: readonly TransitionCategory[] =
    [...new Set(TRANSITION_VOCABULARY.map(entry => entry.category))];

export const TRANSITION_BY_ID: Readonly<Record<TransitionType, TransitionDefinition>> =
    Object.fromEntries(TRANSITION_VOCABULARY.map(entry => [entry.id, entry])) as
        unknown as Readonly<Record<TransitionType, TransitionDefinition>>;

export function isTransitionType(value: unknown): value is TransitionType {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRANSITION_BY_ID, value);
}

export type TransitionFamily = TransitionDefinition['family'];
export type TransitionDirection = 'left' | 'right' | 'up' | 'down' | 'open' | 'close' | 'h' | 'v';

export interface TransitionFamilyDefinition {
    readonly family: TransitionFamily;
    /** 向きを持たない family は空配列。 */
    readonly directions: readonly TransitionDirection[];
}

const TRANSITION_DIRECTION_ORDER: readonly TransitionDirection[] =
    ['left', 'right', 'up', 'down', 'open', 'close', 'h', 'v'];

function directionOfEntry(entry: TransitionDefinition): TransitionDirection | undefined {
    return 'direction' in entry ? entry.direction : undefined;
}

/** 選ぶ画面に並べる単位。向き違いを 1 つにまとめた 15 件で、順序は正準表の初出順。 */
export const TRANSITION_FAMILIES: readonly TransitionFamilyDefinition[] = (() => {
    const families = new Map<TransitionFamily, TransitionDirection[]>();
    for (const entry of TRANSITION_VOCABULARY) {
        const directions = families.get(entry.family) ?? [];
        const direction = directionOfEntry(entry);
        if (direction) directions.push(direction);
        families.set(entry.family, directions);
    }
    return [...families].map(([family, directions]) => ({
        family,
        directions: [...directions].sort((a, b) =>
            TRANSITION_DIRECTION_ORDER.indexOf(a) - TRANSITION_DIRECTION_ORDER.indexOf(b))
    }));
})();

export function transitionFamilyOf(
    type: unknown
): { family: TransitionFamily; direction?: TransitionDirection } | undefined {
    if (!isTransitionType(type)) return undefined;
    const entry = TRANSITION_BY_ID[type];
    const direction = directionOfEntry(entry);
    return direction ? { family: entry.family, direction } : { family: entry.family };
}

/** family と向きから保存用の type を引く。向きを持つ family に向きを渡さなければ undefined。 */
export function transitionTypeOf(family: unknown, direction?: unknown): TransitionType | undefined {
    return TRANSITION_VOCABULARY.find(entry =>
        entry.family === family && directionOfEntry(entry) === (direction ?? undefined))?.id;
}

const camelKeySegment = (value: string): string => value.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase());

/** 辞書のキー。名前そのものは UI の辞書が持ち、ここは引き方だけを決める。 */
export function transitionFamilyLabelKey(family: string): string {
    return `transition.family.label.${camelKeySegment(family)}`;
}

export function transitionDirectionLabelKey(direction: string): string {
    return `transition.direction.label.${camelKeySegment(direction)}`;
}

export const TRANSITION_UNKNOWN_LABEL_KEY = 'transition.family.label.unknown';
export const TRANSITION_NAME_WITH_DIRECTION_KEY = 'transition.name.format.withDirection';
