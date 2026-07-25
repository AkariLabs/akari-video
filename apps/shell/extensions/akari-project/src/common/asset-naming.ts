/**
 * assets/ への移動時の同名衝突回避規約。recordDroppedAssets（akari-project-service.ts）の
 * stem-index.ext 命名を踏襲する（必読資料指定の先例。index は 2 から始まる）。
 */
export function nextCandidateAssetName(originalName: string, index: number): string {
    const dot = originalName.lastIndexOf('.');
    if (dot <= 0) {
        return `${originalName}-${index}`;
    }
    return `${originalName.slice(0, dot)}-${index}${originalName.slice(dot)}`;
}
