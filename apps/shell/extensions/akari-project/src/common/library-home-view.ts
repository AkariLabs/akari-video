import { t } from '../common/project-text';
import { catalogItemCategoryChipKey, CatalogSearchable, filterCatalogItems } from './catalog-reader';
import { filterPresetShowcaseItems, PresetShowcase } from './preset-showcase';
import { searchShapeShelf, ShapeShelfPreset } from './shape-shelf';

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

const TIMELINE_ADD_HINT = t('project.library.home.dragTimelineRightClickAddPlayheadAction');

/** ライブラリホームの宣言順・語彙・操作導線の正本。 */
export const LIBRARY_GROUPS = [
    {
        label: t('project.library.shelf.myAssetsLabel'),
        categories: [
            { key: 'fav', label: t('project.library.textPage.favoritesLabel'), icon: '★', hint: t('project.library.home.assetsMarkedAppearHereMessage'), status: 'soon' },
            { key: 'brandkit', label: t('project.library.home.brandKitLabel'), icon: '◈', hint: t('project.library.home.manageLogosColorsStandardTextOverlaysMessage'), status: 'soon' },
            { key: 'mypresets', label: t('project.library.home.savedPresetsLabel'), icon: '✎', hint: t('project.library.home.savePresetsYouHaveCustomizedAction'), status: 'soon' }
        ]
    },
    {
        label: t('project.library.home.audioVideoImagesLabel'),
        categories: [
            { key: 'bgm', label: 'BGM', icon: '♪', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'audio:bgm' },
            { key: 'sfx', label: 'SFX', icon: '♫', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'audio:sfx' },
            { key: 'broll', label: 'B-roll', icon: '▶', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'broll' },
            { key: 'image', label: t('project.library.shelf.imageLabel'), icon: '▦', hint: TIMELINE_ADD_HINT, status: 'live', chipKey: 'still' },
            { key: 'overlay', label: t('project.catalog.category.overlayLabel'), icon: '✦', hint: t('project.library.home.rightClickChooseImportAddProjectMessage'), status: 'live', chipKey: 'overlay' },
            { key: 'scene3d', label: t('project.library.home.threeDAndAvatarsLabel'), icon: '⬡', hint: t('project.library.home.rightClickChooseImportAddProjectMessage'), status: 'live', chipKey: 'scene3d' },
            { key: 'pack', label: t('project.library.home.packsLabel'), icon: '▤', hint: t('project.library.home.importAllAssetsPackAction'), status: 'live' }
        ]
    },
    {
        label: t('project.library.home.textDecorationsLabel'),
        categories: [
            { key: 'textstyle', label: t('project.library.home.captionStylesLabel'), icon: t('project.library.home.textLabel'), hint: t('project.library.home.applySelectedTextAddAsNewAction'), status: 'live', chipKey: 'preset:textstyle' },
            { key: 'textanim', label: t('project.library.pane.textAnimationLabel'), icon: t('project.library.home.motionIconLabel'), hint: t('project.library.home.applySelectedTextHoverPreviewAction'), status: 'live', chipKey: 'preset:textanim' },
            { key: 'font', label: t('project.library.importSheet.fontLabel'), icon: 'Aa', hint: t('project.library.home.applyFontSelectedTextAction'), status: 'live', chipKey: 'font' },
            { key: 'shapes', label: t('project.library.shapeShelf.shapesLabel'), icon: '◇', hint: t('project.library.home.clickAddCenterDragPlaceAnywhereMessage'), status: 'live' },
            { key: 'stamps', label: t('project.library.home.illustrationsLabel'), icon: '✶', hint: t('project.library.home.illustrationAssetsAreComingSoonMessage'), status: 'soon' }
        ]
    },
    {
        label: t('project.library.home.finishingLabel'),
        categories: [
            { key: 'lut', label: 'LUT', icon: '◐', hint: t('project.library.home.applySelectedCutAdjustStrengthInspectorAction'), status: 'live', chipKey: 'preset:lut' },
            { key: 'transition', label: t('project.library.pane.transitionLabel'), icon: '⇄', hint: t('project.library.home.dragCutBoundaryTimelineApplyAction'), status: 'live' },
            { key: 'fx', label: t('project.library.home.effectsLabel'), icon: '✳', hint: t('project.library.home.effectsAreComingSoonMessage'), status: 'soon' },
            { key: 'motion', label: t('project.library.home.motionCategoryLabel'), icon: '∿', hint: t('project.library.home.motionEffectsAreComingSoonMessage'), status: 'soon' }
        ]
    },
    {
        label: t('project.library.home.templatesLabel'),
        categories: [
            { key: 'template', label: t('project.library.home.templateCategoryLabel'), icon: '⧉', hint: t('project.library.home.creatingProjectTemplateIsComingSoonMessage'), status: 'soon' }
        ]
    }
] as const satisfies readonly LibraryGroupDefinition[];

