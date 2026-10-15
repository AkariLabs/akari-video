export interface ScriptPlan {
    id: string;
    at: number;
    duration?: number;
    text: string;
    done?: boolean;
}

export interface ScriptMemo {
    id: string;
    at: number;
    text: string;
}

export interface ScriptLines {
    plans: ScriptPlan[];
    memos: ScriptMemo[];
}

const empty = (): ScriptLines => ({ plans: [], memos: [] });
const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const byTimeAndId = <T extends { at: number; id: string }>(left: T, right: T): number =>
    left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

const parseDocument = (source: string): unknown => {
    try { return JSON.parse(source); } catch { return undefined; }
};

const validDocument = (value: unknown): value is Record<string, unknown> & { lines: unknown[] } =>
    object(value) && value.version === 0 && value.kind === 'akari-script' && Array.isArray(value.lines);

/** Parse only the fields needed by the read-only timeline. Invalid rows do not hide valid rows. */
function linesFromDocument(value: Record<string, unknown> & { lines: unknown[] }): ScriptLines {
    const result = empty();
    const ids = new Set<string>();
    for (const line of value.lines) {
        if (!object(line) || (line.kind !== 'plan' && line.kind !== 'memo')
            || typeof line.id !== 'string' || line.id.length === 0 || ids.has(line.id)
            || typeof line.at !== 'number' || !Number.isFinite(line.at) || line.at < 0
            || typeof line.text !== 'string' || line.text.length < 1 || line.text.length > 500) continue;
        ids.add(line.id);
        if (line.kind === 'plan') {
            result.plans.push({
                id: line.id, at: line.at, text: line.text,
                ...(typeof line.duration === 'number' && Number.isFinite(line.duration) && line.duration > 0
                    ? { duration: line.duration } : {}),
                ...(typeof line.done === 'boolean' ? { done: line.done } : {})
            });
        } else result.memos.push({ id: line.id, at: line.at, text: line.text });
    }
    result.plans.sort(byTimeAndId);
    result.memos.sort(byTimeAndId);
    return result;
}

export function parseScriptLines(source: string): ScriptLines {
    const value = parseDocument(source);
    return validDocument(value) ? linesFromDocument(value) : empty();
}

/** An absent/unreadable file has no timeline row, even though the parsed lines would be empty. */
export function scriptTimelineRow(source: string | undefined): ScriptLines | undefined {
    if (source === undefined) return undefined;
    const value = parseDocument(source);
    return validDocument(value) ? linesFromDocument(value) : undefined;
}
