import URI from '@theia/core/lib/common/uri';

const KEY = 'akari.structure.open';
const MAX_AGE_MS = 60_000;
export function requestStructureTab(root: URI, tab: 'structure' | 'relations'): void {
    window.localStorage.setItem(KEY, JSON.stringify({ root: root.toString(), tab, requestedAt: Date.now() }));
}
export function consumeStructureTab(root: URI): 'structure' | 'relations' | undefined {
    try {
        const request = JSON.parse(window.localStorage.getItem(KEY) || 'null');
        if (!request || !Number.isFinite(request.requestedAt) || Date.now() - request.requestedAt > MAX_AGE_MS) {
            window.localStorage.removeItem(KEY);
            return undefined;
        }
        if (request?.root !== root.toString()) return undefined;
        window.localStorage.removeItem(KEY);
        return request.tab === 'structure' || request.tab === 'relations' ? request.tab : undefined;
    } catch { window.localStorage.removeItem(KEY); return undefined; }
}
export function clearStructureTab(root: URI): void {
    try {
        const request = JSON.parse(window.localStorage.getItem(KEY) || 'null');
        if (request?.root === root.toString()) window.localStorage.removeItem(KEY);
    } catch { window.localStorage.removeItem(KEY); }
}
