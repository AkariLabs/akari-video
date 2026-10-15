export interface DroppedPath { path: string; label: string }
export interface ChatDropResult {
    paths: DroppedPath[];
    libraryKeys: string[];
    unsupported: boolean;
}

const URI_TYPES = ['theia-editor-dnd', 'text/uri-list', 'application/vnd.code.uri-list',
    'tree-node', 'selected-tree-nodes', 'text/plain'];

export function hasChatDropData(types: readonly string[]): boolean {
    return types.some(type => type === 'Files' || URI_TYPES.includes(type)
        || type === 'application/x-akari-material' || type === 'application/x-akari-library-item');
}

export function shouldPrefetchLibraryCatalog(types: readonly string[], dragDetail?: unknown): boolean {
    if (types.includes('application/x-akari-library-item')) return true;
    if (!dragDetail || typeof dragDetail !== 'object') return false;
    const item = dragDetail as { kind?: unknown; key?: unknown; category?: unknown; id?: unknown };
    if (item.kind === 'font' || item.kind === 'transition') return false;
    return (typeof item.key === 'string' && /^[\w-]+\/[\w.-]+$/.test(item.key))
        || (typeof item.category === 'string' && typeof item.id === 'string'
            && /^[\w-]+\/[\w.-]+$/.test(`${item.category}/${item.id}`));
}

export function readChatDropData(data: Readonly<Record<string, string>>, files: readonly DroppedPath[], root: string): ChatDropResult {
    const paths = new Map<string, string>();
    const libraryKeys = new Set<string>();
    let unsupported = false;
    const add = (path: string, label?: string): void => {
        if (path && !paths.has(path)) paths.set(path, label || path.split(/[\\/]/).pop() || path);
    };
    for (const file of files) add(file.path, file.label);

    const relativePath = (value: unknown): string | undefined => {
        if (typeof value !== 'string' || !value || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) return;
        const parts = value.replace(/\\/g, '/').split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) return;
        return parts.join('/');
    };
    const material = data['application/x-akari-material'];
    if (material) {
        try {
            const item = JSON.parse(material) as { relativePath?: unknown; name?: unknown };
            const relative = relativePath(item.relativePath);
            if (relative) add(`${root.replace(/\/$/, '')}/${relative}`, typeof item.name === 'string' ? item.name : undefined);
            else unsupported = true;
        } catch { unsupported = true; }
    }
    const library = data['application/x-akari-library-item'];
    if (library) {
        try {
            const item = JSON.parse(library) as { kind?: unknown; category?: unknown; id?: unknown; key?: unknown };
            if (item.kind === 'transition' || item.kind === 'font') unsupported = true;
            else {
                const key = typeof item.key === 'string' ? item.key
                    : typeof item.category === 'string' && typeof item.id === 'string' ? `${item.category}/${item.id}` : '';
                if (/^[\w-]+\/[\w.-]+$/.test(key)) libraryKeys.add(key);
                else unsupported = true;
            }
        } catch { unsupported = true; }
    }

    const accept = (value: unknown): void => {
        if (typeof value === 'string') {
            if (value.startsWith('file:')) {
                try {
                    const uri = new URL(value);
                    if (uri.protocol === 'file:' && (!uri.host || uri.host === 'localhost')) {
                        add(decodeURIComponent(uri.pathname).replace(/^\/([A-Za-z]:\/)/, '$1'));
                    }
                } catch { /* An invalid URI has no attachment path. */ }
            } else if (value.startsWith('[') || value.startsWith('{') || value.startsWith('"')) {
                try { accept(JSON.parse(value)); } catch { /* Not a serialized tree node. */ }
            }
        } else if (Array.isArray(value)) {
            for (const item of value) accept(item);
        } else if (value && typeof value === 'object') {
            const node = value as { uri?: unknown; resource?: unknown; id?: unknown };
            accept(node.uri ?? node.resource ?? node.id);
        }
    };
    for (const type of URI_TYPES) {
        for (const line of (data[type] || '').split(/\r?\n/)) accept(line.trim());
    }
    return { paths: [...paths].map(([path, label]) => ({ path, label })), libraryKeys: [...libraryKeys], unsupported };
}
