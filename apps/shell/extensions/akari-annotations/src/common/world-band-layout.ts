export interface WorldBandMap {
    worlds: Array<{ id: string; label?: string; palette?: { accent?: string } }>;
    cameraStops: Array<{ id: string; world: string; at: number; leave: number }>;
    edges: Array<{ id: string; from: string; to: string; type: string; switchTime?: number; t0: number; t1: number; transition?: { kind?: string; cover?: number | null } }>;
}

export interface WorldBandRect {
    kind: 'stop'; id: string; world: string; label: string; left: number; width: number; color: string;
    at: number; leave: number;
}
export interface WorldEdgeMarkerRect {
    kind: 'edge'; id: string; left: number; width: number; title: string;
}

export function worldBandLayout(map: WorldBandMap, secondsToPx: (seconds: number) => number): {
    bands: WorldBandRect[]; markers: WorldEdgeMarkerRect[];
} {
    const worlds = new Map(map.worlds.map(world => [world.id, world]));
    const bands = map.cameraStops.map(stop => {
        const world = worlds.get(stop.world);
        const left = secondsToPx(stop.at);
        return {
            kind: 'stop' as const, id: stop.id, world: stop.world, label: world?.label ?? stop.world,
            left, width: Math.max(1, secondsToPx(stop.leave) - left), color: world?.palette?.accent ?? '#8190aa',
            at: stop.at, leave: stop.leave
        };
    });
    const markers = map.edges.filter(edge => edge.type !== 'move').map(edge => {
        const at = Number.isFinite(edge.switchTime) ? edge.switchTime! : (edge.t0 + edge.t1) / 2;
        const cover = edge.transition?.cover;
        return {
            kind: 'edge' as const, id: edge.id, left: secondsToPx(at), width: 3,
            title: `${edge.type} / ${edge.transition?.kind ?? 'none'} / cover ${cover ?? '-'} s`
        };
    });
    return { bands, markers };
}
