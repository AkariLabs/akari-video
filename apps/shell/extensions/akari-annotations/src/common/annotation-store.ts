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

/** アンカーは描き始めフレーム（review セッション契約 §4.1 の frame と同義）。 */
export interface AnnotationStrokeFrame {
    sourceT: number;
    cutIndex: number | null;
}

/**
 * annotation への着地型（review セッション契約 §4.2）。strokes.json 原本の間引き済みポリライン
 * を review.json に埋め込み、`sessionRef` で原本（review/sessions/<id>/strokes.json）を指す。
 */
export interface AnnotationStroke {
    tool: 'pen';
    space: 'content-rect';
    frame: AnnotationStrokeFrame;
    /** 正規化 0〜1・content-rect 基準の間引き済みポリライン（〜100 点程度） */
    points: [number, number][];
    sessionRef: string;
}

export type AnnotationRef = { src: string } | { path: string };

export type AnnotationSessionConfidence = 'high' | 'medium' | 'low';

/** review セッション契約 §6: コンパイラが annotation に書く出所参照。 */
export interface AnnotationSessionRef {
    id: string;
    recRange: [number, number];
    confidence: AnnotationSessionConfidence;
}

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
    input: 'typed' | 'voice' | 'session';
    audio: string | null;
    /** 発話原文（review セッション契約 §6）。text は正規化済み指示文、これは聴感の温度を残す原文 */
    transcript: string | null;
    /** review セッションからの着地の出所参照（review セッション契約 §6） */
    session: AnnotationSessionRef | null;
    poses: null;
    status: 'open' | 'addressed' | 'resolved';
    response: AnnotationResponse | null;
}

const STATUSES = new Set(['open', 'addressed', 'resolved']);
const INPUTS = new Set(['typed', 'voice', 'session']);
const TARGET_KINDS = new Set<AnnotationTargetKind>(['instant', 'range', 'region', 'asset', 'insert']);
const SESSION_CONFIDENCES = new Set<AnnotationSessionConfidence>(['high', 'medium', 'low']);

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
        transcript: normalizeOptionalString(value.transcript),
        session: normalizeSessionRef(value.session, value.id, warnings),
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
        const normalized = normalizeStroke(stroke);
        if (normalized) {
            strokes.push(normalized);
        } else {
            warnings.push(`注釈 ${id} の strokes に不正なストロークがあるため一部を無視します。`);
        }
    }
    return strokes.length > 0 ? strokes : null;
}

/** review セッション契約 §4.2 の annotation 着地型（`{tool, space, frame, points, sessionRef}`）を検証する。 */
function normalizeStroke(value: any): AnnotationStroke | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.tool !== 'pen' || value.space !== 'content-rect') {
        return undefined;
    }
    const frame = value.frame;
    if (!frame || typeof frame !== 'object' || typeof frame.sourceT !== 'number' || !Number.isFinite(frame.sourceT)) {
        return undefined;
    }
    const cutIndex = typeof frame.cutIndex === 'number' && Number.isFinite(frame.cutIndex) ? frame.cutIndex : null;
    if (!Array.isArray(value.points) || value.points.length < 2
        || !value.points.every((point: unknown) => Array.isArray(point) && point.length === 2
            && point.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1))) {
        return undefined;
    }
    if (typeof value.sessionRef !== 'string' || !value.sessionRef.trim()) {
        return undefined;
    }
    return {
        tool: 'pen',
        space: 'content-rect',
        frame: { sourceT: frame.sourceT, cutIndex },
        points: value.points.map((point: [number, number]) => [point[0], point[1]] as [number, number]),
        sessionRef: value.sessionRef
    };
}

export function normalizeSessionRef(value: any, id: string, warnings: string[]): AnnotationSessionRef | null {
    if (value === undefined || value === null) {
        return null;
    }
    const recRange = value && typeof value === 'object' && Array.isArray(value.recRange) && value.recRange.length === 2
        && value.recRange.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry))
        ? [value.recRange[0], value.recRange[1]] as [number, number]
        : undefined;
    if (value && typeof value === 'object'
        && typeof value.id === 'string' && value.id.trim()
        && recRange
        && typeof value.confidence === 'string' && SESSION_CONFIDENCES.has(value.confidence as AnnotationSessionConfidence)) {
        return { id: value.id, recRange, confidence: value.confidence as AnnotationSessionConfidence };
    }
    warnings.push(`注釈 ${id} の session が不正なため無視します。`);
    return null;
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
        `"transcript":${annotation.transcript === null ? 'null' : JSON.stringify(annotation.transcript)},` +
        `"session":${annotation.session === null ? 'null' : JSON.stringify(annotation.session)},` +
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

/**
 * 注釈 1 件分の object 区間（`{`〜対応する`}`）を、id フィールドの一致で特定する。
 * `appendAnnotationLine` が書く 1 注釈 1 行の形式だけでなく、pretty-print 済みの
 * review.json（人手・他ツール由来。実データ selection-dogfood 等）でも id と status が
 * 別々の行に分かれるため、行単位の照合ではなく括弧の対応で区間を求める。
 */
function findAnnotationObjectSpan(source: string, annotationId: string): { start: number; end: number } {
    const idPattern = new RegExp(`"id"\\s*:\\s*"${escapeForRegExp(annotationId)}"`);
    const stack: number[] = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        } else if (character === '{') {
            stack.push(index);
        } else if (character === '}') {
            const start = stack.pop();
            if (start === undefined) {
                throw new Error('review.json の括弧の対応を確認できません。');
            }
            if (idPattern.test(source.slice(start, index + 1))) {
                return { start, end: index };
            }
        }
    }
    throw new Error(`注釈 ${annotationId} がレビューデータにありません。`);
}

function escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function updateStatusLine(source: string, annotationId: string, fromStatuses: readonly string[], toStatus: string): string {
    const idPattern = new RegExp(`"id"\\s*:\\s*"${escapeForRegExp(annotationId)}"`, 'g');
    const occurrences = source.match(idPattern)?.length ?? 0;
    if (occurrences > 1) {
        throw new Error(`注釈 ${annotationId} がレビューデータに複数あります。`);
    }
    const { start, end } = findAnnotationObjectSpan(source, annotationId);
    const objectText = source.slice(start, end + 1);
    const statusMatch = objectText.match(/"status"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const currentStatus = statusMatch ? decodeJsonString(statusMatch[1]) : undefined;
    if (!currentStatus || !fromStatuses.includes(currentStatus)) {
        throw new Error(`注釈 ${annotationId} は現在の状態（${currentStatus ?? '不明'}）から変更できません。`);
    }
    const updatedObjectText = objectText.replace(
        /("status"\s*:\s*)"(?:\\.|[^"\\])*"/, (_match, prefix) => `${prefix}${JSON.stringify(toStatus)}`
    );
    return source.slice(0, start) + updatedObjectText + source.slice(end + 1);
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
