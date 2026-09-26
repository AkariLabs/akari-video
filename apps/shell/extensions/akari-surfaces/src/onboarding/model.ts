export const ONBOARDING_STEPS = [
    'welcome', 'first', 'invite', 'tour', 'drag', 'matpreview', 'ask',
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
        imported: raw.imported === true, completed: raw.completed === true
    };
}

export function nextOnboardingState(state: OnboardingState, step: OnboardingStep, sub = 0): OnboardingState {
    return { ...state, step, sub, completed: step === 'done' };
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
        text: segment.text, speaker: null, sourceRef: { segment: index }, edited: false,
        src: 'sample', style_preset: 'subtitle-standard'
    }));
    if (withTitle) captions.push({
        id: 'c-0008', start: 0, end: 37.6,
        text: 'AI と話すだけで、動画編集', speaker: null, sourceRef: null,
        edited: true, time_domain: 'output', style_preset: 'title-impact',
        text_style: { zone: 'top-right', size_px: 38, color: '#FFFFFF',
            background: { color: '#1C1B18', opacity: 0.78, padding_px: 14, radius_px: 8 } }
    });
    return { captions };
}
