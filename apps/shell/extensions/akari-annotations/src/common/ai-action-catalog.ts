import { t } from '@akari-video/i18n';
import type { NarrationEngine } from './akari-annotations-protocol';

export interface AiCatalogModel {
    id: string;
    kind: string;
    family?: string;
    provider?: string;
    price?: object | null;
}

export type AiTargetKind = 'still' | 'empty-frame' | 'video' | 'image' | 'generated-video' | 'audio' | 'gap'
    | 'empty-audio-frame'
    | 'material-image' | 'material-video' | 'material-audio';
export type AiActionGroup = 'make' | 'refine';
export type AiImage = 'video' | 'still' | 'transcribe' | 'narration' | 'cutout' | 'eraser';
export interface AiRoute {
    id: string;
    modelId?: string;
    label: string;
    kind: 'cli' | 'api' | 'local';
    cost: 'free' | 'paid';
    maker?: string;
    inputs?: { reference_images?: { max: number; note?: string } };
}
export interface AiAction {
    id: string;
    group: AiActionGroup;
    label: string;
    image: AiImage;
    visibleFor: readonly AiTargetKind[];
    accepts: readonly AiTargetKind[];
    reasonWhenDisabled: string;
    output: 'image' | 'video' | 'audio' | 'captions';
    placement: 'replace' | 'new-material' | 'captions' | 'new-clip';
    placementFor?: Partial<Record<AiTargetKind, AiAction['placement']>>;
    routes: readonly AiRoute[];
}
export interface AiTile { id: string; label: string; image: AiImage; enabled: boolean; reason?: string; done?: boolean }
export interface AiTileGroup { group: AiActionGroup; tiles: AiTile[] }

export function aiActionPlacement(action: AiAction, target: AiTargetKind): AiAction['placement'] {
    return action.placementFor?.[target] ?? action.placement;
}

