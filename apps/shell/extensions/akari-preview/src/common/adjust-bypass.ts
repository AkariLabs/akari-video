// webview に toString() で埋め込むため、モジュールスコープのヘルパーを参照しない。
export const applyAdjustBypass = <T>(summary: T, ids: readonly string[]): T => {
    if (!summary || typeof summary !== 'object' || ids.length === 0) return summary;
    const source = summary as Record<string, unknown>;
    let result = source;
    for (const key of ['cuts', 'layers', 'filters']) {
        const entries = source[key];
        if (!Array.isArray(entries)) continue;
        let changed = false;
        const mapped = entries.map(entry => {
            if (!entry || !ids.includes(String(entry.id)) || !Object.prototype.hasOwnProperty.call(entry, 'adjust')) return entry;
            const copy = { ...entry };
            delete copy.adjust;
            changed = true;
            return copy;
        });
        if (changed) {
            if (result === source) result = { ...source };
            result[key] = mapped;
        }
    }
    return result as T;
};
