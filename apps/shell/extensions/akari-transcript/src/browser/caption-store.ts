import {
    applyCaptionTextEdit,
    insertCaptionLine,
    parseCaptions as parseCaptionRecords,
    removeCaptionLine,
    setCaptionTimingLine,
    type CaptionRecord,
    type CaptionTextEditRecord
} from '@akari-video/edit-store';
import {
    createCaptionIdAllocator,
    planInsertSpans,
    planSplitSpans,
    type CaptionLineOp
} from '@akari-video/edit-store/lib/caption-line-diff';
import { clipUnrecognizedToRange } from '../common/daihon-unrecognized';

export interface CaptionSourceRef {
    segment: number;
}

export interface CaptionWord {
    start: number;
    end: number;
    text: string;
}

export interface Caption {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: CaptionSourceRef | null;
    edited: boolean;
    src?: string;
    timeDomain?: 'source' | 'output';
    words?: CaptionWord[];
    unrecognized?: { start: number; end: number }[];
    style?: string;
    displayText?: string;
    displayFragments?: string[];
    stylePreset?: string;
    textStyle?: unknown;
    extra?: Record<string, unknown>;
}

export interface AnalysisSegment {
    start: number;
    end: number;
    text: string;
    unrecognized?: { start: number; end: number }[];
}

export interface RegenerationResult {
    captions: Caption[];
    source: string;
    warnings: string[];
}

/**
 * captions.json のルート形式（captions.schema.json は配列そのままと
 * { default_text_style?, captions: [...] } のオブジェクト形式の両方を許す）。
 * 書き戻しで元の形式と default_text_style を保持するために持ち回る。
 */
export interface CaptionsDocumentShape {
    root: 'array' | 'object';
    /** オブジェクト形式のときの default_text_style 原値（無ければ undefined） */
    defaultTextStyle?: unknown;
}

export interface DerivedCaptionWord {
    start: number;
    end: number;
    text: string;
}

/**
 * This intentionally mirrors the small akari-surfaces helper instead of importing it.
 * The extensions are independent TypeScript projects; keeping this pure helper local
 * avoids coupling their build roots while preserving the one-physical-line write rule.
 */
