/** Browser hit regions for shape items are resolved before internal-model lowers them to HTML. */
export function previewShapeRoles(raw: unknown): Map<string, 'shape' | 'shape-line'> {
    const roles = new Map<string, 'shape' | 'shape-line'>();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || (raw as { version?: unknown }).version !== 2) return roles;
    const tracks = (raw as { tracks?: unknown }).tracks;
    if (!Array.isArray(tracks)) return roles;
    const visit = (item: unknown): void => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        const record = item as { id?: unknown; source?: { kind?: unknown; shape?: unknown }; items?: unknown };
        if (typeof record.id === 'string' && record.source?.kind === 'shape') {
            roles.set(record.id, record.source.shape === 'line' || record.source.shape === 'arrow'
                ? 'shape-line' : 'shape');
        }
        if (Array.isArray(record.items)) record.items.forEach(visit);
    };
    for (const track of tracks) {
        if (track && typeof track === 'object' && !Array.isArray(track)
            && (track as { lane?: unknown }).lane === 'visual'
            && Array.isArray((track as { items?: unknown }).items)) {
            ((track as { items: unknown[] }).items).forEach(visit);
        }
    }
    return roles;
}
