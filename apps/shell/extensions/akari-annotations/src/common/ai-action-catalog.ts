export interface AiCatalogModel {
    id: string;
    kind: string;
    family?: string;
    provider?: string;
    price?: object | null;
}

export type AiTargetKind = 'still' | 'empty-frame' | 'video' | 'generated-video' | 'audio' | 'gap'
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
    routes: readonly AiRoute[];
}
export interface AiTile { id: string; label: string; image: AiImage; enabled: boolean; reason?: string }
export interface AiTileGroup { group: AiActionGroup; tiles: AiTile[] }

/** The model catalog already read by the generation form is the sole source of routes. */
export function aiActionCatalog(models: readonly AiCatalogModel[]): AiAction[] {
    return [{
        id: 'video', group: 'make', label: '動画にする', image: 'video',
        visibleFor: ['still', 'empty-frame', 'video', 'generated-video'],
        accepts: ['still', 'empty-frame', 'generated-video'],
        reasonWhenDisabled: '静止画か空の枠で使えます', output: 'video', placement: 'replace',
        routes: models.filter(row => row.kind === 'video').map(row => ({
            id: row.id, label: row.family || row.id,
            kind: (row.provider ?? row.id.split(':')[0]) === 'fal' ? 'api'
                : (row.provider ?? row.id.split(':')[0]) === 'local' ? 'local' : 'cli',
            cost: row.price ? 'paid' : 'free'
        }))
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
