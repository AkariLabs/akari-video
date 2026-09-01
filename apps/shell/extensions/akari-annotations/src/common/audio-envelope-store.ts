import {
    findMatchingBracket,
    splitTopLevelElements,
    updateArrayElementByIndex
} from '@akari-video/edit-store/lib/edit-store';

export type AudioEnvelopeTarget =
    | { kind: 'bgm' }
    | { kind: 'sfx' | 'narration'; index: number };

export interface AudioEnvelopeKeyframe {
    t: number;
    gain_db: number;
    easing?: string;
    [key: string]: unknown;
}

export interface AudioDuckUpdates {
    ducking?: boolean | null;
    duckDb?: number | null;
    duckAttack?: number | null;
    duckRelease?: number | null;
}

interface LocatedValue {
    start: number;
    end: number;
    text: string;
}

function locateTopLevelProperty(scope: string, property: string): LocatedValue | undefined {
    const open = scope.indexOf('{');
    const close = open >= 0 ? findMatchingBracket(scope, open) : -1;
    if (open < 0 || close < 0) throw new Error('音声オブジェクトを特定できません。');
    const inner = scope.slice(open + 1, close);
    const element = splitTopLevelElements(inner)
        .find(candidate => new RegExp(`^"${property}"\\s*:`).test(candidate.text));
    return element ? {
        start: open + 1 + element.start,
        end: open + 1 + element.end,
        text: element.text
    } : undefined;
}

function locateTopLevelObject(scope: string, property: string): LocatedValue {
    const located = locateTopLevelProperty(scope, property);
    if (!located) throw new Error(`"${property}" が見つかりません。`);
    const colon = located.text.indexOf(':');
    const open = scope.indexOf('{', located.start + colon + 1);
    if (open < 0 || open >= located.end) throw new Error(`"${property}" が object ではありません。`);
    const close = findMatchingBracket(scope, open);
    return { start: open, end: close + 1, text: scope.slice(open, close + 1) };
}

function appendJsonProperty(source: string, property: string, value: unknown): string {
    const close = source.lastIndexOf('}');
    if (close < 0) throw new Error('音声オブジェクトを特定できません。');
    const beforeClose = source.slice(0, close);
    const trailingWhitespace = beforeClose.match(/\s*$/)?.[0] ?? '';
    const body = beforeClose.slice(0, beforeClose.length - trailingWhitespace.length);
    const serialized = JSON.stringify(value);
    if (!body.trim().endsWith('{')) {
        if (source.includes('\n')) {
            const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
            const indent = source.match(/(?:^|\r?\n)([ \t]+)"[^"\r\n]+"\s*:/)?.[1] ?? '  ';
            return `${body},${lineEnding}${indent}"${property}": ${serialized}${trailingWhitespace}${source.slice(close)}`;
        }
        return `${body}, "${property}": ${serialized}${trailingWhitespace}${source.slice(close)}`;
    }
    return `${body}"${property}": ${serialized}${trailingWhitespace}${source.slice(close)}`;
}

function replacePropertyValue(source: string, property: string, value: unknown, label: string): string {
    const located = locateTopLevelProperty(source, property);
    if (!located) throw new Error(`${label} の ${property} を特定できません。`);
    const colon = located.text.indexOf(':');
    const prefix = located.text.slice(0, colon + 1);
    const whitespace = located.text.slice(colon + 1).match(/^\s*/)?.[0] ?? '';
    const updated = `${prefix}${whitespace}${JSON.stringify(value)}`;
    return source.slice(0, located.start) + updated + source.slice(located.end);
}

function removeObjectProperty(source: string, property: string): string {
    const open = source.indexOf('{');
    const close = open >= 0 ? findMatchingBracket(source, open) : -1;
    if (open < 0 || close < 0) throw new Error('音声オブジェクトを特定できません。');
    const inner = source.slice(open + 1, close);
    const elements = splitTopLevelElements(inner);
    const index = elements.findIndex(element => new RegExp(`^"${property}"\\s*:`).test(element.text));
    if (index < 0) return source;
    const nextInner = elements.length === 1
        ? inner.slice(elements[0].end)
        : index < elements.length - 1
            ? inner.slice(0, elements[index].start) + inner.slice(elements[index + 1].start)
            : inner.slice(0, elements[index - 1].end) + inner.slice(elements[index].end);
    return source.slice(0, open + 1) + nextInner + source.slice(close);
}

