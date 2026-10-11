import { t } from './shell-text';
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
            return { state: 'invalid', error: t('shell.worldMap.marker.worldMapJsonSchemaversionMust3Message') };
        }
        if (value.kind !== 'flat' && value.kind !== 'spatial') {
            return { state: 'invalid', error: t('shell.worldMap.marker.worldMapJsonKindMustFlatSpatialMessage') };
        }
        return { state: 'present' };
    } catch (error) {
        return { state: 'invalid', error: error instanceof Error ? error.message : String(error) };
    }
}
