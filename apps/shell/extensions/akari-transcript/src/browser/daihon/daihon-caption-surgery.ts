import { splitTopLevelElements } from '@akari-video/edit-store';

export function fragmentBoundaries(words: readonly { text: string }[], fragments: readonly string[] | undefined): number[] {
    if (!fragments?.length) return [];
    const offsets = new Map<number, number>();
    let offset = 0;
    words.forEach((word, index) => { offsets.set(offset, index); offset += word.text.length; });
    const result: number[] = [];
    let total = 0;
    for (const fragment of fragments.slice(0, -1)) {
        total += fragment.length;
        const index = offsets.get(total);
        if (index !== undefined && index > 0 && index < words.length) result.push(index);
    }
    return [...new Set(result)].sort((a, b) => a - b);
}

export function toggleFragmentBoundary(words: readonly { text: string }[], fragments: readonly string[] | undefined,
    text: string, atWordIndex: number): string[] {
    if (!Number.isInteger(atWordIndex) || atWordIndex <= 0 || atWordIndex >= words.length) return fragments ? [...fragments] : [];
    const offsets = new Set(fragmentBoundaries(words, fragments).map(index =>
        words.slice(0, index).reduce((sum, word) => sum + word.text.length, 0)));
    const at = words.slice(0, atWordIndex).reduce((sum, word) => sum + word.text.length, 0);
    if (offsets.has(at)) offsets.delete(at); else offsets.add(at);
    const sorted = [...offsets].filter(offset => offset > 0 && offset < text.length).sort((a, b) => a - b);
    if (!sorted.length) return [];
    let cursor = 0;
    return [...sorted, text.length].map(end => { const value = text.slice(cursor, end); cursor = end; return value; });
}

function rootArrayBounds(source: string): { start: number; end: number } | undefined {
    const first = source.search(/\S/u);
    if (first < 0) return undefined;
    if (source[first] === '[') return { start: first, end: source.lastIndexOf(']') };
    const match = /"captions"\s*:\s*\[/u.exec(source);
    if (!match) return undefined;
    const start = match.index + match[0].lastIndexOf('[');
    let depth = 0; let string = false; let escaped = false;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (string) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') string = false; continue; }
        if (char === '"') string = true;
        else if (char === '[') depth++;
        else if (char === ']' && --depth === 0) return { start, end: index };
    }
    return undefined;
}

export function setCaptionDisplayFragmentsInSource(source: string, captionId: string,
    fragments: readonly string[]): string {
    const bounds = rootArrayBounds(source);
    if (!bounds) throw new Error('captions 配列が見つかりません。');
    const inner = source.slice(bounds.start + 1, bounds.end);
    const elements = splitTopLevelElements(inner);
    for (const element of elements) {
        const raw = element.text;
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(raw); } catch { continue; }
        if (parsed.id !== captionId) continue;
        const display = fragments.length ? JSON.stringify(fragments) : null;
        const updated = setObjectProperty(setObjectProperty(raw, 'display_fragments', display), 'edited', 'true');
        const start = bounds.start + 1 + element.start;
        const end = bounds.start + 1 + element.end;
        return source.slice(0, start) + updated + source.slice(end);
    }
    throw new Error(`字幕が見つかりません: ${captionId}`);
}

function setObjectProperty(raw: string, key: string, jsonValue: string | null): string {
    const open = raw.indexOf('{'); const close = raw.lastIndexOf('}');
    if (open < 0 || close <= open) return raw;
    const inner = raw.slice(open + 1, close);
    const properties = splitTopLevelElements(inner);
    const found = properties.find(property => {
        try { return Object.prototype.hasOwnProperty.call(JSON.parse(`{${property.text}}`), key); } catch { return false; }
    });
    if (found) {
        let start = open + 1 + found.start; let end = open + 1 + found.end;
        if (jsonValue !== null) {
            const property = raw.slice(start, end); const colon = property.indexOf(':');
            const space = property.slice(colon + 1).match(/^\s*/u)?.[0] ?? '';
            return raw.slice(0, start) + property.slice(0, colon + 1) + space + jsonValue + raw.slice(end);
        }
        let cursor = end; while (cursor < close && /\s/u.test(raw[cursor])) cursor++;
        if (raw[cursor] === ',') end = cursor + 1;
        else {
            cursor = start - 1; while (cursor > open && /\s/u.test(raw[cursor])) cursor--;
            if (raw[cursor] === ',') start = cursor;
        }
        return raw.slice(0, start) + raw.slice(end);
    }
    if (jsonValue === null) return raw;
    const multiline = inner.includes('\n');
    const indent = multiline ? (inner.match(/\n([ \t]*)\S/u)?.[1] ?? '  ') : ' ';
    const prefix = properties.length ? ',' : '';
    const insertion = multiline ? `${prefix}\n${indent}"${key}": ${jsonValue}` : `${prefix} "${key}": ${jsonValue}`;
    const trailingWhitespace = multiline ? (inner.match(/\s*$/u)?.[0] ?? '') : '';
    const insertionAt = close - trailingWhitespace.length;
    return raw.slice(0, insertionAt) + insertion + raw.slice(insertionAt);
}
