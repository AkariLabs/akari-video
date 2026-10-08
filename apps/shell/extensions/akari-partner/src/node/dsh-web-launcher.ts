import { spawn as nodeSpawn, ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import * as path from 'path';
import { maskToken } from '../common/dsh-output-mask';

export function parseDshWebUrlLine(line: string): string | undefined {
    return /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(line)?.[1];
}

export class DshWebEarlyExitError extends Error {}

function safeCommandArgument(value: string, label: string): string {
    if (/[&^%!"\r\n]/.test(value)) {
        throw new Error(`Windows の .cmd/.bat 起動で使えない文字が ${label} に含まれています: ${value}`);
    }
    return value;
}

export function buildDshWebArgs(
    executablePath: string, patchPath: string, platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env, port?: number
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
    if (port !== undefined && (!Number.isInteger(port) || port < 20000 || port > 44999)) {
        throw new Error('Invalid dsh web port');
    }
    const args = ['--profile', 'web', '--patch', patchPath, '--no-open'];
    if (port !== undefined) args.push('--port', String(port));
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)) {
        const command = safeCommandArgument(env.ComSpec || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), 'cmd.exe のパス');
        safeCommandArgument(executablePath, '実行ファイルのパス');
        safeCommandArgument(patchPath, 'パッチのパス');
        const quoted = '"' + [executablePath, ...args].map(arg => `"${arg}"`).join(' ') + '"';
        return { command, args: ['/d', '/s', '/c', quoted], windowsVerbatimArguments: true };
    }
    return { command: executablePath, args };
}

export async function launchDshWeb(input: {
    executablePath: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    patchPath: string;
    platform: NodeJS.Platform;
    timeoutMs: number;
    port?: number;
    spawn?: typeof nodeSpawn;
    log: (line: string) => void;
    stop: (pid: number) => void;
    onExit?: (pid: number) => void;
}): Promise<{ url: string; pid: number }> {
    const { command, args, windowsVerbatimArguments } = buildDshWebArgs(input.executablePath, input.patchPath, input.platform, input.env, input.port);
    const options: SpawnOptionsWithoutStdio = {
        cwd: input.cwd, env: input.env, windowsHide: true, detached: input.platform !== 'win32',
        windowsVerbatimArguments
    };
    const child = (input.spawn ?? nodeSpawn)(command, args, options) as ChildProcessWithoutNullStreams;
    return new Promise((resolve, reject) => {
        let done = false;
        let stdout = '';
        let stderr = '';
        const tail: string[] = [];
        const finish = (error?: Error, url?: string): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (error) {
                if (child.pid) input.stop(child.pid);
                const message = `${error.message}\n${tail.slice(-20).join('\n')}`;
                reject(error instanceof DshWebEarlyExitError ? new DshWebEarlyExitError(message) : new Error(message));
            } else if (url && child.pid) resolve({ url, pid: child.pid });
        };
        const consume = (chunk: Buffer | string, kind: 'stdout' | 'stderr'): void => {
            const data = (kind === 'stdout' ? stdout : stderr) + chunk.toString();
            const parts = data.split(/\r?\n/);
            if (kind === 'stdout') stdout = parts.pop() ?? '';
            else stderr = parts.pop() ?? '';
            for (const line of parts) {
                try { input.log(maskToken(line)); }
                catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
                if (kind === 'stderr') { tail.push(maskToken(line)); if (tail.length > 20) tail.shift(); }
                if (kind === 'stdout') {
                    const url = parseDshWebUrlLine(line);
                    if (url) finish(undefined, url);
                }
            }
        };
        const timer = setTimeout(() => finish(new Error('dsh web startup timed out')), input.timeoutMs);
        child.stdout.on('data', chunk => consume(chunk, 'stdout'));
        child.stderr.on('data', chunk => consume(chunk, 'stderr'));
        child.on('error', error => finish(new DshWebEarlyExitError(error.message)));
        child.on('close', code => {
            if (child.pid) input.onExit?.(child.pid);
            if (stdout) consume('\n', 'stdout');
            if (stderr) consume('\n', 'stderr');
            finish(new DshWebEarlyExitError(`dsh web exited with code ${code}`));
        });
    });
}
