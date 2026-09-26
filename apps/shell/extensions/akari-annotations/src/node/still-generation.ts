import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import type { GenerateStillResult, ImageRouteState, StartGenerateStillRequest, StillCandidate, StillCandidateBatch } from '../common/akari-annotations-protocol';
import { projectOutputPath } from './project-asset-path';
import { finishPlaceholderGenerating, markPlaceholderGenerating, type GenerationSidecarMeta } from '../common/generation-sidecar';
import { aiActionCatalog } from '../common/ai-action-catalog';

type SpawnProcess = typeof spawn;
type Asset = (path: string) => Promise<string>;
const redact = (value: unknown): string => String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '<email>')
    .replaceAll(homedir(), '<HOME>');
const brief = (value: unknown, lines = 2): string => redact(value).split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-lines).join(' / ').slice(0, 500);
const keyNames = ['FAL_KEY', 'AKARI_IMAGE_AI_FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY'];
type Route = ImageRouteState['id'];
const stillRouteIds = new Set<Route>(['codex', 'antigravity', 'grok', 'fal']);
interface CompareBatchContext {
    root: string;
    state: StillCandidateBatch;
    pending: number;
    write(running: boolean): Promise<void>;
}
export const IMAGE_PROBE_TIMEOUT_MS: Readonly<Record<Route, number>> = {
    codex: 5000, antigravity: 20000, grok: 20000, fal: 5000
};
export const stillAspectText: Readonly<Record<StartGenerateStillRequest['aspect'], string>> = {
    '16:9': '横長 16:9 の画像。', '9:16': '縦長 9:16 の画像。', '1:1': '正方形 1:1 の画像。',
    '4:3': '横長 4:3 の画像。', '3:4': '縦長 3:4 の画像。', '4:5': '縦長 4:5 の画像。',
    '3:2': '横長 3:2 の画像。', '21:9': '横長 21:9 の画像。'
};

export function stillCropPlan(width: number, height: number, aspect: StartGenerateStillRequest['aspect']):
    { width: number; height: number; filter: string } | undefined {
    const [numerator, denominator] = aspect.split(':').map(Number);
    if (Math.abs(width / height / (numerator / denominator) - 1) <= 0.01) return undefined;
    const cropWidth = width / height > numerator / denominator ? Math.round(height * numerator / denominator) : width;
    const cropHeight = width / height < numerator / denominator ? Math.round(width * denominator / numerator) : height;
    return { width: cropWidth, height: cropHeight,
        filter: `crop=${cropWidth}:${cropHeight}:${Math.floor((width - cropWidth) / 2)}:${Math.floor((height - cropHeight) / 2)}` };
}

export class StillGenerationManager {
    private readonly active = new Map<string, { child?: ChildProcess; cancelled: boolean }>();
    private readonly reserved = new Set<string>();
    private readonly routeQueues = new Map<Route, Promise<unknown>>();
    private readonly batches = new Set<string>();
    private readonly batchCancelled = new Set<string>();
    private readonly batchStates = new Map<string, StillCandidateBatch>();
    private readonly batchContexts = new Map<string, Promise<CompareBatchContext>>();
    private readonly batchRoutes = new Map<string, Set<Route>>();
    constructor(private readonly findAsset: Asset, private readonly options: {
        env?: NodeJS.ProcessEnv; spawnProcess?: SpawnProcess;
        /** Legacy override for every route; route-specific values take precedence. */
        probeTimeoutMs?: number;
        probeTimeoutMsByRoute?: Partial<Record<Route, number>>;
        cropPng?: (input: string, output: string, filter: string) => Promise<void>;
    } = {}) {}

    private get env(): NodeJS.ProcessEnv { return this.options.env ?? process.env; }
    private get spawnProcess(): SpawnProcess { return this.options.spawnProcess ?? spawn; }

    private spawnEnv(cli: string): NodeJS.ProcessEnv {
        const entries = (this.env.PATH ?? '').split(delimiter).filter(Boolean);
        const fallback = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')];
        const env = { ...this.env, PATH: [...new Set([dirname(resolve(cli)), ...entries, ...fallback])].join(delimiter) };
        for (const name of keyNames) delete env[name];
        return env;
    }

