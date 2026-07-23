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

export function updateCaptionFieldsInSource(
    source: string,
    captionId: string,
    updates: { text?: string; speaker?: string | null }
): string {
    if (!captionId) {
        throw new Error('字幕 ID を指定してください。');
    }
    if (updates.text === undefined && updates.speaker === undefined) {
        throw new Error('変更する字幕フィールドを指定してください。');
    }
    if (updates.text !== undefined && (typeof updates.text !== 'string' || !updates.text.trim())) {
        throw new Error('字幕のテキストは空にできません。');
    }
    if (updates.speaker !== undefined && updates.speaker !== null && typeof updates.speaker !== 'string') {
        throw new Error('字幕の話者は文字列または null で指定してください。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        let nextLine = line;
        if (updates.text !== undefined) {
            const textPattern = /"text"\s*:\s*"(?:\\.|[^"\\])*"/;
            if (!textPattern.test(nextLine)) {
                throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
            }
            nextLine = nextLine.replace(textPattern, `"text": ${JSON.stringify(updates.text)}`);
        }
        if (updates.speaker !== undefined) {
            const speakerPattern = /"speaker"\s*:\s*(?:"(?:\\.|[^"\\])*"|null)/;
            if (!speakerPattern.test(nextLine)) {
                throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
            }
            nextLine = nextLine.replace(speakerPattern, `"speaker": ${JSON.stringify(updates.speaker)}`);
        }
        nextLine = nextLine.replace(/"edited"\s*:\s*(?:true|false)/, '"edited": true');
        return nextLine;
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}

export function insertCaptionLine(source: string, caption: CaptionRecord): string {
    const parsed = parseCaptions(source);
    if (parsed.captions.some(candidate => candidate.id === caption.id)) {
        throw new Error(`字幕 ${caption.id} は既にあります。`);
    }
    if (!normalizeCaption(caption)) {
        throw new Error('追加する字幕の形式が不正です。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    const entries = captionLineEntries(lines, parsed.captions);
    const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
    const firstIndent = entries[0]?.indent ?? '  ';
    const serialized = `${firstIndent}${serializeCaption(caption)}`;
    const before = entries.find(entry => entry.start > caption.start);

    if (before) {
        lines.splice(before.lineIndex, 0, `${serialized},${lineEnding}`);
        return lines.join('');
    }
    if (entries.length > 0) {
        const last = entries[entries.length - 1];
        lines[last.lineIndex] = addTrailingComma(lines[last.lineIndex]);
        lines.splice(last.lineIndex + 1, 0, `${serialized}${lineEnding}`);
        return lines.join('');
    }

    const openLine = lines.findIndex(line => line.includes('['));
    const closeLine = lines.findIndex((line, index) => index >= openLine && line.includes(']'));
    if (openLine < 0 || closeLine < 0 || openLine === closeLine) {
        throw new Error('字幕配列の1行形式を確認できません。');
    }
    lines.splice(closeLine, 0, `${serialized}${lineEnding}`);
    return lines.join('');
}

export function removeCaptionLine(source: string, captionId: string): string {
    const parsed = parseCaptions(source);
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    const entries = captionLineEntries(lines, parsed.captions);
    const index = entries.findIndex(entry => entry.id === captionId);
    if (index < 0) {
        throw new Error(`字幕 ${captionId} が字幕データにありません。`);
    }
    const entry = entries[index];
    lines.splice(entry.lineIndex, 1);
    if (index === entries.length - 1 && index > 0) {
        const previousLineIndex = entries[index - 1].lineIndex;
        lines[previousLineIndex] = removeTrailingComma(lines[previousLineIndex]);
    }
    return lines.join('');
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

function captionLineEntries(
    lines: string[],
    captions: CaptionRecord[]
): Array<{ id: string; start: number; lineIndex: number; indent: string }> {
    return captions.map(caption => {
        const matches = lines.flatMap((line, lineIndex) => {
            const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
            return idMatch && decodeJsonString(idMatch[1]) === caption.id
                ? [{ line, lineIndex }]
                : [];
        });
        if (matches.length !== 1 || !matches[0].line.includes('{') || !matches[0].line.includes('}')) {
            throw new Error(`字幕 ${caption.id} の1行形式を確認できません。`);
        }
        return {
            id: caption.id,
            start: caption.start,
            lineIndex: matches[0].lineIndex,
            indent: matches[0].line.match(/^\s*/)?.[0] ?? '  '
        };
    });
}

function serializeCaption(caption: CaptionRecord): string {
    return `{ "id": ${JSON.stringify(caption.id)}, "start": ${JSON.stringify(caption.start)}, "end": ${JSON.stringify(caption.end)}, "text": ${JSON.stringify(caption.text)}, "speaker": ${JSON.stringify(caption.speaker)}, "sourceRef": ${JSON.stringify(caption.sourceRef)}, "edited": ${JSON.stringify(caption.edited)} }`;
}

function addTrailingComma(line: string): string {
    return line.replace(/(\r?\n)?$/, (_match, ending = '') => `,${ending}`);
}

function removeTrailingComma(line: string): string {
    return line.replace(/,(\s*)(\r?\n)?$/, (_match, whitespace, ending = '') => `${whitespace}${ending}`);
}
