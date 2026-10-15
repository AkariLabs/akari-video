/** planning/script.json v0. Unknown fields are retained when a valid line is edited. */
export interface ScriptLine {
    id: string;
    kind: 'plan' | 'memo';
    at: number;
    text: string;
    duration?: number;
    placeholder?: string;
    beat?: string;
    done?: boolean;
    author?: 'user' | 'ai' | 'playbook';
    [key: string]: unknown;
}

export interface ScriptDocument {
    version: 0;
    kind: 'akari-script';
    lines: ScriptLine[];
    [key: string]: unknown;
}

export const EMPTY_SCRIPT: ScriptDocument = { version: 0, kind: 'akari-script', lines: [] };

export function sortScriptLines(lines: readonly ScriptLine[]): ScriptLine[] {
    return lines.map((line, index) => ({ line, index }))
        .sort((a, b) => a.line.at - b.line.at
            || (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : a.index - b.index))
        .map(entry => entry.line);
}

/** Pick the earliest later caption even when the existing caption array is out of order. */
export function firstCaptionAfter<T extends { at: number }>(captions: readonly T[], at: number): T | undefined {
    return captions.reduce<T | undefined>((earliest, caption) => caption.at > at
        && (!earliest || caption.at < earliest.at) ? caption : earliest, undefined);
}

export function formatScriptTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const whole = Math.floor(seconds % 60);
    const fraction = seconds % 1;
    return `${minutes}:${String(whole).padStart(2, '0')}${fraction ? fraction.toFixed(2).slice(1) : ''}`;
}

/** Pure chronological row order used by static evidence and other readers. */
export function orderScriptDisplayLines<T extends { id: string; start: number }>(
    captions: readonly T[], lines: readonly ScriptLine[]
): Array<{ kind: 'caption'; at: number; caption: T } | { kind: 'plan' | 'memo'; at: number; line: ScriptLine }> {
    const rows = [
        ...captions.map(caption => ({ kind: 'caption' as const, at: caption.start, caption })),
        ...lines.map(line => ({ kind: line.kind, at: line.at, line }))
    ];
    return rows.sort((a, b) => {
        const aId = 'caption' in a ? a.caption.id : a.line.id;
        const bId = 'caption' in b ? b.caption.id : b.line.id;
        return a.at - b.at
            || (a.kind === 'caption' ? -1 : 0) - (b.kind === 'caption' ? -1 : 0)
            || (aId < bId ? -1 : aId > bId ? 1 : 0);
    });
}

export function isScriptLine(value: unknown): value is ScriptLine {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const line = value as Record<string, unknown>;
    return typeof line.id === 'string' && line.id.length > 0
        && (line.kind === 'plan' || line.kind === 'memo')
        && typeof line.at === 'number' && Number.isFinite(line.at) && line.at >= 0
        && typeof line.text === 'string' && line.text.length >= 1 && line.text.length <= 500
        && (line.duration === undefined || typeof line.duration === 'number' && Number.isFinite(line.duration) && line.duration > 0)
        && (line.placeholder === undefined || typeof line.placeholder === 'string')
        && (line.beat === undefined || typeof line.beat === 'string')
        && (line.done === undefined || typeof line.done === 'boolean')
        && (line.author === undefined || line.author === 'user' || line.author === 'ai' || line.author === 'playbook');
}

export function readScriptLines(source: string | unknown): ScriptDocument {
    let value: unknown;
    try { value = typeof source === 'string' ? JSON.parse(source) : source; }
    catch { return { ...EMPTY_SCRIPT, lines: [] }; }
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const seen = new Set<string>();
    const lines = (Array.isArray(record.lines) ? record.lines : []).filter((line: unknown): line is ScriptLine => {
        if (!isScriptLine(line) || seen.has(line.id)) return false;
        seen.add(line.id);
        return true;
    });
    return { ...record, version: 0, kind: 'akari-script', lines: sortScriptLines(lines) };
}

/** Strict JSON parsing for an existing file; line validation remains tolerant. */
export function parseScriptLines(source: string): ScriptDocument {
    return readScriptLines(JSON.parse(source));
}

export function addScriptLine(document: ScriptDocument, line: ScriptLine): ScriptDocument {
    if (!isScriptLine(line) || document.lines.some(candidate => candidate.id === line.id)) throw new Error('Invalid or duplicate script line');
    return { ...document, lines: sortScriptLines([...document.lines, line]) };
}

export function updateScriptLine(document: ScriptDocument, id: string, patch: Partial<ScriptLine>): ScriptDocument {
    const index = document.lines.findIndex(line => line.id === id);
    if (index < 0) return document;
    const next = { ...document.lines[index], ...patch, id };
    if (!isScriptLine(next)) throw new Error('Invalid script line');
    return { ...document, lines: sortScriptLines(document.lines.map((line, at) => at === index ? next : line)) };
}

export function removeScriptLine(document: ScriptDocument, id: string): ScriptDocument {
    return { ...document, lines: document.lines.filter(line => line.id !== id) };
}

export function toggleScriptPlanDone(document: ScriptDocument, id: string): ScriptDocument {
    const line = document.lines.find(candidate => candidate.id === id);
    return line?.kind === 'plan' ? updateScriptLine(document, id, { done: !line.done }) : document;
}

export function nextScriptMemoId(lines: readonly ScriptLine[]): string {
    const ids = new Set(lines.map(line => line.id));
    let counter = 1;
    while (ids.has(`m-${String(counter).padStart(4, '0')}`)) counter++;
    return `m-${String(counter).padStart(4, '0')}`;
}
