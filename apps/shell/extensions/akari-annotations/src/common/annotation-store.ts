export interface AnnotationResponse {
    summary: string;
    action: 'edited' | 'declined';
    respondedAt: string;
}

export interface Annotation {
    id: string;
    createdAt: string;
    sourceT: number;
    sourceRange: [number, number] | null;
    timelineT: number | null;
    target: string | null;
    text: string;
    input: 'typed' | 'voice';
    audio: string | null;
    strokes: null;
    poses: null;
    status: 'open' | 'addressed' | 'resolved';
    response: AnnotationResponse | null;
}

const STATUSES = new Set(['open', 'addressed', 'resolved']);
const INPUTS = new Set(['typed', 'voice']);

export function emptyReviewSource(): string {
    return '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n';
}

export function parseReview(source: string): { version: number; annotations: Annotation[]; warnings: string[] } {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || !Array.isArray(value.annotations)) {
        throw new Error('レビューデータの形式を確認できません。');
    }
    const warnings: string[] = [];
    const annotations: Annotation[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < value.annotations.length; index++) {
        const annotation = normalizeAnnotation(value.annotations[index], warnings, index);
        if (!annotation) {
            continue;
        }
        if (seenIds.has(annotation.id)) {
            warnings.push(`注釈 ${annotation.id} が重複しているため、後の行は表示しません。`);
            continue;
        }
        seenIds.add(annotation.id);
        annotations.push(annotation);
    }
    return { version: Number.isFinite(value.version) ? value.version : 0, annotations, warnings };
}

function normalizeAnnotation(value: any, warnings: string[], index: number): Annotation | undefined {
    const label = `${index + 1} 番目の注釈`;
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) {
        warnings.push(`${label}は id が不正なため表示しません。`);
        return undefined;
    }
    if (typeof value.createdAt !== 'string'
        || typeof value.sourceT !== 'number' || !Number.isFinite(value.sourceT)
        || typeof value.text !== 'string'
        || typeof value.status !== 'string' || !STATUSES.has(value.status)
        || typeof value.input !== 'string' || !INPUTS.has(value.input)) {
        warnings.push(`注釈 ${value.id} は時刻・状態・内容のいずれかが不正なため表示しません。`);
        return undefined;
    }
    if (value.strokes != null || value.poses != null) {
        warnings.push(`注釈 ${value.id} の予約フィールド（ペン・実演キャプチャ）はこのバージョンでは無視します。`);
    }
    const sourceRange = normalizeRange(value.sourceRange);
    const response = normalizeResponse(value.response);
    return {
        id: value.id,
        createdAt: value.createdAt,
        sourceT: value.sourceT,
        sourceRange,
        timelineT: typeof value.timelineT === 'number' && Number.isFinite(value.timelineT) ? value.timelineT : null,
        target: typeof value.target === 'string' && value.target ? value.target : null,
        text: value.text,
        input: value.input,
        audio: typeof value.audio === 'string' && value.audio ? value.audio : null,
        strokes: null,
        poses: null,
        status: value.status as Annotation['status'],
        response
    };
}

function normalizeRange(value: any): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) {
        return null;
    }
    const [start, end] = value;
    return typeof start === 'number' && typeof end === 'number'
        && Number.isFinite(start) && Number.isFinite(end) && start < end
        ? [start, end]
        : null;
}

function normalizeResponse(value: any): AnnotationResponse | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    if (typeof value.summary !== 'string' || (value.action !== 'edited' && value.action !== 'declined')
        || typeof value.respondedAt !== 'string') {
        return null;
    }
    return { summary: value.summary, action: value.action, respondedAt: value.respondedAt };
}

export function serializeAnnotationLine(annotation: Annotation): string {
    const range = annotation.sourceRange === null ? 'null' : `[${annotation.sourceRange[0]},${annotation.sourceRange[1]}]`;
    const response = annotation.response === null ? 'null' : JSON.stringify(annotation.response);
    return `{"id":${JSON.stringify(annotation.id)},"createdAt":${JSON.stringify(annotation.createdAt)},` +
        `"sourceT":${JSON.stringify(annotation.sourceT)},"sourceRange":${range},` +
        `"timelineT":${annotation.timelineT === null ? 'null' : JSON.stringify(annotation.timelineT)},` +
        `"target":${annotation.target === null ? 'null' : JSON.stringify(annotation.target)},` +
        `"text":${JSON.stringify(annotation.text)},"input":${JSON.stringify(annotation.input)},` +
        `"audio":${annotation.audio === null ? 'null' : JSON.stringify(annotation.audio)},` +
        `"strokes":null,"poses":null,"status":${JSON.stringify(annotation.status)},"response":${response}}`;
}

export function appendAnnotationLine(source: string, annotation: Annotation): string {
    const closing = /\n([ \t]*)\](\s*\}\s*\n?)$/.exec(source);
    if (!closing) {
        throw new Error('review.json の形式を確認できません。');
    }
    const indent = closing[1];
    const itemIndent = `${indent}  `;
    const beforeClosing = source.slice(0, closing.index);
    const isEmpty = /\[\s*$/.test(beforeClosing);
    const line = isEmpty
        ? `${itemIndent}${serializeAnnotationLine(annotation)}`
        : `${itemIndent}, ${serializeAnnotationLine(annotation)}`;
    return `${beforeClosing}\n${line}\n${indent}]${closing[2]}`;
}

export function updateStatusLine(source: string, annotationId: string, fromStatuses: readonly string[], toStatus: string): string {
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== annotationId) {
            return line;
        }
        matches++;
        const statusMatch = line.match(/"status"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const currentStatus = statusMatch ? decodeJsonString(statusMatch[1]) : undefined;
        if (!currentStatus || !fromStatuses.includes(currentStatus)) {
            throw new Error(`注釈 ${annotationId} は現在の状態（${currentStatus ?? '不明'}）から変更できません。`);
        }
        return line.replace(/("status"\s*:\s*)"(?:\\.|[^"\\])*"/, (_match, prefix) => `${prefix}${JSON.stringify(toStatus)}`);
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `注釈 ${annotationId} がレビューデータにありません。`
            : `注釈 ${annotationId} がレビューデータに複数あります。`);
    }
    return updated;
}

export function nextAnnotationId(annotations: readonly Annotation[]): string {
    const next = annotations.reduce((maximum, annotation) => {
        const match = /^a-(\d{4,})$/.exec(annotation.id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    return `a-${String(next).padStart(4, '0')}`;
}

function decodeJsonString(value: string): string {
    try {
        return JSON.parse(`"${value}"`);
    } catch {
        return value;
    }
}
