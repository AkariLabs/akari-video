import {
    ITEM_V2_KEYS,
    KEYFRAME_V2_KEYS,
    MOTION_FILE_V0_KEYS,
} from './generated/edit-v2-keys';

type JsonRecord = Record<string, unknown>;

const ITEM_KEY_ORDER = [
    'id', 'name', 'at', 'duration', 'hidden', 'locked', 'transform', 'opacity',
    'blend', 'crop', 'perspective', 'motion', 'animator', 'keyframes', 'source', 'audio', 'items',
    'role', 'link', 'mute'
] as const;
const EDIT_KEY_ORDER = ['version', 'output', 'sources', 'audio', 'tracks'] as const;
const TRACK_KEY_ORDER = ['id', 'lane', 'name', 'muted', 'items', 'content'] as const;
const CAPTION_KEY_ORDER = [
    'id', 'start', 'end', 'text', 'speaker', 'sourceRef', 'edited', 'time_domain', 'text_style'
] as const;

export function serializeEdit(doc: unknown): string {
    const edit = requireRecord(doc, 'edit.json');
    return `${serializeTopObject(edit, EDIT_KEY_ORDER, (key, value, indent) => {
        if (key === 'tracks' && Array.isArray(value)) return serializeTracks(value, indent);
        if (key === 'sources' && Array.isArray(value)) {
            return serializeRecordArray(value, indent, entry => inline(entry));
        }
        return serializeTopValue(value, indent);
    })}\n`;
}

export function serializeCaptions(doc: unknown): string {
    if (Array.isArray(doc)) {
        return `${serializeRecordArray(doc, 0, entry => inlineOrdered(entry, CAPTION_KEY_ORDER))}\n`;
    }
    const root = requireRecord(doc, 'captions.json');
    return `${serializeTopObject(root, Object.keys(root), (key, value, indent) =>
        key === 'captions' && Array.isArray(value)
            ? serializeRecordArray(value, indent, entry => inlineOrdered(entry, CAPTION_KEY_ORDER))
            : serializeTopValue(value, indent))}\n`;
}

export function serializeMotion(doc: unknown): string {
    const motion = requireRecord(doc, 'motion/*.json');
    return `${serializeTopObject(motion, MOTION_FILE_V0_KEYS, (key, value, indent) => {
        if (key !== 'items' || !isRecord(value)) return serializeTopValue(value, indent);
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        const lines = ['{'];
        entries.forEach(([id, points], index) => {
            const prefix = `${' '.repeat(indent + 2)}${JSON.stringify(id)}: `;
            if (!Array.isArray(points) || points.length === 0) {
                lines.push(`${prefix}[]${index + 1 < entries.length ? ',' : ''}`);
                return;
            }
            lines.push(`${prefix}[`);
            const orderedPoints = [...points].sort((left, right) => frameOf(left) - frameOf(right));
            orderedPoints.forEach((point, pointIndex) => {
                lines.push(`${' '.repeat(indent + 4)}${inlineOrdered(point, KEYFRAME_V2_KEYS)}${pointIndex + 1 < orderedPoints.length ? ',' : ''}`);
            });
            lines.push(`${' '.repeat(indent + 2)}]${index + 1 < entries.length ? ',' : ''}`);
        });
        lines.push(`${' '.repeat(indent)}}`);
        return lines.join('\n');
    })}\n`;
}

function serializeTopObject(
    value: JsonRecord,
    preferred: readonly string[],
    render: (key: string, value: unknown, indent: number) => string
): string {
    const keys = orderedKeys(value, preferred);
    if (keys.length === 0) return '{}';
    const lines = ['{'];
    keys.forEach((key, index) => {
        const rendered = render(key, value[key], 2);
        const renderedLines = rendered.split('\n');
        lines.push(`  ${JSON.stringify(key)}: ${renderedLines[0]}`);
        for (const line of renderedLines.slice(1)) lines.push(line);
        if (index + 1 < keys.length) lines[lines.length - 1] += ',';
    });
    lines.push('}');
    return lines.join('\n');
}

function serializeTopValue(value: unknown, indent: number): string {
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return serializeStructuredArray(value, indent);
    }
    if (isRecord(value) && hasNonEmptyArray(value)) {
        return serializeStructuredObject(value, indent);
    }
    return inline(value);
}

function serializeStructuredArray(values: unknown[], indent: number): string {
    const lines = ['['];
    values.forEach((entry, index) => {
        const rendered = serializeTopValue(entry, indent + 2).split('\n');
        lines.push(`${' '.repeat(indent + 2)}${rendered[0]}`);
        lines.push(...rendered.slice(1));
        if (index + 1 < values.length) lines[lines.length - 1] += ',';
    });
    lines.push(`${' '.repeat(indent)}]`);
    return lines.join('\n');
}