    private async falKey(): Promise<{ key: string; key_source: string } | undefined> {
        const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
        if (this.env.AKARI_IMAGE_AI_FAL_KEY?.trim()) {
            return { key: this.env.AKARI_IMAGE_AI_FAL_KEY.trim(), key_source: 'env:AKARI_IMAGE_AI_FAL_KEY' };
        }
        const creator = await importEsm(pathToFileURL(await this.findAsset('packages/creator-root/src/index.mjs')).toString());
        const imageKey = creator.readCredentials(this.env).values.get('AKARI_IMAGE_AI_FAL_KEY')?.trim();
        if (imageKey) return { key: imageKey, key_source: 'file:credentials.env' };
        const credentials = await importEsm(pathToFileURL(await this.findAsset('packages/generate/src/cli/credentials.mjs')).toString());
        try { return credentials.resolveFalKey({ env: this.env }); } catch (error) {
            if (error?.name === 'CredentialsError') return undefined;
            throw error;
        }
    }

    async resolveCli(route: Route): Promise<string | undefined> {
        const name = route === 'antigravity' ? 'agy' : route;
        const explicit = this.env[route === 'antigravity' ? 'AKARI_AGY_BIN' : route === 'grok' ? 'AKARI_GROK_BIN' : 'AKARI_CODEX_BIN'];
        if (explicit) return await fs.stat(explicit).then(s => s.isFile() ? explicit : undefined).catch(() => undefined);
        const pathEntries = (this.env.PATH ?? '').split(delimiter);
        const candidates = [...pathEntries, '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
            .filter(Boolean).map(dir => join(dir, process.platform === 'win32' ? `${name}.exe` : name));
        for (const candidate of candidates) {
            if (await fs.stat(candidate).then(s => s.isFile()).catch(() => false)) return candidate;
        }
        return undefined;
    }
    async resolveCodex(): Promise<string | undefined> { return this.resolveCli('codex'); }

    async probeImageRoutes(routes: Route[] = ['codex', 'antigravity', 'grok']): Promise<ImageRouteState[]> {
        return Promise.all(routes.map(route => this.probeRoute(route)));
    }

    async readStillPreferredRoutes(projectRoot: string): Promise<Route[]> {
        const appPath = join(this.env.AKARI_HOME || join(homedir(), '.akari'), 'ai-models.json');
        const projectPath = join(projectRoot, '.akari', 'ai-models.json');
        const read = async (file: string): Promise<any> => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
        const [app, project] = await Promise.all([read(appPath), read(projectPath)]);
        const ids = [...(Array.isArray(app?.favorites?.image) ? app.favorites.image : []),
            project?.defaults?.image || app?.defaults?.image];
        const modelIds: Record<Route, string[]> = {
            codex: ['codex:image'], antigravity: ['still:antigravity'],
            grok: ['still:grok'], fal: ['fal:gpt-image-2.5-flare']
        };
        const requested = (['codex', 'antigravity', 'grok'] as Route[])
            .filter(route => ids.some(id => modelIds[route].includes(id)));
        const available = await this.probeImageRoutes(['codex', 'antigravity', 'grok', 'fal']);
        const usable = (route: Route): boolean => available.some(row => row.id === route && row.state === 'ready');
        const preferred = requested.filter(usable);
        return preferred.length ? preferred : (['codex', 'antigravity', 'grok'] as Route[]).filter(usable);
    }

    private async probeRoute(route: Route): Promise<ImageRouteState> {
        if (route === 'fal') {
            const key = await this.falKey();
            return { id: route, state: key ? 'ready' : 'missing', detail: key ? 'キーを設定済み' : 'キーを設定すると使えます →' };
        }
        const cli = await this.resolveCli(route);
        const label = route === 'antigravity' ? 'Antigravity' : route === 'grok' ? 'Grok' : 'Codex';
        if (!cli) return { id: route, state: 'missing', detail: `${label} CLI が見つかりません` };
        const args = route === 'codex' ? ['login', 'status'] : ['models'];
        const timeoutMs = this.options.probeTimeoutMsByRoute?.[route] ?? this.options.probeTimeoutMs ?? IMAGE_PROBE_TIMEOUT_MS[route];
        const timeoutDetail = `確かめられませんでした（${timeoutMs / 1000} 秒で打ち切り）`;
        const inspect = (): Promise<{ code: number | null; output: string; stdout: string; timedOut: boolean }> =>
            new Promise(resolvePromise => {
            let output = '';
            let stdout = '';
            let finished = false;
            let child: ChildProcess;
            const finish = (code: number | null, timedOut = false): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolvePromise({ code, output, stdout, timedOut });
            };
            const timer = setTimeout(() => { child?.kill('SIGKILL'); finish(null, true); }, timeoutMs);
            try {
                child = this.spawnProcess(cli, args, { env: this.spawnEnv(cli), stdio: ['ignore', 'pipe', 'pipe'] });
                child.stdout?.on('data', chunk => { if (output.length < 2000) output += String(chunk); if (stdout.length < 2000) stdout += String(chunk); });
                child.stderr?.on('data', chunk => { if (output.length < 2000) output += String(chunk); });
                child.once('error', error => { output += `\n${error.message}`; finish(null); });
                child.once('close', code => finish(code));
            } catch (error) { output += `\n${String(error)}`; finish(null); }
        });
        const first = await inspect();
        if (first.timedOut && route === 'codex') return { id: route, state: 'missing', detail: timeoutDetail };
        if (first.code === null && !first.timedOut) return { id: route, state: 'missing', detail: '確かめられませんでした' };
        let last = first;
        if (first.timedOut || (route === 'grok' && /^You are not authenticated/iu.test(first.stdout.trimStart().split(/\r?\n/u)[0] ?? ''))) {
            last = await inspect();
            if (last.timedOut) return { id: route, state: 'unknown', detail: timeoutDetail };
            if (last.code === null) return { id: route, state: 'missing', detail: '確かめられませんでした' };
        }
        const ready = route === 'codex' ? last.code === 0 && /Logged in/iu.test(last.output)
            : route === 'antigravity' ? last.code === 0 && last.stdout.split(/\r?\n/u).some(line => /^\S+\t\S+/u.test(line))
                : last.code === 0 && /^You are logged in/iu.test(last.stdout.trimStart().split(/\r?\n/u)[0] ?? '');
        return { id: route, state: ready ? 'ready' : 'signed-out', detail: ready ? 'サインイン済み' : 'サインインが必要です' };
    }

