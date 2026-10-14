export function formatPreviewError(value: unknown): string {
    try {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
            const details = value as { name?: unknown; message?: unknown; stack?: unknown; type?: unknown };
            const message = typeof details.message === 'string' ? details.message : undefined;
            const stack = typeof details.stack === 'string' ? details.stack : undefined;
            if (value instanceof Error || message !== undefined || stack !== undefined) {
                const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
                const name = typeof details.name === 'string' && details.name ? details.name
                    : typeof constructorName === 'string' && constructorName && constructorName !== 'Object'
                        ? constructorName : 'Error';
                const label = message ? `${name}: ${message}` : name;
                return stack ? (stack.startsWith(label) ? stack : `${label}\n${stack}`) : label;
            }
            if (typeof details.type === 'string') return `Event: ${details.type}`;
            const serialized = JSON.stringify(value);
            if (serialized && serialized !== '{}') return serialized;
        }
        return String(value);
    } catch {
        try { return String(value); } catch { return '[unprintable rejection]'; }
    }
}