/** Video routes use the generation model catalog; transcription delegates engine choice to the daihon dialog. */
export function aiActionCatalog(models: readonly AiCatalogModel[], narrationEngines?: readonly NarrationEngine[]): AiAction[] {
    return [{
        id: 'still', group: 'make', label: t('annotationscommon.aiActionCatalog.still.label'), image: 'still',
        // 「作る」は仮枠（と仮枠から作った生成物・空き）のときだけ出す。ふつうの画像・動画のクリップで
        // 「静止画 / 動画を作る」が出ても意味が分からない（オーナー裁定 2026-10-12）。
        visibleFor: ['empty-frame', 'still', 'generated-video', 'gap'],
        accepts: ['empty-frame', 'still', 'gap'],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.still.disabledReason'), output: 'image', placement: 'replace',
        routes: [{ id: 'codex', modelId: 'codex:image', label: 'ChatGPT（Codex）', maker: 'openai', kind: 'cli', cost: 'free', inputs: { reference_images: { max: 4 } } },
            { id: 'antigravity', modelId: 'still:antigravity', label: 'Antigravity', maker: 'google', kind: 'cli', cost: 'free', inputs: { reference_images: { max: 0 } } },
            { id: 'grok', modelId: 'still:grok', label: 'Grok', maker: 'xai', kind: 'cli', cost: 'free', inputs: { reference_images: { max: 1, note: t('annotationscommon.aiActionCatalog.still.referenceNote') } } },
            { id: 'fal', modelId: 'fal:gpt-image-2.5-flare', label: 'fal · GPT Image 2.5 Flare', maker: 'openai', kind: 'api', cost: 'paid', inputs: { reference_images: { max: 16 } } }]
    }, {
        id: 'video', group: 'make', label: t('annotationscommon.aiActionCatalog.video.label'), image: 'video',
        visibleFor: ['still', 'empty-frame', 'generated-video', 'gap', 'material-image'],
        accepts: ['still', 'empty-frame', 'generated-video', 'gap', 'material-image'],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.video.disabledReason'), output: 'video', placement: 'replace',
        placementFor: { 'material-image': 'new-material' },
        routes: models.filter(row => row.kind === 'video').map(row => ({
            id: row.id, label: row.family || row.id,
            kind: (row.provider ?? row.id.split(':')[0]) === 'fal' ? 'api'
                : (row.provider ?? row.id.split(':')[0]) === 'local' ? 'local' : 'cli',
            cost: row.price ? 'paid' : 'free'
        }))
    }, ...(narrationEngines ? [{
        id: 'narration', group: 'make', label: t('annotationscommon.aiActionCatalog.narration.label'), image: 'narration',
        visibleFor: ['empty-audio-frame', 'audio'] as AiTargetKind[], accepts: ['empty-audio-frame'] as AiTargetKind[],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.narration.disabledReason'), output: 'audio' as const, placement: 'replace' as const,
        routes: narrationEngines.filter(engine => ['voicevox', 'gemini-tts', 'irodori'].includes(engine.id)
            || engine.id === 'fal-qwen3' && engine.availability.state === 'available')
            .map(engine => ({ id: engine.id, label: engine.id === 'fal-qwen3'
                ? t('annotationscommon.aiActionCatalog.narration.paidVoice', { price: engine.price?.usd_per_1000_chars ?? 0 }) : engine.label,
                kind: engine.place === 'cloud' ? 'api' as const : 'local' as const,
                cost: (engine.price?.usd_per_1000_chars ?? 0) > 0 || engine.place === 'cloud'
                    ? 'paid' as const : 'free' as const }))
    } as AiAction] : []), {
        id: 'cutout', group: 'refine', label: t('annotationscommon.aiActionCatalog.cutout.label'), image: 'cutout',
        visibleFor: ['still', 'empty-frame', 'video', 'image', 'generated-video'],
        accepts: ['still', 'video', 'image', 'generated-video'],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.photo.disabledReason'), output: 'image', placement: 'replace',
        routes: [{ id: 'on-device', label: t('annotationscommon.aiActionCatalog.device.localLabel'), kind: 'local', cost: 'free' }]
    }, {
        id: 'eraser', group: 'refine', label: t('annotationscommon.aiActionCatalog.eraser.label'), image: 'eraser',
        visibleFor: ['still', 'empty-frame', 'video', 'image', 'generated-video'],
        accepts: ['still', 'video', 'image', 'generated-video'],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.photo.disabledReason'), output: 'image', placement: 'replace',
        routes: [{ id: 'on-device', label: t('annotationscommon.aiActionCatalog.device.localLabel'), kind: 'local', cost: 'free' }]
    }, {
        id: 'transcribe', group: 'refine', label: t('annotationscommon.aiActionCatalog.transcribe.label'), image: 'transcribe',
        visibleFor: ['audio', 'video', 'image', 'generated-video', 'still', 'empty-frame', 'empty-audio-frame',
            'material-audio', 'material-video'],
        accepts: ['audio', 'video', 'material-audio', 'material-video'],
        reasonWhenDisabled: t('annotationscommon.aiActionCatalog.transcribe.disabledReason'),
        output: 'captions', placement: 'captions',
        routes: [{ id: 'transcript', label: t('annotationscommon.aiActionCatalog.transcribe.engineLabel'), kind: 'local', cost: 'free' }]
    }];
}

export function describeAiTiles(catalog: readonly AiAction[], target: AiTargetKind): AiTileGroup[] {
    return (['make', 'refine'] as const).map(group => ({
        group,
        tiles: catalog.filter(action => action.group === group && action.routes.length > 0
            && action.visibleFor.includes(target)).map(action => ({
            id: action.id, label: action.label, image: action.image,
            enabled: action.accepts.includes(target),
            ...(!action.accepts.includes(target) ? { reason: action.reasonWhenDisabled } : {})
        }))
    })).filter(group => group.tiles.length > 0);
}