function updateProperty(source: string, property: string, value: unknown | null | undefined, label: string): string {
    if (value === undefined) return source;
    const has = locateTopLevelProperty(source, property) !== undefined;
    if (value === null) return has ? removeObjectProperty(source, property) : source;
    return has ? replacePropertyValue(source, property, value, label) : appendJsonProperty(source, property, value);
}

function updateBgmObject(source: string, update: (bgm: string) => string): string {
    const audio = locateTopLevelObject(source, 'audio');
    const bgm = locateTopLevelObject(audio.text, 'bgm');
    const nextBgm = update(bgm.text);
    const nextAudio = audio.text.slice(0, bgm.start) + nextBgm + audio.text.slice(bgm.end);
    return source.slice(0, audio.start) + nextAudio + source.slice(audio.end);
}

function updateTargetObject(source: string, target: AudioEnvelopeTarget, update: (value: string) => string): string {
    if (target.kind === 'bgm') return updateBgmObject(source, update);
    return updateArrayElementByIndex(source, target.kind, target.index, target.kind, update);
}

function validateDuckUpdates(updates: AudioDuckUpdates): void {
    if (Object.values(updates).every(value => value === undefined)) {
        throw new Error('変更するダッキングフィールドを指定してください。');
    }
    if (updates.ducking !== undefined && updates.ducking !== null && typeof updates.ducking !== 'boolean') {
        throw new Error('ducking は boolean で指定してください。');
    }
    const ranges: Array<[number | null | undefined, number, number, string]> = [
        [updates.duckDb, -40, 0, 'duck_db'],
        [updates.duckAttack, 0, 2, 'duck_attack'],
        [updates.duckRelease, 0, 5, 'duck_release']
    ];
    for (const [value, min, max, label] of ranges) {
        if (value !== undefined && value !== null
            && (!Number.isFinite(value) || value < min || value > max)) {
            throw new Error(`${label} は ${min}〜${max} の範囲で指定してください。`);
        }
    }
}

export function normalizeAudioKeyframes(
    keyframes: readonly AudioEnvelopeKeyframe[] | null
): AudioEnvelopeKeyframe[] | null {
    if (keyframes === null || keyframes.length === 0) return null;
    const normalized = keyframes.map(point => {
        if (!Number.isFinite(point.t) || point.t < 0) throw new Error('keyframes[].t は 0 以上で指定してください。');
        if (!Number.isFinite(point.gain_db) || point.gain_db < -60 || point.gain_db > 12) {
            throw new Error('keyframes[].gain_db は -60〜12 の範囲で指定してください。');
        }
        return { ...point };
    });
    return normalized.sort((left, right) => left.t - right.t);
}

export function setAudioDuckInSource(
    source: string,
    target: { kind: 'bgm' } | { kind: 'sfx'; index: number },
    updates: AudioDuckUpdates
): string {
    validateDuckUpdates(updates);
    return updateTargetObject(source, target, object => {
        let next = object;
        next = updateProperty(next, 'ducking', updates.ducking, target.kind);
        next = updateProperty(next, 'duck_db', updates.duckDb, target.kind);
        next = updateProperty(next, 'duck_attack', updates.duckAttack, target.kind);
        next = updateProperty(next, 'duck_release', updates.duckRelease, target.kind);
        return next;
    });
}

export function setAudioKeyframesInSource(
    source: string,
    target: AudioEnvelopeTarget,
    keyframes: readonly AudioEnvelopeKeyframe[] | null
): string {
    const normalized = normalizeAudioKeyframes(keyframes);
    return updateTargetObject(source, target, object =>
        updateProperty(object, 'keyframes', normalized, target.kind));
}
