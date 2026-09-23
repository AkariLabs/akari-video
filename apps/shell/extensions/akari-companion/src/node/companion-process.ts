import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CompanionAddress } from './companion-home';

export const DEFAULT_COMPANION_STARTUP_TIMEOUT_MS = 20_000;

export interface CompanionProcessOptions {
    env?: NodeJS.ProcessEnv;
    resourcesPath?: string;
    dirnameValue?: string;
    startupTimeoutMs?: number;
    stopTimeoutMs?: number;
}

export async function resolveCompanionBin(options: CompanionProcessOptions = {}): Promise<string | undefined> {
    const env = options.env ?? process.env;
    if (env.AKARI_VIBE_BIN) return env.AKARI_VIBE_BIN;
    const resources = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates: string[] = [];
    if (resources) candidates.push(join(resources, 'packages', 'akari-vibe', 'bin', 'akari-vibe.mjs'));
    let current = resolve(options.dirnameValue ?? __dirname);
    for (;;) {
        candidates.push(join(current, 'packages', 'akari-vibe', 'bin', 'akari-vibe.mjs'));
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    for (const candidate of candidates) {
        if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) return candidate;
    }
    return undefined;
}

/** Owns one child, including failures before its listening announcement. */
export class CompanionProcess {
    protected child: ChildProcessWithoutNullStreams | undefined;
    protected closed: Promise<void> = Promise.resolve();
    protected didClose = false;
    protected cancelled = false;
    protected rejectStart: ((error: Error) => void) | undefined;
    protected stopping: Promise<void> | undefined;

    constructor(protected readonly options: CompanionProcessOptions = {}) { }

    async start(onExit: () => void): Promise<CompanionAddress> {
        const bin = await resolveCompanionBin(this.options);
        if (this.cancelled) throw new Error('startup cancelled');
        if (!bin) throw new Error('bundled executable is unavailable');
        const token = randomBytes(32).toString('hex');
        const child = this.child = spawn(process.execPath, [bin, '--serve'], {
            env: { ...(this.options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['pipe', 'pipe', 'pipe'], detached: false
        });
        // Synchronous backend exit cannot await the graceful shutdown ladder.
        const onBackendExit = (): void => { child.kill('SIGKILL'); };
        process.once('exit', onBackendExit);
        this.closed = new Promise(resolveClosed => child.once('close', () => {
            process.removeListener('exit', onBackendExit);
            this.didClose = true;
            resolveClosed();
            onExit();
        }));
        // Consume both pipes continuously without retaining arbitrary child output.
        child.stderr.resume();
        return new Promise<CompanionAddress>((resolveAddress, reject) => {
            let buffer = '';
            let settled = false;
            const finish = (error?: Error, port?: number): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.rejectStart = undefined;
                child.stdout.removeListener('data', readLine);
                child.stdout.resume();
                if (error) reject(error);
                else resolveAddress({ port: port!, token });
            };
            const readLine = (chunk: Buffer): void => {
                buffer += chunk.toString('utf8');
                const newline = buffer.indexOf('\n');
                if (newline < 0) {
                    if (buffer.length > 4096) finish(new Error('invalid listening announcement'));
                    return;
                }
                try {
                    const message = JSON.parse(buffer.slice(0, newline));
                    if (message?.type !== 'listening' || message.protocol !== 0
                        || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
                        throw new Error('invalid listening announcement');
                    }
                    finish(undefined, message.port);
                } catch {
                    finish(new Error('invalid listening announcement'));
                }
            };
            const timer = setTimeout(() => finish(new Error('listening announcement timed out')),
                this.options.startupTimeoutMs ?? DEFAULT_COMPANION_STARTUP_TIMEOUT_MS);
            this.rejectStart = error => finish(error);
            child.stdout.on('data', readLine);
            child.once('error', () => finish(new Error('child process could not start')));
            child.once('exit', (code, signal) => finish(new Error(`child exited before connecting (${signal ?? code ?? 'unknown'})`)));
            child.stdin.on('error', () => finish(new Error('child input closed')));
            child.stdin.write(`${JSON.stringify({ token })}\n`);
        });
    }

    cancel(): void {
        this.cancelled = true;
        this.rejectStart?.(new Error('startup cancelled'));
        this.child?.stdin.end();
    }

    stop(): Promise<void> {
        this.cancel();
        return this.stopping ??= this.stopChild();
    }

    protected async stopChild(): Promise<void> {
        const child = this.child;
        if (!child || this.didClose) return;
        const wait = async (): Promise<void> => {
            let timer: ReturnType<typeof setTimeout>;
            await Promise.race([
                this.closed,
                new Promise<void>(resolveWait => { timer = setTimeout(resolveWait, this.options.stopTimeoutMs ?? 3000); })
            ]);
            clearTimeout(timer!);
        };
        await wait();
        if (this.didClose) return;
        child.kill('SIGTERM');
        await wait();
        if (this.didClose) return;
        child.kill('SIGKILL');
        await this.closed;
    }
}
