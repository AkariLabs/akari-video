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

    const claudeInstallUrl = process.env.AKARI_PARTNER_CLAUDE_INSTALL_URL
        || (process.platform === 'win32' ? 'https://claude.ai/install.ps1' : 'https://claude.ai/install.sh');
    const codexReleaseApiUrl = process.env.AKARI_PARTNER_CODEX_RELEASE_API_URL || 'https://api.github.com/repos/openai/codex/releases/latest';
    const requestTimeoutMs = 120_000;
    // Escape hatch for forcing a fresh (re)install even when a usable binary is
    // already on disk. Default is detection-first — see runClaudeInstaller /
    // installCodexBinary below (F46: partner connect must not reinstall CLIs
    // that are already present).
    const forceReinstall = process.env.AKARI_PARTNER_FORCE_REINSTALL === '1';
    // task/2026-07-25-partner-plugin-autowire: the connecting project's workspace
    // root (filesystem path, set by AkariPartnerServerImpl#bootstrap). `--scope
    // project` writes to cwd-relative .claude/settings.json, so plugin wiring
    // needs this to run `claude plugin install` in the right directory.
    const workspaceRoot = process.env.AKARI_PARTNER_WORKSPACE_ROOT;
    // <plugin-name>@<marketplace-name> — both happen to be "akari"
    // (.claude-plugin/marketplace.json / plugin/.claude-plugin/plugin.json).
    const akariPluginId = 'akari@akari';
    const akariMarketplaceKey = 'akari';
    // On win32 this POSIX directory list would replace PATH with directories that
    // don't exist there (breaking installers and `claude plugin install`), so keep
    // the inherited PATH on Windows and pin the well-known system dirs elsewhere.
    const explicitSystemPath = process.platform === 'win32'
        ? (process.env.PATH ?? '')
        : [
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
        const claude = process.platform === 'win32' ? 'claude.exe' : 'claude';
        return [
            path.join(os.homedir(), '.local', 'bin', claude),
            path.join(os.homedir(), '.claude', 'bin', claude),
            path.join(os.homedir(), '.claude', 'local', claude)
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
        console.log(`Claude installer を取得しています: ${claudeInstallUrl}`);
        const script = await request(claudeInstallUrl, 'text/plain');
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-claude-'));
        try {
            console.log('Claude Code をユーザー領域へインストールしています');
            if (process.platform === 'win32') {
                const installer = path.join(tempDir, 'install.ps1');
                await fs.writeFile(installer, script);
                // Windows PowerShell 5.1 は System32 配下に常在するので PATH に依存せず
                // 絶対パスで起動する。-ExecutionPolicy Bypass はこのプロセス限りの指定で、
                // RemoteSigned 既定でもダウンロードした .ps1 を実行できる（マシン GPO で
                // ロックされている環境は除く）。公式の `irm | iex` と同じ官製スクリプト。
                const powershell = path.join(
                    process.env.SystemRoot || 'C:\\Windows',
                    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
                );
                await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installer], {
                    ...process.env
                });
            } else {
                const installer = path.join(tempDir, 'install.sh');
                await fs.writeFile(installer, script, { mode: 0o700 });
                await run('/bin/sh', [installer], {
                    ...process.env,
                    PATH: explicitSystemPath
                });
            }
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
        // win32 の資産は tar.gz ではなく、GitHub リリース上の生の .exe（content-type:
        // application/x-msdos-program）を直接公開している。gunzip/tar 展開は不要
        // （2026-07-23 実測: gh api repos/openai/codex/releases/latest, rust-v0.145.0）。
        const binary = assetName.endsWith('.exe')
            ? archive
            : extractSingleTarFile(gunzipSync(archive), /^codex(?:-|$)/);
        const [executable] = codexCandidates();
        const binDir = path.dirname(executable);
        await fs.mkdir(binDir, { recursive: true });
        const temporary = `${executable}.akari-download`;
        // Windows の fs.chmod は POSIX の実行属性を持たない（read-only 属性のみ）ため
        // mode 指定・chmod 呼び出しは darwin/linux 側でのみ意味を持つ。
        if (process.platform === 'win32') {
            await fs.writeFile(temporary, binary);
        } else {
            await fs.writeFile(temporary, binary, { mode: 0o755 });
        }
        await fs.rename(temporary, executable);
        if (process.platform !== 'win32') {
            await fs.chmod(executable, 0o755);
        }
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
        if (process.platform === 'win32' && process.arch === 'arm64') {
            return 'codex-aarch64-pc-windows-msvc.exe';
        }
        if (process.platform === 'win32' && process.arch === 'x64') {
            return 'codex-x86_64-pc-windows-msvc.exe';
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

    async function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            // windowsHide: GUI アプリ (Electron backend) からの起動でコンソール窓を出さない。POSIX では無効果。
            const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

    async function readJsonFile(filePath: string): Promise<unknown> {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    }

    /**
     * task/2026-07-25-partner-plugin-autowire: makes sure the akari plugin
     * (skills namespace `akari:`) is enabled for the connecting project so
     * `akari:` slash commands appear in the next session. Detection-first
     * (F46) and fail-soft throughout — every branch either no-ops or logs a
     * warning via console.log (captured into BootstrapResult.log by the
     * caller) and returns; it never throws, so a wiring failure never fails
     * the surrounding claude connection. known_marketplaces.json and the
     * enabledPlugins shape are undocumented Claude Code internals that may
     * drift across versions — treat any parse failure as "not wired yet"
     * rather than erroring.
     */
    async function wirePluginSkills(claudeExecutable: string): Promise<void> {
        if (!workspaceRoot) {
            console.log('プラグイン配線: プロジェクトの workspace が見つからないためスキップします');
            return;
        }

        const settingsPath = path.join(workspaceRoot, '.claude', 'settings.json');
        let settings: { enabledPlugins?: Record<string, unknown> } | undefined;
        try {
            settings = await readJsonFile(settingsPath) as { enabledPlugins?: Record<string, unknown> };
        } catch {
            settings = undefined;
        }
        if (settings && settings.enabledPlugins && settings.enabledPlugins[akariPluginId]) {
            console.log('akari プラグイン配線済み');
            return;
        }

        const marketplacesPath = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');
        let marketplaces: Record<string, unknown> | undefined;
        try {
            const parsed = await readJsonFile(marketplacesPath);
            marketplaces = typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : undefined;
        } catch {
            marketplaces = undefined;
        }
        if (!marketplaces || !marketplaces[akariMarketplaceKey]) {
            console.log('akari マーケットプレイスが未登録のため、スキル配線は手動が必要です');
            return;
        }

        try {
            // --scope project only (D2: no user-scope / machine-wide install).
            // cwd matters: --scope project writes to <cwd>/.claude/settings.json.
            await run(claudeExecutable, ['plugin', 'install', akariPluginId, '--scope', 'project'], {
                ...process.env,
                PATH: explicitSystemPath
            }, workspaceRoot);
            console.log(`akari プラグインを配線しました（project scope: ${workspaceRoot}）`);
        } catch (error) {
            console.log(`akari プラグインの配線に失敗しました。スキル配線は手動が必要です（接続は続行します）: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async function main(): Promise<void> {
        const agent = process.argv[process.argv.length - 1];
        if (agent !== 'claude' && agent !== 'codex') {
            throw new Error('expected bootstrap target: claude or codex');
        }
        const outcome = agent === 'claude' ? await runClaudeInstaller() : await installCodexBinary();
        if (agent === 'claude') {
            try {
                await wirePluginSkills(outcome.executablePath);
            } catch (error) {
                // Belt-and-suspenders: wirePluginSkills already fail-softs internally,
                // but a connection must never fail because of the wiring step.
                console.log(`プラグイン配線ステップで想定外のエラーが発生しました（接続は続行します）: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        console.log(JSON.stringify(outcome));
    }

    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
