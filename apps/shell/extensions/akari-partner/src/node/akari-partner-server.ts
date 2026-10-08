import { injectable } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import { readFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    AkariPartnerServer,
    BinaryVerificationRequest,
    BinaryVerificationResult,
    EnsureCliResult,
    PartnerAgentId,
    PartnerInstallDisclosure,
    PartnerBootstrapOutcome,
    PartnerConnectionMarker,
    PartnerLaunchPlan,
    PartnerWebLaunch,
    RenderPins
} from '../common/akari-partner-protocol';
import { buildPartnerConnectionMarker } from '../common/partner-connection-marker';
import { bootstrapRunner, partnerInstallDisclosure } from './bootstrap-runner';
import { spawnBootstrapProcess } from './bootstrap-process';
import { partnerCliCandidates } from './partner-cli-candidates';
import { buildCliPathEnv, buildPrivateNodePathEnv, ensureCli as provisionCli, readInstalledAppVersion } from './cli-provisioner';
import { resolveAkariHomeDir, resolvePartnerConnectionMarkerPath, writePartnerConnectionMarker } from './partner-connection-writer';
import { buildDshPatchYaml, buildDshSessionId, detectDeepSeekConnection } from './dsh-patch';
import { launchDshWeb } from './dsh-web-launcher';
import { maskDshOutput } from '../common/dsh-output-mask';
import { DSH_CWD_WORKSPACE_PLUGIN_SOURCE } from './dsh-cwd-workspace-plugin';

const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFY_DEPTH = 8;

interface WebProcessRecord { cwdKey: string; owners: Set<string>; launch: PartnerWebLaunch; }
interface PendingWebLaunch { owners: Set<string>; promise: Promise<PartnerWebLaunch>; }

export function resolvePartnerProcessLaunch(
    agent: PartnerAgentId,
    resolvedExecutablePath: string | undefined,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): Pick<PartnerLaunchPlan, 'executablePath' | 'args'> {
    // tui プロファイルが将来同梱されたら、DeepSeek の起動引数を ['tui'] に差し替える。
    const args: string[] = [];
    // node-pty は Windows の .cmd/.bat を CreateProcess で直接起動できない。
    // エージェントを問わず .cmd/.bat shim は cmd.exe を器にして実行する。
    if (platform === 'win32' && resolvedExecutablePath
        && /\.(?:cmd|bat)$/i.test(resolvedExecutablePath)) {
        return {
            executablePath: env.ComSpec || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
            args: ['/d', '/s', '/c', resolvedExecutablePath, ...args]
        };
    }
    return { args };
}

@injectable()
export class AkariPartnerServerImpl implements AkariPartnerServer, BackendApplicationContribution {
    private readonly webProcesses = new Map<number, WebProcessRecord>();
    private readonly pendingWebLaunches = new Map<string, PendingWebLaunch>();

    constructor() {
        process.once('exit', () => this.stopAllWebPartners());
    }

    onStop(): void { this.stopAllWebPartners(); }

    private stopAllWebPartners(): void {
        for (const pid of this.webProcesses.keys()) this.killWebProcess(pid);
        this.webProcesses.clear();
        for (const pending of this.pendingWebLaunches.values()) pending.owners.clear();
    }