export function replaceCaptionLine(source: string, captionId: string, text: string): string {
    if (!captionId) {
        throw new Error('字幕の識別情報がありません。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        const openIndex = line.indexOf('{');
        const closeIndex = line.lastIndexOf('}');
        if (openIndex < 0 || closeIndex < openIndex) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        const record = JSON.parse(line.slice(openIndex, closeIndex + 1)) as CaptionTextEditRecord;
        const updated = applyCaptionTextEdit(record, text).record;
        if (updated === record) return line;
        return line.slice(0, openIndex) + JSON.stringify(updated) + line.slice(closeIndex + 1);
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}

export function replaceCaptionDisplayTextLine(source: string, captionId: string, text: string): string {
    if (!captionId) {
        throw new Error('字幕の識別情報がありません。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        if (!/"display_text"\s*:\s*"(?:\\.|[^"\\])*"/.test(line)) {
            throw new Error(`字幕 ${captionId} に整文（display_text）がありません。`);
        }
        return line.replace(
            /("display_text"\s*:\s*)"(?:\\.|[^"\\])*"/,
            (_match, prefix) => `${prefix}${JSON.stringify(text)}`
        );
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}

/**
 * 1 行の `words`（単語タイミング）を落とす行手術。行の結合は複数行のテキストと時刻を 1 行へ
 * 畳むため、既存 words を再導出できる保証が無い（task 2026-09-08-caption-line-ops 指示 C-9）。
 * replaceCaptionLine と同じく「1 レコード 1 物理行」を前提にその行だけを書き換える。
 * words を持たない行に対しては本文を変えない（冪等）。
 */
export function removeCaptionWordsLine(source: string, captionId: string): string {
    if (!captionId) {
        throw new Error('字幕の識別情報がありません。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        const openIndex = line.indexOf('{');
        const closeIndex = line.lastIndexOf('}');
        if (openIndex < 0 || closeIndex < openIndex) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        const record = JSON.parse(line.slice(openIndex, closeIndex + 1)) as Record<string, unknown>;
        if (record.words === undefined) {
            return line;
        }
        delete record.words;
        return line.slice(0, openIndex) + JSON.stringify(record) + line.slice(closeIndex + 1);
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}

export interface CaptionLineOpCounts {
    replace: number;
    split: number;
    merge: number;
    remove: number;
    insert: number;
}

export interface CaptionLineOpsResult {
    /** 全操作を適用したあとの captions.json 本文（呼び出し側が lint ゲート越しに 1 回だけ書く）。 */
    source: string;
    /** 拒否・スキップした操作の理由。空なら全部保存できた。 */
    notices: string[];
    counts: CaptionLineOpCounts;
    /** 保存できた操作の数（拒否したものは数えない）。 */
    applied: number;
    /** 字幕の件数が変わったか（フッター文言の切り替えに使う）。 */
    lineCountChanged: boolean;
}

export interface CaptionLineOpsOptions {
    /** 整文（display_text）表示中の字幕 id。replace のときだけ display_text 側を書き換える。 */
    displayTextIds?: ReadonlySet<string>;
}

const EMPTY_LINE_NOTICE = '空の行は字幕になりません。文字を入れると保存します。';
const SPLIT_TOO_SHORT_NOTICE = 'この行は短すぎて分割できません。';
const INSERT_NO_GAP_NOTICE = 'ここには字幕を追加できません（前後に隙間がありません）。';
const MERGE_STYLE_LOST_NOTICE = '結合したため 2 行目以降のスタイル指定は失われました。';
const UNREADABLE_RECORD_NOTICE = 'この行の字幕データを解釈できないため、この操作は保存しません。';

/**
 * diffCaptionLines が返した操作列を captions.json 本文へ適用する
 * （task 2026-09-08-caption-line-ops 指示 E-12・司令塔裁定 3 = 一括適用）。
 *
 * 書き戻しは既存の外科手術関数の合成だけで行う:
 *   replace → replaceCaptionLine / replaceCaptionDisplayTextLine
 *   remove  → removeCaptionLine
 *   insert  → insertCaptionLine
 *   split   → removeCaptionLine + insertCaptionLine ×n
 *   merge   → replaceCaptionLine + setCaptionTimingLine + removeCaptionWordsLine + removeCaptionLine ×(n-1)
 *
 * 拒否された操作があっても成功した分は残す（指示 15）。時刻は元の字幕の値だけから決めるので、
 * 同じ入力からは常に同じ本文になる。
 */
export function applyCaptionLineOps(
    source: string,
    ops: readonly CaptionLineOp[],
    options: CaptionLineOpsOptions = {}
): CaptionLineOpsResult {
    const captions = parseCaptions(source).captions;
    const byId = new Map(captions.map(caption => [caption.id, caption]));
    const allocateId = createCaptionIdAllocator(captions.map(caption => caption.id));
    const counts: CaptionLineOpCounts = { replace: 0, split: 0, merge: 0, remove: 0, insert: 0 };
    const notices: string[] = [];
    const addNotice = (message: string): void => {
        if (!notices.includes(message)) notices.push(message);
    };
    let current = source;

    for (const group of groupCaptionLineOps(ops)) {
        if (group.kind === 'insert') {
            const texts: string[] = [];
            for (const text of group.texts) {
                const normalized = normalizeLineText(text);
                if (normalized) texts.push(normalized);
                else addNotice(EMPTY_LINE_NOTICE);
            }
            if (texts.length === 0) continue;
            const anchor = group.afterId === undefined
                ? -1
                : captions.findIndex(caption => caption.id === group.afterId);
            const previousEnd = anchor < 0 ? 0 : captions[anchor].end;
            const spans = planInsertSpans(previousEnd, captions[anchor + 1]?.start, texts.length);
            if (!spans) {
                addNotice(INSERT_NO_GAP_NOTICE);
                continue;
            }
            for (let index = 0; index < texts.length; index++) {
                current = insertCaptionLine(current, {
                    id: allocateId(),
                    start: spans[index].start,
                    end: spans[index].end,
                    text: texts[index],
                    speaker: null,
                    sourceRef: null,
                    edited: true
                });
                counts.insert++;
            }
            continue;
        }

        const op = group.op;
        if (op.kind === 'replace') {
            const caption = byId.get(op.id);
            const text = normalizeLineText(op.text);
            if (!caption) continue;
            if (!text) {
                addNotice(EMPTY_LINE_NOTICE);
                continue;
            }
            current = options.displayTextIds?.has(op.id) && caption.displayText !== undefined
                ? replaceCaptionDisplayTextLine(current, op.id, text)
                : replaceCaptionLine(current, op.id, text);
            counts.replace++;
            continue;
        }

        if (op.kind === 'remove') {
            if (!byId.has(op.id)) continue;
            current = removeCaptionLine(current, op.id);
            counts.remove++;
            continue;
        }

        if (op.kind === 'split') {
            const caption = byId.get(op.id);
            if (!caption) continue;
            const texts = op.texts.map(normalizeLineText);
            if (texts.some(text => !text)) {
                addNotice(EMPTY_LINE_NOTICE);
                continue;
            }
            const spans = planSplitSpans(caption.start, caption.end, texts);
            if (!spans) {
                addNotice(SPLIT_TOO_SHORT_NOTICE);
                continue;
            }
            const base = toInsertableRecord(caption);
            if (!base) {
                addNotice(UNREADABLE_RECORD_NOTICE);
                continue;
            }
            current = removeCaptionLine(current, op.id);
            for (let index = 0; index < texts.length; index++) {
                const unrecognized = clipUnrecognizedToRange(
                    caption.unrecognized,
                    spans[index].start,
                    spans[index].end
                );
                current = insertCaptionLine(current, {
                    ...base,
                    // 1 本目は元の id を残す（overlay の anchor.caption を切らない）。
                    // 増えた行だけ新しい id を振る。
                    id: index === 0 ? op.id : allocateId(),
                    start: spans[index].start,
                    end: spans[index].end,
                    text: texts[index],
                    edited: true,
                    ...(unrecognized.length > 0 ? { unrecognized } : {})
                });
            }
            counts.split++;
            continue;
        }

        const head = byId.get(op.ids[0]);
        const tail = byId.get(op.ids[op.ids.length - 1]);
        const text = normalizeLineText(op.text);
        if (!head || !tail) continue;
        if (!text) {
            addNotice(EMPTY_LINE_NOTICE);
            continue;
        }
        if (op.ids.slice(1).some(id => !sameLineStyle(head, byId.get(id)))) {
            addNotice(MERGE_STYLE_LOST_NOTICE);
        }
        current = replaceCaptionLine(current, head.id, text);
        current = setCaptionTimingLine(current, head.id, head.start, tail.end, head.timeDomain ?? null, true);
        current = removeCaptionWordsLine(current, head.id);
        for (const id of op.ids.slice(1)) {
            current = removeCaptionLine(current, id);
        }
        counts.merge++;
    }

    const applied = counts.replace + counts.split + counts.merge + counts.remove + counts.insert;
    return {
        source: current,
        notices,
        counts,
        applied,
        lineCountChanged: counts.split + counts.merge + counts.remove + counts.insert > 0
    };
}

type CaptionLineOpGroup =
    | { kind: 'insert'; afterId: string | undefined; texts: string[] }
    | { kind: 'single'; op: Exclude<CaptionLineOp, { kind: 'insert' }> };

/** 同じ位置へ続けて入る insert は 1 つの隙間へまとめて割り付ける。 */
function groupCaptionLineOps(ops: readonly CaptionLineOp[]): CaptionLineOpGroup[] {
    const groups: CaptionLineOpGroup[] = [];
    for (const op of ops) {
        if (op.kind !== 'insert') {
            groups.push({ kind: 'single', op });
            continue;
        }
        const previous = groups[groups.length - 1];
        if (previous?.kind === 'insert' && previous.afterId === op.afterId) {
            previous.texts.push(op.text);
        } else {
            groups.push({ kind: 'insert', afterId: op.afterId, texts: [op.text] });
        }
    }
    return groups;
}

function normalizeLineText(text: string): string {
    return text.normalize('NFC').trim();
}

/** 結合で捨てられる側のスタイル指定が実際に head と違うか（違うときだけ notice を出す）。 */
function sameLineStyle(head: Caption, other: Caption | undefined): boolean {
    if (!other) return true;
    return JSON.stringify(head.textStyle ?? null) === JSON.stringify(other.textStyle ?? null)
        && (head.stylePreset ?? null) === (other.stylePreset ?? null)
        && (head.style ?? null) === (other.style ?? null);
}

/**
 * 分割後の行の雛形（元の行固有プロパティを引き継ぐ CaptionRecord）を作る。
 * text_style は snake_case のままでは insertCaptionLine が読めないため edit-store の
 * parseCaptions で camelCase へ正規化する。**style_preset は渡さない** —
 * edit-store の parseCaptions はプリセットを text_style へ展開してしまうので、
 * 参照のまま持ち回るために正規化の外で足し直す。
 * words / display_text / display_fragments は引き継がない（指示 C-9）。
 */
function toInsertableRecord(caption: Caption): CaptionRecord | undefined {
    const probe = {
        id: caption.id,
        start: caption.start,
        end: caption.end,
        text: caption.text,
        speaker: caption.speaker,
        sourceRef: caption.sourceRef,
        edited: caption.edited,
        ...(caption.timeDomain === undefined ? {} : { time_domain: caption.timeDomain }),
        ...(caption.textStyle === undefined ? {} : { text_style: caption.textStyle })
    };
    const [normalized] = parseCaptionRecords(JSON.stringify([probe])).captions;
    if (!normalized) return undefined;
    return {
        ...normalized,
        ...(caption.src === undefined ? {} : { src: caption.src }),
        ...(caption.style === undefined ? {} : { style: caption.style as CaptionRecord['style'] }),
        ...(caption.stylePreset === undefined ? {} : { stylePreset: caption.stylePreset }),
        ...(caption.extra === undefined ? {} : { extra: caption.extra })
    };
}

/** 配列ルート / オブジェクトルートの両形式からレコード列と形式情報を取り出す。 */
function extractCaptionRecords(value: unknown): { records: unknown[]; shape: CaptionsDocumentShape } {
    if (Array.isArray(value)) {
        return { records: value, shape: { root: 'array' } };
    }
    if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).captions)) {
        const root = value as Record<string, unknown>;
        return {
            records: root.captions as unknown[],
            shape: {
                root: 'object',
                ...(root.default_text_style !== undefined ? { defaultTextStyle: root.default_text_style } : {})
            }
        };
    }
    throw new Error('字幕データの形式を確認できません。');
}

export function parseCaptions(source: string): {
    captions: Caption[];
    warnings: string[];
    shape: CaptionsDocumentShape;
} {
    const { records, shape } = extractCaptionRecords(JSON.parse(source));
    const captions: Caption[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < records.length; index++) {
        const caption = normalizeCaption(records[index]);
        if (!caption) {
            warnings.push(`${index + 1} 番目の字幕は時刻または内容が不正なため表示しません。`);
            continue;
        }
        if (seenIds.has(caption.id)) {
            warnings.push(`字幕 ${caption.id} が重複しているため、後の行は表示しません。`);
            continue;
        }
        seenIds.add(caption.id);
        captions.push(caption);
    }
    return { captions, warnings, shape };
}

export function regenerateCaptions(analysisSource: string, existingSource?: string): RegenerationResult {
    const analysis = JSON.parse(analysisSource);
    if (!Array.isArray(analysis?.transcript)) {
        throw new Error('文字起こしの内容がありません。');
    }

    const warnings: string[] = [];
    const segments = new Map<number, AnalysisSegment>();
    for (let index = 0; index < analysis.transcript.length; index++) {
        const segment = normalizeSegment(analysis.transcript[index]);
        if (segment) {
            segments.set(index, segment);
        } else {
            warnings.push(`${index + 1} 番目の文字起こしは時刻または内容が不正なため使いません。`);
        }
    }

    const existing: Caption[] = [];
    let shape: CaptionsDocumentShape = { root: 'array' };
    if (existingSource !== undefined) {
        let records: unknown[];
        try {
            ({ records, shape } = extractCaptionRecords(JSON.parse(existingSource)));
        } catch (error) {
            throw error instanceof SyntaxError
                ? error
                : new Error('既存の字幕データの形式を確認できません。');
        }
        for (let index = 0; index < records.length; index++) {
            const value = records[index];
            const caption = normalizeCaptionForRegeneration(value);
            if (!caption) {
                warnings.push(`既存の ${index + 1} 番目の字幕は時刻または内容が不正なため使いません。`);
                continue;
            }
            existing.push(caption);
        }
    }

    const usedIds = new Set(existing.map(caption => caption.id));
    let nextSequence = existing.reduce((maximum, caption) => {
        const match = /^c-(\d{4,})$/.exec(caption.id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    const nextId = (): string => {
        let candidate: string;
        do {
            candidate = `c-${String(nextSequence++).padStart(4, '0')}`;
        } while (usedIds.has(candidate));
        usedIds.add(candidate);
        return candidate;
    };

    const bySegment = new Map<number, Caption>();
    const unpaired: Caption[] = [];
    for (const caption of existing) {
        const segment = caption.sourceRef?.segment;
        if (segment !== undefined && !bySegment.has(segment)) {
            bySegment.set(segment, caption);
        } else {
            unpaired.push(caption);
        }
    }

    const captions: Caption[] = [];
    for (const [segmentIndex, segment] of segments) {
        const current = bySegment.get(segmentIndex);
        if (current) {
            bySegment.delete(segmentIndex);
            if (current.edited) {
                captions.push(current);
            } else {
                const preserved = { ...current };
                delete preserved.unrecognized;
                delete preserved.displayText;
                delete preserved.displayFragments;
                const unrecognized = clipUnrecognizedToRange(segment.unrecognized, segment.start, segment.end);
                captions.push({
                    ...preserved,
                    id: current.id,
                    start: segment.start,
                    end: segment.end,
                    text: segment.text,
                    speaker: null,
                    sourceRef: { segment: segmentIndex },
                    edited: false,
                    ...(unrecognized.length > 0 ? { unrecognized } : {})
                });
            }
        } else {
            const unrecognized = clipUnrecognizedToRange(segment.unrecognized, segment.start, segment.end);
            captions.push({
                id: nextId(),
                start: segment.start,
                end: segment.end,
                text: segment.text,
                speaker: null,
                sourceRef: { segment: segmentIndex },
                edited: false,
                ...(unrecognized.length > 0 ? { unrecognized } : {})
            });
        }
    }

    for (const caption of [...bySegment.values(), ...unpaired]) {
        if (caption.sourceRef !== null) {
            warnings.push(`字幕 ${caption.id} の元の文字起こしが見つからないため、ID と内容を保持しました。`);
        }
        captions.push({ ...caption, sourceRef: null });
    }

    // 保持した既存字幕を末尾へ追記したままだと start 順が崩れ、captions.schema の
    // 並び順契約（edit-lint captions.order）に落ちる。安定ソートで時刻順に整える
    captions.sort((left, right) => left.start - right.start);

    // 既存がオブジェクト形式なら、その形式と default_text_style を保持して書き戻す
    return { captions, source: serializeCaptions(captions, shape), warnings };
}

export function serializeCaptions(captions: readonly Caption[], shape?: CaptionsDocumentShape): string {
    if (!shape || shape.root === 'array') {
        const rows = captions.map(caption => `  ${serializeCaption(caption)}`);
        return rows.length > 0 ? `[\n${rows.join(',\n')}\n]\n` : '[]\n';
    }
    // オブジェクト形式: default_text_style は 1 行の原値のまま、レコードは従来どおり
    // 1 レコード 1 物理行（replaceCaptionLine 系の行手術契約を維持する）
    const rows = captions.map(caption => `    ${serializeCaption(caption)}`);
    const defaultTextStyle = shape.defaultTextStyle !== undefined
        ? `  "default_text_style": ${JSON.stringify(shape.defaultTextStyle)},\n`
        : '';
    const body = rows.length > 0 ? `[\n${rows.join(',\n')}\n  ]` : '[]';
    return `{\n${defaultTextStyle}  "captions": ${body}\n}\n`;
}

/** Deterministic display-only timing derived from character count; it is never persisted to captions.json. */
export function deriveCaptionWords(caption: Pick<Caption, 'start' | 'end' | 'text'>): DerivedCaptionWord[] {
    const characters = Array.from(caption.text);
    if (characters.length === 0 || !Number.isFinite(caption.start) || !Number.isFinite(caption.end)
        || caption.start >= caption.end) {
        return [];
    }
    const duration = caption.end - caption.start;
    return characters.map((text, index) => ({
        start: caption.start + duration * index / characters.length,
        end: index === characters.length - 1
            ? caption.end
            : caption.start + duration * (index + 1) / characters.length,
        text
    }));
}

function serializeCaption(caption: Caption): string {
    const sourceRef = caption.sourceRef === null
        ? 'null'
        : `{"segment":${JSON.stringify(caption.sourceRef.segment)}}`;
    const src = caption.src === undefined
        ? ''
        : `,"src":${JSON.stringify(caption.src)}`;
    const timeDomain = caption.timeDomain === undefined
        ? ''
        : `,"time_domain":${JSON.stringify(caption.timeDomain)}`;
    const words = caption.words === undefined
        ? ''
        : `,"words":${JSON.stringify(caption.words)}`;
    const unrecognized = caption.unrecognized?.length
        ? `,"unrecognized":${JSON.stringify(caption.unrecognized)}`
        : '';
    const style = caption.style === undefined
        ? ''
        : `,"style":${JSON.stringify(caption.style)}`;
    const displayText = caption.displayText === undefined
        ? ''
        : `,"display_text":${JSON.stringify(caption.displayText)}`;
    const displayFragments = caption.displayFragments === undefined
        ? ''
        : `,"display_fragments":${JSON.stringify(caption.displayFragments)}`;
    const stylePreset = caption.stylePreset === undefined
        ? ''
        : `,"style_preset":${JSON.stringify(caption.stylePreset)}`;
    const textStyle = caption.textStyle === undefined
        ? ''
        : `,"text_style":${JSON.stringify(caption.textStyle)}`;
    const schemaKeys = new Set([
        'id', 'start', 'end', 'text', 'speaker', 'sourceRef', 'edited', 'src',
        'time_domain', 'words', 'unrecognized', 'style', 'display_text',
        'display_fragments', 'style_preset', 'text_style'
    ]);
    const extra = Object.entries(caption.extra ?? {}).flatMap(([key, value]) =>
        value !== undefined && !schemaKeys.has(key)
            ? `,${JSON.stringify(key)}:${JSON.stringify(value)}`
            : []
    ).join('');
    return `{"id":${JSON.stringify(caption.id)},"start":${JSON.stringify(caption.start)},` +
        `"end":${JSON.stringify(caption.end)},"text":${JSON.stringify(caption.text)},` +
        `"speaker":${caption.speaker === null ? 'null' : JSON.stringify(caption.speaker)},` +
        `"sourceRef":${sourceRef},"edited":${caption.edited ? 'true' : 'false'}` +
        `${src}${timeDomain}${words}${unrecognized}${style}${displayText}${displayFragments}` +
        `${stylePreset}${textStyle}${extra}}`;
}

function normalizeSegment(value: any): AnalysisSegment | undefined {
    const start = value?.start;
    const end = value?.end;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || start >= end
        || typeof value?.text !== 'string' || value.text.length === 0) {
        return undefined;
    }
    const unrecognized = normalizeUnrecognized(value.unrecognized);
    return { start, end, text: value.text, ...(unrecognized === undefined ? {} : { unrecognized }) };
}

function normalizeCaption(value: any): Caption | undefined {
    return normalizeCaptionForRegeneration(value);
}

function normalizeCaptionForRegeneration(value: any): Caption | undefined {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id
        || typeof value.text !== 'string' || typeof value.edited !== 'boolean') {
        return undefined;
    }
    const start = value.start;
    const end = value.end;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return undefined;
    }
    const segment = value.sourceRef === null
        ? null
        : Number.isInteger(value.sourceRef?.segment) && value.sourceRef.segment >= 0
            ? { segment: value.sourceRef.segment as number }
            : undefined;
    if (segment === undefined || (value.speaker !== null && typeof value.speaker !== 'string')) {
        return undefined;
    }
    const words = normalizeCaptionWords(value.words);
    const unrecognized = normalizeUnrecognized(value.unrecognized);
    const src = typeof value.src === 'string' ? value.src : undefined;
    const timeDomain = value.time_domain === 'source' || value.time_domain === 'output'
        ? value.time_domain : undefined;
    const style = typeof value.style === 'string' ? value.style : undefined;
    const displayText = typeof value.display_text === 'string' ? value.display_text : undefined;
    const displayFragments = Array.isArray(value.display_fragments)
        && value.display_fragments.every((fragment: unknown) => typeof fragment === 'string')
        ? [...value.display_fragments] as string[] : undefined;
    const stylePreset = typeof value.style_preset === 'string' ? value.style_preset : undefined;
    const textStyle = value.text_style !== null && typeof value.text_style === 'object'
        && !Array.isArray(value.text_style) ? value.text_style : undefined;
    const schemaKeys = new Set([
        'id', 'start', 'end', 'text', 'speaker', 'sourceRef', 'edited', 'src',
        'time_domain', 'words', 'unrecognized', 'style', 'display_text',
        'display_fragments', 'style_preset', 'text_style'
    ]);
    const extra = Object.fromEntries(Object.keys(value).flatMap(key =>
        schemaKeys.has(key) ? [] : [[key, value[key]]]
    ));
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef: segment,
        edited: value.edited,
        ...(src === undefined ? {} : { src }),
        ...(timeDomain === undefined ? {} : { timeDomain }),
        ...(words === undefined ? {} : { words }),
        ...(unrecognized === undefined ? {} : { unrecognized }),
        ...(style === undefined ? {} : { style }),
        ...(displayText === undefined ? {} : { displayText }),
        ...(displayFragments === undefined ? {} : { displayFragments }),
        ...(stylePreset === undefined ? {} : { stylePreset }),
        ...(textStyle === undefined ? {} : { textStyle }),
        ...(Object.keys(extra).length === 0 ? {} : { extra })
    };
}

function normalizeCaptionWords(value: any): CaptionWord[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const words = value.flatMap((word: any) =>
        word && typeof word === 'object'
            && typeof word.start === 'number' && Number.isFinite(word.start)
            && typeof word.end === 'number' && Number.isFinite(word.end)
            && typeof word.text === 'string'
            ? [{ start: word.start, end: word.end, text: word.text }]
            : []
    );
    return words.length > 0 ? words : undefined;
}

function normalizeUnrecognized(value: any): { start: number; end: number }[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const spans = value.flatMap((span: any) => span && typeof span === 'object'
        && typeof span.start === 'number' && Number.isFinite(span.start)
        && typeof span.end === 'number' && Number.isFinite(span.end)
        && span.end > span.start
        ? [{ start: span.start, end: span.end }]
        : []);
    return spans.length > 0 ? spans : undefined;
}

function decodeJsonString(value: string): string {
    try {
        return JSON.parse(`"${value}"`);
    } catch {
        return value;
    }
}
