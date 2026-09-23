import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import type { GenerateStillResult, ImageRouteState, StartGenerateStillRequest } from '../common/akari-annotations-protocol';

type SpawnProcess = typeof spawn;
type Asset = (path: string) => Promise<string>;
const redact = (value: unknown): string => String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '<email>')
    .replaceAll(homedir(), '<HOME>');
const brief = (value: unknown, lines = 2): string => redact(value).split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(0, lines).join(' / ').slice(0, 500);
const aspectText: Record<StartGenerateStillRequest['aspect'], string> = {
    '16:9': '横長 16:9 の画像。', '9:16': '縦長 9:16 の画像。', '1:1': '正方形 1:1 の画像。'
};

export class StillGenerationManager {
    private readonly active = new Map<string, { child?: ChildProcess; cancelled: boolean }>();
    constructor(private readonly findAsset: Asset, private readonly options: {
        env?: NodeJS.ProcessEnv; spawnProcess?: SpawnProcess; probeTimeoutMs?: number;
    } = {}) {}

    private get env(): NodeJS.ProcessEnv { return this.options.env ?? process.env; }
    private get spawnProcess(): SpawnProcess { return this.options.spawnProcess ?? spawn; }

    private spawnEnv(cli: string): NodeJS.ProcessEnv {
        const entries = (this.env.PATH ?? '').split(delimiter).filter(Boolean);
        const fallback = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')];
        return { ...this.env, PATH: [...new Set([dirname(resolve(cli)), ...entries, ...fallback])].join(delimiter) };
    }

