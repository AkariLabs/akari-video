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
    words?: CaptionWord[];
    style?: string;
    displayText?: string;
}

export interface AnalysisSegment {
    start: number;
    end: number;
    text: string;
}

export interface RegenerationResult {
    captions: Caption[];
    source: string;
    warnings: string[];
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
        if (!/"text"\s*:\s*"(?:\\.|[^"\\])*"/.test(line)
            || !/"edited"\s*:\s*(?:true|false)/.test(line)) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        return line
            .replace(/("text"\s*:\s*)"(?:\\.|[^"\\])*"/, (_match, prefix) => `${prefix}${JSON.stringify(text)}`)
            .replace(/("edited"\s*:\s*)(?:true|false)/, '$1true');
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

export function parseCaptions(source: string): { captions: Caption[]; warnings: string[] } {
    const value = JSON.parse(source);
    if (!Array.isArray(value)) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const captions: Caption[] = [];
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
    if (existingSource !== undefined) {
        const parsed = JSON.parse(existingSource);
        if (!Array.isArray(parsed)) {
            throw new Error('既存の字幕データの形式を確認できません。');
        }
        for (let index = 0; index < parsed.length; index++) {
            const value = parsed[index];
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
            captions.push(current.edited ? current : {
                ...current,
                id: current.id,
                start: segment.start,
                end: segment.end,
                text: segment.text,
                speaker: null,
                sourceRef: { segment: segmentIndex },
                edited: false
            });
        } else {
            captions.push({
                id: nextId(),
                start: segment.start,
                end: segment.end,
                text: segment.text,
                speaker: null,
                sourceRef: { segment: segmentIndex },
                edited: false
            });
        }
    }

    for (const caption of [...bySegment.values(), ...unpaired]) {
        if (caption.sourceRef !== null) {
            warnings.push(`字幕 ${caption.id} の元の文字起こしが見つからないため、ID と内容を保持しました。`);
        }
        captions.push({ ...caption, sourceRef: null });
    }

    return { captions, source: serializeCaptions(captions), warnings };
}

export function serializeCaptions(captions: readonly Caption[]): string {
    const rows = captions.map(caption => `  ${serializeCaption(caption)}`);
    return rows.length > 0 ? `[\n${rows.join(',\n')}\n]\n` : '[]\n';
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
    const words = caption.words === undefined
        ? ''
        : `,"words":${JSON.stringify(caption.words)}`;
    const style = caption.style === undefined
        ? ''
        : `,"style":${JSON.stringify(caption.style)}`;
    const displayText = caption.displayText === undefined
        ? ''
        : `,"display_text":${JSON.stringify(caption.displayText)}`;
    return `{"id":${JSON.stringify(caption.id)},"start":${JSON.stringify(caption.start)},` +
        `"end":${JSON.stringify(caption.end)},"text":${JSON.stringify(caption.text)},` +
        `"speaker":${caption.speaker === null ? 'null' : JSON.stringify(caption.speaker)},` +
        `"sourceRef":${sourceRef},"edited":${caption.edited ? 'true' : 'false'}${words}${style}${displayText}}`;
}

function normalizeSegment(value: any): AnalysisSegment | undefined {
    const start = value?.start;
    const end = value?.end;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || start >= end
        || typeof value?.text !== 'string' || value.text.length === 0) {
        return undefined;
    }
    return { start, end, text: value.text };
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
    const style = typeof value.style === 'string' ? value.style : undefined;
    const displayText = typeof value.display_text === 'string' ? value.display_text : undefined;
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef: segment,
        edited: value.edited,
        ...(words === undefined ? {} : { words }),
        ...(style === undefined ? {} : { style }),
        ...(displayText === undefined ? {} : { displayText })
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

function decodeJsonString(value: string): string {
    try {
        return JSON.parse(`"${value}"`);
    } catch {
        return value;
    }
}
