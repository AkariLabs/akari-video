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
            return destination;
        }
        // Older development builds can still use the Lab resolver.
        const resolver = await importEsm<{ resolve: (id: string, options: { env: NodeJS.ProcessEnv }) => Promise<{ dir: string }> }>(
            pathToFileURL(await this.findUpwardFile('packages/asset-resolver/src/resolve.mjs')).toString());
        return (await resolver.resolve(SAMPLE_ID, { env: process.env })).dir;
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

    async writeExample(projectUri: string, sourcePath: string, segments: TranscriptSegment[], count: number, title: boolean): Promise<void> {
        const current = await this.load();
        if (current?.projectUri !== projectUri || (!current.imported && !current.exampleActive) || basename(sourcePath) !== 'clip.mp4')
            throw new Error('素材を先に取り込んでください');
        if (!Number.isInteger(count) || count < 0 || count > segments.length || !segments.length) throw new Error('字幕の数が不正です');
        const project = fileURLToPath(projectUri);
        const samplePath = `assets/${SAMPLE_NAME}`;
        const desired: Record<string, string> = {
            'edit.json': `${JSON.stringify(createOnboardingEdit(samplePath, count > 0 || title), null, 2)}\n`,
            'captions.json': `${JSON.stringify(createOnboardingCaptions(segments, count, title), null, 2)}\n`
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
