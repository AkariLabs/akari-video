// サムネイルは 16:9。名前は枠の外に置く。

import type { MaterialMetaEntry } from './akari-project-protocol';

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
            : { video: '動画', audio: '音声', image: '画像', other: '素材' }[entry.kind]);
    return {
        aspectRatio: '16 / 9' as const,
        objectFit: 'contain' as const,
        gridColumn: undefined,
        namePlacement: 'below' as const,
        kindLabel,
        gridGap: `${options.gridGapPx ?? 6}px`,
        gridPadding: `${options.gridPaddingPx ?? 8}px`,
        cardMinWidth: `${options.cardMinWidthPx ?? 104}px`
    };
}
