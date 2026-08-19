import store from '@akari-video/edit-store';
import migrate from '@akari-video/edit-store/lib/migrate/index.js';

const { projectLegacyEdit, readInternalEdit } = store;
const { migrateEditToV2 } = migrate;

export function toV2Edit(value) {
    if (value?.version === 2) return structuredClone(value);
    const legacy = {
        version: 0,
        output: { width: 1920, height: 1080, fps: 30 },
        source: { path: 'source.mp4', proxy: null },
        overlays: [],
        ...structuredClone(value)
    };
    const result = migrateEditToV2(legacy);
    if (!result.ok) {
        throw new Error(`legacy extension fixture could not migrate: ${result.blockers.join(' / ')}`);
    }
    return result.doc;
}

export function readLegacyView(value) {
    return projectLegacyEdit(readInternalEdit(toV2Edit(value)));
}
