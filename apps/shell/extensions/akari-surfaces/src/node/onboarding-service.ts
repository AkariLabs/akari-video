import { t, getLanguage } from '@akari-video/i18n';
import { OnboardingGuide, parseOnboardingGuide } from '../onboarding/guide';
import { injectable, inject } from '@theia/core/shared/inversify';
import { promises as fs, constants as fsConstants } from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';
import { planCaptionLookMigration, rederiveCaptionWords, type CaptionRun } from '@akari-video/edit-store';
import { loadTextstyleCatalogSync } from '@akari-video/edit-store/lib/textstyle-library-node';
import { runEditLint, writeProjectFilesGuarded } from '@akari-video/edit-store/lib/write-gate';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions, OnboardingState, parseOnboardingState, splitOnboardingTokens, TranscriptSegment, TranscriptToken } from '../onboarding/model';
import { guideAnnouncementDecision, guideAnnouncementMarker } from '../onboarding/announcement-model';
import { welcomeImageCandidates } from '../onboarding/asset-paths';
import { AkariOnboardingService, SampleInformation } from '../onboarding/protocol';

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
const SAMPLE_BY_LANG: Record<string, string> = { ja: 'talkinghead-desk-ja-01', en: 'talkinghead-desk-en-01' };
const STATE_FILE = 'onboarding-v1.json';
const ANNOUNCEMENT_FILE = 'first-video-guide-announcement-v1.json';
type DemoSource = { kind: string; path?: string; src?: string; [key: string]: unknown };
type DemoItem = { id: string; at: number; source: DemoSource; [key: string]: unknown };
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
const extraSampleFiles = (guide: OnboardingGuide): Array<{ bundled: string; project: string }> =>
    [...new Map(guide.demo_plan.stages.flatMap(stage => stage.items)
        .map(({ item }) => demoFile(item.source))
        .filter((file): file is { bundled: string; project: string } => !!file)
        .map(file => [file.bundled, file])).values()];
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
        console.warn('[akari-onboarding] ' + t('surfaces.onboardingService.warning.welcomeImageUnavailable'), lastError);
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
        if (!parsed) throw new Error(t('surfaces.onboardingService.error.invalidState'));
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
        throw new Error(t('surfaces.onboardingService.error.missingFile', { name }));
    }

    protected async bundledSample(sampleId: string): Promise<string | undefined> {
        const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const bundledPath = `onboarding-sample/${sampleId}`;
        const packaged = resources && join(resources, bundledPath);
        const bundled = packaged && await fs.stat(join(packaged, 'clip.mp4')).then(stat => stat.isFile(), () => false)
            ? packaged : dirname(await this.findUpwardFile(`apps/shell/resources/${bundledPath}/clip.mp4`).catch(() => ''));
        return bundled && await fs.stat(join(bundled, 'clip.mp4')).then(stat => stat.isFile(), () => false) ? bundled : undefined;
    }

    protected async readGuide(directory: string): Promise<OnboardingGuide> {
        const path = join(directory, 'guide.json');
        let raw: unknown;
        try { raw = JSON.parse(await fs.readFile(path, 'utf8')); }
        catch (error) { throw new Error(`Cannot read onboarding guide ${path}: ${String(error)}`); }
        return parseOnboardingGuide(raw, path);
    }

    protected async guideForState(state?: OnboardingState): Promise<OnboardingGuide> {
        const sampleId = state?.sampleId ?? SAMPLE_BY_LANG.ja;
        const bundled = await this.bundledSample(sampleId);
        if (!bundled) throw new Error(`Missing bundled onboarding sample ${sampleId} (guide.json)`);
        return this.readGuide(bundled);
    }

    protected async ensureSample(rootPath: string, sampleId = SAMPLE_BY_LANG.ja, guide?: OnboardingGuide): Promise<string> {
        const destination = join(rootPath, 'library', 'broll', sampleId);
        const bundled = await this.bundledSample(sampleId);
        guide ??= bundled && await this.readGuide(bundled);
        if (bundled && await fs.stat(join(bundled, 'clip.mp4')).then(stat => stat.isFile(), () => false)) {
            await fs.mkdir(destination, { recursive: true });
            for (const name of ['clip.mp4', 'transcript.json', 'meta.json', 'preview.png']) {
                try { await fs.copyFile(join(bundled, name), join(destination, name), fsConstants.COPYFILE_EXCL); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            }
            await this.upgradeLegacyTranscript(bundled, destination);
            for (const file of extraSampleFiles(guide!)) {
                await fs.mkdir(dirname(join(destination, file.bundled)), { recursive: true });
                try { await fs.copyFile(join(bundled, file.bundled), join(destination, file.bundled), fsConstants.COPYFILE_EXCL); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
            }
            return destination;
        }
        // Older development builds can still use the Lab resolver.
        const resolver = await importEsm<{ resolve: (id: string, options: { env: NodeJS.ProcessEnv }) => Promise<{ dir: string }> }>(
            pathToFileURL(await this.findUpwardFile('packages/asset-resolver/src/resolve.mjs')).toString());
        return (await resolver.resolve(sampleId, { env: process.env })).dir;
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
            console.warn('[akari-onboarding] ' + t('surfaces.onboardingService.warning.transcriptUpgradeUnavailable'), error);
        }
    }

    async prepare(language?: string): Promise<{ projectUri: string; sample: SampleInformation }> {
        const rootUri = await this.projects.ensureCreatorRoot();
        const rootPath = fileURLToPath(rootUri);
        const previous = await this.load();
        const requested = (language ?? getLanguage()).split('-')[0].toLowerCase();
        const candidates = previous?.projectUri ? [previous.sampleId ?? SAMPLE_BY_LANG.ja] :
            [SAMPLE_BY_LANG[requested], SAMPLE_BY_LANG.en, SAMPLE_BY_LANG.ja];
        const distinctCandidates = [...new Set(candidates.filter((candidate): candidate is string => !!candidate))];
        let sampleId: string | undefined;
        let guide: OnboardingGuide | undefined;
        let guideError: unknown;
        for (const [index, candidate] of distinctCandidates.entries()) {
            const found = await this.bundledSample(candidate);
            if (!found) continue;
            try {
                guide = await this.readGuide(found);
                sampleId = candidate;
                break;
            } catch (error) {
                if (previous?.projectUri) throw error;
                guideError = error;
                console.warn(`[akari-onboarding] Guide for ${candidate} is unavailable; ${index < distinctCandidates.length - 1
                    ? 'trying the next sample.' : 'no usable sample remains.'}`);
            }
        }
        if (!sampleId || !guide) {
            if (guideError) throw guideError;
            throw new Error(`Missing bundled onboarding sample ${candidates.filter(Boolean).join(', ')} (guide.json)`);
        }
        let projectPath = previous?.projectUri ? fileURLToPath(previous.projectUri) : undefined;
        if (!projectPath || !await fs.stat(projectPath).then(stat => stat.isDirectory(), () => false)) {
            const videos = join(rootPath, 'channels', 'my-channel', 'videos');
            const stem = `${new Date().toISOString().slice(0, 10)}-first-video`;
            let name = stem;
            for (let index = 2; await fs.stat(join(videos, name)).then(() => true, () => false); index++) name = `${stem}-${index}`;
            projectPath = join(videos, name);
            await this.projects.createProject(pathToFileURL(projectPath).toString());
            const intake = { version: 1, tasks: [], target: { duration_s: null, keep_length: true, taste: null },
                autonomy: 'checkpoint', status: 'draft', submitted_at: null, title: guide.project_title, language: guide.language };
            await fs.writeFile(join(projectPath, '.akari', 'intake.json'), `${JSON.stringify(intake, null, 2)}\n`);
            await writeProjectFilesGuarded(projectPath, { 'edit.json': `${JSON.stringify(createEmptyOnboardingEdit(), null, 2)}\n` });
            await this.save({ schema: 1, step: 'invite', sub: 0, projectUri: pathToFileURL(projectPath).toString(), sampleId });
        }
        const assetDir = await this.ensureSample(rootPath, sampleId, guide);
        const transcript = JSON.parse(await fs.readFile(join(assetDir, 'transcript.json'), 'utf8')) as {
            tokens?: { items?: TranscriptToken[] }
        };
        const segments = splitOnboardingTokens(transcript.tokens?.items ?? [], guide.subtitles);
        if (!segments.length) throw new Error(t('surfaces.onboardingService.error.readTranscript'));
        return { projectUri: pathToFileURL(projectPath).toString(), sample: { sourcePath: join(assetDir, 'clip.mp4'), segments, sampleId, guide } };
    }

    async importSample(projectUri: string, sourcePath: string): Promise<string> {
        const project = fileURLToPath(projectUri);
        const current = await this.load();
        if (current?.projectUri !== projectUri || basename(sourcePath) !== 'clip.mp4') throw new Error(t('surfaces.onboardingService.error.sampleLocation'));
        const guide = await this.guideForState(current);
        const result = await this.projectService.recordDroppedAssets(projectUri,
            [{ name: guide.asset_name, sourcePath }]);
        const imported = result[0];
        if (!imported?.success) throw new Error(t('surfaces.onboardingService.error.importSample'));
        const rel = imported.assetPath;
        const assetPath = resolve(project, rel);
        const inside = relative(project, assetPath);
        if (!inside || inside.startsWith(`..${sep}`) || inside === '..') throw new Error(t('surfaces.onboardingService.error.assetLocation'));
        const transcript = JSON.parse(await fs.readFile(join(dirname(sourcePath), 'transcript.json'), 'utf8')) as {
            tokens?: { items?: TranscriptToken[] }
        };
        const analysisDir = join(project, '.akari', 'sidecars', `${rel}.analysis`);
        await fs.mkdir(analysisDir, { recursive: true });
        const analysis = { version: 0, source: relative(analysisDir, assetPath).split(sep).join('/'),
            transcript: splitOnboardingTokens(transcript.tokens?.items ?? [], guide.subtitles), transcript_language: guide.language,
            keyframes: [], events: [],
            tracks: { speakers: [], faces: [], person_matte: null } };
        await fs.writeFile(join(analysisDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
        return rel;
    }

    async writeExample(projectUri: string, sourcePath: string, segments: TranscriptSegment[], count: number, title: boolean,
        progress?: { stage?: number }): Promise<void> {
        const current = await this.load();
        if (current?.projectUri !== projectUri || (!current.imported && !current.exampleActive) || basename(sourcePath) !== 'clip.mp4')
            throw new Error(t('surfaces.onboardingService.error.importFirst'));
        if (!Number.isInteger(count) || count < 0 || count > segments.length || !segments.length) throw new Error(t('surfaces.onboardingService.error.captionCount'));
        const stage = progress?.stage ?? (title ? (count === segments.length ? 8 : 1) : 0);
        if (!Number.isInteger(stage) || stage < 0 || stage > 8 || (stage >= 1 && !title))
            throw new Error(t('surfaces.onboardingService.error.exampleStage'));
        const project = fileURLToPath(projectUri);
        const guide = await this.guideForState(current);
        const samplePath = `assets/${guide.asset_name}`;
        const edit = createOnboardingEdit(samplePath, count > 0 || title, guide) as {
            sources: Array<{ id: string; path: string }>;
            tracks: Array<{ id: string; lane: string; name: string; items: DemoItem[] }>;
        };
        const selected = guide.demo_plan.stages.filter(part => part.stage <= stage).flatMap(part => part.items);
        if (stage >= 3) edit.tracks[0].items[0].keyframes = guide.demo_plan.punch_in_keyframes;
        if (stage >= 1) {
            const captionTrack = edit.tracks.find(track => track.id === 'captions');
            if (captionTrack) captionTrack.name = guide.tracks.captions;
        }
        // 閃光は擬音「パッ！」（demo-stage）より下の専用段に置く（上だと 19.70 の見せ場で擬音が白く飛ぶ）。
        const demoTracks = ['demo-phone-screen', 'demo-flash', 'demo-stage', 'demo-accents', 'onboarding-bgm', 'demo-sfx']
            .map(id => ({ id, lane: ['onboarding-bgm', 'demo-sfx'].includes(id) ? 'audio' : 'visual', name: guide.tracks[id] }));
        const visual = demoTracks.filter(track => track.lane === 'visual').map(track => ({ ...track,
            items: selected.filter(entry => entry.track === track.id).map(entry => ({ ...entry.item }))
                .sort((a, b) => a.at - b.at) })).filter(track => track.items.length);
        const audio = demoTracks.filter(track => track.lane === 'audio').map(track => ({ ...track,
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
        let transcriptTokens: TranscriptToken[] | undefined;
        try {
            const transcript = JSON.parse(await fs.readFile(join(dirname(sourcePath), 'transcript.json'), 'utf8')) as {
                tokens?: { items?: TranscriptToken[] }
            };
            const tokens = transcript.tokens?.items;
            if (Array.isArray(tokens) && tokens.every(token => typeof token.t === 'string' &&
                Number.isFinite(token.start) && Number.isFinite(token.end))) {
                transcriptTokens = tokens;
                const joinText = (words: readonly string[]): string => guide.language === 'ja' ? words.join('') :
                    words.join(' ').replace(/\s+([.!?,])/gu, '$1');
                const index = adjusted.findIndex((segment, position) => adjusted[position + 1] &&
                    joinText([segment.text, adjusted[position + 1].text]) === guide.karaoke.pair);
                if (index >= 0) {
                    const pair = tokens.filter(token => token.start >= adjusted[index].start &&
                        token.end <= adjusted[index + 1].end);
                    const comma = pair.findIndex(token => token.t.endsWith(guide.karaoke.separator));
                    if (comma >= 0 && comma < pair.length - 1 && joinText(pair.map(token => token.t)) === guide.karaoke.pair) {
                        const head = pair.slice(0, comma + 1);
                        karaokeTokens = pair.slice(comma + 1);
                        adjusted[index] = { start: head[0].start,
                            end: Math.max(head[0].start + .05, head[head.length - 1].end), text: guide.karaoke.head };
                        adjusted[index + 1] = { start: karaokeTokens[0].start,
                            end: Math.max(karaokeTokens[0].start + .05, karaokeTokens[karaokeTokens.length - 1].end),
                            text: guide.karaoke.text };
                    }
                }
            }
        } catch { /* An absent or incompatible transcript leaves the model captions intact. */ }
        const captions = createOnboardingCaptions(adjusted, count, false, guide) as { captions: Array<{
            text: string; display_text: string; runs: CaptionRun[]; start: number; end: number; [key: string]: unknown
        }> };
        if (transcriptTokens) {
            for (const caption of captions.captions) {
                const sourceWords = transcriptTokens.filter(token => token.start >= caption.start && token.end <= caption.end)
                    .map(token => ({ text: token.t, start: token.start, end: token.end }));
                if (!sourceWords.length) continue;
                const aligned = rederiveCaptionWords({
                    // Spaced languages join their words with a space, as the caption text does.
                    oldText: guide.language === 'ja' ? sourceWords.map(word => word.text).join('')
                        : sourceWords.map(word => word.text).join(' ').replace(/\s+([.!?,])/gu, '$1'),
                    newText: caption.text,
                    words: sourceWords, start: caption.start, end: caption.end
                });
                const withoutSpaces = (text: string): string => text.replace(/\s/gu, '');
                if (!aligned.degraded && aligned.derivedCount === 0 && aligned.words.length > 0
                    && withoutSpaces(aligned.words.map(word => word.text).join('')) === withoutSpaces(caption.text)
                    && aligned.words.every(word => word.start >= caption.start && word.end <= caption.end
                        && word.end > word.start)) caption.words = aligned.words;
            }
        }
        if (stage >= 2) {
            const GraphemeSegmenter = (Intl as typeof Intl & { Segmenter: new (locale: string,
                options: { granularity: 'grapheme' }) => { segment(input: string): Iterable<unknown> } }).Segmenter;
            const graphemes = new GraphemeSegmenter(guide.language, { granularity: 'grapheme' });
            for (const caption of captions.captions) {
                const runs = guide.emphasis.flatMap(({ text: keyword, scale }) => {
                    const at = caption.display_text.indexOf(keyword);
                    if (at < 0) return [];
                    return [{ from: [...graphemes.segment(caption.display_text.slice(0, at))].length,
                        to: [...graphemes.segment(caption.display_text.slice(0, at + keyword.length))].length,
                        role: 'emphasis', style: { color: '#FB923C', font_weight: 900,
                            ...(scale !== undefined && scale !== 1 ? { scale } : {}) } }];
                });
                caption.runs = runs.sort((a, b) => a.from - b.from);
            }
        }
        if (stage >= 7 && karaokeTokens) {
            const caption = captions.captions.find(item => item.text === guide.karaoke.text);
            if (caption) Object.assign(caption, { style: 'karaoke', runs: [],
                text_style: { karaoke: { fill: 'smooth', done_color: '#FB923C' }, size_px: 62 } });
        }
        // Use the same migration and catalog as the timeline's offer before the guide writes captions.
        // This also covers the legacy emphasis runs added by the later demo stages.
        const migratedCaptions = planCaptionLookMigration(captions,
            loadTextstyleCatalogSync({ env: process.env }).catalog).next;
        const desired: Record<string, string> = {
            'edit.json': `${JSON.stringify(edit, null, 2)}\n`,
            'captions.json': `${JSON.stringify(migratedCaptions, null, 2)}\n`
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
            throw new Error(t('surfaces.onboardingService.error.exampleState'));
        const project = fileURLToPath(projectUri);
        const guide = await this.guideForState(current);
        const sample = join(project, 'assets', guide.asset_name);
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
        for (const file of extraSampleFiles(guide)) {
            const [original, copied] = await Promise.all([
                fs.readFile(join(dirname(sourcePath), file.bundled)).catch(() => undefined),
                fs.readFile(join(project, file.project)).catch(() => undefined)
            ]);
            if (original && copied && createHash('sha256').update(original).digest('hex') ===
                createHash('sha256').update(copied).digest('hex')) await fs.rm(join(project, file.project), { force: true });
        }
        const emptyDirectories = [...new Set(extraSampleFiles(guide).map(file => dirname(file.project)))].filter(directory => {
            const relativeDirectory = directory.replaceAll('\\', '/');
            return relativeDirectory === 'assets/onboarding' || /^overlays\/demo-[^/]+$/.test(relativeDirectory);
        });
        for (const directory of emptyDirectories) await fs.rmdir(join(project, directory)).catch(() => undefined);
        if (removeSample) {
            await fs.rm(sample, { force: true });
            await fs.rm(join(project, '.akari', 'sidecars', `assets/${guide.asset_name}.analysis`), { recursive: true, force: true });
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
