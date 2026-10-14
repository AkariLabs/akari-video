import { t } from '@akari-video/i18n';
import { nextEmphasisWordId } from '@akari-video/edit-store';
import type { TimelineCaptionSelection } from '../timeline-selection-model';
import { captionMotionOriginalAnimation } from './caption-motion-cards';
import { commonCaptionAnimation } from './caption-multi-targets';

export const CAPTION_WORD_STYLES = [
    { id: 'karaoke', label: t('inspector.captionMotionDocument.style.karaoke') }, { id: 'pop', label: t('inspector.captionMotionDocument.style.pop') },
    { id: 'reveal', label: t('inspector.captionMotionDocument.style.reveal') }, { id: 'reveal-word', label: t('inspector.captionMotionDocument.style.revealWord') }
] as const;

export const CAPTION_EMPHASIS_STYLES = [
    { id: 'one-char-bang', label: t('inspector.captionMotionDocument.style.oneCharBang'), emotion: 'surprise' },
    { id: 'one-char-jumble', label: t('inspector.captionMotionDocument.style.oneCharJumble'), emotion: 'disgust' },
    { id: 'size-pulse', label: t('inspector.captionMotionDocument.style.sizePulse'), emotion: 'emphasis' },
    { id: 'color-accent', label: t('inspector.captionMotionDocument.style.colorAccent'), emotion: 'emphasis' },
    { id: 'color-only', label: t('inspector.captionMotionDocument.style.colorOnly'), emotion: 'emphasis' },
    { id: 'outline-bold', label: t('inspector.captionMotionDocument.style.outlineBold'), emotion: 'emphasis' },
    { id: 'danger', label: t('inspector.captionMotionDocument.style.danger'), emotion: 'anger' },
    { id: 'positive', label: t('inspector.captionMotionDocument.style.positive'), emotion: 'joy' },
    { id: 'highlight', label: t('inspector.captionMotionDocument.style.highlight'), emotion: 'emphasis' }
] as const;

export interface CaptionMotionWord { text: string; start: number; end: number }
export interface CaptionMotionCue {
    id: string;
    style?: string;
    text?: string;
    text_style?: { color?: string; karaoke?: CaptionKaraokeSettings };
    words: CaptionMotionWord[];
    src?: string;
    time_domain?: string;
}

export interface CaptionKaraokeSettings {
    done_color?: string;
    fill?: 'char' | 'word' | 'smooth';
    start_index?: number;
}

export interface CaptionWordWriteResult { source: string; applied: number; skipped: number }

/** Validate words at write time, including every row of a multi or bag selection. */
export function captionWordStyleWrite(source: string, captionIds: readonly string[],
    style: string | null | undefined, settings?: CaptionKaraokeSettings): CaptionWordWriteResult {
    const raw = JSON.parse(source) as unknown;
    const rows = Array.isArray(raw) ? raw : object(raw) ? raw.captions : undefined;
    if (!Array.isArray(rows)) throw new Error(t('inspector.captionMotionDocument.error.couldNotReadCaptionData'));
    const needsWords = style === 'karaoke' || style === 'pop' || style === 'reveal-word' || settings !== undefined;
    let applied = 0;
    let skipped = 0;
    for (const id of new Set(captionIds)) {
        const matches = rows.filter(row => object(row) && row.id === id);
        if (matches.length !== 1 || !object(matches[0])) throw new Error(t('inspector.captionMotionDocument.error.captionCouldNotBeFoundUniquely', { id: String(id) }));
        if (needsWords && readCaptionMotionCue(source, id).words.length === 0) { skipped++; continue; }
        const row = matches[0];
        if (style === null) delete row.style;
        else if (style !== undefined) row.style = style;
        if (settings !== undefined) {
            const textStyle = object(row.text_style) ? row.text_style : {};
            textStyle.karaoke = { ...(object(textStyle.karaoke) ? textStyle.karaoke : {}), ...settings };
            row.text_style = textStyle;
        }
        applied++;
    }
    if (applied === 0 && needsWords) {
        throw new Error(t('inspector.captionMotionDocument.error.karaokePopWordWordRequireCaptionWord'));
    }
    return { source: `${JSON.stringify(raw, null, 2)}\n`, applied, skipped };
}

