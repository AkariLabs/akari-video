import type { NarrationEngine } from './akari-annotations-protocol';

export interface AiCatalogModel {
    id: string;
    kind: string;
    family?: string;
    provider?: string;
    price?: object | null;
}

export type AiTargetKind = 'still' | 'empty-frame' | 'video' | 'generated-video' | 'audio' | 'gap'
    | 'empty-audio-frame'
    | 'material-image' | 'material-video' | 'material-audio';
export type AiActionGroup = 'make' | 'refine';
export type AiImage = 'video' | 'still' | 'transcribe' | 'narration';
export interface AiRoute {
    id: string;
    label: string;
    kind: 'cli' | 'api' | 'local';
    cost: 'free' | 'paid';
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
        id: 'still', group: 'make', label: '静止画', image: 'still',
        visibleFor: ['empty-frame', 'still', 'video', 'generated-video', 'gap'],
        accepts: ['empty-frame', 'still', 'gap'],
        reasonWhenDisabled: '空の枠か静止画で使えます', output: 'image', placement: 'replace',
        routes: [{ id: 'codex', label: 'Codex', kind: 'cli', cost: 'free' },
            { id: 'antigravity', label: 'Antigravity', kind: 'cli', cost: 'free' },
            { id: 'grok', label: 'Grok', kind: 'cli', cost: 'free' }]
    }, {
        id: 'video', group: 'make', label: '動画にする', image: 'video',
        visibleFor: ['still', 'empty-frame', 'video', 'generated-video', 'gap', 'material-image'],
        accepts: ['still', 'empty-frame', 'generated-video', 'gap', 'material-image'],
        reasonWhenDisabled: '静止画か空の枠で使えます', output: 'video', placement: 'replace',
        placementFor: { 'material-image': 'new-material' },
        routes: models.filter(row => row.kind === 'video').map(row => ({
            id: row.id, label: row.family || row.id,
            kind: (row.provider ?? row.id.split(':')[0]) === 'fal' ? 'api'
                : (row.provider ?? row.id.split(':')[0]) === 'local' ? 'local' : 'cli',
            cost: row.price ? 'paid' : 'free'
        }))
    }, ...(narrationEngines ? [{
        id: 'narration', group: 'make', label: 'ナレーション', image: 'narration',
        visibleFor: ['empty-audio-frame', 'audio'] as AiTargetKind[], accepts: ['empty-audio-frame'] as AiTargetKind[],
        reasonWhenDisabled: '空いている音声の枠で使えます', output: 'audio' as const, placement: 'replace' as const,
        routes: narrationEngines.filter(engine => ['voicevox', 'gemini-tts', 'irodori'].includes(engine.id)
            || engine.id === 'fal-qwen3' && engine.availability.state === 'available')
            .map(engine => ({ id: engine.id, label: engine.id === 'fal-qwen3'
                ? `自声 · 有料 · $${engine.price?.usd_per_1000_chars ?? 0} / 1000 字` : engine.label,
                kind: engine.place === 'cloud' ? 'api' as const : 'local' as const,
                cost: (engine.price?.usd_per_1000_chars ?? 0) > 0 || engine.place === 'cloud'
                    ? 'paid' as const : 'free' as const }))
    } as AiAction] : []), {
        id: 'transcribe', group: 'refine', label: '文字起こし', image: 'transcribe',
        visibleFor: ['audio', 'video', 'generated-video', 'still', 'empty-frame', 'empty-audio-frame',
            'material-audio', 'material-video'],
        accepts: ['audio', 'video', 'material-audio', 'material-video'],
        reasonWhenDisabled: '声の入った音声か動画で使えます',
        output: 'captions', placement: 'captions',
        routes: [{ id: 'transcript', label: '台本パネルのエンジン', kind: 'local', cost: 'free' }]
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
