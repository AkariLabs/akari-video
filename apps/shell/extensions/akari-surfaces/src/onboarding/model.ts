export const ONBOARDING_STEPS = [
    'welcome', 'first', 'invite', 'tour0', 'tour1', 'tour2', 'tour3', 'drag', 'matpreview', 'ask',
    'prompt', 'work', 'play', 'caption', 'daihon', 'export', 'done'
] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
export type AiAnswer = 'claude' | 'chatgpt' | 'google' | 'none' | 'other';

export interface OnboardingState {
    schema: 1;
    step: OnboardingStep;
    sub: number;
    answer?: AiAnswer;
    projectUri?: string;
    samplePath?: string;
    imported?: boolean;
    exampleActive?: boolean;
    workCompleted?: boolean;
    materialOpened?: boolean;
    played?: boolean;
    completed?: boolean;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = { schema: 1, step: 'welcome', sub: 0 };

export function parseOnboardingState(value: unknown): OnboardingState | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    if (raw.schema !== 1 || !ONBOARDING_STEPS.includes(raw.step as OnboardingStep)
        || !Number.isInteger(raw.sub) || (raw.sub as number) < 0) return undefined;
    if (raw.answer !== undefined && !['claude', 'chatgpt', 'google', 'none', 'other'].includes(String(raw.answer))) return undefined;
    return {
        schema: 1, step: raw.step as OnboardingStep, sub: raw.sub as number,
        answer: raw.answer as AiAnswer | undefined,
        projectUri: typeof raw.projectUri === 'string' ? raw.projectUri : undefined,
        samplePath: typeof raw.samplePath === 'string' ? raw.samplePath : undefined,
        imported: raw.imported === true, exampleActive: raw.exampleActive === true,
        workCompleted: raw.workCompleted === true, materialOpened: raw.materialOpened === true,
        played: raw.played === true, completed: raw.completed === true
    };
}

export function nextOnboardingState(state: OnboardingState, step: OnboardingStep, sub = 0): OnboardingState {
    return { ...state, step, sub, completed: step === 'done' };
}

export const COUNTED_ONBOARDING_STEPS = ONBOARDING_STEPS.filter(step =>
    !['welcome', 'first', 'invite', 'tour0', 'tour1', 'tour2', 'tour3', 'done'].includes(step));

export function onboardingCount(step: OnboardingStep): { current: number; total: number } | undefined {
    const index = COUNTED_ONBOARDING_STEPS.indexOf(step);
    return index < 0 ? undefined : { current: index + 1, total: COUNTED_ONBOARDING_STEPS.length };
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | undefined {
    if (step === 'tour0' || step === 'tour1' || step === 'work' || step === 'welcome'
        || step === 'first' || step === 'invite' || step === 'done') return undefined;
    if (step === 'play') return 'prompt';
    const index = ONBOARDING_STEPS.indexOf(step);
    return index > 0 ? ONBOARDING_STEPS[index - 1] : undefined;
}

/** Return one visible guide position, keeping earlier tour revisit rules in the controller. */
export function previousGuidePosition(state: OnboardingState): { step: OnboardingStep; sub: number } | undefined {
    // After submission the export may still be running; going back must not restart or cancel it.
    if (state.step === 'export' && state.sub >= 3) return undefined;
    if (state.step === 'export' && state.sub > 0) return { step: 'export', sub: state.sub - 1 };
    if (state.step === 'export') return { step: 'daihon', sub: 2 };
    if ((state.step === 'caption' || state.step === 'daihon') && state.sub > 0)
        return { step: state.step, sub: state.sub - 1 };
    if (state.step === 'daihon') return { step: 'caption', sub: 2 };
    const step = previousOnboardingStep(state.step);
    return step ? { step, sub: 0 } : undefined;
}

/** Seek inside a caption actually written by writeExample, allowing sample timing to change. */
export function onboardingCaptionSeekTime(segments: readonly TranscriptSegment[]): number | undefined {
    const candidate = segments.filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end)
        && segment.end - segment.start >= 0.2 && segment.text.trim())
        .sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
    return candidate ? (candidate.start + candidate.end) / 2 : undefined;
}

export function onboardingRevisit(state: OnboardingState): 'imported' | 'previewed' | 'completed' | undefined {
    if (state.step === 'drag' && state.imported) return 'imported';
    if (state.step === 'matpreview' && state.materialOpened) return 'previewed';
    if (state.step === 'prompt' && state.workCompleted) return 'completed';
    return undefined;
}

export function shouldResumeOnboarding(state: OnboardingState | undefined, openProjectUri?: string): boolean {
    return !!state && !state.completed && (state.step === 'welcome' || state.step === 'first'
        || state.step === 'invite' || !!state.projectUri && (!openProjectUri || sameProjectUri(state.projectUri, openProjectUri)));
}

function sameProjectUri(left: string, right: string): boolean {
    try {
        const a = new URL(left);
        const b = new URL(right);
        const canonical = (url: URL): string => {
            const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
            return `${url.protocol}//${url.hostname.toLowerCase()}${/^\/[a-z]:/i.test(path) ? path.toLowerCase() : path}`;
        };
        return canonical(a) === canonical(b);
    } catch { return left === right; }
}

