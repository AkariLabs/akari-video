/** edit.json がまだ無いときだけ表示する、タイムラインの開始案内。 */
export function timelineEmptyStateMessage(hasEdit: boolean): string | undefined {
    return hasEdit ? undefined : '素材をここへドラッグ＆ドロップするか、パートナーに話しかけて始めてください';
}

/** 同じ scheme / authority の正規化済み URI パスから、edit.json 基準の素材参照を作る。 */
export function relativeTimelineMaterialPath(editDirectory: string, materialPath: string): string {
    const directory = editDirectory.split('/').filter(Boolean);
    const material = materialPath.split('/').filter(Boolean);
    let common = 0;
    while (common < directory.length && common < material.length && directory[common] === material[common]) common++;
    return [...Array(directory.length - common).fill('..'), ...material.slice(common)].join('/');
}

/** Node 専用の project-scaffold は browser から呼べないため、最小の雛形だけを作る。 */
export function createTimelineEdit(): {
    version: 2;
    output: { width: number; height: number; fps: number };
    sources: unknown[];
    tracks: unknown[];
} {
    return {
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [],
        tracks: []
    };
}