    async startGenerateStill(projectRoot: string, request: StartGenerateStillRequest, candidateMode = false): Promise<GenerateStillResult> {
        const route = request.route ?? 'codex';
        const key = `${request.itemId}:${route}`;
        if (this.reserved.has(key)) return { ok: false, reason: 'この枠と手段は生成中です。' };
        this.reserved.add(key);
        const previous = this.routeQueues.get(route);
        const work = (async () => {
            if (previous) await previous.catch(() => undefined);
            if (this.batchCancelled.has(request.itemId)) return { ok: false, cancelled: true, reason: '中止しました。' };
            return this.runGenerateStill(projectRoot, request, candidateMode);
        })();
        this.routeQueues.set(route, work);
        try { return await work; }
        finally {
            this.reserved.delete(key);
            if (this.routeQueues.get(route) === work) this.routeQueues.delete(route);
        }
    }

    private async runGenerateStill(projectRoot: string, request: StartGenerateStillRequest, candidateMode: boolean): Promise<GenerateStillResult> {
        if (!request.prompt?.trim() || !stillAspectText[request.aspect]) return { ok: false, reason: '指示文と画角を指定してください。' };
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(request.itemId)) return { ok: false, reason: 'itemId が不正です。' };
        const route = request.route ?? 'codex';
        if (!(['codex', 'antigravity', 'grok', 'fal'] as const).includes(route)) return { ok: false, reason: '手段が不正です。' };
        if (route === 'fal' && request.approved !== true) return { ok: false, reason: '費用承認が必要です。' };
        const maxReferences = aiActionCatalog([]).find(action => action.id === 'still')!.routes.find(row => row.id === route)!
            .inputs!.reference_images!.max;
        if (!Array.isArray(request.references ?? []) || (request.references?.length ?? 0) > maxReferences) {
            return { ok: false, reason: route === 'antigravity' ? 'この手段は画像を受け取れません' : `${route} は ${maxReferences} 枚まで` };
        }
        const root = await fs.realpath(projectRoot);
        const references: Array<{ path: string; sha256: string; absolutePath: string }> = [];
        for (const path of request.references ?? []) {
            if (typeof path !== 'string' || isAbsolute(path) || !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(path)) {
                return { ok: false, reason: '参照画像はプロジェクト内の画像ファイルを指定してください。' };
            }
            const absolutePath = await fs.realpath(resolve(root, path)).catch(() => undefined);
            if (!absolutePath || !absolutePath.startsWith(`${root}${sep}`) || !(await fs.stat(absolutePath)).isFile()) {
                return { ok: false, reason: '参照画像が見つからないか、プロジェクト外です。' };
            }
            references.push({ path: relative(root, absolutePath).split(sep).join('/'), absolutePath,
                sha256: createHash('sha256').update(await fs.readFile(absolutePath)).digest('hex') });
        }
        const cli = route === 'fal' ? undefined : await this.resolveCli(route);
        if (route !== 'fal' && !cli) return { ok: false, reason: `${route === 'antigravity' ? 'Antigravity' : route === 'grok' ? 'Grok' : 'Codex'} CLI が見つかりません。` };
        const falKey = route === 'fal' ? await this.falKey() : undefined;
        if (route === 'fal' && !falKey) return { ok: false, reason: 'fal のキーを設定してください。' };
        const edit = JSON.parse(await fs.readFile(join(root, 'edit.json'), 'utf8'));
        if (edit.version !== 2) return { ok: false, reason: 'v2 へ変換してから編集してください。' };
        const item = (edit.tracks ?? []).flatMap((track: any) => track.items ?? []).find((entry: any) => entry.id === request.itemId);
        const sourcePath = edit.sources?.find((source: any) => source.id === item?.source?.src)?.path;
        if (!item || item.source?.kind !== 'media' || !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(sourcePath ?? '')) {
            return { ok: false, reason: '空の枠か静止画を選んでください。' };
        }
        const outputDir = join(root, 'assets', 'generated');
        await projectOutputPath(root, 'assets/generated/.still-output');
        if (candidateMode) {
            await fs.mkdir(join(outputDir, 'candidates'), { recursive: true });
            await fs.mkdir(join(outputDir, 'candidates', request.itemId), { recursive: true });
            const candidateRoot = await fs.realpath(join(outputDir, 'candidates', request.itemId));
            if (!candidateRoot.startsWith(`${await fs.realpath(outputDir)}${sep}`)) return { ok: false, reason: '生成先がプロジェクト外です。' };
        }
        const realOutputDir = await fs.realpath(outputDir);
        const rel = relative(root, realOutputDir);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, reason: '生成先がプロジェクト外です。' };
        const staging = await fs.mkdtemp(join(outputDir, '.still-'));
        const id = `still-${Date.now()}-${basename(staging).slice(7)}`;
        const relativePath = candidateMode
            ? `assets/generated/candidates/${request.itemId}/${route}-${Date.now()}-${basename(staging).slice(7)}.png`
            : `assets/generated/${id}.png`;
        const stageRelative = relative(root, join(staging, 'image.png')).split(sep).join('/');
        const target = join(root, relativePath);
        const run = { child: undefined as ChildProcess | undefined, cancelled: false };
        this.active.set(`${request.itemId}:${route}`, run);
        let oldMetaPath: string | undefined;
        let oldMetaText: string | undefined;
        let oldMetaCaptured = false;
        let temporaryMeta: GenerationSidecarMeta | undefined;
        let succeeded = false;
        try {
            const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
            const load = async (name: string): Promise<any> => importEsm(pathToFileURL(await this.findAsset(`packages/generate/src/cli/${name}.mjs`)).toString());
            const [generator, metas, validator] = await Promise.all([load(route === 'codex' ? 'codex-image' : route === 'antigravity' ? 'agy-image' : route === 'fal' ? 'fal-still' : 'grok-image'), load('meta-still'), load('meta-validate')]);
            const prompt = `${request.prompt.trim()}\n\n${stillAspectText[request.aspect]}`;
            oldMetaPath = candidateMode ? undefined : await projectOutputPath(root, `${sourcePath}.meta.json`);
            oldMetaText = oldMetaPath ? await fs.readFile(oldMetaPath, 'utf8').catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                throw error;
            }) : undefined;
            oldMetaCaptured = !!oldMetaPath;
            const atStart = new Date().toISOString();
            const placeholder = oldMetaText ? JSON.parse(oldMetaText) : metas.plannedStillMeta({
                prompt: '', duration_s: Number(item.duration) / (Number(edit.output?.fps) || 30),
                at: atStart, asOf: atStart.slice(0, 10)
            });
            const provider = route === 'antigravity' ? 'agy' : route;
            if (oldMetaPath) {
                const generating = markPlaceholderGenerating(placeholder, provider, atStart);
                temporaryMeta = generating;
                await fs.writeFile(oldMetaPath, `${JSON.stringify(generating, null, 2)}\n`);
            }
            const spawnProcess = ((...args: Parameters<SpawnProcess>) => {
                const child = this.spawnProcess(...args); run.child = child;
                if (run.cancelled) child.kill('SIGTERM');
                return child;
            }) as SpawnProcess;
            const result = route === 'fal' ? await generator.generateFalStill({ prompt: request.prompt.trim(), aspect: request.aspect,
                quality: request.quality ?? 'high', referencePaths: references.map(row => row.absolutePath),
                dest: join(staging, 'image.png'), key: falKey!.key, env: this.env })
                : route === 'codex' ? (await generator.generateCodexImages({ projectDir: root, parallel: 1,
                items: [{ id, path: stageRelative, prompt, references: references.map(row => row.absolutePath) }], env: { ...this.spawnEnv(cli), AKARI_CODEX_BIN: cli },
                spawnProcess,
                log: () => undefined, logError: () => undefined
            }))[0] : await generator[route === 'antigravity' ? 'generateAgyImage' : 'generateGrokImage']({
                projectDir: root, item: { id, path: stageRelative, prompt }, aspect: request.aspect,
                references: references.map(row => row.absolutePath),
                env: { ...this.spawnEnv(cli), [route === 'antigravity' ? 'AKARI_AGY_BIN' : 'AKARI_GROK_BIN']: cli },
                spawnProcess
            });
            if (run.cancelled) return { ok: false, cancelled: true, reason: '中止しました。' };
            if (!result?.ok) return { ok: false, reason: brief(result?.error ?? `${route} から結果が返りませんでした`) };
            let image = await metas.inspectPng(join(staging, 'image.png'));
            const crop = request.cropToAspect === false ? undefined : stillCropPlan(image.width, image.height, request.aspect);
            const croppedFrom = crop ? `${image.width}x${image.height}` : undefined;
            if (crop) {
                const input = join(staging, 'image.png'), output = join(staging, 'cropped.png');
                if (this.options.cropPng) await this.options.cropPng(input, output, crop.filter);
                else {
                    const mediaBin = await importEsm(pathToFileURL(await this.findAsset('packages/media-bin/src/index.mjs')).toString());
                    const ffmpeg = mediaBin.resolveFfmpeg({ env: this.env });
                    await new Promise<void>((resolvePromise, reject) => {
                        const child = spawnProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
                            '-vf', crop.filter, '-frames:v', '1', output], { env: this.spawnEnv(ffmpeg), stdio: 'ignore' });
                        child.once('error', reject);
                        child.once('close', code => code === 0 ? resolvePromise() : reject(new Error('画像を切りそろえられませんでした。')));
                    });
                }
                await fs.rename(output, input);
                image = await metas.inspectPng(input);
                if (image.width !== crop.width || image.height !== crop.height) {
                    throw new Error('切りそろえた画像の寸法が一致しません。');
                }
            }
            const oldMeta = oldMetaText ? JSON.parse(oldMetaText) : undefined;
            const at = new Date().toISOString();
            const duration_s = Number(item.duration) / (Number(edit.output?.fps) || 30);
            let meta = metas.doneStillMeta({ prompt, duration_s, at, asOf: route === 'codex' ? await metas.readCodexModelAsOf() : at.slice(0, 10),
                path: relativePath, image, elapsed_s: result.elapsed_s, references, croppedFrom, aspect: request.aspect,
                candidateOf: candidateMode ? request.itemId : undefined });
            if (route !== 'codex') {
                const name = route === 'antigravity' ? 'agy' : route;
                meta.model.id = `${name}:image`;
                meta.job.provider = name;
                meta.provenance.tool = `akari generate still --${name}`;
                meta.provenance.key_source = `login:${name}`;
            }
            if (route === 'fal') {
                meta.model.id = generator.FAL_STILL_MODEL;
                meta.model.as_of = generator.FAL_STILL_AS_OF;
                meta.cost.estimate_usd = generator.falStillEstimate(request.quality ?? 'high').usd;
                meta.job.request_id = result.request_id;
                meta.job.status_url = result.status_url;
                meta.job.response_url = result.response_url;
                meta.provenance.key_source = falKey!.key_source;
            }
            if (!candidateMode && oldMeta?.next?.kind === 'video') {
                const next = oldMeta.next;
                meta = metas.withNextVideoDraft(meta, { firstFrame: { path: relativePath, sha256: image.sha256 },
                    lastFrame: next.inputs?.last_frame ?? null, prompt: next.inputs?.prompt ?? '',
                    modelId: next.model?.id ?? 'fal:h3-i2v', at });
                meta.next = { ...next, inputs: { ...next.inputs, first_frame: meta.next.inputs.first_frame }, updated_at: at };
            }
            const checked = validator.validateGenerationMeta(meta);
            if (!checked.ok) return { ok: false, reason: brief(checked.errors.join('\n')) };
            await fs.writeFile(join(staging, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
            if (run.cancelled) return { ok: false, cancelled: true, reason: '中止しました。' };
            await fs.rename(join(staging, 'meta.json'), `${target}.meta.json`);
            try { await fs.rename(join(staging, 'image.png'), target); }
            catch (error) { await fs.rm(`${target}.meta.json`, { force: true }); throw error; }
            if (run.cancelled) {
                await Promise.all([fs.rm(target, { force: true }), fs.rm(`${target}.meta.json`, { force: true })]);
                return { ok: false, cancelled: true, reason: '中止しました。' };
            }
            succeeded = true;
            return { ok: true, relativePath, width: image.width, height: image.height, elapsedSeconds: result.elapsed_s, croppedFrom };
        } catch (error) {
            return { ok: false, reason: brief(error instanceof Error ? error.message : error) };
        } finally {
            this.active.delete(`${request.itemId}:${route}`);
            if (oldMetaPath && oldMetaCaptured) {
                if (oldMetaText === undefined) await fs.rm(oldMetaPath, { force: true });
                else if (succeeded && temporaryMeta) {
                    const restored = finishPlaceholderGenerating(JSON.parse(oldMetaText), temporaryMeta, new Date().toISOString());
                    await fs.writeFile(oldMetaPath, `${JSON.stringify(restored, null, 2)}\n`);
                } else await fs.writeFile(oldMetaPath, oldMetaText);
            }
            await fs.rm(staging, { recursive: true, force: true });
        }
    }

    async startGenerateStillBatch(projectRoot: string, request: Omit<StartGenerateStillRequest, 'route'> & { routes: Route[] }): Promise<StillCandidateBatch> {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(request.itemId) || !request.prompt?.trim()
            || !stillAspectText[request.aspect]) throw new Error('枠、指示文、画角を指定してください。');
        const routes = [...new Set(request.routes)];
        if (!routes.length || routes.length !== request.routes.length
            || routes.some(route => !stillRouteIds.has(route))) throw new Error('手段を選んでください。');
        if (routes.includes('fal') && request.approved !== true) throw new Error('費用承認が必要です。');
        const reserved = this.batchRoutes.get(request.itemId) ?? new Set<Route>();
        if (routes.some(route => reserved.has(route))) throw new Error('この枠と手段は生成中です。');
        routes.forEach(route => reserved.add(route));
        this.batchRoutes.set(request.itemId, reserved);
        let contextPromise = this.batchContexts.get(request.itemId);
        if (!contextPromise) {
            contextPromise = this.prepareCompareBatch(projectRoot, request);
            this.batchContexts.set(request.itemId, contextPromise);
            this.batches.add(request.itemId);
        }
        let context: CompareBatchContext | undefined;
        try {
            context = await contextPromise;
            context.pending++;
            context.state.routes.push(...routes);
            await context.write(true);
            const results = await Promise.all(routes.map(async route => {
                const result = await this.startGenerateStill(context!.root, { ...request, route }, true);
                const candidate: StillCandidate = { ...result, route,
                    ...(route === 'fal' && result.ok ? { costUsd: ({ low: 0.006, medium: 0.0133, high: 0.0528 } as const)[request.quality ?? 'high'] } : {}) };
                context!.state.candidates.push(candidate);
                context!.state.completed++;
                await context!.write(true);
                return candidate;
            }));
            return { routes, completed: results.length, candidates: results, results, running: false };
        } finally {
            routes.forEach(route => reserved.delete(route));
            if (!reserved.size) this.batchRoutes.delete(request.itemId);
            if (context && --context.pending === 0) {
                context.state.running = false;
                await context.write(false);
                this.batchContexts.delete(request.itemId);
                this.batchStates.delete(request.itemId);
                this.batches.delete(request.itemId);
                this.batchCancelled.delete(request.itemId);
            } else if (!context && this.batchContexts.get(request.itemId) === contextPromise) {
                this.batchContexts.delete(request.itemId);
                this.batchStates.delete(request.itemId);
                this.batches.delete(request.itemId);
                this.batchCancelled.delete(request.itemId);
            }
        }
    }

    private async prepareCompareBatch(projectRoot: string, request: Omit<StartGenerateStillRequest, 'route'>): Promise<CompareBatchContext> {
        const root = await fs.realpath(projectRoot);
        const edit = JSON.parse(await fs.readFile(join(root, 'edit.json'), 'utf8'));
        const item = (edit.tracks ?? []).flatMap((track: any) => track.items ?? []).find((entry: any) => entry.id === request.itemId);
        const sourcePath = edit.sources?.find((source: any) => source.id === item?.source?.src)?.path;
        if (!item || item.source?.kind !== 'media' || typeof sourcePath !== 'string'
            || !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(sourcePath)) throw new Error('空の枠か静止画を選んでください。');
        const sidecarPath = await projectOutputPath(root, `${sourcePath}.meta.json`);
        const previous = await fs.readFile(sidecarPath, 'utf8').catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        });
        const at = new Date().toISOString();
        const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
        const metas = await importEsm(pathToFileURL(await this.findAsset('packages/generate/src/cli/meta-still.mjs')).toString());
        const original: GenerationSidecarMeta = previous ? JSON.parse(previous) : metas.plannedStillMeta({
            prompt: '', duration_s: Number(item.duration) / (Number(edit.output?.fps) || 30), at, asOf: at.slice(0, 10)
        });
        const existing = await fs.readdir(join(root, 'assets', 'generated', 'candidates', request.itemId))
            .catch(() => [] as string[]);
        const previousCandidates = existing.filter(name => name.endsWith('.png.meta.json')).length;
        const state: StillCandidateBatch = { routes: [], completed: 0, candidates: [], results: [], running: true };
        const job = { ...original.job, provider: 'compare', started_at: at, stale_after_s: 900,
            routes: [] as Route[], completed: 0, candidates: 0, failed: [] as Array<{ route: Route; reason: string }> };
        let writing: Promise<void> = Promise.resolve();
        const write = (running: boolean): Promise<void> => {
            const snapshot = { routes: [...state.routes], completed: state.completed,
                candidates: previousCandidates + state.candidates.filter(row => row.ok).length,
                failed: state.candidates.filter(row => !row.ok).map(row => ({ route: row.route, reason: row.reason ?? '生成できませんでした。' })),
                results: state.candidates.map(row => ({ route: row.route, ok: row.ok,
                    ...(row.relativePath ? { path: row.relativePath } : {}),
                    ...(row.reason ? { reason: row.reason } : {}),
                    ...(row.elapsedSeconds === undefined ? {} : { elapsed_s: row.elapsedSeconds }) })) };
            writing = writing.then(async () => {
                const status = running ? 'generating' : snapshot.candidates > 0 ? original.status : 'failed';
                const meta = { ...original, status, job: { ...job, ...snapshot },
                    history: [...(Array.isArray(original.history) ? original.history : []),
                        { at, status: 'generating', reason: null },
                        ...(!running ? [{ at: new Date().toISOString(), status, reason: null }] : [])] };
                await fs.writeFile(sidecarPath, `${JSON.stringify(meta, null, 2)}\n`);
            });
            return writing;
        };
        this.batchStates.set(request.itemId, state);
        return { root, state, pending: 0, write };
    }

    async readStillCandidates(projectRoot: string, itemId: string, includeThumbnails = true): Promise<StillCandidateBatch> {
        const live = this.batchStates.get(itemId);
        const root = await fs.realpath(projectRoot);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(itemId)) throw new Error('itemId が不正です。');
        const directory = join(root, 'assets', 'generated', 'candidates', itemId);
        const realDirectory = await fs.realpath(directory).catch(() => undefined);
        if (realDirectory && !realDirectory.startsWith(`${root}${sep}`)) throw new Error('候補がプロジェクト外です。');
        const edit = await fs.readFile(join(root, 'edit.json'), 'utf8').then(JSON.parse).catch(() => ({}));
        const item = (edit.tracks ?? []).flatMap((track: any) => track.items ?? []).find((row: any) => row.id === itemId);
        const sourcePath = edit.sources?.find((row: any) => row.id === item?.source?.src)?.path;
        const safeMetaPath = typeof sourcePath === 'string'
            ? await projectOutputPath(root, `${sourcePath}.meta.json`).catch(() => undefined) : undefined;
        const sourceMeta = safeMetaPath ? await fs.readFile(safeMetaPath, 'utf8')
            .then(JSON.parse).catch(() => ({})) : {};
        const entries = await fs.readdir(directory).catch(() => [] as string[]);
        const loaded = (await Promise.all(entries.filter(name => name.endsWith('.png.meta.json')).map(async name => {
            try {
                const metaPath = await fs.realpath(join(directory, name));
                if (!metaPath.startsWith(`${root}${sep}`)) return undefined;
                const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                if (meta.candidate_of !== itemId || meta.status !== 'done') return undefined;
                const route = name.split('-')[0] as Route;
                if (!stillRouteIds.has(route)) return undefined;
                const relativePath = `assets/generated/candidates/${itemId}/${name.slice(0, -'.meta.json'.length)}`;
                const pngPath = await fs.realpath(join(root, relativePath));
                if (!pngPath.startsWith(`${root}${sep}`)) return undefined;
                const thumbnail = includeThumbnails
                    ? `data:image/png;base64,${(await fs.readFile(pngPath)).toString('base64')}` : undefined;
                return { ok: true, route, relativePath, width: meta.result?.width, height: meta.result?.height,
                    elapsedSeconds: meta.result?.elapsed_s, croppedFrom: meta.output?.cropped_from,
                    costUsd: meta.cost?.estimate_usd ?? 0, ...(thumbnail ? { thumbnail } : {}) } as StillCandidate;
            } catch { return undefined; }
        }))).filter((row): row is StillCandidate => !!row);
        const candidates = [...new Map(loaded.map(row => [row.relativePath, row])).values()].sort((left, right) => {
            const time = (row: StillCandidate): number => Number(row.relativePath?.split('/').pop()?.split('-')[1]) || 0;
            return time(right) - time(left) || String(right.relativePath).localeCompare(String(left.relativePath));
        });
        const savedResults: StillCandidate[] = Array.isArray(sourceMeta.job?.results)
            ? sourceMeta.job.results.map((row: any) => row.ok && row.path
                ? candidates.find(candidate => candidate.relativePath === row.path) ?? { ok: true, route: row.route, relativePath: row.path }
                : { ok: false, route: row.route, reason: row.reason }) : [];
        const results = live?.candidates.map(row => row.ok && row.relativePath
            ? candidates.find(candidate => candidate.relativePath === row.relativePath) ?? row : row)
            ?? (savedResults.length ? savedResults : undefined);
        const failed = (results ?? []).filter(row => !row.ok);
        const routes = live?.routes ?? (Array.isArray(sourceMeta.job?.routes) ? sourceMeta.job.routes : [...new Set(candidates.map(row => row.route))]);
        return { routes, completed: live?.completed ?? sourceMeta.job?.completed ?? candidates.length + failed.length,
            candidates: [...candidates, ...failed], results, running: live?.running ?? false };
    }

    cancelGenerateStill(itemId: string): void {
        if (this.batches.has(itemId)) this.batchCancelled.add(itemId);
        for (const [key, run] of this.active) {
            if (!key.startsWith(`${itemId}:`)) continue;
            run.cancelled = true;
            run.child?.kill('SIGKILL');
        }
    }
}