export function partnerToConnect(answer: AiAnswer | undefined): string | undefined {
    return ({ claude: 'Claude Code CLI', chatgpt: 'Codex CLI', google: 'Antigravity CLI' } as Partial<Record<AiAnswer, string>>)[answer ?? 'none'];
}

export interface TranscriptSegment { start: number; end: number; text: string }
export interface TranscriptToken { t: string; start: number; end: number }

// Keep each subtitle below the width of the standard 16:9 subtitle plate.
// Token boundaries supply the timing; punctuation supplies natural breaks.
export function splitOnboardingTokens(tokens: readonly TranscriptToken[]): TranscriptSegment[] {
    const result: TranscriptSegment[] = [];
    let group: TranscriptToken[] = [];
    const Segmenter = (Intl as typeof Intl & { Segmenter: new (locale: string, options: { granularity: 'word' }) => {
        segment(input: string): Iterable<{ index: number; segment: string }>;
    } }).Segmenter;
    const words = new Segmenter('ja', { granularity: 'word' });
    const flush = (): void => {
        if (!group.length) return;
        const text = group.map(token => token.t).join('');
        const wordEnds = new Set([...words.segment(text)].map(word => word.index + word.segment.length));
        const offsets = [0];
        for (const token of group) offsets.push(offsets[offsets.length - 1] + token.t.length);
        const best = Array.from({ length: group.length + 1 }, () => Number.POSITIVE_INFINITY);
        const previous = Array.from({ length: group.length + 1 }, () => -1);
        best[0] = 0;
        for (let end = 1; end <= group.length; end++) {
            for (let start = end - 1; start >= 0; start--) {
                const length = offsets[end] - offsets[start];
                if (length > 13 && start < end - 1) break;
                const cost = best[start] + (length - 10) ** 2
                    + (length < 5 && group.length > 1 ? 45 : 0)
                    + (end < group.length && !wordEnds.has(offsets[end]) ? 80 : 0)
                    + (end < group.length && /^[ぁ-ん]/u.test(group[end].t) ? 40 : 0);
                if (cost < best[end]) { best[end] = cost; previous[end] = start; }
            }
        }
        const pieces: TranscriptToken[][] = [];
        for (let end = group.length; end > 0;) {
            const start = previous[end];
            pieces.unshift(group.slice(start, end));
            end = start;
        }
        for (const piece of pieces) result.push({
            start: piece[0].start, end: Math.max(piece[0].start + .05, piece[piece.length - 1].end),
            text: piece.map(token => token.t).join('')
        });
        group = [];
    };
    for (const token of tokens) {
        if (!token.t || !Number.isFinite(token.start) || !Number.isFinite(token.end)) continue;
        group.push(token);
        if (/[。！？]/u.test(token.t) || (/[、，]/u.test(token.t) && group.map(part => part.t).join('').length >= 7)) flush();
    }
    flush();
    return result;
}

export function createEmptyOnboardingEdit(): object {
    return { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: [] };
}

export function createOnboardingEdit(samplePath: string, withTitle = false): object {
    const frames = 1128;
    const tracks: object[] = [{ id: 'video', lane: 'visual', name: '本編', items: [
        { id: 'sample', at: 0, duration: frames, source: { kind: 'media', src: 'sample', in: 0, out: 37.6 } }
    ] }];
    if (withTitle) tracks.push({ id: 'captions', lane: 'visual', name: '字幕とタイトル', items: [
        { id: 'captions', at: 0, duration: frames, source: { kind: 'captions', path: 'captions.json' } }
    ] });
    return { version: 2, output: { width: 1280, height: 720, fps: 30, geometry: 'source' },
        sources: [{ id: 'sample', path: samplePath }], tracks };
}

export function createOnboardingCaptions(segments: readonly TranscriptSegment[], count: number, withTitle = false): object {
    const captions: object[] = segments.slice(0, count).map((segment, index) => ({
        id: `c-${String(index + 1).padStart(4, '0')}`, start: segment.start, end: segment.end,
        text: segment.text, display_text: segment.text, runs: [],
        speaker: null, sourceRef: { segment: index }, edited: false,
        src: 'sample', style_preset: 'subtitle-standard'
    }));
    if (withTitle) captions.push({
        id: `c-${String(segments.length + 1).padStart(4, '0')}`, start: 0, end: 37.6,
        text: 'AI と話すだけで動画編集', speaker: null, sourceRef: null,
        display_text: 'AI と話すだけで動画編集', runs: [],
        edited: true, time_domain: 'output', style_preset: 'title-impact',
        text_style: { zone: 'top-right', size_px: 38, weight: 800, letter_spacing_em: 0.035,
            max_characters: 40, color: '#FFFFFF',
            stroke: { color: '#000000', width_px: 0 },
            shadow: { color: '#000000', opacity: 0.35, blur_px: 3, distance_px: 2, angle_deg: 90 },
            animation: { in: { id: 'soft-fade' } },
            background: { color: '#17130F', opacity: 0.87, padding_px: 20, radius_px: 7 } }
    });
    return { captions };
}
