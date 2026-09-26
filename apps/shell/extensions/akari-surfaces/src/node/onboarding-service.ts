import { injectable, inject } from '@theia/core/shared/inversify';
import { promises as fs } from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { runEditLint, writeProjectFilesGuarded } from '@akari-video/edit-store/lib/write-gate';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions, OnboardingState, parseOnboardingState, TranscriptSegment } from '../onboarding/model';
import { AkariOnboardingService, SampleInformation } from '../onboarding/protocol';

const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
const SAMPLE_ID = 'talkinghead-desk-ja-01';
const SAMPLE_NAME = 'サンプル動画.mp4';
const STATE_FILE = 'onboarding-v1.json';
const WELCOME_IMAGE = 'extensions/akari-surfaces/src/onboarding/welcome.webp';

@injectable()
export class AkariOnboardingServiceImpl implements AkariOnboardingService {
    async heroDataUrl(): Promise<string> {
        return `data:image/webp;base64,${(await fs.readFile(await this.findUpwardFile(WELCOME_IMAGE))).toString('base64')}`;
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
        const resolver = await importEsm<{ resolve: (id: string, options: { env: NodeJS.ProcessEnv }) => Promise<{ dir: string }> }>(
            pathToFileURL(await this.findUpwardFile('packages/asset-resolver/src/resolve.mjs')).toString());
        const asset = await resolver.resolve(SAMPLE_ID, { env: process.env });
        const transcript = JSON.parse(await fs.readFile(join(asset.dir, 'transcript.json'), 'utf8')) as {
            segments?: { items?: TranscriptSegment[] }
        };
        const segments = transcript.segments?.items;
        if (!Array.isArray(segments) || segments.length !== 7) throw new Error('サンプルの書き起こしを読み取れませんでした');
        return { projectUri: pathToFileURL(projectPath).toString(), sample: { sourcePath: join(asset.dir, 'clip.mp4'), segments } };
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
            segments: { items: TranscriptSegment[] }
        };
        const analysisDir = join(project, '.akari', 'sidecars', `${rel}.analysis`);
        await fs.mkdir(analysisDir, { recursive: true });
        const analysis = { version: 0, source: relative(analysisDir, assetPath).split(sep).join('/'),
            transcript: transcript.segments.items, keyframes: [], events: [],
            tracks: { speakers: [], faces: [], person_matte: null } };
        await fs.writeFile(join(analysisDir, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
        return rel;
    }

    async writeExample(projectUri: string, sourcePath: string, segments: TranscriptSegment[], count: number, title: boolean): Promise<void> {
        const current = await this.load();
        if (current?.projectUri !== projectUri || !current.imported || basename(sourcePath) !== 'clip.mp4')
            throw new Error('素材を先に取り込んでください');
        if (!Number.isInteger(count) || count < 0 || count > 7 || segments.length !== 7) throw new Error('字幕の数が不正です');
        const project = fileURLToPath(projectUri);
        const samplePath = `assets/${SAMPLE_NAME}`;
        const candidates: Record<string, string> = {
            'edit.json': `${JSON.stringify(createOnboardingEdit(samplePath, count > 0 || title), null, 2)}\n`,
            'captions.json': `${JSON.stringify(createOnboardingCaptions(segments, count, title), null, 2)}\n`
        };
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
