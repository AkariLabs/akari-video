import { injectable, inject } from '@theia/core/shared/inversify';
import { promises as fs, constants as fsConstants } from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';
import { runEditLint, writeProjectFilesGuarded } from '@akari-video/edit-store/lib/write-gate';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions, OnboardingState, parseOnboardingState, splitOnboardingTokens, TranscriptSegment, TranscriptToken } from '../onboarding/model';
import { guideAnnouncementDecision, guideAnnouncementMarker } from '../onboarding/announcement-model';
import { welcomeImageCandidates } from '../onboarding/asset-paths';
import { AkariOnboardingService, SampleInformation } from '../onboarding/protocol';

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
const SAMPLE_ID = 'talkinghead-desk-ja-01';
const SAMPLE_NAME = 'サンプル動画.mp4';
const STATE_FILE = 'onboarding-v1.json';
const ANNOUNCEMENT_FILE = 'first-video-guide-announcement-v1.json';
const BUNDLED_SAMPLE = 'onboarding-sample/talkinghead-desk-ja-01';
// Production layout: apps/shell/extensions/akari-surfaces/evidence/onboarding-demo-production/plan.json.
// お手本には声のダッキング鍵が無い（書き出しは直下の analysis.json、プレビューは narration のみ）ため ducking は使わず、両経路で同じ音にする。
// 声の下は gain_db -14（声 -16 LUFS より約 14 LU 下）。keyframes は基準への加算で「BGM も」(29.45) に +8 dB、締めに +10 dB。
// keyframes は 8 点以下に保つ。9 点以上は edit-store が motion 袋へ出し、音声 item では edit-lint が通らない。
// phone-screen reuses sample, so captions: 'off' prevents duplicate subtitles.
type DemoSource = { kind: string; path?: string; src?: string; [key: string]: unknown };
type DemoItem = { id: string; at: number; source: DemoSource; [key: string]: unknown };
type DemoEntry = { track: string; item: DemoItem };
const html = (track: string, id: string, name: string, at: number, duration: number, path: string): DemoEntry =>
    ({ track, item: { id, name, at, duration, source: { kind: 'html', path } } });
const sfx = (id: string, at: number, duration: number, gain_db: number, name: string, out: number): DemoEntry =>
    ({ track: 'demo-sfx', item: { id, at, duration, role: 'sfx', gain_db,
        source: { kind: 'media', src: `demo-${name}`, in: 0, out } } });