/** One captions.json write keeps the word mode and its defaults in one undo step. */
export function upsertCaptionKaraoke(source: string, captionId: string,
    settings: CaptionKaraokeSettings, selectStyle = false): string {
    return captionWordStyleWrite(source, [captionId], selectStyle ? 'karaoke' : undefined, settings).source;
}

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readCaptionMotionCue(source: string, captionId: string): CaptionMotionCue {
    const document = JSON.parse(source) as unknown;
    const rows = Array.isArray(document) ? document : object(document) ? document.captions : undefined;
    if (!Array.isArray(rows)) throw new Error(t('inspector.captionMotionDocument.error.couldNotReadCaptionData'));
    const raw = rows.find(row => object(row) && row.id === captionId);
    if (!object(raw)) throw new Error(t('inspector.captionMotionDocument.error.captionNotFound'));
    const inherited = object(document) && object(document.default_text_style) ? document.default_text_style : {};
    const own = object(raw.text_style) ? raw.text_style : {};
    const inheritedKaraoke = object(inherited.karaoke) ? inherited.karaoke : undefined;
    const ownKaraoke = object(own.karaoke) ? own.karaoke : undefined;
    const words = Array.isArray(raw.words) ? raw.words.filter(word => object(word)
        && typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end)
        && Number(word.start) >= 0 && Number(word.end) > Number(word.start)) as CaptionMotionWord[] : [];
    return { id: captionId, words,
        ...(typeof raw.display_text === 'string' ? { text: raw.display_text }
            : typeof raw.text === 'string' ? { text: raw.text } : {}),
        ...(typeof raw.style === 'string' ? { style: raw.style } : {}),
        ...(Object.keys(own).length || Object.keys(inherited).length ? { text_style: {
            color: typeof own.color === 'string' ? own.color : typeof inherited.color === 'string' ? inherited.color : undefined,
            ...(inheritedKaraoke || ownKaraoke ? { karaoke: { ...inheritedKaraoke, ...ownKaraoke } as CaptionKaraokeSettings } : {})
        } } : {}),
        ...(typeof raw.src === 'string' && raw.src.trim() ? { src: raw.src } : {}),
        ...(typeof raw.time_domain === 'string' ? { time_domain: raw.time_domain } : {}) };
}

/** Existing unrelated records and caption fields are retained. Array roots become object roots. */
export function upsertCaptionEmphasis(source: string, captionId: string, wordIndex: number,
    style: typeof CAPTION_EMPHASIS_STYLES[number]['id']): string {
    const cue = readCaptionMotionCue(source, captionId);
    if (cue.time_domain === 'output') throw new Error(t('inspector.captionMotionDocument.error.wordSourceTimesUnavailableOutputTimeCaptions'));
    const word = cue.words[wordIndex];
    if (!word) throw new Error(t('inspector.captionMotionDocument.error.selectWordEmphasize'));
    const definition = CAPTION_EMPHASIS_STYLES.find(item => item.id === style);
    if (!definition) throw new Error(t('inspector.captionMotionDocument.error.selectEmphasisStyle'));
    const raw = JSON.parse(source) as unknown;
    const document: Record<string, unknown> = Array.isArray(raw) ? { captions: raw } : raw as Record<string, unknown>;
    const entries = Array.isArray(document.emphasis_words) ? [...document.emphasis_words] : [];
    const sameWord = (entry: unknown): boolean => object(entry)
        && entry.word === word.text && entry.t_start === word.start && entry.t_end === word.end
        && (entry.src ?? undefined) === cue.src;
    const index = entries.findIndex(sameWord);
    const existing = index >= 0 && object(entries[index]) ? entries[index] as Record<string, unknown> : undefined;
    let id = existing?.id;
    if (typeof id !== 'string') id = nextEmphasisWordId(document as Parameters<typeof nextEmphasisWordId>[0]);
    if (typeof id !== 'string') throw new Error(t('inspector.captionMotionDocument.error.couldNotAssignEmphasisId'));
    const next = { ...(existing ?? {}), id, word: word.text, t_start: word.start, t_end: word.end,
        ...(cue.src ? { src: cue.src } : {}), emotion: definition.emotion, style_hint: style };
    if (index >= 0) entries[index] = next;
    else entries.push(next);
    document.emphasis_words = entries;
    return `${JSON.stringify(document, null, 2)}\n`;
}