export type LibraryCategoryKey = typeof LIBRARY_GROUPS[number]['categories'][number]['key'];

export interface LibraryPrimaryTile {
    readonly key: 'text' | LibraryCategoryKey;
    readonly kind: 'make' | 'pick';
    readonly label: string;
    readonly icon: string;
    readonly hint: string;
    readonly status: LibraryCategoryStatus;
    /**
     * `library-tile-art.ts` の絵の名前。タイルの key とは独立させてある
     * （`broll` の絵は「動画」、`pack` の絵は「セット」というように、
     * 内部の key を変えずに見せ方だけ差し替えられるようにするため）。
     */
    readonly art: string;
    /** 2 枚重ねカードの台座色（両テーマ共通。c1 = 明るい側 / c2 = 深い側）。 */
    readonly plate: readonly [string, string];
    /**
     * 段の区切り。`true` の直前に細い線を 1 本引く（見出しの文字は置かない
     * — 2026-09-27 オーナー指示「そざい・しあげのような言葉は不自然なので、
     * 名前ごとやめて線で区切る」）。
     */
    readonly startsGroup?: boolean;
}

/**
 * ホームのタイル。text はスタイルとフォントを選ぶページへ入る。
 *
 * 顔ぶれの経緯: 2026-09-22 裁定で 9 枚（text / shapes / stamps / image / broll /
 * bgm / sfx / overlay / scene3d）に確定していたが、**2026-09-27 オーナー指示で改訂**。
 * - 「B-roll」→「動画」（業界語をやめる。`chipKey` は `broll` のまま）
 * - 仕上げ（LUT・トランジション・エフェクト・モーション）とマイスタイルも
 *   同じカードに揃えて最上段へ出す（詳細に畳まない）
 * - テキストスタイル・テキストアニメ・フォントは出さない。文字に対する操作は
 *   テキストの中に入る（動きはスタイルに内包する。正本 = モック §03）
 */
export const LIBRARY_PRIMARY_TILES = [
    { key: 'text', kind: 'make', label: t('project.library.textPage.textLabel'), icon: 'T', hint: t('project.library.home.clickBrowseDragAddMessage'), status: 'live',
        art: 'text', plate: ['#8b6cff', '#5b3fd6'] },
    { key: 'shapes', kind: 'make', label: t('project.library.shapeShelf.shapesLabel'), icon: '◯', hint: t('project.library.home.chooseShelfAction'), status: 'live',
        art: 'shapes', plate: ['#35cadd', '#1490a8'] },
    { key: 'stamps', kind: 'make', label: t('project.library.home.illustrationsLabel'), icon: '◇', hint: t('project.library.shelf.comingSoonLabel'), status: 'soon',
        art: 'stamps', plate: ['#f5a742', '#d9761a'] },

    { key: 'image', kind: 'pick', label: t('project.library.shelf.imageLabel'), icon: '▦', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'image', plate: ['#4aa5ff', '#1e6fd9'], startsGroup: true },
    { key: 'broll', kind: 'pick', label: t('project.library.shelf.videoLabel'), icon: '▶', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'video', plate: ['#bc6ef5', '#8a2fd0'] },
    { key: 'bgm', kind: 'pick', label: 'BGM', icon: '♪', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'bgm', plate: ['#f9656e', '#cc2431'] },
    { key: 'sfx', kind: 'pick', label: 'SFX', icon: '♬', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'sfx', plate: ['#f77fbe', '#d62b89'] },
    { key: 'overlay', kind: 'pick', label: t('project.catalog.category.overlayLabel'), icon: '✦', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'overlay', plate: ['#7d8afc', '#4450d8'] },
    { key: 'scene3d', kind: 'pick', label: t('project.library.home.threeDAndAvatarsLabel'), icon: '⬡', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'scene3d', plate: ['#3cdcc7', '#0d9488'] },

    { key: 'lut', kind: 'pick', label: 'LUT', icon: '◐', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'lut', plate: ['#4bd471', '#1a8c3a'], startsGroup: true },
    { key: 'transition', kind: 'pick', label: t('project.library.pane.transitionLabel'), icon: '⇄', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'transition', plate: ['#26b0f0', '#0369a1'] },
    { key: 'fx', kind: 'pick', label: t('project.library.home.effectsLabel'), icon: '✳', hint: t('project.library.shelf.comingSoonLabel'), status: 'soon',
        art: 'fx', plate: ['#f5c231', '#b4860b'] },
    { key: 'motion', kind: 'pick', label: t('project.library.home.motionCategoryLabel'), icon: '∿', hint: t('project.library.shelf.comingSoonLabel'), status: 'soon',
        art: 'motion', plate: ['#fb8496', '#e11d48'] },

    { key: 'mypresets', kind: 'pick', label: t('project.library.pane.myStylesLabel'), icon: '✎', hint: t('project.library.shelf.comingSoonLabel'), status: 'soon',
        art: 'mystyle', plate: ['#f4b942', '#cc8409'], startsGroup: true },
    { key: 'template', kind: 'pick', label: t('project.library.home.templateGroupLabel'), icon: '⧉', hint: t('project.library.shelf.comingSoonLabel'), status: 'soon',
        art: 'template', plate: ['#9aa0b8', '#5c6178'] },
    { key: 'pack', kind: 'pick', label: t('project.library.home.setLabel'), icon: '▤', hint: t('project.library.home.chooseListAction'), status: 'live',
        art: 'pack', plate: ['#a3b0c2', '#64748b'] }
] as const satisfies readonly LibraryPrimaryTile[];