const DEMO_PLAN: { stages: Array<{ stage: number; key: string; items: DemoEntry[] }>; punch_in_keyframes: object[] } = {
  stages: [
    { stage: 1, key: 'title', items: [
        html('demo-stage', 'demo-title', 'タイトル', 7, 217, 'overlays/demo-title/fragment.html'),
        sfx('demo-sfx-title-whoosh', 0, 29, -10, 'sfx-whoosh-air-soft', 0.95),
        sfx('demo-sfx-name-pop', 107, 15, -6, 'sfx-pop-ding', 0.5)
    ] },
    { stage: 2, key: 'telops', items: [
        html('demo-stage', 'demo-chat', 'AI との対話', 256, 73, 'overlays/demo-chat/fragment.html'),
        html('demo-stage', 'demo-done', '編集完了', 338, 108, 'overlays/demo-done/fragment.html'),
        sfx('demo-sfx-chat-pop-1', 256, 5, -4, 'sfx-pop-bubble-big', 0.15),
        sfx('demo-sfx-chat-pop-2', 277, 5, -4, 'sfx-pop-bubble-big', 0.15),
        sfx('demo-sfx-done-tone', 402, 17, -3, 'sfx-correct-tone', 0.55)
    ] },
    { stage: 3, key: 'effects', items: [
        html('demo-stage', 'demo-effects', '効果音とエフェクト', 524, 135, 'overlays/demo-effects/fragment.html'),
        html('demo-flash', 'demo-flash', '閃光', 590, 12, 'overlays/demo-flash/fragment.html'),
        sfx('demo-sfx-kouka-pop', 524, 5, -4, 'sfx-pop-cork', 0.15),
        sfx('demo-sfx-pa-whoosh', 581, 23, -4, 'sfx-whoosh-punchy', 0.75),
        sfx('demo-sfx-hora-sparkle', 617, 44, 2, 'sfx-shimmer-sparkle', 1.45)
    ] },
    { stage: 4, key: 'diagram', items: [
        html('demo-stage', 'demo-diagram', '図解', 697, 110, 'overlays/demo-diagram/fragment.html'),
        sfx('demo-sfx-diagram-pon', 697, 15, -3, 'sfx-diagram-pon', 0.482),
        sfx('demo-sfx-diagram-stack', 713, 5, -3, 'sfx-diagram-stack', 0.147),
        sfx('demo-sfx-diagram-playhead', 727, 7, -3, 'sfx-diagram-playhead', 0.216),
        sfx('demo-sfx-diagram-count', 743, 18, -3, 'sfx-diagram-count', 0.567)
    ] },
    { stage: 5, key: 'phone', items: [
        { track: 'demo-phone-screen', item: { id: 'demo-phone-screen', name: 'スマホの画面', at: 833, duration: 144, crop: { x: 0.208, y: 0, w: 0.2645, h: 1 }, transform: { x: 372, y: -24, scale: 0.6607 }, source: { kind: 'media', src: 'sample', in: 27.7667, out: 32.5667, mute: true }, captions: 'off' } },
        html('demo-stage', 'demo-phone', 'スマホ', 809, 179, 'overlays/demo-phone/fragment.html'),
        sfx('demo-sfx-phone-swoosh', 805, 20, -5, 'sfx-swoosh-up', 0.65),
        sfx('demo-sfx-phone-tap', 833, 5, -6, 'sfx-click-mouse-single', 0.15)
    ] },
    { stage: 6, key: 'bgm', items: [
        { track: 'onboarding-bgm', item: { id: 'onboarding-bgm', at: 0, duration: 1128, role: 'bgm', gain_db: -14, fade_in: 0.6, fade_out: 1.2,
            keyframes: [{ t: 0, gain_db: 0 }, { t: 879, gain_db: 0 }, { t: 888, gain_db: 8, easing: 'out-cubic' }, { t: 918, gain_db: 8 },
                { t: 942, gain_db: 0, easing: 'in-out-cubic' }, { t: 1070, gain_db: 0 }, { t: 1080, gain_db: 10, easing: 'out-cubic' }],
            source: { kind: 'media', src: 'onboarding-bgm', in: 0, out: 37.6 } } },
        html('demo-accents', 'demo-bgm-chip', 'BGM', 883, 105, 'overlays/demo-bgm/fragment.html')
    ] },
    { stage: 7, key: 'karaoke', items: [] },
    { stage: 8, key: 'credit', items: [
        html('demo-stage', 'demo-credit', 'クレジット', 1068, 60, 'overlays/demo-credit/fragment.html'),
        sfx('demo-sfx-punchline-ding', 1069, 42, -2, 'sfx-ding-single', 1.4)
    ] }
  ],
  punch_in_keyframes: [{ t: 590, transform: { x: 0, scale: 1 } }, { t: 592, transform: { x: 0, scale: 1.1 }, easing: 'out-expo' }, { t: 593, transform: { x: 4, scale: 1.1 } }, { t: 594, transform: { x: -4, scale: 1.1 } }, { t: 595, transform: { x: 0, scale: 1.1 } }, { t: 633, transform: { x: 0, scale: 1.1 } }, { t: 642, transform: { x: 0, scale: 1 }, easing: 'in-out-cubic' }]
};
const demoFile = (source: DemoSource): { bundled: string; project: string } | undefined => {
    if (source.kind === 'html' && source.path) return { bundled: source.path, project: source.path };
    if (source.kind !== 'media' || !source.src || source.src === 'sample') return undefined;
    if (source.src === 'onboarding-bgm') return { bundled: 'bgm.m4a', project: 'assets/onboarding-bgm.m4a' };
    if (source.src.startsWith('demo-sfx-')) {
        const name = source.src.slice('demo-'.length);
        return { bundled: `audio/${name}.m4a`, project: `assets/onboarding/${name}.m4a` };
    }
    return undefined;
};
const DEMO_STAGES = DEMO_PLAN.stages;
const EXTRA_SAMPLE_FILES = [...new Map(DEMO_STAGES.flatMap(stage => stage.items)
    .map(({ item }) => demoFile(item.source))
    .filter((file): file is { bundled: string; project: string } => !!file)
    .map(file => [file.bundled, file])).values()];
