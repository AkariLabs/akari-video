export interface OnboardingGuide {
    language: string;
    duration_seconds: number;
    duration_frames: number;
    asset_name: string;
    project_title: string;
    title_caption: string;
    tracks: Record<string, string>;
    // Production layout: apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/plan.json.
    // お手本には声のダッキング鍵が無い（書き出しは直下の analysis.json、プレビューは narration のみ）ため ducking は使わず、両経路で同じ音にする。
    // 声の下は gain_db -14（声 -16 LUFS より約 14 LU 下）。keyframes は基準への加算で「BGM も」(29.45) に +8 dB、締めに +10 dB。
    // keyframes は 8 点以下に保つ。9 点以上は edit-store が motion 袋へ出し、音声 item では edit-lint が通らない。
    // phone-screen reuses sample, so captions: 'off' prevents duplicate subtitles.
    demo_plan: { stages: Array<{ stage: number; key: string; items: Array<{
        track: string; item: { id: string; at: number; source: { kind: string; path?: string; src?: string; [key: string]: unknown }; [key: string]: unknown }
    }> }>; punch_in_keyframes: object[] };
    seek_seconds: number[];
    emphasis: Array<{ text: string; scale?: number }>;
    karaoke: { pair: string; head: string; text: string; separator: string };
    log_words: Record<string, string>;
    finder: { length: string; size: string };
    asset_facts_duration_seconds: number;
    subtitles: { language: string; max_characters: number };
}

export function parseOnboardingGuide(value: unknown, source: string): OnboardingGuide {
    const error = (field: string): never => { throw new Error(`Invalid onboarding guide ${source}: ${field}`); };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return error('root');
    const guide = value as OnboardingGuide;
    const string = (value: unknown): boolean => typeof value === 'string' && value.length > 0;
    const number = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
    for (const field of ['language', 'asset_name', 'project_title', 'title_caption'] as const)
        if (!string(guide[field])) error(field);
    if (!/^[a-z]{2,3}$/.test(guide.language)) error('language');
    if (!/^[^/\\]+\.mp4$/i.test(guide.asset_name)) error('asset_name');
    for (const field of ['duration_seconds', 'duration_frames', 'asset_facts_duration_seconds'] as const)
        if (!number(guide[field]) || guide[field] <= 0) error(field);
    if (!Number.isInteger(guide.duration_frames)) error('duration_frames');
    if (!guide.tracks || typeof guide.tracks !== 'object' ||
        !['video', 'captions_and_title', 'captions', 'demo-phone-screen', 'demo-flash', 'demo-stage',
            'demo-accents', 'onboarding-bgm', 'demo-sfx'].every(key => string(guide.tracks[key]))) error('tracks');
    if (!guide.demo_plan || !Array.isArray(guide.demo_plan.stages) || guide.demo_plan.stages.length !== 8 ||
        !Array.isArray(guide.demo_plan.punch_in_keyframes)) error('demo_plan');
    for (const [index, stage] of guide.demo_plan.stages.entries()) {
        if (stage.stage !== index + 1 || !string(stage.key) || !Array.isArray(stage.items)) error(`demo_plan.stages[${index}]`);
        for (const entry of stage.items) {
            if (!string(entry.track) || !guide.tracks[entry.track] || !entry.item || !string(entry.item.id) ||
                !number(entry.item.at) || !number(entry.item.duration) || !entry.item.source ||
                !['html', 'media'].includes(entry.item.source.kind)) error(`demo_plan.stages[${index}].items`);
            if (entry.item.at < 0 || (entry.item.duration as number) <= 0 ||
                entry.item.at + (entry.item.duration as number) > guide.duration_frames) error(`demo_plan.stages[${index}].timing`);
            const source = entry.item.source;
            if (source.kind === 'html' && (!string(source.path) || source.path!.startsWith('/') || source.path!.includes('..')))
                error(`demo_plan.stages[${index}].source.path`);
            if (source.kind === 'media' && (!string(source.src) || !number(source.in) || !number(source.out) ||
                (source.out as number) <= (source.in as number))) error(`demo_plan.stages[${index}].source`);
            if (entry.item.crop && (!isFiniteRecord(entry.item.crop, ['x', 'y', 'w', 'h']) ||
                (entry.item.crop as { w: number; h: number }).w <= 0 ||
                (entry.item.crop as { w: number; h: number }).h <= 0)) error(`demo_plan.stages[${index}].crop`);
            if (entry.item.transform && !isFiniteRecord(entry.item.transform, ['x', 'y', 'scale']))
                error(`demo_plan.stages[${index}].transform`);
            if (entry.item.keyframes && (!Array.isArray(entry.item.keyframes) ||
                !entry.item.keyframes.every(frame => frame && typeof frame === 'object' && number(frame.t))))
                error(`demo_plan.stages[${index}].keyframes`);
        }
    }
    if (!guide.demo_plan.punch_in_keyframes.every(frame => frame && typeof frame === 'object' &&
        number((frame as { t?: unknown }).t))) error('demo_plan.punch_in_keyframes');
    if (!Array.isArray(guide.seek_seconds) || guide.seek_seconds.length !== 8 ||
        !guide.seek_seconds.every(second => number(second) && second >= 0 && second <= guide.duration_seconds)) error('seek_seconds');
    if (!Array.isArray(guide.emphasis) || !guide.emphasis.every(entry => entry && typeof entry === 'object' &&
        string(entry.text) && (entry.scale === undefined || number(entry.scale) && entry.scale > 0))) error('emphasis');
    if (!guide.karaoke || !['pair', 'head', 'text', 'separator'].every(key => string(guide.karaoke[key as keyof typeof guide.karaoke]))) error('karaoke');
    if (!guide.log_words || !['opening_title', 'first_quote', 'second_quote', 'effect', 'diagram', 'music', 'karaoke', 'credit']
        .every(key => string(guide.log_words[key]))) error('log_words');
    if (!guide.finder || !['length', 'size'].every(key => string(guide.finder[key as keyof typeof guide.finder]))) error('finder');
    if (!guide.subtitles || guide.subtitles.language !== guide.language ||
        !Number.isInteger(guide.subtitles.max_characters) || guide.subtitles.max_characters < 1) error('subtitles');
    return guide;
}

function isFiniteRecord(value: unknown, fields: string[]): boolean {
    return !!value && typeof value === 'object' && fields.every(field =>
        typeof (value as Record<string, unknown>)[field] === 'number' &&
        Number.isFinite((value as Record<string, number>)[field]));
}
