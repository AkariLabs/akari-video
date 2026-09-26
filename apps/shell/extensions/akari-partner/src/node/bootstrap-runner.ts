/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * This function is deliberately self-contained. The backend serializes it with
 * `toString()` and passes it to the bundled Electron executable via `node -e`.
 * That keeps packaged execution independent of both user PATH and extension
 * source/layout paths inside app.asar.
 */
export function bootstrapRunner(candidatePaths: typeof import('./partner-cli-candidates').partnerCliCandidates): void {
    const fs = require('fs').promises as typeof import('fs').promises;
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const { spawn } = require('child_process') as typeof import('child_process');
    const { gunzipSync, inflateRawSync } = require('zlib') as typeof import('zlib');
    const { createHash } = require('crypto') as typeof import('crypto');

    const claudeInstallUrl = process.env.AKARI_PARTNER_CLAUDE_INSTALL_URL
        || (process.platform === 'win32' ? 'https://claude.ai/install.ps1' : 'https://claude.ai/install.sh');
    const codexReleaseApiUrl = process.env.AKARI_PARTNER_CODEX_RELEASE_API_URL || 'https://api.github.com/repos/openai/codex/releases/latest';
    const codexReleaseTagApiUrlTemplate = process.env.AKARI_PARTNER_CODEX_RELEASE_TAG_API_URL_TEMPLATE
        || 'https://api.github.com/repos/openai/codex/releases/tags/{tag}';
    const requestTimeoutMs = 120_000;
    // win32 の opencode/copilot は 160-180MB の単一 exe 入り zip を直接ダウンロードする
    // ため、既定の 120s では低速回線で足りない。呼び出し側 (akari-partner-server.ts) の
    // bootstrap 全体タイムアウト 10 分の内側に収める。
    const largeDownloadTimeoutMs = 480_000;
    // Windows インストーラーが %LOCALAPPDATA% 配下へ置く CLI の探索基点。
    // LOCALAPPDATA が無い異常環境でも既定レイアウトへフォールバックする。
    const windowsLocalAppData = process.env.LOCALAPPDATA
        || path.join(os.homedir(), 'AppData', 'Local');
    // Escape hatch for forcing a fresh (re)install even when a usable binary is
    // already on disk. Default is detection-first — see runClaudeInstaller /
    // installCodexBinary below (F46: partner connect must not reinstall CLIs
    // that are already present).
    const forceReinstall = process.env.AKARI_PARTNER_FORCE_REINSTALL === '1';
    const ignoreSystemNode = process.env.AKARI_PARTNER_IGNORE_SYSTEM_NODE === '1';
    const nodeVersion = '24.21.0';
    const nodeSha256: Record<string, string> = {
        'node-v24.21.0-darwin-arm64.tar.gz': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
        'node-v24.21.0-darwin-x64.tar.gz': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
        'node-v24.21.0-win-arm64.zip': '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921',
        'node-v24.21.0-win-x64.zip': '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
    };
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
        nodeSource?: 'system' | 'private';
    }

    function claudeCandidates(): string[] {
        return candidatePaths('claude', { homeDir: os.homedir(), platform: process.platform, env: process.env, includePath: false, nativeOnly: true });
    }

    function codexCandidates(): string[] {
        return candidatePaths('codex', { homeDir: os.homedir(), platform: process.platform, env: process.env, includePath: false, nativeOnly: true });
    }

    function codexManagedRoot(): string {
        if (process.platform === 'win32') {
            return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AKARI Video', 'codex');
        }
        return path.join(os.homedir(), '.local', 'share', 'akari-video', 'codex');
    }

    function scriptInstallCandidates(executableName: string, extraCandidates: string[] = []): string[] {
        const pathDirectories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
        const pathNames = process.platform === 'win32'
            ? (process.env.PATHEXT ?? '')
                .split(';')
                .map(extension => extension.trim())
                .filter(Boolean)
                .map(extension => `${executableName}${extension.toLowerCase()}`)
            : [executableName];
        const candidateNames = pathNames.length > 0
            ? pathNames
            : [`${executableName}.exe`, `${executableName}.cmd`, `${executableName}.bat`];
        const candidates = candidateNames.map(name => path.join(os.homedir(), '.local', 'bin', name));
        for (const extraCandidate of extraCandidates) {
            if (process.platform === 'win32' && path.extname(extraCandidate) === '') {
                for (const name of candidateNames) {
                    candidates.push(path.join(path.dirname(extraCandidate), name));
                }
            } else {
                candidates.push(extraCandidate);
            }
        }
        for (const directory of pathDirectories) {
            for (const name of candidateNames) {
                candidates.push(path.join(directory, name));
            }
        }
        return candidates;
    }

    function npmAgentCandidates(agent: 'commandcode' | 'pi'): string[] {
        return candidatePaths(agent,
            { homeDir: os.homedir(), platform: process.platform, env: process.env });
    }

    function npmCandidates(): string[] {
        if (ignoreSystemNode) { return []; }
        const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const wellKnown = process.platform === 'win32'
            ? [
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', executable),
                path.join(windowsLocalAppData, 'Programs', 'nodejs', executable)
            ]
            : ['/opt/homebrew/bin/npm', '/usr/local/bin/npm', '/usr/bin/npm'];
        return [
            ...scriptInstallCandidates('npm'),
            ...wellKnown
        ];
    }

    function nodeCandidates(npmExecutable?: string): string[] {
        if (ignoreSystemNode) { return []; }
        const executable = process.platform === 'win32' ? 'node.exe' : 'node';
        const sibling = npmExecutable ? [path.join(path.dirname(npmExecutable), executable)] : [];
        const wellKnown = process.platform === 'win32'
            ? [
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', executable),
                path.join(windowsLocalAppData, 'Programs', 'nodejs', executable)
            ]
            : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
        return [
            ...sibling,
            ...scriptInstallCandidates('node'),
            ...wellKnown
        ];
    }

    async function request(url: string, accept = 'application/octet-stream', timeoutMs = requestTimeoutMs): Promise<Buffer> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
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
                console.log(`探索した実行ファイル候補: ${claudeCandidates().join(', ')}`);
                throw new Error('Claude installer completed but the claude executable was not found');
            }
            return { executablePath: executable, reused: false };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    async function installCodexBinary(): Promise<BootstrapOutcome> {
        try {
            if (!forceReinstall) {
                const existing = await firstExecutable(codexCandidates());
                if (existing) {
                    console.log(`既存の codex を検出: ${existing}`);
                    if (await codexHostPath(existing)) {
                        logCodexHostResult('OK', existing);
                        return { executablePath: existing, reused: true };
                    }
                    try {
                        await repairCodexHost(existing);
                        await requireCodexHost(existing);
                        logCodexHostResult('補充した', existing);
                        return { executablePath: existing, reused: true };
                    } catch (error) {
                        console.log(`既存 Codex の code-mode host 補充に失敗したため、公式バンドルへ切り替えます: ${errorMessage(error)}`);
                    }
                }
            }

            const installed = await installManagedCodexBundle();
            await requireCodexHost(installed);
            logCodexHostResult('OK', installed);
            return { executablePath: installed, reused: false };
        } catch (error) {
            console.log(`Codex code-mode host: 取得失敗 — 画像生成が使えません: ${errorMessage(error)}`);
            throw error;
        }
    }

    interface CodexRelease {
        tag_name?: string;
        assets?: Array<{ name: string; browser_download_url: string }>;
    }

    async function installManagedCodexBundle(): Promise<string> {
        console.log(`Codex リリース情報を取得しています: ${codexReleaseApiUrl}`);
        const release = await fetchCodexRelease(codexReleaseApiUrl);
        const version = releaseVersion(release);
        const assetName = codexBundleAssetName();
        const asset = release.assets?.find(candidate => candidate.name === assetName);
        if (!asset) {
            throw new Error(`Codex release does not contain ${assetName}`);
        }
        console.log(`${asset.name} をダウンロードしています`);
        // バンドルは 114MB 級。低速回線向けの大容量タイムアウトを使う（win32 zip CLI と同方針）。
        const archive = await request(asset.browser_download_url, 'application/octet-stream', largeDownloadTimeoutMs);
        const managedRoot = codexManagedRoot();
        const versionDir = path.join(managedRoot, version);
        await fs.mkdir(managedRoot, { recursive: true });
        const temporaryDir = await fs.mkdtemp(path.join(managedRoot, '.akari-download-'));
        try {
            await extractTarArchive(gunzipSync(archive), temporaryDir);
            const bundled = codexBundlePaths(temporaryDir);
            await fs.access(bundled.executable, fs.constants.X_OK);
            await fs.access(bundled.host, fs.constants.X_OK);
            await fs.rm(versionDir, { recursive: true, force: true });
            await fs.rename(temporaryDir, versionDir);
        } catch (error) {
            await fs.rm(temporaryDir, { recursive: true, force: true });
            throw error;
        }

        const bundled = codexBundlePaths(versionDir);
        let executable: string;
        if (process.platform === 'win32') {
            const currentBin = path.join(managedRoot, 'current', 'bin');
            const temporaryCurrent = path.join(managedRoot, `.current-${process.pid}`);
            await fs.rm(temporaryCurrent, { recursive: true, force: true });
            await fs.mkdir(path.join(temporaryCurrent, 'bin'), { recursive: true });
            await fs.copyFile(bundled.executable, path.join(temporaryCurrent, 'bin', path.basename(bundled.executable)));
            await fs.copyFile(bundled.host, path.join(temporaryCurrent, 'bin', path.basename(bundled.host)));
            await fs.rm(path.dirname(currentBin), { recursive: true, force: true });
            await fs.rename(temporaryCurrent, path.dirname(currentBin));
            executable = path.join(currentBin, path.basename(bundled.executable));
        } else {
            const executableLink = path.join(os.homedir(), '.local', 'bin', 'codex');
            await fs.mkdir(path.dirname(executableLink), { recursive: true });
            const temporaryLink = `${executableLink}.akari-download-${process.pid}`;
            await fs.rm(temporaryLink, { force: true });
            await fs.symlink(bundled.executable, temporaryLink);
            await fs.rename(temporaryLink, executableLink);
            executable = executableLink;
        }
        console.log(`Codex ${version} を ${versionDir} にインストールしました`);
        return executable;
    }

    async function repairCodexHost(executable: string): Promise<void> {
        const executableRealpath = await fs.realpath(executable);
        const versionOutput = await runCapture(executableRealpath, ['--version'], {
            ...process.env,
            PATH: explicitSystemPath
        });
        const versionMatch = /(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(versionOutput.trim());
        if (!versionMatch) {
            throw new Error(`codex --version から版を特定できませんでした: ${versionOutput.trim()}`);
        }
        const tag = `rust-v${versionMatch[1]}`;
        const tagUrl = codexReleaseTagApiUrlTemplate.replace('{tag}', encodeURIComponent(tag));
        console.log(`Codex ${versionMatch[1]} の code-mode host を取得しています: ${tagUrl}`);
        const release = await fetchCodexRelease(tagUrl);
        if (release.tag_name !== tag) {
            throw new Error(`Codex host release tag mismatch: expected ${tag}, got ${release.tag_name ?? '(missing)'}`);
        }
        const candidateNames = codexHostAssetNames();
        const asset = release.assets?.find(candidate => candidateNames.includes(candidate.name));
        if (!asset) {
            throw new Error(`Codex release does not contain a matching code-mode host asset (${candidateNames.join(', ')})`);
        }
        const download = await request(asset.browser_download_url, 'application/octet-stream', largeDownloadTimeoutMs);
        const hostName = process.platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host';
        const destination = path.join(path.dirname(executableRealpath), hostName);
        const temporary = `${destination}.akari-download-${process.pid}`;
        await fs.rm(temporary, { force: true });
        try {
            if (asset.name.endsWith('.tar.gz')) {
                const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-codex-host-'));
                try {
                    await extractTarArchive(gunzipSync(download), temporaryDir);
                    const extracted = await findFileByBasenamePrefix(temporaryDir, 'codex-code-mode-host');
                    if (!extracted) {
                        throw new Error('code-mode host was not found in its release archive');
                    }
                    await fs.copyFile(extracted, temporary);
                } finally {
                    await fs.rm(temporaryDir, { recursive: true, force: true });
                }
            } else {
                await fs.writeFile(temporary, download);
            }
            if (process.platform !== 'win32') {
                await fs.chmod(temporary, 0o755);
            }
            await fs.rename(temporary, destination);
        } catch (error) {
            await fs.rm(temporary, { force: true });
            throw error;
        }
    }

    async function fetchCodexRelease(url: string): Promise<CodexRelease> {
        return JSON.parse((await request(url, 'application/vnd.github+json')).toString('utf8')) as CodexRelease;
    }

    function releaseVersion(release: CodexRelease): string {
        const match = /^rust-v([0-9A-Za-z._-]+)$/.exec(release.tag_name ?? '');
        if (!match) {
            throw new Error(`Codex release has an invalid tag_name: ${release.tag_name ?? '(missing)'}`);
        }
        return match[1];
    }

    function codexBundlePaths(root: string): { executable: string; host: string } {
        const suffix = process.platform === 'win32' ? '.exe' : '';
        return {
            executable: path.join(root, 'bin', `codex${suffix}`),
            host: path.join(root, 'bin', `codex-code-mode-host${suffix}`)
        };
    }

    async function codexHostPath(executable: string): Promise<string | undefined> {
        try {
            const executableRealpath = await fs.realpath(executable);
            const host = path.join(path.dirname(executableRealpath), process.platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host');
            await fs.access(host, fs.constants.X_OK);
            return host;
        } catch {
            return undefined;
        }
    }

    async function requireCodexHost(executable: string): Promise<string> {
        const host = await codexHostPath(executable);
        if (!host) {
            throw new Error(`Codex code-mode host is missing next to the resolved executable; image generation is unavailable (${executable})`);
        }
        return host;
    }

    function logCodexHostResult(result: 'OK' | '補充した', executable: string): void {
        console.log(`Codex code-mode host: ${result}（${executable} の realpath 隣）`);
    }

    type ScriptInstallAgent = 'opencode' | 'copilot' | 'cursor' | 'antigravity' | 'grok' | 'devin';

    interface ScriptInstallAgentConfig {
        agent: ScriptInstallAgent;
        installUrlEnvVar: string;
        defaultInstallUrl: string;
        defaultInstallUrlWin32?: string;
        // 公式インストールスクリプトが win32 に存在しない CLI 向けの直接配置ルート:
        // GitHub リリースの単一 exe 入り zip を ~/.local/bin へ展開する（codex と同方式）。
        // installUrlEnvVar が指定されているときはスクリプト方式の env 上書きを優先する。
        win32ZipUrlByArch?: Record<string, string>;
        manualInstallCommand: string;
        // win32 で manualInstallCommand が実行不能（curl | bash 等）な CLI はこちらを案内する。
        manualInstallCommandWin32?: string;
        posixInterpreter?: '/bin/bash';
        allowNonzeroIfVersionSucceeds?: boolean;
    }

    const scriptInstallAgentConfigs: Record<ScriptInstallAgent, ScriptInstallAgentConfig> = {
        opencode: {
            agent: 'opencode',
            installUrlEnvVar: 'AKARI_PARTNER_OPENCODE_INSTALL_URL',
            defaultInstallUrl: 'https://opencode.ai/install',
            // opencode.ai/install.ps1 は 404（2026-08-24 実測）。win32 は GitHub リリースの
            // 単一 exe 入り zip（opencode-windows-*.zip, unzip -l で単一 opencode.exe を確認済み）
            // を直接配置する。
            win32ZipUrlByArch: {
                x64: 'https://github.com/sst/opencode/releases/latest/download/opencode-windows-x64.zip',
                arm64: 'https://github.com/sst/opencode/releases/latest/download/opencode-windows-arm64.zip'
            },
            manualInstallCommand: 'curl -fsSL https://opencode.ai/install | bash（または npm install -g opencode-ai）',
            manualInstallCommandWin32: 'npm install -g opencode-ai'
        },
        copilot: {
            agent: 'copilot',
            installUrlEnvVar: 'AKARI_PARTNER_COPILOT_INSTALL_URL',
            defaultInstallUrl: 'https://gh.io/copilot-install',
            // gh.io/copilot-install は bash 専用（win32 分岐は winget 呼び出しのみ）。win32 は
            // GitHub リリースの単一 exe 入り zip（copilot-win32-*.zip, 2026-08-24 実測）を直接配置する。
            win32ZipUrlByArch: {
                x64: 'https://github.com/github/copilot-cli/releases/latest/download/copilot-win32-x64.zip',
                arm64: 'https://github.com/github/copilot-cli/releases/latest/download/copilot-win32-arm64.zip'
            },
            manualInstallCommand: 'npm install -g @github/copilot',
            manualInstallCommandWin32: 'winget install GitHub.Copilot（または npm install -g @github/copilot）'
        },
        cursor: {
            agent: 'cursor',
            installUrlEnvVar: 'AKARI_PARTNER_CURSOR_INSTALL_URL',
            defaultInstallUrl: 'https://cursor.com/install',
            // cursor.com/install は linux/darwin のみ対応で、install.ps1 はサイトの HTML を返す
            // 偽エンドポイント（2026-08-24 実測）。Windows ネイティブ配布が存在しないため
            // win32 は自動インストール不可 — 手動誘導のみ（WSL 内での公式スクリプト実行）。
            manualInstallCommand: 'curl https://cursor.com/install -fsS | bash',
            manualInstallCommandWin32: 'Cursor CLI は Windows ネイティブ未対応です。WSL 内で curl https://cursor.com/install -fsS | bash を実行してください'
        },
        antigravity: {
            agent: 'antigravity',
            installUrlEnvVar: 'AKARI_PARTNER_ANTIGRAVITY_INSTALL_URL',
            defaultInstallUrl: 'https://antigravity.google/cli/install.sh',
            defaultInstallUrlWin32: 'https://antigravity.google/cli/install.ps1',
            // 公式 install.ps1 は agy.exe を %LOCALAPPDATA%\agy\bin へ置き、PATH 追加は
            // レジストリ（User PATH）のみ — 起動済み backend の process.env.PATH には届かず
            // 探索で構造的に見つからない。grok と同型
            // (task/2026-08-17-partner-grok-install-detection)。POSIX 側は ~/.local/bin に
            // 入るため追加不要。
            manualInstallCommand: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
            manualInstallCommandWin32: 'powershell -c "irm https://antigravity.google/cli/install.ps1 | iex"'
        },
        devin: {
            agent: 'devin',
            installUrlEnvVar: 'AKARI_PARTNER_DEVIN_INSTALL_URL',
            defaultInstallUrl: 'https://cli.devin.ai/install.sh',
            defaultInstallUrlWin32: 'https://static.devin.ai/cli/setup.ps1',
            manualInstallCommand: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
            manualInstallCommandWin32: 'irm https://static.devin.ai/cli/setup.ps1 | iex',
            posixInterpreter: '/bin/bash',
            allowNonzeroIfVersionSucceeds: true
        },
        grok: {
            agent: 'grok',
            installUrlEnvVar: 'AKARI_PARTNER_GROK_INSTALL_URL',
            defaultInstallUrl: 'https://x.ai/cli/install.sh',
            defaultInstallUrlWin32: 'https://x.ai/cli/install.ps1',
            // grok installer defaults to $HOME/.grok/bin (GROK_BIN_DIR), which is
            // outside both ~/.local/bin and the minimal launchd PATH inherited by
            // the GUI-launched Electron backend. Without this, a successful grok
            // install is structurally undetectable (task/2026-08-17-partner-grok-install-detection).
            manualInstallCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash（または npm install -g @xai-official/grok）',
            manualInstallCommandWin32: 'powershell -c "irm https://x.ai/cli/install.ps1 | iex"（または npm install -g @xai-official/grok）'
        }
    };

    const commandCodeManualInstall = 'npm install -g command-code（Node.js 22 以上が必要）';

    interface NodeRuntime {
        nodeExecutable: string;
        npmExecutable: string;
        binDir: string;
        source: 'system' | 'private';
        reused: boolean;
    }

    interface NodeRuntimePurpose {
        purposeLabel: string;
        manualInstall: string;
        minimumNode?: [number, number];
    }

    function privateNodeDir(): string {
        return path.join(process.env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'runtime', 'node', `v${nodeVersion}`);
    }

    function privateNodePaths(root: string): Pick<NodeRuntime, 'nodeExecutable' | 'npmExecutable' | 'binDir'> {
        const binDir = process.platform === 'win32' ? root : path.join(root, 'bin');
        return {
            nodeExecutable: path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node'),
            npmExecutable: path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm'),
            binDir
        };
    }

    function nodeRuntimeEnv(binDir: string): NodeJS.ProcessEnv {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        return { ...process.env, PATH: [binDir, process.env.PATH ?? '', explicitSystemPath].filter(Boolean).join(delimiter) };
    }

    async function preparedPrivateNode(): Promise<NodeRuntime | undefined> {
        const paths = privateNodePaths(privateNodeDir());
        if (!await firstExecutable([paths.nodeExecutable]) || !await firstExecutable([paths.npmExecutable])) {
            return undefined;
        }
        try {
            const version = (await runCapture(paths.nodeExecutable, ['-p', 'process.versions.node'], nodeRuntimeEnv(paths.binDir))).trim();
            if (version === nodeVersion) {
                return { ...paths, source: 'private', reused: true };
            }
        } catch {
            // Incomplete or damaged runtime: download afresh.
        }
        return undefined;
    }

    function acceptableNodeVersion(version: string, minimum: [number, number]): boolean {
        const [major, minor] = version.split('.').map(Number);
        return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
    }

    async function hasSystemNode(minimum: [number, number]): Promise<boolean> {
        for (const nodeExecutable of nodeCandidates()) {
            if (!await firstExecutable([nodeExecutable])) { continue; }
            try {
                const version = (await runCapture(nodeExecutable, ['-p', 'process.versions.node'], nodeRuntimeEnv(path.dirname(nodeExecutable)))).trim();
                if (acceptableNodeVersion(version, minimum)) { return true; }
            } catch {
                // Continue to the next candidate.
            }
        }
        return false;
    }

    async function resolveNodeRuntime({ purposeLabel, manualInstall, minimumNode = [22, 0] }: NodeRuntimePurpose): Promise<NodeRuntime> {
        if (!ignoreSystemNode) {
            for (const nodeExecutable of nodeCandidates()) {
                if (!await firstExecutable([nodeExecutable])) { continue; }
                const binDir = path.dirname(nodeExecutable);
                try {
                    const version = (await runCapture(nodeExecutable, ['-p', 'process.versions.node'], nodeRuntimeEnv(binDir))).trim();
                    if (!acceptableNodeVersion(version, minimumNode)) { continue; }
                    const npmExecutable = await firstExecutable([
                        path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm'),
                        ...npmCandidates()
                    ]);
                    if (npmExecutable) {
                        return { nodeExecutable, npmExecutable, binDir, source: 'system', reused: true };
                    }
                } catch {
                    // Continue to the next candidate.
                }
            }
        }
        const prepared = await preparedPrivateNode();
        if (prepared) {
            console.log(`用意済みの AKARI 専用 Node.js を使います: ${privateNodeDir()}`);
            return prepared;
        }
        const suffix = process.platform === 'darwin' ? 'tar.gz' : process.platform === 'win32' ? 'zip' : undefined;
        const archivePlatform = process.platform === 'win32' ? 'win' : process.platform;
        const assetName = suffix && (process.arch === 'arm64' || process.arch === 'x64')
            ? `node-v${nodeVersion}-${archivePlatform}-${process.arch}.${suffix}` : undefined;
        if (!assetName || !nodeSha256[assetName]) {
            throw new Error(`${purposeLabel} は ${process.platform}-${process.arch} で Node.js を自動取得できません。手動でインストールしてください: ${manualInstall}`);
        }
        const root = privateNodeDir();
        const parent = path.dirname(root);
        const distBaseUrl = process.env.AKARI_PARTNER_NODE_DIST_BASE_URL;
        const url = `${(distBaseUrl || 'https://nodejs.org/dist').replace(/\/$/, '')}/v${nodeVersion}/${assetName}`;
        console.log(`${purposeLabel} に必要な Node.js を AKARI 専用の場所に用意しています: ${root}`);
        console.log(`Node.js をダウンロードしています: ${url}`);
        const archive = await request(url, 'application/octet-stream', largeDownloadTimeoutMs);
        const overrides = distBaseUrl && process.env.AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON
            ? JSON.parse(process.env.AKARI_PARTNER_NODE_SHA256_OVERRIDE_JSON) as Record<string, string> : {};
        const expected = overrides[assetName] || nodeSha256[assetName];
        const actual = createHash('sha256').update(archive).digest('hex');
        if (actual !== expected) {
            throw new Error(`Node.js archive sha256 mismatch: ${assetName} (expected ${expected}, got ${actual})`);
        }
        console.log(`Node.js archive sha256 検証 OK: ${actual}`);
        await fs.mkdir(parent, { recursive: true });
        const temporaryDir = await fs.mkdtemp(path.join(parent, '.node-download-'));
        try {
            if (suffix === 'tar.gz') {
                await extractNodeTarArchive(gunzipSync(archive), temporaryDir);
            } else {
                await extractZipArchive(archive, temporaryDir);
            }
            const extractedRoot = path.join(temporaryDir, `node-v${nodeVersion}-${archivePlatform}-${process.arch}`);
            const paths = privateNodePaths(extractedRoot);
            await fs.access(paths.nodeExecutable, fs.constants.X_OK);
            await fs.access(paths.npmExecutable, fs.constants.F_OK);
            const version = (await runCapture(paths.nodeExecutable, ['-p', 'process.versions.node'], nodeRuntimeEnv(paths.binDir))).trim();
            if (version !== nodeVersion) {
                throw new Error(`Node.js version mismatch: expected ${nodeVersion}, got ${version}`);
            }
            await fs.rm(root, { recursive: true, force: true });
            await fs.rename(extractedRoot, root);
            return { ...privateNodePaths(root), source: 'private', reused: false };
        } finally {
            await fs.rm(temporaryDir, { recursive: true, force: true });
        }
    }

    type NpmAgent = 'commandcode' | 'pi';
    const npmAgentConfigs: Record<NpmAgent, {
        label: string; packageName: string;
        manualInstall: string; marker: string; minimumNode: [number, number];
    }> = {
        commandcode: {
            label: 'Command Code', packageName: 'command-code',
            manualInstall: commandCodeManualInstall, marker: 'command-code-installed', minimumNode: [22, 0]
        },
        pi: {
            label: 'Pi', packageName: '@earendil-works/pi-coding-agent',
            manualInstall: 'npm install -g @earendil-works/pi-coding-agent（Node.js 22.19 以上が必要）',
            marker: 'pi-installed', minimumNode: [22, 19]
        }
    };

    async function requireNpmAgentVersion(executable: string, env: NodeJS.ProcessEnv, config: typeof npmAgentConfigs[NpmAgent]): Promise<string> {
        try {
            return (await runCapture(executable, ['--version'], env)).trim();
        } catch (error) {
            const [major, minor] = config.minimumNode;
            const minimumNode = `${major}${minor ? `.${minor}` : ''}`;
            throw new Error(`${config.label} の起動確認に失敗しました。Node.js ${minimumNode} 以上を確認して再インストールしてください: ${config.manualInstall} (${errorMessage(error)})`);
        }
    }

    async function installNpmAgent(agent: NpmAgent): Promise<BootstrapOutcome> {
        const config = npmAgentConfigs[agent];
        const candidates = npmAgentCandidates(agent);
        const runtimePurpose = { purposeLabel: config.label, manualInstall: config.manualInstall, minimumNode: config.minimumNode };
        const privateMarker = path.join(privateNodeDir(), config.marker);
        if (!forceReinstall) {
            const existing = await firstExecutable(candidates);
            if (existing) {
                let privateRuntime = await preparedPrivateNode();
                if (!privateRuntime && !await hasSystemNode(config.minimumNode)) {
                    privateRuntime = await resolveNodeRuntime(runtimePurpose);
                }
                const validationPath = [privateRuntime?.binDir, path.dirname(existing), process.env.PATH ?? '', explicitSystemPath]
                    .filter(Boolean)
                    .join(path.delimiter);
                const version = await requireNpmAgentVersion(existing, { ...process.env, PATH: validationPath }, config);
                console.log(`既存の ${agent} ${version || '(version unknown)'} を検出: ${existing}`);
                const markerExists = await fs.access(privateMarker).then(() => true, () => false);
                const usePrivate = Boolean(privateRuntime && (markerExists || !await hasSystemNode(config.minimumNode)));
                if (usePrivate) {
                    console.log(`用意済みの AKARI 専用 Node.js を使います: ${privateNodeDir()}`);
                    await fs.writeFile(privateMarker, 'private\n');
                }
                return { executablePath: existing, reused: true, ...(usePrivate ? { nodeSource: 'private' as const } : {}) };
            }
        }
        const runtime = await resolveNodeRuntime(runtimePurpose);
        const installEnv = nodeRuntimeEnv(runtime.binDir);

        const prefix = path.join(os.homedir(), '.local');
        console.log(`${config.label} を npm 公式パッケージからユーザー領域へインストールしています: ${prefix}`);
        const npmArgs = [
            'install', '--global', '--prefix', prefix,
            '--no-audit', '--no-fund',
            config.packageName
        ];
        const npmCli = path.join(runtime.binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        const useWindowsNpmCli = process.platform === 'win32'
            && await fs.access(npmCli).then(() => true, () => false);
        try {
            await run(useWindowsNpmCli ? runtime.nodeExecutable : runtime.npmExecutable,
                useWindowsNpmCli ? [npmCli, ...npmArgs] : npmArgs, installEnv);
        } catch (error) {
            throw new Error(`${agent} のインストールに失敗しました。手動でインストールしてください: ${config.manualInstall} (${errorMessage(error)})`);
        }
        const executable = await firstExecutable(candidates);
        if (!executable) {
            console.log(`探索した実行ファイル候補: ${candidates.join(', ')}`);
            throw new Error(`npm install は完了しましたが ${config.label} の実行ファイルが見つかりませんでした。手動でインストールしてください: ${config.manualInstall}`);
        }
        const version = await requireNpmAgentVersion(executable, installEnv, config);
        if (runtime.source === 'private') {
            await fs.writeFile(privateMarker, 'private\n');
        } else {
            await fs.rm(privateMarker, { force: true });
        }
        console.log(`${config.label} ${version || '(version unknown)'} を検出: ${executable}`);
        return { executablePath: executable, reused: false, nodeSource: runtime.source };
    }

    function manualInstallGuidance(config: ScriptInstallAgentConfig): string {
        return process.platform === 'win32' && config.manualInstallCommandWin32
            ? config.manualInstallCommandWin32
            : config.manualInstallCommand;
    }

    async function runScriptInstaller(config: ScriptInstallAgentConfig): Promise<BootstrapOutcome> {
        const candidates = candidatePaths(config.agent, { homeDir: os.homedir(), platform: process.platform, env: process.env });
        if (!forceReinstall) {
            const existing = await firstExecutable(candidates);
            if (existing) {
                console.log(`既存の ${config.agent} を検出: ${existing}`);
                return { executablePath: existing, reused: true };
            }
        }
        const manualCommand = manualInstallGuidance(config);
        const envInstallUrl = process.env[config.installUrlEnvVar];
        // env 上書きはスクリプト方式を意味する（zip 直接配置より優先）。
        if (!envInstallUrl && process.platform === 'win32' && config.win32ZipUrlByArch) {
            return installWin32ZipBinary(config, manualCommand);
        }
        const installUrl = envInstallUrl
            || (process.platform === 'win32' ? config.defaultInstallUrlWin32 : config.defaultInstallUrl);
        if (!installUrl) {
            throw new Error(`${config.agent} はこの環境で自動インストールできません。手動でインストールしてください: ${manualCommand}`);
        }

        console.log(`${config.agent} installer を取得しています: ${installUrl}`);
        let script: Buffer;
        try {
            script = await request(installUrl, 'text/plain');
        } catch (error) {
            throw new Error(`${config.agent} のインストーラー取得に失敗しました。手動でインストールしてください: ${manualCommand} (${error instanceof Error ? error.message : String(error)})`);
        }
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `akari-${config.agent}-`));
        try {
            console.log(`${config.agent} をユーザー領域へインストールしています`);
            let installerError: unknown;
            try {
                if (process.platform === 'win32') {
                    const installer = path.join(tempDir, 'install.ps1');
                    await fs.writeFile(installer, script);
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
                    await run(config.posixInterpreter || '/bin/sh', [installer], {
                        ...process.env,
                        PATH: explicitSystemPath
                    });
                }
            } catch (error) {
                if (!config.allowNonzeroIfVersionSucceeds) {
                    throw new Error(`${config.agent} のインストールに失敗しました。手動でインストールしてください: ${manualCommand} (${error instanceof Error ? error.message : String(error)})`);
                }
                installerError = error;
            }
            const installerErrorLine = installerError ? lastInstallerErrorLine(installerError) : undefined;
            const executable = await firstExecutable(candidates);
            if (!executable) {
                console.log(`探索した実行ファイル候補: ${candidates.join(', ')}`);
                const searchedDirectories = [...new Set(candidatePaths(config.agent, {
                    homeDir: os.homedir(), platform: process.platform, env: process.env, includePath: false
                }).map(candidate => path.dirname(candidate)))];
                throw new Error(`インストールスクリプト後に実行ファイルが見つかりませんでした（探索先: ${searchedDirectories.join(', ')}）。手動でインストールしてください: ${manualCommand}${installerErrorLine ? ` (${installerErrorLine})` : ''}`);
            }
            if (installerError) {
                try {
                    const version = (await runCapture(executable, ['--version'], { ...process.env, PATH: [path.dirname(executable), process.env.PATH ?? ''].join(path.delimiter) })).trim();
                    console.log(`${config.agent} installer は非 0 終了しましたが、${executable} --version (${version}) が成功したためインストール済みと判定します: ${installerErrorLine}`);
                } catch (versionError) {
                    throw new Error(`${config.agent} のインストールと起動確認に失敗しました。手動でインストールしてください: ${manualCommand} (${installerErrorLine}; ${lastInstallerErrorLine(versionError)})`);
                }
            }
            return { executablePath: executable, reused: false };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    /**
     * win32 で公式インストールスクリプトを持たない CLI（opencode / copilot）向け:
     * GitHub リリースの単一 exe 入り zip をダウンロードし、codex と同じく
     * ~/.local/bin へ直接配置する。npm や winget の有無に依存しない。
     */
    async function installWin32ZipBinary(config: ScriptInstallAgentConfig, manualCommand: string): Promise<BootstrapOutcome> {
        const url = config.win32ZipUrlByArch?.[process.arch];
        if (!url) {
            throw new Error(`${config.agent} は ${process.platform}-${process.arch} 向けの配布物がありません。手動でインストールしてください: ${manualCommand}`);
        }
        console.log(`${config.agent} をダウンロードしています: ${url}`);
        let archive: Buffer;
        try {
            archive = await request(url, 'application/octet-stream', largeDownloadTimeoutMs);
        } catch (error) {
            throw new Error(`${config.agent} のダウンロードに失敗しました。手動でインストールしてください: ${manualCommand} (${error instanceof Error ? error.message : String(error)})`);
        }
        const executable = candidatePaths(config.agent, { homeDir: os.homedir(), platform: process.platform,
            env: process.env, includePath: false, nativeOnly: true })[0];
        const binary = extractSingleZipFile(archive, new RegExp(`^${path.basename(executable).replace('.', '\\.')}$`, 'i'));
        await fs.mkdir(path.dirname(executable), { recursive: true });
        const temporary = `${executable}.akari-download`;
        // Windows の fs.chmod は POSIX 実行属性を持たないため mode 指定は不要（codex 同様）。
        await fs.writeFile(temporary, binary);
        await fs.rename(temporary, executable);
        console.log(`${config.agent} を ${executable} にインストールしました`);
        return { executablePath: executable, reused: false };
    }

    /**
     * 依存なしの最小 zip 展開（単一エントリの取り出し専用）。central directory を
     * 正として名前・サイズ・格納方式を読む（general purpose bit 3 = data descriptor
     * 使用時、local header のサイズ欄は 0 のため信用しない）。対象 zip は 4GB 未満・
     * エントリ数 65535 未満なので zip64 は対象外。
     */
    function extractSingleZipFile(zip: Buffer, namePattern: RegExp): Buffer {
        // End of central directory record (署名 0x06054b50) を末尾から探す。
        // 固定長 22 バイト + 可変コメント最大 65535 バイト。
        let eocd = -1;
        for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
            if (zip.readUInt32LE(i) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) {
            throw new Error('zip: end of central directory record not found');
        }
        const entryCount = zip.readUInt16LE(eocd + 10);
        let offset = zip.readUInt32LE(eocd + 16);
        for (let i = 0; i < entryCount; i++) {
            if (zip.readUInt32LE(offset) !== 0x02014b50) {
                throw new Error('zip: invalid central directory entry');
            }
            const method = zip.readUInt16LE(offset + 10);
            const compressedSize = zip.readUInt32LE(offset + 20);
            const nameLength = zip.readUInt16LE(offset + 28);
            const extraLength = zip.readUInt16LE(offset + 30);
            const commentLength = zip.readUInt16LE(offset + 32);
            const localHeaderOffset = zip.readUInt32LE(offset + 42);
            const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
            if (!name.endsWith('/') && namePattern.test(path.posix.basename(name))) {
                // local header の name/extra 長は central directory と異なりうるので読み直す。
                const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
                const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
                const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
                const data = zip.subarray(dataStart, dataStart + compressedSize);
                if (method === 0) {
                    return Buffer.from(data);
                }
                if (method === 8) {
                    return inflateRawSync(data);
                }
                throw new Error(`zip: unsupported compression method ${method} for ${name}`);
            }
            offset += 46 + nameLength + extraLength + commentLength;
        }
        throw new Error('zip: no entry matched the expected executable name');
    }

    function codexTarget(): string {
        if (process.platform === 'darwin' && process.arch === 'arm64') {
            return 'aarch64-apple-darwin';
        }
        if (process.platform === 'darwin' && process.arch === 'x64') {
            return 'x86_64-apple-darwin';
        }
        if (process.platform === 'linux' && process.arch === 'arm64') {
            return 'aarch64-unknown-linux-musl';
        }
        if (process.platform === 'linux' && process.arch === 'x64') {
            return 'x86_64-unknown-linux-musl';
        }
        if (process.platform === 'win32' && process.arch === 'arm64') {
            return 'aarch64-pc-windows-msvc';
        }
        if (process.platform === 'win32' && process.arch === 'x64') {
            return 'x86_64-pc-windows-msvc';
        }
        throw new Error(`Codex binary bootstrap is unsupported on ${process.platform}-${process.arch}`);
    }

    function codexBundleAssetName(): string {
        return `codex-package-${codexTarget()}.tar.gz`;
    }

    function codexHostAssetNames(): string[] {
        const stem = `codex-code-mode-host-${codexTarget()}`;
        return process.platform === 'win32'
            ? [`${stem}.exe`, `${stem}.exe.tar.gz`]
            : [`${stem}.tar.gz`];
    }

    function archiveTarget(destination: string, name: string): string {
        const normalized = path.posix.normalize(name.replace(/\\/g, '/'));
        if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')
            || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
            throw new Error(`Node.js archive contains an unsafe path: ${name}`);
        }
        return path.join(destination, ...normalized.split('/'));
    }

    function paxFields(content: Buffer): Record<string, string> {
        const fields: Record<string, string> = {};
        for (let offset = 0; offset < content.length;) {
            const separator = content.indexOf(0x20, offset);
            const length = Number(content.subarray(offset, separator).toString());
            if (separator < 0 || !Number.isInteger(length) || length <= 0 || offset + length > content.length) {
                throw new Error('Node.js archive has an invalid pax header');
            }
            const record = content.subarray(separator + 1, offset + length - 1).toString('utf8');
            const equals = record.indexOf('=');
            if (equals > 0) { fields[record.slice(0, equals)] = record.slice(equals + 1); }
            offset += length;
        }
        return fields;
    }

    async function extractNodeTarArchive(tar: Buffer, destination: string): Promise<void> {
        let globalPax: Record<string, string> = {};
        let localPax: Record<string, string> = {};
        let longName: string | undefined;
        const links = new Set<string>();
        for (let offset = 0; offset + 512 <= tar.length;) {
            const header = tar.subarray(offset, offset + 512);
            const headerName = [readTarString(header, 345, 155), readTarString(header, 0, 100)].filter(Boolean).join('/');
            if (!headerName) { break; }
            const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8);
            const mode = Number.parseInt(readTarString(header, 100, 8).trim() || '0', 8);
            if (!Number.isFinite(size) || size < 0 || !Number.isFinite(mode) || mode < 0) {
                throw new Error('Node.js archive has an invalid tar entry');
            }
            const start = offset + 512;
            const end = start + size;
            if (end > tar.length) { throw new Error('Node.js archive has a truncated tar entry'); }
            const content = tar.subarray(start, end);
            const type = String.fromCharCode(header[156] || 0);
            if (type === 'g') {
                globalPax = { ...globalPax, ...paxFields(content) };
            } else if (type === 'x') {
                localPax = { ...localPax, ...paxFields(content) };
            } else if (type === 'L') {
                longName = content.toString('utf8').replace(/\0.*$/s, '').replace(/\n$/, '');
            } else {
                const fields = { ...globalPax, ...localPax };
                const name = fields.path || longName || headerName;
                const target = archiveTarget(destination, name);
                for (let parent = path.dirname(target); parent.startsWith(destination) && parent !== destination; parent = path.dirname(parent)) {
                    if (links.has(parent)) { throw new Error(`Node.js archive writes through a symlink: ${name}`); }
                }
                if (type === '5') {
                    await fs.mkdir(target, { recursive: true, mode: mode & 0o777 });
                } else if (type === '0' || type === '\0') {
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.writeFile(target, content, { mode: mode & 0o777 });
                    await fs.chmod(target, mode & 0o777);
                } else if (type === '2') {
                    const linkpath = fields.linkpath || readTarString(header, 157, 100);
                    const resolved = path.resolve(path.dirname(target), linkpath);
                    if (path.isAbsolute(linkpath) || path.relative(destination, resolved).startsWith('..')
                        || path.isAbsolute(path.relative(destination, resolved))) {
                        throw new Error(`Node.js archive contains an unsafe symlink: ${name} -> ${linkpath}`);
                    }
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.symlink(linkpath, target);
                    links.add(target);
                }
                localPax = {};
                longName = undefined;
            }
            offset = start + Math.ceil(size / 512) * 512;
        }
    }

    async function extractZipArchive(zip: Buffer, destination: string): Promise<void> {
        let eocd = -1;
        for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
            if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) { throw new Error('zip: end of central directory record not found'); }
        const count = zip.readUInt16LE(eocd + 10);
        let offset = zip.readUInt32LE(eocd + 16);
        for (let i = 0; i < count; i++) {
            if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
                throw new Error('zip: invalid central directory entry');
            }
            const method = zip.readUInt16LE(offset + 10);
            const compressedSize = zip.readUInt32LE(offset + 20);
            const uncompressedSize = zip.readUInt32LE(offset + 24);
            const nameLength = zip.readUInt16LE(offset + 28);
            const extraLength = zip.readUInt16LE(offset + 30);
            const commentLength = zip.readUInt16LE(offset + 32);
            const localOffset = zip.readUInt32LE(offset + 42);
            const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
            const target = archiveTarget(destination, name);
            if (name.endsWith('/')) {
                await fs.mkdir(target, { recursive: true });
            } else {
                if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
                    throw new Error(`zip: invalid local header for ${name}`);
                }
                const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
                if (dataStart + compressedSize > zip.length) { throw new Error(`zip: truncated entry ${name}`); }
                const compressed = zip.subarray(dataStart, dataStart + compressedSize);
                const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
                if (!content || content.length !== uncompressedSize) {
                    throw new Error(`zip: invalid content or compression method for ${name}`);
                }
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, content, { mode: 0o755 });
            }
            offset += 46 + nameLength + extraLength + commentLength;
        }
    }

    async function extractTarArchive(tar: Buffer, destination: string): Promise<void> {
        for (let offset = 0; offset + 512 <= tar.length;) {
            const header = tar.subarray(offset, offset + 512);
            const name = [readTarString(header, 345, 155), readTarString(header, 0, 100)]
                .filter(Boolean)
                .join('/');
            if (!name) {
                break;
            }
            const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8);
            const mode = Number.parseInt(readTarString(header, 100, 8).trim() || '0', 8);
            if (!Number.isFinite(size) || size < 0 || !Number.isFinite(mode) || mode < 0) {
                throw new Error('Codex archive has an invalid tar entry');
            }
            const contentStart = offset + 512;
            const contentEnd = contentStart + size;
            if (contentEnd > tar.length) {
                throw new Error('Codex archive has a truncated tar entry');
            }
            const normalized = path.posix.normalize(name.replace(/\\/g, '/'));
            if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
                throw new Error(`Codex archive contains an unsafe path: ${name}`);
            }
            const target = path.join(destination, ...normalized.split('/'));
            const type = String.fromCharCode(header[156] || 0);
            if (type === '5') {
                await fs.mkdir(target, { recursive: true, mode: mode & 0o777 });
                if (process.platform !== 'win32') {
                    await fs.chmod(target, mode & 0o777);
                }
            } else if (type === '\0' || type === '0') {
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, tar.subarray(contentStart, contentEnd), { mode: mode & 0o777 });
                if (process.platform !== 'win32') {
                    await fs.chmod(target, mode & 0o777);
                }
            }
            offset = contentStart + Math.ceil(size / 512) * 512;
        }
    }

    function readTarString(buffer: Buffer, offset: number, length: number): string {
        const end = buffer.indexOf(0, offset);
        return buffer.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString('utf8');
    }

    async function findFileByBasenamePrefix(directory: string, prefix: string): Promise<string | undefined> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = await findFileByBasenamePrefix(entryPath, prefix);
                if (nested) {
                    return nested;
                }
            } else if (entry.isFile() && entry.name.startsWith(prefix)) {
                return entryPath;
            }
        }
        return undefined;
    }

    function shellInvocation(command: string, args: string[]): { command: string; args: string[]; shell: boolean } {
        // テストは process.platform だけを win32 に差し替えるため、実 OS も確認する。
        const shell = process.platform === 'win32' && os.platform() === 'win32' && /\.(cmd|bat)$/i.test(command);
        if (!shell) { return { command, args, shell }; }
        const quoted = (value: string): string => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
        return { command: quoted(command), args: args.map(quoted), shell };
    }

    async function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            // windowsHide: GUI アプリ (Electron backend) からの起動でコンソール窓を出さない。POSIX では無効果。
            const invocation = shellInvocation(command, args);
            const child = spawn(invocation.command, invocation.args,
                { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: invocation.shell });
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

    async function runCapture(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const invocation = shellInvocation(command, args);
            const child = spawn(invocation.command, invocation.args,
                { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: invocation.shell });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (chunk: Buffer) => stdout += chunk.toString());
            child.stderr.on('data', (chunk: Buffer) => stderr += chunk.toString());
            child.on('error', reject);
            child.on('exit', (code: number | null) => code === 0
                ? resolve(stdout)
                : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
        });
    }

    function errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    function lastInstallerErrorLine(error: unknown): string {
        // run() は stderr を既にストリーム出力している。ここでは curl の進捗や ANSI 制御を
        // 二重表示せず、診断に必要な最後の非空行だけを残す。
        const lines = errorMessage(error)
            .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
            .split(/[\r\n]+/)
            .map(line => line.trim())
            .filter(Boolean);
        return lines[lines.length - 1] || 'installer exited with an error';
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
        if (agent !== 'claude' && agent !== 'codex' && agent !== 'opencode'
            && agent !== 'commandcode' && agent !== 'pi' && agent !== 'devin'
            && agent !== 'copilot' && agent !== 'cursor'
            && agent !== 'antigravity' && agent !== 'grok') {
            throw new Error('expected bootstrap target: claude, codex, opencode, commandcode, pi, devin, copilot, cursor, antigravity, or grok');
        }
        let outcome: BootstrapOutcome;
        if (agent === 'claude') {
            outcome = await runClaudeInstaller();
        } else if (agent === 'codex') {
            outcome = await installCodexBinary();
        } else if (agent === 'commandcode' || agent === 'pi') {
            outcome = await installNpmAgent(agent);
        } else {
            outcome = await runScriptInstaller(scriptInstallAgentConfigs[agent]);
        }
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