    protected killWebProcess(pid: number): void {
        if (process.platform === 'win32') {
            try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* Already stopped. */ }
            return;
        }
        try { process.kill(-pid, 'SIGTERM'); }
        catch { try { process.kill(pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
    }

    async stopWebPartner(pid: number, ownerId: string): Promise<void> {
        const record = this.webProcesses.get(pid);
        if (!record || !record.owners.delete(ownerId)) return;
        if (record.owners.size === 0) {
            this.webProcesses.delete(pid);
            this.killWebProcess(pid);
        }
    }

    async isWebPartnerRunning(pid: number): Promise<boolean> {
        if (!this.webProcesses.has(pid)) return false;
        if (this.webProcessAlive(pid)) return true;
        this.webProcesses.delete(pid);
        return false;
    }

    protected webProcessAlive(pid: number): boolean {
        try { process.kill(pid, 0); return true; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
    }

    protected resolveWebCwdKey(cwd: string): Promise<string> { return fs.realpath(cwd); }

    async reconcileWebPartners(ownerId: string, activeRootUris: string[]): Promise<void> {
        const roots = new Set<string>();
        for (const uri of activeRootUris) {
            try { roots.add(await this.resolveWebCwdKey(this.toFsPath(uri))); } catch { /* Invalid or closed root. */ }
        }
        for (const [pid, record] of this.webProcesses) {
            if (record.owners.has(ownerId) && !roots.has(record.cwdKey)) await this.stopWebPartner(pid, ownerId);
        }
        for (const [cwd, pending] of this.pendingWebLaunches) {
            if (!roots.has(cwd)) pending.owners.delete(ownerId);
        }
    }

    async startWebPartner(agent: PartnerAgentId, workspaceRootUri: string | undefined,
        executablePath: string, ownerId: string, theme?: 'dark' | 'light' | 'system'): Promise<PartnerWebLaunch> {
        if (agent !== 'deepseek') throw new Error('Web partner is available only for DeepSeek');
        if (!ownerId?.trim()) throw new Error('Web partner owner is required');
        if (!workspaceRootUri) throw new Error('DeepSeek Harness を始めるにはプロジェクトを開いてください');
        if (!path.isAbsolute(executablePath) || !/^dsh(?:\.cmd|\.exe)?$/i.test(path.basename(executablePath))) {
            throw new Error('DeepSeek Harness の実行ファイルは絶対パスの dsh / dsh.cmd / dsh.exe を指定してください');
        }
        if (!(await fs.stat(executablePath).catch(() => undefined))?.isFile()) {
            throw new Error('DeepSeek Harness の実行ファイルが見つかりません');
        }
        let cwd: string;
        try { cwd = this.toFsPath(workspaceRootUri); }
        catch { throw new Error('プロジェクトのフォルダが不正です'); }
        if (cwd.startsWith('\\\\') || cwd.startsWith('//')) {
            throw new Error('ネットワークの場所（\\\\server\\share）を直接開いたプロジェクトでは DeepSeek Harness を起動できません。ドライブ文字を割り当てて開き直してください');
        }
        if (!path.isAbsolute(cwd) || !(await fs.stat(cwd).catch(() => undefined))?.isDirectory()) {
            throw new Error('プロジェクトのフォルダが見つかりません');
        }
        const cwdKey = await this.resolveWebCwdKey(cwd);
        for (const [pid, record] of this.webProcesses) {
            if (record.cwdKey !== cwdKey) continue;
            if (this.webProcessAlive(pid)) { record.owners.add(ownerId); return { ...record.launch, cwd }; }
            this.webProcesses.delete(pid);
        }
        const inProgress = this.pendingWebLaunches.get(cwdKey);
        if (inProgress) { inProgress.owners.add(ownerId); return { ...await inProgress.promise, cwd }; }
        const owners = new Set([ownerId]);
        const promise = this.launchNewWebPartner(agent, cwd, executablePath, theme).then(launch => {
            if (owners.size === 0) {
                this.killWebProcess(launch.pid);
                throw new Error('プロジェクトが切り替わったため作業画面を閉じました');
            }
            this.webProcesses.set(launch.pid, { cwdKey, owners, launch });
            return launch;
        });
        const pending: PendingWebLaunch = { owners, promise };
        this.pendingWebLaunches.set(cwdKey, pending);
        try { return await pending.promise; }
        finally { if (this.pendingWebLaunches.get(cwdKey) === pending) this.pendingWebLaunches.delete(cwdKey); }
    }

    protected async launchNewWebPartner(agent: PartnerAgentId, cwd: string, executablePath: string,
        theme?: 'dark' | 'light' | 'system'): Promise<PartnerWebLaunch> {
        const partnersDir = path.join(resolveAkariHomeDir(), 'partners', 'deepseek');
        await fs.mkdir(partnersDir, { recursive: true });
        const pluginPath = path.join(partnersDir, 'akari-cwd-workspace.mjs');
        await fs.writeFile(pluginPath, DSH_CWD_WORKSPACE_PLUGIN_SOURCE);
        const connection = detectDeepSeekConnection({
            env: process.env, homeDir: homedir(), readFile: file => readFileSync(file, 'utf8')
        });
        const appVersion = await readInstalledAppVersion(resolveAkariHomeDir()) ?? 'dev';
        const patchPath = path.join(partnersDir, 'akari.patch.yml');
        await fs.writeFile(patchPath, buildDshPatchYaml({
            pluginPath, provider: connection.provider, appVersion, sessionId: buildDshSessionId(cwd), theme
        }), { mode: 0o600 });
        await fs.chmod(patchPath, 0o600).catch(() => undefined);
        const launch = await this.prepareLaunch(agent, executablePath);
        const env = { ...process.env, ...launch.env, ...connection.secret, AKARI_PARTNER_PARENT_PID: String(process.pid) };
        if (connection.provider !== 'opencode-go') delete env.OPENCODE_GO_API_KEY;
        const logPath = path.join(partnersDir, 'web.log');
        const log = (line: string): void => {
            const safe = maskDshOutput(line, [process.env.DEEPSEEK_API_KEY, connection.secret?.OPENCODE_GO_API_KEY]);
            appendFileSync(logPath, safe + '\n');
        };
        let result: { url: string; pid: number };
        try {
            result = await this.launchWebProcess({
                executablePath, cwd, env, patchPath, platform: process.platform, timeoutMs: 120_000,
                log, stop: pid => this.killWebProcess(pid), onExit: pid => this.webProcesses.delete(pid)
            });
        } catch (error) {
            const message = maskDshOutput(this.errorMessage(error),
                [process.env.DEEPSEEK_API_KEY, connection.secret?.OPENCODE_GO_API_KEY]);
            throw new Error(message);
        }
        if (!this.webProcessAlive(result.pid)) throw new Error('dsh web exited after startup');
        return { ...result, cwd, provider: connection.provider, providerNote: connection.note, guidance: connection.guidance };
    }

    protected launchWebProcess(input: Parameters<typeof launchDshWeb>[0]): ReturnType<typeof launchDshWeb> {
        return launchDshWeb(input);
    }

    async getInstallDisclosure(agent: PartnerAgentId): Promise<PartnerInstallDisclosure> {
        const disclosure = partnerInstallDisclosure(agent);
        if (agent !== 'deepseek') return disclosure;
        const connection = detectDeepSeekConnection({
            env: process.env, homeDir: homedir(), readFile: file => readFileSync(file, 'utf8')
        });
        return { ...disclosure, connectionNote: connection.note };
    }

    async getPlatformKey(): Promise<string> {
        return `${process.platform}-${process.arch}`;
    }

    async bootstrap(agent: PartnerAgentId, workspaceRootUri?: string, installConsent = false): Promise<PartnerBootstrapOutcome> {
        const runtimePath = process.execPath;
        const runtimeMode = this.isElectronExecutable(runtimePath) ? 'electron-as-node' : 'node';
        const runnerSource = `(${bootstrapRunner.toString()})(${partnerCliCandidates.toString()})`;
        const workspaceRootFsPath = workspaceRootUri ? this.toFsPath(workspaceRootUri) : undefined;
        const env = {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            ...(installConsent ? { AKARI_PARTNER_INSTALL_CONSENT: '1' } : { AKARI_PARTNER_INSTALL_CONSENT: '0' }),
            // Read by bootstrap-runner.ts's claude-branch plugin wiring step
            // (task/2026-07-25-partner-plugin-autowire). Omitted when no
            // workspace is open so the runner treats wiring as skippable.
            ...(workspaceRootFsPath ? { AKARI_PARTNER_WORKSPACE_ROOT: workspaceRootFsPath } : {})
        };

        const output = await new Promise<string>((resolve, reject) => {
            const child = this.spawnBootstrapProcess(runtimePath, runnerSource, agent, env);
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error(`${agent} bootstrap timed out after ${BOOTSTRAP_TIMEOUT_MS} ms`));
            }, BOOTSTRAP_TIMEOUT_MS);
            child.stdout.on('data', chunk => stdout += chunk.toString());
            child.stderr.on('data', chunk => stderr += chunk.toString());
            child.on('error', error => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('exit', code => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new Error(stderr.trim() || stdout.trim() || `${agent} bootstrap exited with code ${code}`));
                    return;
                }
                resolve(stdout);
            });
        });

        const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const resultLine = [...lines].reverse().find(line => line.startsWith('{'));
        if (!resultLine) {
            throw new Error(`${agent} bootstrap did not return an executable path`);
        }
        const parsed = JSON.parse(resultLine) as { executablePath?: string; reused?: boolean; consentRequired?: boolean };
        if (parsed.consentRequired === true) {
            return { consentRequired: true, disclosure: await this.getInstallDisclosure(agent) };
        }
        if (!parsed.executablePath) {
            throw new Error(`${agent} bootstrap returned an invalid result`);
        }
        await fs.access(parsed.executablePath, fs.constants.X_OK);
        return {
            executablePath: parsed.executablePath,
            runtimePath,
            runtimeMode,
            reused: Boolean(parsed.reused),
            log: lines.filter(line => line !== resultLine)
        };
    }

    protected spawnBootstrapProcess(runtimePath: string, source: string, agent: PartnerAgentId, env: NodeJS.ProcessEnv): ReturnType<typeof spawnBootstrapProcess> {
        return spawnBootstrapProcess(runtimePath, source, agent, env);
    }

    async prepareLaunch(agent: PartnerAgentId, resolvedExecutablePath?: string): Promise<PartnerLaunchPlan> {
        const processLaunch = resolvePartnerProcessLaunch(agent, resolvedExecutablePath);
        const cliPathEnv = this.resolveCliPathEnv();
        const privateNodePathEnv = agent === 'commandcode' || agent === 'pi' || agent === 'deepseek' ? buildPrivateNodePathEnv({
            agent,
            akariHome: resolveAkariHomeDir(),
            platform: process.platform,
            existingPath: cliPathEnv.PATH ?? process.env.PATH
        }) : {};
        return {
            agent,
            ...processLaunch,
            log: [],
            env: {
                ...this.resolveMediaBinEnv(),
                ...cliPathEnv,
                ...privateNodePathEnv
            }
        };
    }

    /**
     * task/2026-08-17-shell-managed-cli: `ensureCli()` が配備したシム dir を PATH の先頭に
     * 加えるための env 差分。`ensureCli()` の呼び出し結果を受け渡すのではなく、ここで
     * 改めてシムの存在を確認する（`ensureCli()` と `prepareLaunch()` は別々の RPC 呼び出しで
     * あり、状態を跨いで信頼しない — 未配備 / failed 時は PATH を一切触らない）。
     */
    protected resolveCliPathEnv(): Record<string, string> {
        return buildCliPathEnv({
            akariHome: resolveAkariHomeDir(),
            platform: process.platform,
            existingPath: process.env.PATH
        });
    }

    /**
     * task/2026-08-17-shell-managed-cli: `akari` CLI のアプリ管理配備の RPC 実装。
     * ロジックはすべて `cli-provisioner.ts` に集約し、ここは env 由来の実行体パスを渡すだけの
     * 薄いラッパー（`resourcesPath` は packaged 時のみ Electron が設定する）。
     */
    async ensureCli(): Promise<EnsureCliResult> {
        return provisionCli({
            resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
        });
    }

    /**
     * task/2026-07-31-shell-ffmpeg-bundle: パートナー PTY 内で動くスキルスクリプト
     * （packages/media-bin の resolveFfmpeg/resolveFfprobe を使うもの）が、PATH に
     * ffmpeg/ffprobe が無い環境でもアプリ同梱バイナリを見つけられるよう、この時点で解決した
     * パスを AKARI_FFMPEG_BIN / AKARI_FFPROBE_BIN として渡す。優先順位は media-bin 側と同じ
     * （明示指定 env → PATH → 同梱）。ユーザーが自分の shell で既に指定済みの場合はそれを
     * そのまま通す（この関数は process.env を上書きしない — 呼び出し側が widget の
     * newTerminal() の env に載せるだけ）。
     */
    protected resolveMediaBinEnv(): Record<string, string> {
        const env: Record<string, string> = {};
        const ffmpeg = this.resolveMediaBinPath('ffmpeg', 'AKARI_FFMPEG_BIN');
        const ffprobe = this.resolveMediaBinPath('ffprobe', 'AKARI_FFPROBE_BIN');
        if (ffmpeg) {
            env.AKARI_FFMPEG_BIN = ffmpeg;
        }
        if (ffprobe) {
            env.AKARI_FFPROBE_BIN = ffprobe;
        }
        return env;
    }

    protected resolveMediaBinPath(name: 'ffmpeg' | 'ffprobe', explicitEnvVar: 'AKARI_FFMPEG_BIN' | 'AKARI_FFPROBE_BIN'): string | undefined {
        const explicit = process.env[explicitEnvVar];
        if (explicit) {
            return explicit;
        }
        if (this.canRunOnPath(name)) {
            return name;
        }
        return this.bundledMediaBinPath(name);
    }

    protected canRunOnPath(command: string): boolean {
        try {
            return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
        } catch {
            return false;
        }
    }

    protected bundledMediaBinPath(name: 'ffmpeg' | 'ffprobe'): string | undefined {
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        if (!resourcesPath) {
            return undefined;
        }
        const exe = process.platform === 'win32' ? `${name}.exe` : name;
        const candidate = path.join(resourcesPath, 'media-bin', exe);
        return existsSync(candidate) ? candidate : undefined;
    }

    async recordConnection(agent: PartnerAgentId, executablePath: string): Promise<PartnerConnectionMarker> {
        const marker = buildPartnerConnectionMarker(agent, executablePath, new Date().toISOString());
        await writePartnerConnectionMarker(marker, resolvePartnerConnectionMarkerPath());
        return marker;
    }

    async getRenderPins(): Promise<RenderPins> {
        return { version: 1, pins: { 'overlay-runtime': await this.overlayRuntimeVersion() } };
    }

    protected async overlayRuntimeVersion(): Promise<string> {
        const candidates = [
            path.resolve(__dirname, '../overlay-runtime/package.json'),
            path.resolve(process.cwd(), '../../packages/overlay-runtime/package.json'),
            path.resolve(process.cwd(), 'packages/overlay-runtime/package.json')
        ];
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(await fs.readFile(candidate, 'utf8')) as { version?: string };
                if (typeof parsed.version === 'string' && parsed.version) {
                    return parsed.version;
                }
            } catch {
                // Try the next development or packaged-app location.
            }
        }
        return 'unknown';
    }

    async verifyExtensionBinary(request: BinaryVerificationRequest): Promise<BinaryVerificationResult> {
        if (!request.packagePath) {
            return { checked: false, found: false, reason: '拡張の配置先を取得できませんでした' };
        }
        const root = this.toFsPath(request.packagePath);
        try {
            const match = await this.findExecutable(root, request, 0);
            return match
                ? { checked: true, found: true, match }
                : { checked: true, found: false, reason: `対象プラットフォーム用バイナリがありません (${request.platformTokens.join(', ')})` };
        } catch (error) {
            return { checked: false, found: false, reason: this.errorMessage(error) };
        }
    }

    protected async findExecutable(
        directory: string,
        request: BinaryVerificationRequest,
        depth: number
    ): Promise<string | undefined> {
        if (depth > MAX_VERIFY_DEPTH) {
            return undefined;
        }
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = await this.findExecutable(entryPath, request, depth + 1);
                if (nested) {
                    return nested;
                }
                continue;
            }
            const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
            const nameMatches = request.executableNames.some(name => entry.name.toLowerCase() === name.toLowerCase());
            const platformMatches = request.platformTokens.some(token => normalized.includes(token.toLowerCase()));
            if (!nameMatches || !platformMatches) {
                continue;
            }
            if (process.platform !== 'win32') {
                const stat = await fs.stat(entryPath);
                if ((stat.mode & 0o111) === 0) {
                    continue;
                }
            }
            return entryPath;
        }
        return undefined;
    }

    protected toFsPath(value: string): string {
        return value.startsWith('file:') ? fileURLToPath(value) : value;
    }

    protected isElectronExecutable(executable: string): boolean {
        return /electron|\.app\/Contents\/MacOS\//i.test(executable) || Boolean(process.versions.electron);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
