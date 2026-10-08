import { injectable } from '@theia/core/shared/inversify';
import { ChildProcess, execFile, spawn, spawnSync } from 'child_process';
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
import { DshWebEarlyExitError, launchDshWeb } from './dsh-web-launcher';
import { normalizeWebCwdKey, selectDshWebPort } from './dsh-web-port';
import { maskDshOutput } from '../common/dsh-output-mask';
import { appliedPartnerPermissionMode, normalizePartnerPermissionMode, partnerPermissionArgs, partnerPermissionEnv,
    PartnerPermissionMode } from '../common/partner-permissions';
import { DSH_CWD_WORKSPACE_PLUGIN_SOURCE } from './dsh-cwd-workspace-plugin';

const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFY_DEPTH = 8;

export type PartnerCliHelpProbe = { kind: 'ok'; help: string } | { kind: 'timeout' | 'failed' };

export function stopPartnerCliHelpProcess(pid: number, platform: NodeJS.Platform, child: ChildProcess,
    runKill: typeof execFile = execFile, killGroup: typeof process.kill = process.kill): void {
    if (platform === 'win32') {
        try {
            runKill(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
                ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, error => {
                    if (error) child.kill('SIGKILL');
                });
        } catch { child.kill('SIGKILL'); }
        return;
    }
    try { killGroup(-pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
}

export function probePartnerCliHelp(executablePath: string, platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env, run: typeof spawn = spawn,
    stop: typeof stopPartnerCliHelpProcess = stopPartnerCliHelpProcess, timeoutMs = 15_000): Promise<PartnerCliHelpProbe> {
    const isBatch = platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath);
    if (isBatch && /[&^%!"\r\n]/.test(executablePath)) return Promise.resolve({ kind: 'failed' });
    const command = isBatch ? env.ComSpec || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe') : executablePath;
    const args = isBatch ? ['/d', '/s', '/c', `""${executablePath}" "--help""`] : ['--help'];
    return new Promise(resolve => {
        let done = false;
        let timer: NodeJS.Timeout | undefined;
        let child: ChildProcess | undefined;
        let output = '';
        const finish = (result: PartnerCliHelpProbe): void => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            resolve(result);
        };
        try {
            child = run(command, args, { env, detached: platform !== 'win32', windowsHide: true,
                windowsVerbatimArguments: isBatch });
            const append = (chunk: Buffer | string): void => {
                if (done) return;
                output += chunk.toString();
                if (Buffer.byteLength(output) > 1024 * 1024) {
                    try {
                        if (child?.pid) stop(child.pid, platform, child);
                        else child?.kill('SIGKILL');
                    } catch { child?.kill('SIGKILL'); }
                    finish({ kind: 'failed' });
                }
            };
            child.stdout?.on('data', append);
            child.stderr?.on('data', append);
            child.once('error', () => finish({ kind: 'failed' }));
            child.once('close', (code, signal) => {
                const help = output.trim();
                finish(code === 0 && signal === null && help ? { kind: 'ok', help } : { kind: 'failed' });
            });
            if (!done) timer = setTimeout(() => {
                if (child?.exitCode === null && child.signalCode === null) {
                    try {
                        if (child.pid) stop(child.pid, platform, child);
                        else child.kill('SIGKILL');
                    } catch { child.kill('SIGKILL'); }
                }
                finish({ kind: 'timeout' });
            }, timeoutMs);
        } catch { finish({ kind: 'failed' }); }
    });
}

function hasDelimitedWord(text: string, word: string, isWordCharacter: (character: string) => boolean): boolean {
    let index = text.indexOf(word);
    while (index !== -1) {
        const before = text[index - 1];
        const after = text[index + word.length];
        if ((!before || !isWordCharacter(before)) && (!after || !isWordCharacter(after))) return true;
        index = text.indexOf(word, index + 1);
    }
    return false;
}

export function partnerHelpSupportsArgs(help: string, args: readonly string[]): boolean {
    const [flag, value] = args;
    if (!flag || args.length > 2) return false;
    const lines = help.split(/\r?\n/);
    const flagInLine = (line: string): boolean => hasDelimitedWord(line, flag, character => /[a-zA-Z0-9_-]/.test(character));
    for (let index = 0; index < lines.length; index++) {
        if (!flagInLine(lines[index])) continue;
        if (!value) return true;
        const detail = [lines[index]];
        for (let next = index + 1; next < Math.min(lines.length, index + 6); next++) {
            if (/^\s*(?:--[a-zA-Z]|-[a-zA-Z],\s*--)/.test(lines[next])) break;
            detail.push(lines[next]);
        }
        const description = detail.join('\n');
        const choices = /\b(?:choices|possible values)\s*:/i.exec(description);
        if (choices) {
            const listed = description.slice(choices.index + choices[0].length);
            const close = listed.search(/[)\]]/);
            const values = close >= 0 ? listed.slice(0, close) : listed.split('\n', 1)[0];
            if (hasDelimitedWord(values, value, character => /[a-zA-Z0-9_-]/.test(character))) return true;
        }
    }
    return false;
}

