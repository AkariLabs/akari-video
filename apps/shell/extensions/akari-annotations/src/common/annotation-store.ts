export interface AnnotationResponse {
    summary: string;
    action: 'edited' | 'declined';
    respondedAt: string;
}

export type AnnotationTargetKind = 'instant' | 'range' | 'region' | 'asset' | 'insert';

export interface AnnotationRegion {
    /** [x, y, w, h] 正規化 0〜1・source フレーム基準（faceBox / crop.box と同形式） */
    box: [number, number, number, number];
}

/** フリーハンド 1 ストローク = [x, y] 点列（正規化 0〜1・source フレーム基準） */
export type AnnotationStroke = [number, number][];

export type AnnotationRef = { src: string } | { path: string };

export interface Annotation {
    id: string;
    createdAt: string;
    /** edit.json v1 の sources[].id 参照。null = 単一ソース互換 */
    src: string | null;
    sourceT: number;
    sourceRange: [number, number] | null;
    /** 非推奨。新規書き込みは常に null（timeline 位置は cuts[] から射影する） */
    timelineT: number | null;
    target: string | null;
    targetKind: AnnotationTargetKind | null;
    region: AnnotationRegion | null;
    strokes: AnnotationStroke[] | null;
    refs: AnnotationRef[] | null;
    insertPosition: 'before' | 'after' | null;
    intent: string | null;
    text: string;
    input: 'typed' | 'voice';
    audio: string | null;
    poses: null;
    status: 'open' | 'addressed' | 'resolved';
    response: AnnotationResponse | null;
}

const STATUSES = new Set(['open', 'addressed', 'resolved']);
const INPUTS = new Set(['typed', 'voice']);
const TARGET_KINDS = new Set<AnnotationTargetKind>(['instant', 'range', 'region', 'asset', 'insert']);

export function emptyReviewSource(): string {
    return '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n';
}

export function parseReview(source: string): { version: number; annotations: Annotation[]; warnings: string[] } {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || !Array.isArray(value.annotations)) {
        throw new Error('レビューデータの形式を確認できません。');
    }
    if (Number.isInteger(value.version) && value.version > 0) {
        throw new Error(`review.json の version ${value.version} は新しい形式です。スキル / アプリを更新してください。`);
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
    if (value.poses != null) {
        warnings.push(`注釈 ${value.id} の予約フィールド（実演キャプチャ）はこのバージョンでは無視します。`);
    }
    const timelineT = typeof value.timelineT === 'number' && Number.isFinite(value.timelineT) ? value.timelineT : null;
    if (timelineT !== null) {
        warnings.push(`注釈 ${value.id} の timelineT は非推奨です（timeline 位置は cuts[] から射影します）。`);
    }
    const sourceRange = normalizeRange(value.sourceRange);
    const response = normalizeResponse(value.response);
    return {
        id: value.id,
        createdAt: value.createdAt,
        src: normalizeOptionalString(value.src),
        sourceT: value.sourceT,
        sourceRange,
        timelineT,
        target: normalizeOptionalString(value.target),
        targetKind: normalizeTargetKind(value.targetKind, value.id, warnings),
        region: normalizeRegion(value.region, value.id, warnings),
        strokes: normalizeStrokes(value.strokes, value.id, warnings),
        refs: normalizeRefs(value.refs, value.id, warnings),
        insertPosition: normalizeInsertPosition(value.insertPosition, value.id, warnings),
        intent: normalizeOptionalString(value.intent),
        text: value.text,
        input: value.input,
        audio: normalizeOptionalString(value.audio),
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

function normalizeOptionalString(value: any): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

export function normalizeTargetKind(value: any, id: string, warnings: string[]): AnnotationTargetKind | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || !TARGET_KINDS.has(value as AnnotationTargetKind)) {
        warnings.push(`注釈 ${id} の targetKind が不正なため無視します。`);
        return null;
    }
    return value as AnnotationTargetKind;
}