function detailGroup(label: string, keys: readonly LibraryCategoryKey[]): LibraryGroupDefinition {
    const categories = keys.map(key => {
        const category = (LIBRARY_GROUPS as readonly LibraryGroupDefinition[])
            .flatMap(group => group.categories).find(candidate => candidate.key === key);
        if (!category) throw new Error(`未知のライブラリカテゴリです: ${key}`);
        return category;
    });
    return { label, categories };
}

/**
 * 主要タイルに移したカテゴリを除いた、詳細内の表示順。
 *
 * 2026-09-27 改訂: 仕上げ（lut / transition / fx / motion）・まとめて（pack / template）・
 * 保存したプリセット（mypresets）は主要タイルへ昇格したので詳細から外す
 * （重複させない規律は 2026-09-23 から継続）。残るのは
 * - マイの残り（fav / brandkit）… まだ実装枠
 */
export const LIBRARY_DETAIL_GROUPS: readonly LibraryGroupDefinition[] = [
    detailGroup(t('project.library.shelf.myAssetsLabel'), ['fav', 'brandkit'])
];

/**
 * 外部呼び出し（コマンド引数等）の任意文字列を、実際に開けるカテゴリキーへ解決する。
 * 未知のキー・status='soon' のキーは undefined（呼び出し側はホームへフォールバックする）。
 */
export function resolveOpenableLibraryCategory(key: string | undefined): LibraryCategoryKey | undefined {
    if (!key) {
        return undefined;
    }
    for (const group of LIBRARY_GROUPS as readonly LibraryGroupDefinition[]) {
        const category = group.categories.find(candidate => candidate.key === key);
        if (category && category.status === 'live') {
            return category.key as LibraryCategoryKey;
        }
    }
    return undefined;
}

export interface LibraryTransitionSearchItem {
    readonly id: string;
    readonly labelJa: string;
    readonly category: string;
}

export interface LibrarySearchHit {
    readonly categoryKey: LibraryCategoryKey;
    readonly label: string;
    readonly kind: 'catalog' | 'preset' | 'transition' | 'shape';
}

export interface LibrarySearchSources {
    readonly catalogItems: readonly CatalogSearchable[];
    readonly presetShowcase: PresetShowcase;
    readonly transitions: readonly LibraryTransitionSearchItem[];
    /** 図形の棚。名前で引く（名前はタイルに出さず、検索とツールチップだけに使う）。 */
    readonly shapes?: readonly ShapeShelfPreset[];
}

const CATALOG_CATEGORY_TO_LIBRARY: Readonly<Record<string, LibraryCategoryKey>> = {
    'audio:bgm': 'bgm',
    'audio:sfx': 'sfx',
    broll: 'broll',
    still: 'image',
    overlay: 'overlay',
    scene3d: 'scene3d',
    textstyle: 'textstyle',
    font: 'font'
};

/** ホーム検索用。カタログ・プリセット・トランジション・図形を同じ小文字包含で横断する。 */
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
    const presetKinds = ['textstyle', 'textanim', 'lut'] as const;
    const presetHits = presetKinds.flatMap(kind => filterPresetShowcaseItems(sources.presetShowcase[kind], normalizedQuery)
        .map(item => ({
            categoryKey: kind as LibraryCategoryKey,
            label: item.name,
            kind: 'preset' as const
        })));
    const transitionHits = sources.transitions
        .filter(item => [item.labelJa, item.id, item.category].join(' ').toLowerCase().includes(normalizedQuery))
        .map(item => ({ categoryKey: 'transition' as const, label: item.labelJa, kind: 'transition' as const }));
    const shapeHits = searchShapeShelf(sources.shapes ?? [], normalizedQuery)
        .map(item => ({ categoryKey: 'shapes' as const, label: item.name, kind: 'shape' as const }));
    return [...catalogHits, ...presetHits, ...transitionHits, ...shapeHits];
}
