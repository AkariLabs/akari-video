import { catalogItemCategoryChipKey, CatalogSearchable, filterCatalogItems } from './catalog-reader';
import { filterPresetShowcaseItems, PresetShowcase } from './preset-showcase';

export type LibraryCategoryStatus = 'live' | 'soon';

export interface LibraryCategoryDefinition {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly hint: string;
    readonly status: LibraryCategoryStatus;
    readonly chipKey?: string;
}

export interface LibraryGroupDefinition {
    readonly label: string;
    readonly categories: readonly LibraryCategoryDefinition[];
}

const TIMELINE_ADD_HINT = 'タイムラインへドラッグ、＋でプレイヘッド位置に追加';

/** ライブラリホームの宣言順・語彙・操作導線の正本。 */
export const LIBRARY_GROUPS = [
    {
        label: 'マイ',
        categories: [
            { key: 'fav', label: 'お気に入り', icon: '★', hint: '★を付けた素材をここに集約', status: 'soon' },
            { key: 'brandkit', label: 'ブランドキット', icon: '◈', hint: 'ロゴ・色・定番テロップをまとめて管理', status: 'soon' },
            { key: 'mypresets', label: '保存したプリセット', icon: '✎', hint: '自分で調整したプリセットを保存', status: 'soon' }
        ]
    },
    {
        label: '音・映像・画像',
        categories: [
            { key: 'bgm', label: 'BGM', icon: '♪', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'audio:bgm' },
            { key: 'sfx', label: 'SFX', icon: '♫', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'audio:sfx' },
            { key: 'broll', label: 'B-roll', icon: '▶', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'broll' },
            { key: 'image', label: '画像', icon: '▦', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'still' },
            { key: 'overlay', label: 'オーバーレイ', icon: '✦', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'overlay' },
            { key: 'scene3d', label: '3D・アバター', icon: '⬡', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'scene3d' },
            { key: 'pack', label: 'パック', icon: '▤', hint: 'パック内の素材をまとめて取り込み', status: 'live' }
        ]
    },
    {
        label: '文字・飾り',
        categories: [
            { key: 'telop', label: 'テロップ', icon: '字', hint: 'プレビューへドラッグ、＋でプレイヘッド位置に追加', status: 'live', chipKey: 'preset:telop' },
            { key: 'textanim', label: 'テキストアニメ', icon: '動', hint: '選択中のテロップに適用（次のラウンドで有効化）', status: 'live', chipKey: 'preset:textanim' },
            { key: 'font', label: 'フォント', icon: 'Aa', hint: '「使う」でこのプロジェクトのフォントに追加', status: 'live', chipKey: 'font' },
            { key: 'shapes', label: '図形', icon: '◇', hint: '図形素材は近日利用できるようになります', status: 'soon' },
            { key: 'stamps', label: 'スタンプ', icon: '✶', hint: 'スタンプ素材は近日利用できるようになります', status: 'soon' }
        ]
    },
    {
        label: '仕上げ',
        categories: [
            { key: 'lut', label: 'LUT', icon: '◐', hint: '選択中のカットに適用（強さはインスペクター）', status: 'live', chipKey: 'preset:lut' },
            { key: 'transition', label: 'トランジション', icon: '⇄', hint: 'タイムラインのカット境界へドラッグして適用', status: 'live' },
            { key: 'fx', label: 'エフェクト', icon: '✳', hint: 'エフェクトは近日利用できるようになります', status: 'soon' },
            { key: 'motion', label: 'モーション', icon: '∿', hint: 'モーションは近日利用できるようになります', status: 'soon' }
        ]
    },
    {
        label: '雛形',
        categories: [
            { key: 'template', label: 'テンプレート', icon: '⧉', hint: 'テンプレートからの新規作成は近日利用できるようになります', status: 'soon' }
        ]
    }
] as const satisfies readonly LibraryGroupDefinition[];

export type LibraryCategoryKey = typeof LIBRARY_GROUPS[number]['categories'][number]['key'];

export interface LibraryTransitionSearchItem {
    readonly id: string;
    readonly labelJa: string;
    readonly category: string;
}

export interface LibrarySearchHit {
    readonly categoryKey: LibraryCategoryKey;
    readonly label: string;
    readonly kind: 'catalog' | 'preset' | 'transition';
}

export interface LibrarySearchSources {
    readonly catalogItems: readonly CatalogSearchable[];
    readonly presetShowcase: PresetShowcase;
    readonly transitions: readonly LibraryTransitionSearchItem[];
}

const CATALOG_CATEGORY_TO_LIBRARY: Readonly<Record<string, LibraryCategoryKey>> = {
    'audio:bgm': 'bgm',
    'audio:sfx': 'sfx',
    broll: 'broll',
    still: 'image',
    overlay: 'overlay',
    scene3d: 'scene3d',
    font: 'font'
};

/** ホーム検索用。カタログ・プリセット・トランジションを同じ小文字包含で横断する。 */
export function searchLibraryHome(query: string, sources: LibrarySearchSources): LibrarySearchHit[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }
    const catalogHits = filterCatalogItems(sources.catalogItems, normalizedQuery, 'all')
        .flatMap(item => {
            const categoryKey = CATALOG_CATEGORY_TO_LIBRARY[catalogItemCategoryChipKey(item)];
            return categoryKey ? [{ categoryKey, label: item.title, kind: 'catalog' as const }] : [];
        });
    const presetKinds = ['telop', 'textstyle', 'textanim', 'lut'] as const;
    const presetHits = presetKinds.flatMap(kind => filterPresetShowcaseItems(sources.presetShowcase[kind], normalizedQuery)
        .map(item => ({
            categoryKey: (kind === 'textstyle' ? 'telop' : kind) as LibraryCategoryKey,
            label: item.name,
            kind: 'preset' as const
        })));
    const transitionHits = sources.transitions
        .filter(item => [item.labelJa, item.id, item.category].join(' ').toLowerCase().includes(normalizedQuery))
        .map(item => ({ categoryKey: 'transition' as const, label: item.labelJa, kind: 'transition' as const }));
    return [...catalogHits, ...presetHits, ...transitionHits];
}