function serializeStructuredObject(value: JsonRecord, indent: number): string {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = ['{'];
    entries.forEach(([key, entry], index) => {
        const rendered = serializeTopValue(entry, indent + 2).split('\n');
        lines.push(`${' '.repeat(indent + 2)}${JSON.stringify(key)}: ${rendered[0]}`);
        lines.push(...rendered.slice(1));
        if (index + 1 < entries.length) lines[lines.length - 1] += ',';
    });
    lines.push(`${' '.repeat(indent)}}`);
    return lines.join('\n');
}

function hasNonEmptyArray(value: JsonRecord): boolean {
    return Object.values(value).some(entry => Array.isArray(entry) && entry.length > 0);
}

function serializeTracks(tracks: unknown[], indent: number): string {
    if (tracks.length === 0) return '[]';
    const lines = ['['];
    tracks.forEach((track, index) => {
        const record = requireRecord(track, 'edit.json.tracks[]');
        const rendered = serializeItemLike(record, indent + 2, true);
        lines.push(...appendComma(rendered, index + 1 < tracks.length));
    });
    lines.push(`${' '.repeat(indent)}]`);
    return lines.join('\n');
}

function serializeItemLike(value: JsonRecord, indent: number, track = false): string[] {
    const children = value.items;
    const preferred = track
        ? [...TRACK_KEY_ORDER]
        : [...ITEM_KEY_ORDER, ...ITEM_V2_KEYS.filter(key => !ITEM_KEY_ORDER.includes(key as typeof ITEM_KEY_ORDER[number]))];
    if (!Array.isArray(children) || children.length === 0) {
        return [`${' '.repeat(indent)}${inlineObject(value, preferred, !track)}`];
    }
    const keys = orderedKeys(value, preferred).filter(key => key !== 'items');
    const body = keys.map(key => `${JSON.stringify(key)}: ${inlineField(key, value[key], !track)}`).join(', ');
    const lines = [`${' '.repeat(indent)}{ ${body}${body ? ', ' : ''}"items": [`];
    children.forEach((child, index) => {
        const childRecord = requireRecord(child, 'item.items[]');
        lines.push(...appendComma(serializeItemLike(childRecord, indent + 2), index + 1 < children.length));
    });
    lines.push(`${' '.repeat(indent)}] }`);
    return lines;
}

function serializeRecordArray(
    values: unknown[],
    indent: number,
    render: (entry: unknown) => string
): string {
    if (values.length === 0) return '[]';
    const lines = ['['];
    values.forEach((entry, index) => {
        lines.push(`${' '.repeat(indent + 2)}${render(entry)}${index + 1 < values.length ? ',' : ''}`);
    });
    lines.push(`${' '.repeat(indent)}]`);
    return lines.join('\n');
}

function inlineField(key: string, value: unknown, item: boolean): string {
    if (item && key === 'source' && isRecord(value)) return inlineObject(value, ['kind']);
    if (item && key === 'keyframes' && Array.isArray(value)) {
        return `[${value.map(point => inlineOrdered(point, KEYFRAME_V2_KEYS)).join(', ')}]`;
    }
    return inline(value);
}

function inlineOrdered(value: unknown, preferred: readonly string[]): string {
    return isRecord(value) ? inlineObject(value, preferred) : inline(value);
}

function inlineObject(value: JsonRecord, preferred: readonly string[], item = false): string {
    const keys = orderedKeys(value, preferred);
    if (keys.length === 0) return '{}';
    return `{ ${keys.map(key => `${JSON.stringify(key)}: ${inlineField(key, value[key], item)}`).join(', ')} }`;
}

function inline(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(entry => inline(entry)).join(', ')}]`;
    if (isRecord(value)) return inlineObject(value, Object.keys(value));
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'null' : serialized;
}

function orderedKeys(value: JsonRecord, preferred: readonly string[]): string[] {
    const present = new Set(Object.keys(value).filter(key => value[key] !== undefined));
    const keys = preferred.filter(key => present.delete(key));
    return [...keys, ...Object.keys(value).filter(key => present.has(key))];
}

function appendComma(lines: string[], comma: boolean): string[] {
    if (comma) lines[lines.length - 1] += ',';
    return lines;
}

function frameOf(value: unknown): number {
    return isRecord(value) && typeof value.t === 'number' ? value.t : Number.POSITIVE_INFINITY;
}

function requireRecord(value: unknown, label: string): JsonRecord {
    if (!isRecord(value)) throw new Error(`${label} は object である必要があります。`);
    return value;
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