export function normalizeRegion(value: any, id: string, warnings: string[]): AnnotationRegion | null {
    if (value === undefined || value === null) {
        return null;
    }
    const box = value && typeof value === 'object' ? value.box : undefined;
    if (Array.isArray(box) && box.length === 4
        && box.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1)) {
        const [x, y, w, h] = box as number[];
        if (w > 0 && h > 0 && x + w <= 1 && y + h <= 1) {
            return { box: [x, y, w, h] };
        }
    }
    warnings.push(`注釈 ${id} の region が不正なため無視します。`);
    return null;
}

export function normalizeStrokes(value: any, id: string, warnings: string[]): AnnotationStroke[] | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Array.isArray(value)) {
        warnings.push(`注釈 ${id} の strokes が不正なため無視します。`);
        return null;
    }
    const strokes: AnnotationStroke[] = [];
    for (const stroke of value) {
        if (Array.isArray(stroke) && stroke.length >= 2
            && stroke.every(point => Array.isArray(point) && point.length === 2
                && point.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1))) {
            strokes.push(stroke.map(point => [point[0], point[1]] as [number, number]));
        } else {
            warnings.push(`注釈 ${id} の strokes に不正なストロークがあるため一部を無視します。`);
        }
    }
    return strokes.length > 0 ? strokes : null;
}

export function normalizeRefs(value: any, id: string, warnings: string[]): AnnotationRef[] | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (!Array.isArray(value)) {
        warnings.push(`注釈 ${id} の refs が不正なため無視します。`);
        return null;
    }
    const refs: AnnotationRef[] = [];
    for (const ref of value) {
        if (!ref || typeof ref !== 'object') {
            warnings.push(`注釈 ${id} の refs に不正な参照があるため一部を無視します。`);
            continue;
        }
        const hasSrc = typeof ref.src === 'string' && ref.src.trim();
        const hasPath = typeof ref.path === 'string' && ref.path.trim();
        if (hasSrc && !('path' in ref)) {
            refs.push({ src: ref.src });
        } else if (hasPath && !('src' in ref)) {
            refs.push({ path: ref.path });
        } else {
            warnings.push(`注釈 ${id} の refs は src / path のどちらか一方だけを持つ必要があるため一部を無視します。`);
        }
    }
    return refs.length > 0 ? refs : null;
}

export function normalizeInsertPosition(value: any, id: string, warnings: string[]): 'before' | 'after' | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (value !== 'before' && value !== 'after') {
        warnings.push(`注釈 ${id} の insertPosition が不正なため無視します。`);
        return null;
    }
    return value;
}

export function serializeAnnotationLine(annotation: Annotation): string {
    const range = annotation.sourceRange === null ? 'null' : `[${annotation.sourceRange[0]},${annotation.sourceRange[1]}]`;
    const response = annotation.response === null ? 'null' : JSON.stringify(annotation.response);
    return `{"id":${JSON.stringify(annotation.id)},"createdAt":${JSON.stringify(annotation.createdAt)},` +
        `"src":${annotation.src === null ? 'null' : JSON.stringify(annotation.src)},` +
        `"sourceT":${JSON.stringify(annotation.sourceT)},"sourceRange":${range},` +
        // timelineT は非推奨のため常に null で書く（契約 §1。timeline 位置は cuts[] から射影する）
        '"timelineT":null,' +
        `"target":${annotation.target === null ? 'null' : JSON.stringify(annotation.target)},` +
        `"targetKind":${annotation.targetKind === null ? 'null' : JSON.stringify(annotation.targetKind)},` +
        `"region":${annotation.region === null ? 'null' : JSON.stringify(annotation.region)},` +
        `"strokes":${annotation.strokes === null ? 'null' : JSON.stringify(annotation.strokes)},` +
        `"refs":${annotation.refs === null ? 'null' : JSON.stringify(annotation.refs)},` +
        `"insertPosition":${annotation.insertPosition === null ? 'null' : JSON.stringify(annotation.insertPosition)},` +
        `"intent":${annotation.intent === null ? 'null' : JSON.stringify(annotation.intent)},` +
        `"text":${JSON.stringify(annotation.text)},"input":${JSON.stringify(annotation.input)},` +
        `"audio":${annotation.audio === null ? 'null' : JSON.stringify(annotation.audio)},` +
        `"poses":null,"status":${JSON.stringify(annotation.status)},"response":${response}}`;
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