interface WebProcessRecord { cwdKey: string; owners: Set<string>; launch: PartnerWebLaunch; }
interface PendingWebLaunch { owners: Set<string>; promise: Promise<PartnerWebLaunch>; }

export function resolvePartnerProcessLaunch(
    agent: PartnerAgentId,
    resolvedExecutablePath: string | undefined,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    permissionArgs: readonly string[] = []
): Pick<PartnerLaunchPlan, 'executablePath' | 'args'> {
    // tui プロファイルが将来同梱されたら、DeepSeek の起動引数を ['tui'] に差し替える。
    const args = [...permissionArgs];
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
    private readonly cliHelpCache = new Map<string, { mtimeMs: number; pathValue: string | undefined; help: string }>();

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

    protected async resolveWebCwdKey(cwd: string): Promise<string> {
        return normalizeWebCwdKey(await fs.realpath(cwd));
    }

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
        executablePath: string, ownerId: string, permissionMode?: PartnerPermissionMode): Promise<PartnerWebLaunch> {
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
        const promise = this.launchNewWebPartner(agent, cwd, executablePath, cwdKey, normalizePartnerPermissionMode(permissionMode)).then(launch => {
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
        cwdKey: string, permissionMode: PartnerPermissionMode): Promise<PartnerWebLaunch> {
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
            pluginPath, provider: connection.provider, appVersion, sessionId: buildDshSessionId(cwd)
        }), { mode: 0o600 });
        await fs.chmod(patchPath, 0o600).catch(() => undefined);
        const launch = await this.prepareLaunch(agent, executablePath, permissionMode);
        const env: NodeJS.ProcessEnv = { ...process.env, ...launch.env, ...connection.secret,
            ...partnerPermissionEnv(agent, permissionMode), AKARI_PARTNER_PARENT_PID: String(process.pid) };
        if (permissionMode !== 'bypass') delete env.DSH_PERMISSION_MODE;
        if (connection.provider !== 'opencode-go') delete env.OPENCODE_GO_API_KEY;
        const logPath = path.join(partnersDir, 'web.log');
        const log = (line: string): void => {
            const safe = maskDshOutput(line, [process.env.DEEPSEEK_API_KEY, connection.secret?.OPENCODE_GO_API_KEY]);
            appendFileSync(logPath, safe + '\n');
        };
        const selection = await selectDshWebPort(cwdKey);
        log(`dsh web port: ${selection.port === undefined ? '0 (OS が選ぶ)' : selection.port}; skipped: ${selection.skipped.join(', ') || 'none'}`);
        const input: Parameters<typeof launchDshWeb>[0] = {
            executablePath, cwd, env, patchPath, platform: process.platform, timeoutMs: 120_000,
            log, stop: pid => this.killWebProcess(pid), onExit: pid => this.webProcesses.delete(pid)
        };
        let result: { url: string; pid: number };
        try {
            try {
                result = await this.launchWebProcess({ ...input, port: selection.port });
            } catch (error) {
                if (selection.port === undefined || !(error instanceof DshWebEarlyExitError)) throw error;
                log(`dsh web port: 0 (OS が選ぶ); retrying once after ${selection.port} failed before URL`);
                try {
                    result = await this.launchWebProcess(input);
                } catch (retryError) {
                    throw new Error(`dsh web first attempt failed: ${this.errorMessage(error)}\n--port 0 retry failed: ${this.errorMessage(retryError)}`);
                }
            }
        } catch (error) {
            const message = maskDshOutput(this.errorMessage(error),
                [process.env.DEEPSEEK_API_KEY, connection.secret?.OPENCODE_GO_API_KEY]);
            throw new Error(message);
        }
        if (!this.webProcessAlive(result.pid)) throw new Error('dsh web exited after startup');
        return { ...result, cwd, provider: connection.provider, providerNote: connection.note,
            guidance: connection.guidance,
            appliedPermissionMode: appliedPartnerPermissionMode(agent, permissionMode, [], partnerPermissionEnv(agent, permissionMode)) };
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

    async prepareLaunch(agent: PartnerAgentId, resolvedExecutablePath?: string, permissionMode?: PartnerPermissionMode): Promise<PartnerLaunchPlan> {
        const mode = normalizePartnerPermissionMode(permissionMode);
        const requestedArgs = partnerPermissionArgs(agent, mode);
        const log: string[] = [];
        const cliPathEnv = this.resolveCliPathEnv();
        const privateNodePathEnv = agent === 'commandcode' || agent === 'pi' || agent === 'deepseek' ? buildPrivateNodePathEnv({
            agent,
            akariHome: resolveAkariHomeDir(),
            platform: process.platform,
            existingPath: cliPathEnv.PATH ?? process.env.PATH
        }) : {};
        const launchEnv = { ...this.resolveMediaBinEnv(), ...cliPathEnv, ...privateNodePathEnv };
        let permissionArgs = requestedArgs;
        let permissionFallbackReason: PartnerLaunchPlan['permissionFallbackReason'];
        if (requestedArgs.length > 0) {
            const flag = requestedArgs[0];
            const probe = resolvedExecutablePath ? await this.cliHelp(resolvedExecutablePath, { ...process.env, ...launchEnv }) : { kind: 'failed' } as const;
            if (probe.kind !== 'ok' || !partnerHelpSupportsArgs(probe.help, requestedArgs)) {
                permissionArgs = [];
                const reason = probe.kind === 'timeout' ? '--help の確認が時間切れのため' :
                    probe.kind === 'failed' ? '--help の確認に失敗したため' : '--help にフラグが無いため';
                permissionFallbackReason = probe.kind === 'timeout' ? '時間切れ' : probe.kind === 'failed' ? '確認失敗' : 'フラグ無し';
                const line = `${agent}: ${flag} は ${reason}、権限フラグを付けずに起動します`;
                console.warn(`[akari-partner] ${line}`);
                log.push(line);
            }
        }
        const processLaunch = resolvePartnerProcessLaunch(agent, resolvedExecutablePath, process.platform, process.env, permissionArgs);
        return {
            agent,
            ...processLaunch,
            log,
            permissionFallbackReason,
            appliedPermissionMode: appliedPartnerPermissionMode(agent, mode, permissionArgs),
            env: launchEnv
        };
    }

    protected async cliHelp(executablePath: string, env: NodeJS.ProcessEnv): Promise<PartnerCliHelpProbe> {
        const stat = await fs.stat(executablePath).catch(() => undefined);
        if (!stat) return { kind: 'failed' };
        const cached = this.cliHelpCache.get(executablePath);
        if (cached?.mtimeMs === stat.mtimeMs && cached.pathValue === env.PATH) return { kind: 'ok', help: cached.help };
        const probe = await this.probeCliHelp(executablePath, env);
        if (probe.kind === 'ok') this.cliHelpCache.set(executablePath, { mtimeMs: stat.mtimeMs, pathValue: env.PATH, help: probe.help });
        return probe;
    }

    protected probeCliHelp(executablePath: string, env: NodeJS.ProcessEnv): Promise<PartnerCliHelpProbe> {
        return probePartnerCliHelp(executablePath, process.platform, env);
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