// 閃光は擬音「パッ！」（demo-stage）より下の専用段に置く（上だと 19.70 の見せ場で擬音が白く飛ぶ）。
const DEMO_TRACKS = [
    { id: 'demo-phone-screen', lane: 'visual', name: 'スマホの画面' },
    { id: 'demo-flash', lane: 'visual', name: '閃光' },
    { id: 'demo-stage', lane: 'visual', name: '右の演出' },
    { id: 'demo-accents', lane: 'visual', name: '札' },
    { id: 'onboarding-bgm', lane: 'audio', name: 'BGM' },
    { id: 'demo-sfx', lane: 'audio', name: '効果音' }
] as const;
// 2026-10-01 に語の時刻を声で合わせ直す前に同梱していた transcript.json（語頭が最大 1.46 秒早い）の sha256。
// ライブラリへの複写は COPYFILE_EXCL なので、既存ユーザーの手元にはこの版が残り続ける。
const LEGACY_TRANSCRIPT_DIGESTS: readonly string[] = ['b384cae62959224be1c65d036da836ce53023169f0aa778afc1dffd307696c69'];

@injectable()
export class AkariOnboardingServiceImpl implements AkariOnboardingService {
    async heroDataUrl(): Promise<string> {
        let lastError: unknown;
        for (const candidate of this.welcomeImageCandidates()) {
            try { return `data:image/webp;base64,${(await fs.readFile(candidate)).toString('base64')}`; }
            catch (error) { lastError = error; }
        }
        console.warn('[akari-onboarding] ようこそ画像を読めませんでした。画像なしで続けます。', lastError);
        return '';
    }

    protected welcomeImageCandidates(): string[] {
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        return welcomeImageCandidates(__dirname, process.cwd(), resourcesPath);
    }
    @inject(AkariNewProjectService)
    protected readonly projects!: AkariNewProjectService;

    @inject(AkariProjectService)
    protected readonly projectService!: AkariProjectService;

    protected get home(): string {
        return process.env.AKARI_HOME || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.akari');
    }

    async load(): Promise<OnboardingState | undefined> {
        try { return parseOnboardingState(JSON.parse(await fs.readFile(join(this.home, STATE_FILE), 'utf8'))); }
        catch { return undefined; }
    }

    async save(state: OnboardingState): Promise<void> {
        const parsed = parseOnboardingState(state);
        if (!parsed) throw new Error('オンボーディングの保存形式が不正です');
        await fs.mkdir(this.home, { recursive: true });
        const destination = join(this.home, STATE_FILE);
        const temporary = `${destination}.${process.pid}.tmp`;
        await fs.writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
        await fs.rename(temporary, destination);
    }

    async claimGuideAnnouncement(context: { hasOpenProject: boolean; hasProjectHistory: boolean }): Promise<boolean> {
        const exists = async (name: string): Promise<boolean> =>
            fs.stat(join(this.home, name)).then(stat => stat.isFile(), () => false);
        const [hasCreatorRootPointer, hasWorkspaceDirectory, legacySetupMarkerSeen, announcementMarkerSeen, guideStateSeen] = await Promise.all([
            exists('creator-root.json'),
            this.projects.defaultCreatorRootPath()
                .then(path => fs.stat(join(path, '.akari', 'root.json')).then(stat => stat.isFile(), () => false), () => false),
            exists('first-run-onboarding-v0.json'), exists(ANNOUNCEMENT_FILE),
            this.load().then(state => !!state)
        ]);
        const decision = guideAnnouncementDecision({ ...context, hasCreatorRootPointer, hasWorkspaceDirectory,
            legacySetupMarkerSeen, guideStateSeen, announcementMarkerSeen });
        const marker = guideAnnouncementMarker(decision, new Date().toISOString());
        if (!marker) return false;
        await fs.mkdir(this.home, { recursive: true });
        try {
            const file = await fs.open(join(this.home, ANNOUNCEMENT_FILE), 'wx');
            try { await file.writeFile(`${JSON.stringify(marker, null, 2)}\n`, 'utf8'); }
            finally { await file.close(); }
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
            throw error;
        }
    }

