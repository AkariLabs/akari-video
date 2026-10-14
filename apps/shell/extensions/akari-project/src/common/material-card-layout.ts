import { t } from '../common/project-text';
import { localizedAssetText, type LocalizableAsset } from '@akari-video/i18n';
// サムネイルは 16:9。名前は枠の外に置く。

import type { MaterialMetaEntry } from './akari-project-protocol';

export function materialCardTitle(meta: LocalizableAsset | undefined, fallback: string, language: string): string {
    return meta ? localizedAssetText(meta, 'title', language) ?? fallback : fallback;
}

export interface ReferenceCardTitleSource { title?: string; id: string }
export interface CatalogCardTitleSource extends LocalizableAsset { title: string; baseTitle?: string }
export interface MaterialCardNameSource { name: string; baseName?: string }

export function referenceMaterialBaseName(reference: ReferenceCardTitleSource, known?: CatalogCardTitleSource): string {
    return reference.title ?? known?.baseTitle ?? known?.title ?? reference.id;
}

/** Keep the Japanese reference-card precedence, using an actual translation only outside Japanese. */
export function referenceMaterialCardTitle(reference: ReferenceCardTitleSource, known: CatalogCardTitleSource | undefined,
    card: MaterialCardNameSource | undefined, language: string): string {
    const legacy = reference.title ?? known?.title ?? reference.id;
    if (language === 'ja') return legacy;
    const cardTranslation = card?.baseName && card.name !== card.baseName ? card.name : undefined;
    const knownBase = known?.baseTitle ?? known?.title;
    const translatedKnown = known && knownBase
        ? localizedAssetText({ title: knownBase, i18n: known.i18n }, 'title', language) : undefined;
    const knownTranslation = translatedKnown && translatedKnown !== knownBase ? translatedKnown
        : known?.baseTitle && known.title !== known.baseTitle ? known.title : undefined;
    return cardTranslation ?? knownTranslation ?? legacy;
}

export function materialStoredName(entry: MaterialCardNameSource): string {
    return entry.baseName ?? entry.name;
}

/** analysis の尺を優先し、ファイル由来の日時と不足分の尺を補う。 */
export function mergeMaterialCardMeta<T extends { durationSeconds?: number; createdAt?: string; importedAt?: string }>(
    entry: T, meta: MaterialMetaEntry
): T {
    return {
        ...entry,
        durationSeconds: entry.durationSeconds !== undefined ? entry.durationSeconds : meta.durationSeconds,
        createdAt: meta.createdAt,
        importedAt: meta.importedAt
    };
}

export interface MaterialCardLayoutEntry {
    kind: 'video' | 'audio' | 'image' | 'other';
    name?: string;
    assetGroupCategory?: string;
}

export interface MaterialCardLayoutOptions {
    gridGapPx?: number;
    gridPaddingPx?: number;
    cardMinWidthPx?: number;
}

/** I/O・URI・React に依存しない、素材カード共通のレイアウト値。 */
export function materialCardLayout(entry: MaterialCardLayoutEntry, options: MaterialCardLayoutOptions = {}) {
    const kindLabel = entry.assetGroupCategory
        || (/\.html?$/i.test(entry.name ?? '') ? 'HTML'
            : { video: t('project.library.shelf.videoLabel'), audio: t('project.library.shelf.audioMediaLabel'), image: t('project.library.shelf.imageLabel'), other: t('project.catalog.purchase.asset') }[entry.kind]);
    return {
        aspectRatio: '16 / 9' as const,
        objectFit: 'contain' as const,
        gridColumn: undefined,
        namePlacement: 'below' as const,
        kindLabel,
        gridGap: `${options.gridGapPx ?? 6}px`,
        gridPadding: `${options.gridPaddingPx ?? 8}px`,
        // With the panel chrome, 95px keeps the intended steps: 320px -> 2, 400px -> 3, 500px -> 4 columns.
        // Electron + CDP calibration: a 255.92px grid fits two 121.96px cards;
        // at 400px it fits three 111.83px cards. Keep the 95px threshold.
        cardMinWidth: `${options.cardMinWidthPx ?? 95}px`
    };
}
