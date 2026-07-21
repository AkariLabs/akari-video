/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * This function is deliberately self-contained. The backend serializes it with
 * `toString()` and passes it to the bundled Electron executable via `node -e`.
 * That keeps packaged execution independent of both user PATH and extension
 * source/layout paths inside app.asar.
 */
export function bootstrapRunner(): void {
    const fs = require('fs').promises as typeof import('fs').promises;
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const { spawn } = require('child_process') as typeof import('child_process');
    const { gunzipSync } = require('zlib') as typeof import('zlib');

    const claudeInstallUrl = process.env.AKARI_PARTNER_CLAUDE_INSTALL_URL || 'https://claude.ai/install.sh';
    const codexReleaseApiUrl = process.env.AKARI_PARTNER_CODEX_RELEASE_API_URL || 'https://api.github.com/repos/openai/codex/releases/latest';
    const requestTimeoutMs = 120_000;
    // Escape hatch for forcing a fresh (re)install even when a usable binary is
    // already on disk. Default is detection-first — see runClaudeInstaller /
    // installCodexBinary below (F46: partner connect must not reinstall CLIs
    // that are already present).
    const forceReinstall = process.env.AKARI_PARTNER_FORCE_REINSTALL === '1';
    const explicitSystemPath = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
    ].join(path.delimiter);

    interface BootstrapOutcome {
        executablePath: string;
        // true when an already-installed binary was reused instead of running
        // the installer/downloader.
        reused: boolean;
    }

    function claudeCandidates(): string[] {
        return [
            path.join(os.homedir(), '.local', 'bin', 'claude'),
            path.join(os.homedir(), '.claude', 'bin', 'claude'),
            path.join(os.homedir(), '.claude', 'local', 'claude')
        ];
    }

    function codexCandidates(): string[] {
        return [
            path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
        ];
    }

    async function request(url: string, accept = 'application/octet-stream'): Promise<Buffer> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    Accept: accept,
                    'User-Agent': 'AKARI-Video-Partner-Bootstrap'
                }
            });
            if (!response.ok) {
                throw new Error(`download failed: ${response.status} ${response.statusText} (${url})`);
            }
            return Buffer.from(await response.arrayBuffer());
        } finally {
            clearTimeout(timer);
        }
    }

    async function runClaudeInstaller(): Promise<BootstrapOutcome> {
        if (!forceReinstall) {
            const existing = await firstExecutable(claudeCandidates());
            if (existing) {
                console.log(`既存の claude を検出: ${existing}`);
                return { executablePath: existing, reused: true };
            }
        }
        if (process.platform === 'win32') {
            throw new Error('Claude Code native bootstrap currently requires macOS or Linux');
        }
        console.log(`Claude installer を取得しています: ${claudeInstallUrl}`);
        const script = await request(claudeInstallUrl, 'text/plain');
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-claude-'));
        const installer = path.join(tempDir, 'install.sh');
        try {
            await fs.writeFile(installer, script, { mode: 0o700 });
            console.log('Claude Code をユーザー領域へインストールしています');
            await run('/bin/sh', [installer], {
                ...process.env,
                PATH: explicitSystemPath
            });
            const executable = await firstExecutable(claudeCandidates());
            if (!executable) {
                throw new Error('Claude installer completed but the claude executable was not found');
            }
            return { executablePath: executable, reused: false };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    async function installCodexBinary(): Promise<BootstrapOutcome> {
        if (!forceReinstall) {
            const existing = await firstExecutable(codexCandidates());
            if (existing) {
                console.log(`既存の codex を検出: ${existing}`);
                return { executablePath: existing, reused: true };
            }
        }
        console.log(`Codex リリース情報を取得しています: ${codexReleaseApiUrl}`);
        const release = JSON.parse((await request(codexReleaseApiUrl, 'application/vnd.github+json')).toString('utf8')) as {
            assets?: Array<{ name: string; browser_download_url: string }>;
        };
        const assetName = codexAssetName();
        const asset = release.assets?.find(candidate => candidate.name === assetName);
        if (!asset) {
            throw new Error(`Codex release does not contain ${assetName}`);
        }
        console.log(`${asset.name} をダウンロードしています`);
        const archive = await request(asset.browser_download_url);
        const binary = extractSingleTarFile(gunzipSync(archive), /^codex(?:-|$)/);
        const [executable] = codexCandidates();
        const binDir = path.dirname(executable);
        await fs.mkdir(binDir, { recursive: true });
        const temporary = `${executable}.akari-download`;
        await fs.writeFile(temporary, binary, { mode: 0o755 });
        await fs.rename(temporary, executable);
        await fs.chmod(executable, 0o755);
        console.log(`Codex を ${executable} にインストールしました`);
        return { executablePath: executable, reused: false };
    }

    function codexAssetName(): string {
        if (process.platform === 'darwin' && process.arch === 'arm64') {
            return 'codex-aarch64-apple-darwin.tar.gz';
        }
        if (process.platform === 'darwin' && process.arch === 'x64') {
            return 'codex-x86_64-apple-darwin.tar.gz';
        }
        if (process.platform === 'linux' && process.arch === 'arm64') {
            return 'codex-aarch64-unknown-linux-musl.tar.gz';
        }
        if (process.platform === 'linux' && process.arch === 'x64') {
            return 'codex-x86_64-unknown-linux-musl.tar.gz';
        }
        throw new Error(`Codex binary bootstrap is unsupported on ${process.platform}-${process.arch}`);
    }

    function extractSingleTarFile(tar: Buffer, namePattern: RegExp): Buffer {
        for (let offset = 0; offset + 512 <= tar.length;) {
            const header = tar.subarray(offset, offset + 512);
            const name = readTarString(header, 0, 100);
            if (!name) {
                break;
            }
            const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8);
            if (!Number.isFinite(size) || size < 0) {
                throw new Error('Codex archive has an invalid tar entry');
            }
            const contentStart = offset + 512;
            if (namePattern.test(path.posix.basename(name)) && size > 0) {
                return tar.subarray(contentStart, contentStart + size);
            }
            offset = contentStart + Math.ceil(size / 512) * 512;
        }
        throw new Error('Codex executable was not found in the release archive');
    }

    function readTarString(buffer: Buffer, offset: number, length: number): string {
        const end = buffer.indexOf(0, offset);
        return buffer.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString('utf8');
    }

    async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
                process.stderr.write(chunk);
            });
            child.on('error', reject);
            child.on('exit', (code: number | null) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
        });
    }

    async function firstExecutable(candidates: string[]): Promise<string | undefined> {
        for (const candidate of candidates) {
            try {
                await fs.access(candidate, fs.constants.X_OK);
                return candidate;
            } catch {
                // Continue through the documented native-installer locations.
            }
        }
        return undefined;
    }

    async function main(): Promise<void> {
        const agent = process.argv[process.argv.length - 1];
        if (agent !== 'claude' && agent !== 'codex') {
            throw new Error('expected bootstrap target: claude or codex');
        }
        const outcome = agent === 'claude' ? await runClaudeInstaller() : await installCodexBinary();
        console.log(JSON.stringify(outcome));
    }

    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
