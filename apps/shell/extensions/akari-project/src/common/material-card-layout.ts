// タスク契約 §指示の確定値・オーナー裁定（2026-09-08）:
// 全種を 1:1・contain・同じ列幅に統一し、名前は重ね、格子の余白と間隔は 4px にする。

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
        aspectRatio: '1 / 1' as const,
        objectFit: 'contain' as const,
        gridColumn: undefined,
        namePlacement: 'overlay' as const,
        kindLabel,
        gridGap: `${options.gridGapPx ?? 4}px`,
        gridPadding: `${options.gridPaddingPx ?? 4}px`,
        // 95px は維持する。ラッパーの実機計測（Electron + CDP）では左パネル 320px
        // = 格子枠 255.92px で 2 列（カード 121.96px）、400px で 3 列（111.83px）、
        // 500px で 4 列。既定幅を動かすと、この較正済みの列数の階段がずれるため。
        cardMinWidth: `${options.cardMinWidthPx ?? 95}px`
    };
}
