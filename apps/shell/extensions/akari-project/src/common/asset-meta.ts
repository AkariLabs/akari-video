export interface AssetMeta {
    asset?: string;
    thumbnail?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    transcript?: { available?: boolean; path?: string };
    analysis?: { status?: string; summary?: string };
    decisions?: Array<{ id?: string; summary?: string; status?: string }>;
}

export interface AssetMetaDescription {
    duration: string;
    resolution: string;
    transcript: string;
    analysis: string;
    decisions: string;
}

export function describeAssetMeta(meta: AssetMeta | undefined): AssetMetaDescription {
    return {
        duration: typeof meta?.durationSeconds === 'number' ? formatDuration(meta.durationSeconds) : '未分析',
        resolution: meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : '未分析',
        transcript: meta?.transcript?.available === true ? 'あり' : meta?.transcript?.available === false ? 'なし' : '未分析',
        analysis: meta?.analysis?.summary || '未分析',
        decisions: meta?.decisions?.length
            ? meta.decisions.map(item => item.summary || item.id || '判断').join(' / ')
            : '未分析'
    };
}

function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}
