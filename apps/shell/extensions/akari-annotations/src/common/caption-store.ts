export interface CaptionRecord {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
}

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

export function parseCaptions(source: string): { captions: CaptionRecord[]; warnings: string[] } {
    const value = JSON.parse(source);
    if (!Array.isArray(value)) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const captions: CaptionRecord[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < value.length; index++) {
        const caption = normalizeCaption(value[index]);
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
    return { captions, warnings };
}

export function shiftCaptionLine(
    source: string,
    captionId: string,
    deltaStart: number,
    deltaEnd: number
): string {
    if (!captionId || !Number.isFinite(deltaStart) || !Number.isFinite(deltaEnd)) {
        throw new Error('字幕の調整値が不正です。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        const startMatch = new RegExp(`"start"\\s*:\\s*(${JSON_NUMBER})`).exec(line);
        const endMatch = new RegExp(`"end"\\s*:\\s*(${JSON_NUMBER})`).exec(line);
        if (!startMatch || !endMatch || !/"edited"\s*:\s*(?:true|false)/.test(line)) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        const nextStart = Number(startMatch[1]) + deltaStart;
        const nextEnd = Number(endMatch[1]) + deltaEnd;
        if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)
            || nextStart < 0 || nextEnd - nextStart < 0.15) {
            throw new Error('字幕が短すぎます（0.15 秒未満にはできません）');
        }
        return line
            .replace(new RegExp(`("start"\\s*:\\s*)${JSON_NUMBER}`), (_match, prefix) =>
                `${prefix}${JSON.stringify(nextStart)}`)
            .replace(new RegExp(`("end"\\s*:\\s*)${JSON_NUMBER}`), (_match, prefix) =>
                `${prefix}${JSON.stringify(nextEnd)}`)
            .replace(/("edited"\s*:\s*)(?:true|false)/, '$1true');
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}

function normalizeCaption(value: any): CaptionRecord | undefined {
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
    const sourceRef = value.sourceRef === null
        ? null
        : Number.isInteger(value.sourceRef?.segment) && value.sourceRef.segment >= 0
            ? { segment: value.sourceRef.segment as number }
            : undefined;
    if (sourceRef === undefined || (value.speaker !== null && typeof value.speaker !== 'string')) {
        return undefined;
    }
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef,
        edited: value.edited
    };
}

function decodeJsonString(value: string): string {
    try {
        return JSON.parse(`"${value}"`);
    } catch {
        return value;
    }
}