export function readOwnerMotion(editSource: string, ownerId: string, fallbackSeconds: number): {
    id: string; motion?: Record<string, unknown>; durationFrames: number
} {
    const document = JSON.parse(editSource) as Record<string, unknown>;
    const find = (items: unknown): Record<string, unknown> | undefined => {
        if (!Array.isArray(items)) return undefined;
        for (const entry of items) {
            if (!object(entry)) continue;
            if (entry.id === ownerId) return entry;
            const nested = find(entry.items);
            if (nested) return nested;
        }
        return undefined;
    };
    const tracks = Array.isArray(document.tracks) ? document.tracks : [];
    const item = tracks.map(track => object(track) ? find(track.items) : undefined).find(Boolean);
    if (!item) throw new Error(t('inspector.captionMotionDocument.error.captionGroupNotFound'));
    const duration = Number(item.duration);
    const output = object(document.output) ? document.output : {};
    const fps = Number(output.fps ?? 30);
    return { id: ownerId,
        ...(object(item.motion) ? { motion: item.motion } : {}),
        durationFrames: Math.max(1, Math.round(Number.isFinite(duration) ? duration
            : fallbackSeconds * (Number.isFinite(fps) && fps > 0 ? fps : 30))) };
}

export function readCaptionBagMotionContext(editSource: string, captionsSource: string, bagId: string): {
    ids: string[]; snapshot: TimelineCaptionSelection
} {
    const edit = JSON.parse(editSource) as Record<string, unknown>;
    const find = (items: unknown): Record<string, unknown> | undefined => {
        if (!Array.isArray(items)) return undefined;
        for (const value of items) {
            if (!object(value)) continue;
            if (value.id === bagId) return value;
            const nested = find(value.items);
            if (nested) return nested;
        }
        return undefined;
    };
    const bag = (Array.isArray(edit.tracks) ? edit.tracks : [])
        .map(track => object(track) ? find(track.items) : undefined).find(Boolean);
    if (!bag || !object(bag.source) || bag.source.kind !== 'captions') {
        throw new Error(t('inspector.captionMotionDocument.error.captionGroupNotFound'));
    }
    const root = JSON.parse(captionsSource) as unknown;
    const rows = Array.isArray(root) ? root : object(root) ? root.captions : undefined;
    if (!Array.isArray(rows)) throw new Error(t('inspector.captionMotionDocument.error.couldNotReadCaptionData'));
    const excluded = new Set(Array.isArray(bag.source.exclude) ? bag.source.exclude : []);
    const selected = rows.filter(row => object(row) && typeof row.id === 'string' && !excluded.has(row.id));
    if (!selected.length) throw new Error(t('inspector.captionMotionDocument.error.groupHasNoCaptionsDisplay'));
    const ids = selected.map(row => row.id as string);
    const animations = ids.map(id => captionMotionOriginalAnimation(captionsSource, id) ?? undefined);
    const common = commonCaptionAnimation(ids.map((id, index): TimelineCaptionSelection => ({
        kind: 'caption', id, text: '', sourceStart: 0, sourceEnd: 0,
        outputStart: undefined, outputEnd: undefined, speaker: null, sourceRef: null, edited: false,
        effectiveTextStyle: { animation: animations[index] }
    })));
    const first = selected[0];
    const start = Number(first.start);
    const end = Number(first.end);
    const snapshot: TimelineCaptionSelection = {
        kind: 'caption', id: ids[0], text: typeof first.text === 'string' ? first.text : '',
        sourceStart: Number.isFinite(start) ? start : 0,
        sourceEnd: Number.isFinite(end) ? end : 0,
        outputStart: undefined, outputEnd: undefined, speaker: null, sourceRef: null, edited: false,
        ...(common ? { textStyle: { animation: common }, effectiveTextStyle: { animation: common } } : {}),
        animatorOwner: { id: bagId }
    };
    return { ids, snapshot };
}
