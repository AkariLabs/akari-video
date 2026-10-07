import { spawn as nodeSpawn, ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import * as path from 'path';

export function parseDshWebUrlLine(line: string): string | undefined {
    return /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(line)?.[1];
}

export function maskToken(line: string): string {
    return line.replace(/token=[^\s&)"']+/g, 'token=***');
}

export function buildDshWebArgs(
    executablePath: string, patchPath: string, platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): { command: string; args: string[] } {
    const args = ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', '0'];
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)) {
        return { command: env.ComSpec || path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
            args: ['/d', '/s', '/c', executablePath, ...args] };
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
    spawn?: typeof nodeSpawn;
    log: (line: string) => void;
    stop: (pid: number) => void;
    onExit?: (pid: number) => void;
}): Promise<{ url: string; pid: number }> {
    const { command, args } = buildDshWebArgs(input.executablePath, input.patchPath, input.platform, input.env);
    const options: SpawnOptionsWithoutStdio = {
        cwd: input.cwd, env: input.env, windowsHide: true, detached: input.platform !== 'win32'
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
                reject(new Error(`${error.message}\n${tail.slice(-20).join('\n')}`));
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
        child.on('error', error => finish(error));
        child.on('exit', code => {
            if (child.pid) input.onExit?.(child.pid);
            if (stdout) consume('\n', 'stdout');
            if (stderr) consume('\n', 'stderr');
            finish(new Error(`dsh web exited with code ${code}`));
        });
    });
}
