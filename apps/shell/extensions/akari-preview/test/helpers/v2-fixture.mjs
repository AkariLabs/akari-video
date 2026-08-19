import migrate from '@akari-video/edit-store/lib/migrate/index.js';

const { migrateEditToV2 } = migrate;

export function toV2Edit(value, options) {
    if (value?.version === 2) return structuredClone(value);
    const result = migrateEditToV2(value, options);
    if (!result.ok) {
        throw new Error(`legacy preview fixture could not migrate: ${result.blockers.join(' / ')}`);
    }
    return result.doc;
}