    async resolveCodex(): Promise<string | undefined> {
        if (this.env.AKARI_CODEX_BIN) return await fs.stat(this.env.AKARI_CODEX_BIN).then(s => s.isFile() ? this.env.AKARI_CODEX_BIN : undefined).catch(() => undefined);
        const pathEntries = (this.env.PATH ?? '').split(delimiter);
        const candidates = [...pathEntries, '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
            .filter(Boolean).map(dir => join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'));
        for (const candidate of candidates) {
            if (await fs.stat(candidate).then(s => s.isFile()).catch(() => false)) return candidate;
        }
        return undefined;
    }

    async probeImageRoutes(): Promise<ImageRouteState[]> {
        const cli = await this.resolveCodex();
        if (!cli) return [{ id: 'codex', state: 'missing', detail: 'Codex CLI が見つかりません' }];
        return new Promise(resolvePromise => {
            let output = '';
            let finished = false;
            let child: ChildProcess;
            const finish = (state: ImageRouteState['state'], detail: string): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolvePromise([{ id: 'codex', state, detail: brief(detail, 1) }]);
            };
            const timer = setTimeout(() => { child?.kill('SIGKILL'); finish('missing', '確かめられませんでした（5 秒で打ち切り）'); }, this.options.probeTimeoutMs ?? 5000);
            try {
                child = this.spawnProcess(cli, ['login', 'status'], { env: this.spawnEnv(cli), stdio: ['ignore', 'pipe', 'pipe'] });
                child.stdout?.on('data', chunk => { if (output.length < 2000) output += String(chunk); });
                child.stderr?.on('data', chunk => { if (output.length < 2000) output += String(chunk); });
                child.once('error', error => finish('missing', error.message));
                child.once('close', code => finish(code === 0 && /Logged in/iu.test(output) ? 'ready' : 'signed-out', output || `exit ${code}`));
            } catch (error) { finish('missing', String(error)); }
        });
    }

    async startGenerateStill(projectRoot: string, request: StartGenerateStillRequest): Promise<GenerateStillResult> {
        if (!request.prompt?.trim() || !aspectText[request.aspect]) return { ok: false, reason: '指示文と画角を指定してください。' };
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(request.itemId)) return { ok: false, reason: 'itemId が不正です。' };
        if (this.active.has(request.itemId)) return { ok: false, reason: 'この枠は生成中です。' };
        const cli = await this.resolveCodex();
        if (!cli) return { ok: false, reason: 'Codex CLI が見つかりません。' };
        const root = await fs.realpath(projectRoot);
        const edit = JSON.parse(await fs.readFile(join(root, 'edit.json'), 'utf8'));
        if (edit.version !== 2) return { ok: false, reason: 'v2 へ変換してから編集してください。' };
        const item = (edit.tracks ?? []).flatMap((track: any) => track.items ?? []).find((entry: any) => entry.id === request.itemId);
        const sourcePath = edit.sources?.find((source: any) => source.id === item?.source?.src)?.path;
        if (!item || item.source?.kind !== 'media' || !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(sourcePath ?? '')) {
            return { ok: false, reason: '空の枠か静止画を選んでください。' };
        }
        const outputDir = join(root, 'assets', 'generated');
        await fs.mkdir(outputDir, { recursive: true });
        const realOutputDir = await fs.realpath(outputDir);
        const rel = relative(root, realOutputDir);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, reason: '生成先がプロジェクト外です。' };
        const staging = await fs.mkdtemp(join(outputDir, '.still-'));
        const id = `still-${Date.now()}-${basename(staging).slice(7)}`;
        const relativePath = `assets/generated/${id}.png`;
        const stageRelative = relative(root, join(staging, 'image.png')).split(sep).join('/');
        const target = join(root, relativePath);
        const run = { child: undefined as ChildProcess | undefined, cancelled: false };
        this.active.set(request.itemId, run);
        try {
            const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
            const load = async (name: string): Promise<any> => importEsm(pathToFileURL(await this.findAsset(`packages/generate/src/cli/${name}.mjs`)).toString());
            const [codex, metas, validator] = await Promise.all([load('codex-image'), load('meta-still'), load('meta-validate')]);
            const prompt = `${request.prompt.trim()}\n\n${aspectText[request.aspect]}`;
            const result = (await codex.generateCodexImages({ projectDir: root, parallel: 1,
                items: [{ id, path: stageRelative, prompt }], env: { ...this.spawnEnv(cli), AKARI_CODEX_BIN: cli },
                spawnProcess: ((...args: Parameters<SpawnProcess>) => {
                    const child = this.spawnProcess(...args); run.child = child;
                    if (run.cancelled) child.kill('SIGTERM');
                    return child;
                }) as SpawnProcess,
                log: () => undefined, logError: () => undefined
            }))[0];
            if (run.cancelled) return { ok: false, cancelled: true, reason: '中止しました。' };
            if (!result?.ok) return { ok: false, reason: brief(result?.error ?? 'Codex から結果が返りませんでした') };
            const image = await metas.inspectPng(join(staging, 'image.png'));
            const sourceAbsolute = resolve(root, sourcePath);
            if (!sourceAbsolute.startsWith(root + sep)) return { ok: false, reason: '元画像のパスが不正です。' };
            const oldMeta = await fs.readFile(`${sourceAbsolute}.meta.json`, 'utf8').then(JSON.parse).catch(() => undefined);
            const at = new Date().toISOString();
            const duration_s = Number(item.duration) / (Number(edit.output?.fps) || 30);
            let meta = metas.doneStillMeta({ prompt, duration_s, at, asOf: await metas.readCodexModelAsOf(),
                path: relativePath, image, elapsed_s: result.elapsed_s });
            if (oldMeta?.next?.kind === 'video') {
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
            return { ok: true, relativePath, width: image.width, height: image.height, elapsedSeconds: result.elapsed_s };
        } catch (error) {
            return { ok: false, reason: brief(error instanceof Error ? error.message : error) };
        } finally {
            this.active.delete(request.itemId);
            await fs.rm(staging, { recursive: true, force: true });
        }
    }

    cancelGenerateStill(itemId: string): void {
        const run = this.active.get(itemId);
        if (!run) return;
        run.cancelled = true;
        run.child?.kill('SIGTERM');
    }
}
