export type WorldMapMarkerState = 'absent' | 'present' | 'invalid';

export interface ParsedWorldMapMarker {
    state: WorldMapMarkerState;
    error?: string;
}

export function parseWorldMapMarker(source: string | undefined): ParsedWorldMapMarker {
    if (source === undefined) return { state: 'absent' };
    try {
        const value = JSON.parse(source) as { schemaVersion?: unknown; kind?: unknown };
        if (value?.schemaVersion !== 3) {
            return { state: 'invalid', error: 'world-map.json の schemaVersion は 3 である必要があります。' };
        }
        if (value.kind !== 'flat' && value.kind !== 'spatial') {
            return { state: 'invalid', error: 'world-map.json の kind は flat または spatial である必要があります。' };
        }
        return { state: 'present' };
    } catch (error) {
        return { state: 'invalid', error: error instanceof Error ? error.message : String(error) };
    }
}
