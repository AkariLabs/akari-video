import { t } from '../common/project-text';
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
        duration: typeof meta?.durationSeconds === 'number' ? formatDuration(meta.durationSeconds) : t('project.agent.contextPacket.notAnalyzedLabel'),
        resolution: meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : t('project.agent.contextPacket.notAnalyzedLabel'),
        transcript: meta?.transcript?.available === true ? t('project.materials.metadata.yesLabel') : meta?.transcript?.available === false ? t('project.materials.metadata.noLabel') : t('project.agent.contextPacket.notAnalyzedLabel'),
        analysis: meta?.analysis?.summary || t('project.agent.contextPacket.notAnalyzedLabel'),
        decisions: meta?.decisions?.length
            ? meta.decisions.map(item => item.summary || item.id || t('project.materials.metadata.decisionLabel')).join(' / ')
            : t('project.agent.contextPacket.notAnalyzedLabel')
    };
}

function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}