    async markSeen(): Promise<void> {
        await fs.mkdir(this.home, { recursive: true });
        await fs.writeFile(join(this.home, 'first-run-onboarding-v0.json'),
            `${JSON.stringify({ schema: 1, shownAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
        const state = await this.load();
        if (state) await this.save({ ...state, completed: true });
    }

    async returnToHome(): Promise<void> {
        await this.projects.ensureCreatorRoot();
        await this.markSeen();
    }

    protected async findUpwardFile(name: string): Promise<string> {
        for (const start of [__dirname, process.cwd()]) {
            let current = start;
            for (let index = 0; index < 12; index++) {
                const candidate = join(current, name);
                if (await fs.stat(candidate).then(stat => stat.isFile(), () => false)) return candidate;
                const parent = dirname(current);
                if (parent === current) break;
                current = parent;
            }
        }
        throw new Error(`${name} が見つかりません`);
    }

    protected async ensureSample(rootPath: string): Promise<string> {
        const destination = join(rootPath, 'library', 'broll', SAMPLE_ID);
        const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const packaged = resources && join(resources, BUNDLED_SAMPLE);
        const bundled = packaged && await fs.stat(join(packaged, 'clip.mp4')).then(stat => stat.isFile(), () => false)
            ? packaged : dirname(await this.findUpwardFile(`apps/shell/resources/${BUNDLED_SAMPLE}/clip.mp4`).catch(() => ''));
        if (bundled && await fs.stat(join(bundled, 'clip.mp4')).then(stat => stat.isFile(), () => false)) {
            await fs.mkdir(destination, { recursive: true });
            for (const name of ['clip.mp4', 'transcript.json', 'meta.json', 'preview.png']) {
                try { await fs.copyFile(join(bundled, name), join(destination, name), fsConstants.COPYFILE_EXCL); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            }
            await this.upgradeLegacyTranscript(bundled, destination);
            for (const file of EXTRA_SAMPLE_FILES) {
                await fs.mkdir(dirname(join(destination, file.bundled)), { recursive: true });
                try { await fs.copyFile(join(bundled, file.bundled), join(destination, file.bundled), fsConstants.COPYFILE_EXCL); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            }
            return destination;
        }
        // Older development builds can still use the Lab resolver.
        const resolver = await importEsm<{ resolve: (id: string, options: { env: NodeJS.ProcessEnv }) => Promise<{ dir: string }> }>(
            pathToFileURL(await this.findUpwardFile('packages/asset-resolver/src/resolve.mjs')).toString());
        return (await resolver.resolve(SAMPLE_ID, { env: process.env })).dir;
    }

    protected readonly legacyTranscriptDigests: readonly string[] = LEGACY_TRANSCRIPT_DIGESTS;

    // ライブラリの書き起こしが旧同梱版そのもの（改行コードの違いは同一視）のときだけ同梱版へ置き換える。
    // 利用者が手を入れた版は残す。置き換えに失敗しても旧版のまま続ける（字幕の時刻がずれるだけで作業は止めない）。
    protected async upgradeLegacyTranscript(bundled: string, destination: string): Promise<void> {
        const target = join(destination, 'transcript.json');
        const current = await fs.readFile(target).catch(() => undefined);
        if (!current) return;
        const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
        if (!this.legacyTranscriptDigests.includes(digest(current.toString('utf8').replace(/\r\n/g, '\n')))) return;
        const next = await fs.readFile(join(bundled, 'transcript.json'));
        if (digest(next) === digest(current)) return;
        const temporary = `${target}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporary, next);
            await fs.rename(temporary, target);
        } catch (error) {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
            console.warn('[akari-onboarding] サンプルの書き起こしを新しい語の時刻へ更新できませんでした。前の版のまま続けます。', error);
        }
    }

    async prepare(): Promise<{ projectUri: string; sample: SampleInformation }> {
        const rootUri = await this.projects.ensureCreatorRoot();
        const rootPath = fileURLToPath(rootUri);
        const previous = await this.load();
        let projectPath = previous?.projectUri ? fileURLToPath(previous.projectUri) : undefined;
        if (!projectPath || !await fs.stat(projectPath).then(stat => stat.isDirectory(), () => false)) {
            const videos = join(rootPath, 'channels', 'my-channel', 'videos');
            const stem = `${new Date().toISOString().slice(0, 10)}-first-video`;
            let name = stem;
            for (let index = 2; await fs.stat(join(videos, name)).then(() => true, () => false); index++) name = `${stem}-${index}`;
            projectPath = join(videos, name);
            await this.projects.createProject(pathToFileURL(projectPath).toString());
            const intake = { version: 1, tasks: [], target: { duration_s: null, keep_length: true, taste: null },
                autonomy: 'checkpoint', status: 'draft', submitted_at: null, title: 'はじめての動画' };
            await fs.writeFile(join(projectPath, '.akari', 'intake.json'), `${JSON.stringify(intake, null, 2)}\n`);
            await writeProjectFilesGuarded(projectPath, { 'edit.json': `${JSON.stringify(createEmptyOnboardingEdit(), null, 2)}\n` });
            await this.save({ schema: 1, step: 'invite', sub: 0, projectUri: pathToFileURL(projectPath).toString() });
        }
        const assetDir = await this.ensureSample(rootPath);
        const transcript = JSON.parse(await fs.readFile(join(assetDir, 'transcript.json'), 'utf8')) as {
            tokens?: { items?: TranscriptToken[] }
        };
        const segments = splitOnboardingTokens(transcript.tokens?.items ?? []);
        if (!segments.length) throw new Error('サンプルの書き起こしを読み取れませんでした');
        return { projectUri: pathToFileURL(projectPath).toString(), sample: { sourcePath: join(assetDir, 'clip.mp4'), segments } };
    }

    async importSample(projectUri: string, sourcePath: string): Promise<string> {
        const project = fileURLToPath(projectUri);
        const current = await this.load();
        if (current?.projectUri !== projectUri || basename(sourcePath) !== 'clip.mp4') throw new Error('サンプルの場所が違います');
        const result = await this.projectService.recordDroppedAssets(projectUri,
            [{ name: SAMPLE_NAME, sourcePath }]);
        const imported = result[0];
        if (!imported?.success) throw new Error('サンプル動画を取り込めませんでした');
        const rel = imported.assetPath;
        const assetPath = resolve(project, rel);
        const inside = relative(project, assetPath);
        if (!inside || inside.startsWith(`..${sep}`) || inside === '..') throw new Error('素材の場所が違います');
        const transcript = JSON.parse(await fs.readFile(join(dirname(sourcePath), 'transcript.json'), 'utf8')) as {
            tokens?: { items?: TranscriptToken[] }
        };
        const analysisDir = join(project, '.akari', 'sidecars', `${rel}.analysis`);
        await fs.mkdir(analysisDir, { recursive: true });
        const analysis = { version: 0, source: relative(analysisDir, assetPath).split(sep).join('/'),
            transcript: splitOnboardingTokens(transcript.tokens?.items ?? []), keyframes: [], events: [],
            tracks: { speakers: [], faces: [], person_matte: null } };
        await fs.writeFile(join(analysisDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
        return rel;
    }

    async writeExample(projectUri: string, sourcePath: string, segments: TranscriptSegment[], count: number, title: boolean,
        progress?: { stage?: number }): Promise<void> {
        const current = await this.load();
        if (current?.projectUri !== projectUri || (!current.imported && !current.exampleActive) || basename(sourcePath) !== 'clip.mp4')
            throw new Error('素材を先に取り込んでください');
        if (!Number.isInteger(count) || count < 0 || count > segments.length || !segments.length) throw new Error('字幕の数が不正です');
        const stage = progress?.stage ?? (title ? (count === segments.length ? 8 : 1) : 0);
        if (!Number.isInteger(stage) || stage < 0 || stage > 8 || (stage >= 1 && !title))
            throw new Error('お手本の段階が不正です');
        const project = fileURLToPath(projectUri);
        const samplePath = `assets/${SAMPLE_NAME}`;
        const edit = createOnboardingEdit(samplePath, count > 0 || title) as {
            sources: Array<{ id: string; path: string }>;
            tracks: Array<{ id: string; lane: string; name: string; items: DemoItem[] }>;
        };
        const selected = DEMO_STAGES.filter(part => part.stage <= stage).flatMap(part => part.items);
        if (stage >= 3) edit.tracks[0].items[0].keyframes = DEMO_PLAN.punch_in_keyframes;
        if (stage >= 1) {
            const captionTrack = edit.tracks.find(track => track.id === 'captions');
            if (captionTrack) captionTrack.name = '字幕';
        }
        const visual = DEMO_TRACKS.filter(track => track.lane === 'visual').map(track => ({ ...track,
            items: selected.filter(entry => entry.track === track.id).map(entry => ({ ...entry.item }))
                .sort((a, b) => a.at - b.at) })).filter(track => track.items.length);
        const audio = DEMO_TRACKS.filter(track => track.lane === 'audio').map(track => ({ ...track,
            items: selected.filter(entry => entry.track === track.id).map(entry => ({ ...entry.item }))
                .sort((a, b) => a.at - b.at) })).filter(track => track.items.length);
        edit.tracks.splice(1, 0, ...visual);
        edit.tracks.push(...audio);
        const media = selected.map(entry => entry.item.source).filter(source => source.kind === 'media' &&
            source.src && source.src !== 'sample' && source.src !== 'onboarding-bgm');
        for (const source of media) {
            const id = source.src!;
            if (!edit.sources.some(existing => existing.id === id)) edit.sources.push({ id, path: demoFile(source)!.project });
        }
        if (selected.some(entry => entry.item.source.src === 'onboarding-bgm'))
            edit.sources.push({ id: 'onboarding-bgm', path: 'assets/onboarding-bgm.m4a' });
        const files = [...new Map(selected.map(entry => demoFile(entry.item.source))
            .filter((file): file is { bundled: string; project: string } => !!file)
            .map(file => [file.bundled, file])).values()];
        for (const file of files) {
            await fs.mkdir(dirname(join(project, file.project)), { recursive: true });
            try { await fs.copyFile(join(dirname(sourcePath), file.bundled), join(project, file.project), fsConstants.COPYFILE_EXCL); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        const adjusted = segments.map(segment => ({ ...segment }));
        let karaokeTokens: TranscriptToken[] | undefined;
        try {
            const transcript = JSON.parse(await fs.readFile(join(dirname(sourcePath), 'transcript.json'), 'utf8')) as {
                tokens?: { items?: TranscriptToken[] }
            };
            const tokens = transcript.tokens?.items;
            if (Array.isArray(tokens) && tokens.every(token => typeof token.t === 'string' &&
                Number.isFinite(token.start) && Number.isFinite(token.end))) {
                const index = adjusted.findIndex((segment, position) => adjusted[position + 1] &&
                    segment.text + adjusted[position + 1].text === 'BGMも、字幕のカラオケ表示もいけます。');
                if (index >= 0) {
                    const pair = tokens.filter(token => token.start >= adjusted[index].start &&
                        token.end <= adjusted[index + 1].end);
                    const comma = pair.findIndex(token => token.t === '、');
                    if (comma >= 0 && comma < pair.length - 1 && pair.map(token => token.t).join('') ===
                        adjusted[index].text + adjusted[index + 1].text) {
                        const head = pair.slice(0, comma + 1);
                        karaokeTokens = pair.slice(comma + 1);
                        adjusted[index] = { start: head[0].start,
                            end: Math.max(head[0].start + .05, head[head.length - 1].end), text: 'BGMも、' };
                        adjusted[index + 1] = { start: karaokeTokens[0].start,
                            end: Math.max(karaokeTokens[0].start + .05, karaokeTokens[karaokeTokens.length - 1].end),
                            text: '字幕のカラオケ表示もいけます。' };
                    }
                }
            }
        } catch { /* An absent or incompatible transcript leaves the model captions intact. */ }
        const captions = createOnboardingCaptions(adjusted, count, false) as { captions: Array<{
            text: string; display_text: string; runs: object[]; [key: string]: unknown
        }> };
        if (stage >= 2) {
            const keywords = ['アカリビデオ', 'AIと対話', '効果音', 'エフェクト', 'パッと', '図解', 'スマホ', 'モックアップ', 'BGM'];
            const GraphemeSegmenter = (Intl as typeof Intl & { Segmenter: new (locale: string,
                options: { granularity: 'grapheme' }) => { segment(input: string): Iterable<unknown> } }).Segmenter;
            const graphemes = new GraphemeSegmenter('ja', { granularity: 'grapheme' });
            for (const caption of captions.captions) {
                const runs = keywords.flatMap(keyword => {
                    const at = caption.display_text.indexOf(keyword);
                    if (at < 0) return [];
                    return [{ from: [...graphemes.segment(caption.display_text.slice(0, at))].length,
                        to: [...graphemes.segment(caption.display_text.slice(0, at + keyword.length))].length,
                        role: 'emphasis', style: { color: '#FB923C', font_weight: 900,
                            ...(keyword === 'パッと' ? { scale: 1.15 } : {}) } }];
                });
                caption.runs = runs.sort((a, b) => a.from - b.from);
            }
        }
        if (stage >= 7 && karaokeTokens) {
            const caption = captions.captions.find(item => item.text === '字幕のカラオケ表示もいけます。');
            if (caption) Object.assign(caption, { style: 'karaoke', runs: [],
                words: karaokeTokens.map(token => ({ text: token.t, start: token.start, end: token.end })),
                text_style: { karaoke: { done_color: '#FB923C' }, size_px: 62 } });
        }
        const desired: Record<string, string> = {
            'edit.json': `${JSON.stringify(edit, null, 2)}\n`,
            'captions.json': `${JSON.stringify(captions, null, 2)}\n`
        };
        const candidates: Record<string, string> = {};
        for (const [name, content] of Object.entries(desired)) {
            if (await fs.readFile(join(project, name), 'utf8').catch(() => '') !== content) candidates[name] = content;
        }
        if (!Object.keys(candidates).length) return;
        // Windows のプレビュー／監視が置換先を短時間開いている場合は rename が EPERM になる。
        // 既存の atomic 保存口を保ったまま同じ候補一式を再試行する。
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                await writeProjectFilesGuarded(project, candidates);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 7) throw error;
                await new Promise(resolveDelay => setTimeout(resolveDelay, 100 * (attempt + 1)));
            }
        }
    }

    async resetTourExample(projectUri: string, sourcePath: string, _segments: TranscriptSegment[]): Promise<void> {
        const current = await this.load();
        if (current?.projectUri !== projectUri || !current.exampleActive || current.workCompleted)
            throw new Error('完成例の状態が違います');
        const project = fileURLToPath(projectUri);
        const sample = join(project, 'assets', SAMPLE_NAME);
        const captionPath = join(project, 'captions.json');
        let removeSample = false;
        if (!current.imported) {
            const [original, copied] = await Promise.all([
                fs.readFile(sourcePath).catch(() => undefined), fs.readFile(sample).catch(() => undefined)
            ]);
            if (original && copied) {
                const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
                removeSample = digest(original) === digest(copied);
            }
        }
        await writeProjectFilesGuarded(project, {
            'edit.json': `${JSON.stringify(createEmptyOnboardingEdit(), null, 2)}\n`
        });
        await fs.rm(captionPath, { force: true });
        for (const file of EXTRA_SAMPLE_FILES) {
            const [original, copied] = await Promise.all([
                fs.readFile(join(dirname(sourcePath), file.bundled)).catch(() => undefined),
                fs.readFile(join(project, file.project)).catch(() => undefined)
            ]);
            if (original && copied && createHash('sha256').update(original).digest('hex') ===
                createHash('sha256').update(copied).digest('hex')) await fs.rm(join(project, file.project), { force: true });
        }
        const emptyDirectories = [...new Set(EXTRA_SAMPLE_FILES.map(file => dirname(file.project)))].filter(directory => {
            const relativeDirectory = directory.replaceAll('\\', '/');
            return relativeDirectory === 'assets/onboarding' || /^overlays\/demo-[^/]+$/.test(relativeDirectory);
        });
        for (const directory of emptyDirectories) await fs.rmdir(join(project, directory)).catch(() => undefined);
        if (removeSample) {
            await fs.rm(sample, { force: true });
            await fs.rm(join(project, '.akari', 'sidecars', `assets/${SAMPLE_NAME}.analysis`), { recursive: true, force: true });
        }
    }

    async lintExample(projectUri: string): Promise<number> {
        const result = await runEditLint(fileURLToPath(projectUri), undefined, false);
        return result.errors.length;
    }

    async hasExport(projectUri: string): Promise<boolean> {
        const current = await this.load();
        if (current?.projectUri !== projectUri) return false;
        const files = await fs.readdir(join(fileURLToPath(projectUri), 'exports')).catch(() => [] as string[]);
        return files.some(name => name.toLowerCase().endsWith('.mp4'));
    }
}
