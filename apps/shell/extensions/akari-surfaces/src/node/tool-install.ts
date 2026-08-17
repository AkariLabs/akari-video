import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AkariToolId, AkariToolInstallResult } from '../common/akari-new-project-protocol';
import { TOOL_UI } from '../common/tool-guidance';

/**
 * 道具のインストールエンジン（初回セットアップ v2・裁定 A / 正本
 * `planning/notes-2026-08-17-firstrun-v2-and-launcher.md` §3.1）。
 *
 * `tool-detection.ts` と同じ依存注入の流儀でテスト可能にする。取得元は**公式配布
 * チャネルのみ**（Homebrew / 各公式サイト / 公式 GitHub releases）。URL はコードに
 * 定数で持ち、野良ミラーは使わない。実ネットワーク・実 brew はテストで叩かない
 * （このモジュールを呼び出す側は必ず注入した偽実装でテストする）。
 */

export interface CommandResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

export interface RunCommandOptions {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}

export type RunCommandFn = (command: string, args: string[], options?: RunCommandOptions) => Promise<CommandResult>;

export interface ToolInstallOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    runCommand?: RunCommandFn;
    pathExists?: (path: string) => Promise<boolean>;
    fetchImpl?: typeof fetch;
    writeFile?: (path: string, data: Buffer) => Promise<void>;
    ensureDir?: (path: string) => Promise<void>;
    makeExecutable?: (path: string) => Promise<void>;
    openPath?: (path: string) => Promise<void>;
    /**
     * brew 不在で FFmpeg / Whisper が選ばれたときに使う Homebrew 準備フック
     * （「無料の道具管理ソフト（Homebrew）を先に準備します」という平易な説明とともに
     * 内蔵ターミナルで公式インストールスクリプトを自動実行し、ユーザーが打つのは
     * Mac のパスワードのみにする — 正本 §3.1）。
     *
     * この `tool-install.ts` は Node バックエンド側の純ロジックで、Theia の内蔵
     * ターミナル widget を直接開く手段を持たない。そのため既定では未配線
     * （`undefined`）とし、未配線のときは `failed` + 「何が起きて次に何を押せば
     * よいか」が分かる 1 行を返す（行き止まりにはしない）。フロント側／拡張間連携で
     * 配線できるようになった時点でこのフックへ実装を渡せる。**契約逸脱**（report.md
     * 参照）: 正本は「内蔵ターミナルで自動実行」を要求しているが、本タスクの所有
     * ファイル境界（browser 側のこのダイアログ・common・node 側の tool-install のみ）
     * からは Theia の TerminalService（別拡張・別レイヤ）を安全に配線できないため、
     * 未配線フォールバックのまま実装している。
     */
    runHomebrewPrepInEmbeddedTerminal?: (env: NodeJS.ProcessEnv) => Promise<{ ok: boolean }>;
}

const HOMEBREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const BREW_TIMEOUT_MS = 20 * 60 * 1000;

/** 取得元は公式配布チャネルのみ。URL は定数で持つ（野良ミラー禁止）。 */
export const OFFICIAL_SOURCES = {
    homebrewInstallScript: 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh',
    ytDlpMacBinary: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    chromeDmg: 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg',
    voicevoxDownloadPage: 'https://voicevox.hiroshiba.jp/',
    blenderDownloadPage: 'https://www.blender.org/download/'
} as const;

const BREW_FORMULA: Partial<Record<AkariToolId, string>> = {
    ffmpeg: 'ffmpeg',
    whisper: 'whisper-cpp',
    'yt-dlp': 'yt-dlp'
};

const BREW_CASK: Partial<Record<AkariToolId, string>> = {
    chrome: 'google-chrome',
    voicevox: 'voicevox',
    blender: 'blender'
};

const WINGET_ID: Partial<Record<AkariToolId, string>> = {
    ffmpeg: 'Gyan.FFmpeg',
    'yt-dlp': 'yt-dlp.yt-dlp',
    chrome: 'Google.Chrome',
    blender: 'BlenderFoundation.Blender'
};

interface InstallContext {
    id: AkariToolId;
    env: NodeJS.ProcessEnv;
    homeDir: string;
    runCommand: RunCommandFn;
    pathExists: (path: string) => Promise<boolean>;
    fetchImpl: typeof fetch;
    writeFile: (path: string, data: Buffer) => Promise<void>;
    ensureDir: (path: string) => Promise<void>;
    makeExecutable: (path: string) => Promise<void>;
    openPath: (path: string) => Promise<void>;
    runHomebrewPrepInEmbeddedTerminal?: (env: NodeJS.ProcessEnv) => Promise<{ ok: boolean }>;
}

/** `~/.akari/tools/bin`（brew 不在時に DL 配置した道具の置き場）。`tool-detection.ts` の探索対象と一致させる。 */
export function akariToolsBinDir(homeDir: string): string {
    return join(homeDir, '.akari', 'tools', 'bin');
}

export async function installTool(id: AkariToolId, options: ToolInstallOptions = {}): Promise<AkariToolInstallResult> {
    const ctx: InstallContext = {
        id,
        env: options.env ?? process.env,
        homeDir: options.homeDir ?? homedir(),
        runCommand: options.runCommand ?? defaultRunCommand,
        pathExists: options.pathExists ?? defaultPathExists,
        fetchImpl: options.fetchImpl ?? fetch,
        writeFile: options.writeFile ?? (async (path, data) => { await fs.writeFile(path, data); }),
        ensureDir: options.ensureDir ?? (async path => { await fs.mkdir(path, { recursive: true }); }),
        makeExecutable: options.makeExecutable ?? (async path => { await fs.chmod(path, 0o755); }),
        openPath: options.openPath ?? defaultOpenPath,
        runHomebrewPrepInEmbeddedTerminal: options.runHomebrewPrepInEmbeddedTerminal
    };
    const platform = options.platform ?? process.platform;

    if (platform === 'darwin') {
        return installOnMac(ctx);
    }
    if (platform === 'win32') {
        return installOnWindows(ctx);
    }
    return { id, outcome: 'failed', message: `${toolName(id)} はこの環境では自動導入に対応していません。` };
}

async function installOnMac(ctx: InstallContext): Promise<AkariToolInstallResult> {
    if (ctx.id === 'xcode-clt') {
        return installXcodeClt(ctx);
    }
    const brew = await findBrew(ctx);
    if (brew) {
        return installWithBrew(ctx, brew);
    }
    return installWithoutBrew(ctx);
}

async function installXcodeClt(ctx: InstallContext): Promise<AkariToolInstallResult> {
    await ctx.runCommand('xcode-select', ['--install'], { env: ctx.env });
    // 非0終了（導入済み等）でも Apple の GUI インストーラーは開こうとする。行き止まりに
    // しないため、常に次の一手（再チェック）が分かる 1 行を返す。
    return {
        id: 'xcode-clt', outcome: 'external-installer-opened',
        message: 'Apple のインストーラーが開きました。完了したら再チェックしてください。'
    };
}

async function findBrew(ctx: InstallContext): Promise<string | undefined> {
    const onPath = await ctx.runCommand('brew', ['--version'], { env: ctx.env });
    if (onPath.ok) {
        return 'brew';
    }
    for (const candidate of HOMEBREW_PATHS) {
        if (await ctx.pathExists(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

async function installWithBrew(ctx: InstallContext, brewPath: string): Promise<AkariToolInstallResult> {
    const formula = BREW_FORMULA[ctx.id];
    const cask = BREW_CASK[ctx.id];
    if (!formula && !cask) {
        return { id: ctx.id, outcome: 'failed', message: `${toolName(ctx.id)} はこの環境では自動導入に対応していません。` };
    }
    const args = formula ? ['install', formula] : ['install', '--cask', cask as string];
    const result = await ctx.runCommand(brewPath, args, { env: ctx.env, timeoutMs: BREW_TIMEOUT_MS });
    if (result.ok) {
        return { id: ctx.id, outcome: 'installed', message: `${toolName(ctx.id)} を導入しました。` };
    }
    return {
        id: ctx.id, outcome: 'failed',
        message: `${toolName(ctx.id)} の導入に失敗しました。時間をおいて、もう一度お試しください。`
    };
}

async function installWithoutBrew(ctx: InstallContext): Promise<AkariToolInstallResult> {
    switch (ctx.id) {
        case 'yt-dlp':
            return installYtDlpBinary(ctx);
        case 'chrome':
            return downloadAndOpenInstaller(ctx, OFFICIAL_SOURCES.chromeDmg, 'Chrome');
        case 'voicevox':
            return openOfficialDownloadPage(ctx, OFFICIAL_SOURCES.voicevoxDownloadPage, 'VOICEVOX');
        case 'blender':
            return openOfficialDownloadPage(ctx, OFFICIAL_SOURCES.blenderDownloadPage, 'Blender');
        case 'ffmpeg':
        case 'whisper':
            return prepareHomebrewThenInstall(ctx);
        default:
            return { id: ctx.id, outcome: 'failed', message: `${toolName(ctx.id)} はこの環境では自動導入に対応していません。` };
    }
}

async function installYtDlpBinary(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const destination = join(akariToolsBinDir(ctx.homeDir), 'yt-dlp');
    try {
        await ctx.ensureDir(akariToolsBinDir(ctx.homeDir));
        await downloadTo(ctx, OFFICIAL_SOURCES.ytDlpMacBinary, destination);
        await ctx.makeExecutable(destination);
        return { id: 'yt-dlp', outcome: 'installed', message: 'yt-dlp を導入しました。' };
    } catch (error) {
        return {
            id: 'yt-dlp', outcome: 'failed',
            message: `yt-dlp のダウンロードに失敗しました（${describeError(error)}）。もう一度お試しください。`
        };
    }
}

async function downloadAndOpenInstaller(ctx: InstallContext, url: string, label: string): Promise<AkariToolInstallResult> {
    const destination = join(ctx.homeDir, 'Downloads', `${label}-installer.dmg`);
    try {
        await ctx.ensureDir(join(ctx.homeDir, 'Downloads'));
        await downloadTo(ctx, url, destination);
        await ctx.openPath(destination);
        return {
            id: ctx.id, outcome: 'external-installer-opened',
            message: `${label} の公式インストーラーを開きました。画面の案内に沿って導入し、完了したら再チェックしてください。`
        };
    } catch (error) {
        return {
            id: ctx.id, outcome: 'failed',
            message: `${label} のダウンロードに失敗しました（${describeError(error)}）。もう一度お試しください。`
        };
    }
}

/**
 * VOICEVOX / Blender は配布パッケージがバージョンごとにファイル名が変わり、brew
 * 不在時に安定した直リンクを定数として確定できない（実ネットワークで検証すること
 * 自体が本タスクの制約で禁止されている）。そのため brew 不在時は公式サイトを開いて
 * 導線を渡す（**契約逸脱**: 正本は「公式 dmg を DL して自動で開く」を期待している。
 * report.md に記録）。
 */
async function openOfficialDownloadPage(ctx: InstallContext, url: string, label: string): Promise<AkariToolInstallResult> {
    try {
        await ctx.openPath(url);
        return {
            id: ctx.id, outcome: 'external-installer-opened',
            message: `${label} の公式サイトを開きました。ダウンロードしたインストーラーを実行し、完了したら再チェックしてください。`
        };
    } catch (error) {
        return {
            id: ctx.id, outcome: 'failed',
            message: `${label} の公式サイトを開けませんでした（${describeError(error)}）。もう一度お試しください。`
        };
    }
}

async function prepareHomebrewThenInstall(ctx: InstallContext): Promise<AkariToolInstallResult> {
    if (!ctx.runHomebrewPrepInEmbeddedTerminal) {
        return {
            id: ctx.id, outcome: 'failed',
            message: `${toolName(ctx.id)} の自動導入をこの環境では完了できませんでした。少し時間をおいてから、もう一度「選んだ道具をインストール」を押してください。`
        };
    }
    const prep = await ctx.runHomebrewPrepInEmbeddedTerminal(ctx.env);
    if (!prep.ok) {
        return {
            id: ctx.id, outcome: 'failed',
            message: '無料の道具管理ソフト（Homebrew）の準備に失敗しました。もう一度お試しください。'
        };
    }
    const brew = await findBrew(ctx);
    if (!brew) {
        return {
            id: ctx.id, outcome: 'failed',
            message: 'Homebrew の準備は完了しましたが、見つけられませんでした。再チェックしてください。'
        };
    }
    return installWithBrew(ctx, brew);
}

async function installOnWindows(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const wingetId = WINGET_ID[ctx.id];
    if (!wingetId) {
        return { id: ctx.id, outcome: 'failed', message: `${toolName(ctx.id)} はこの環境では自動導入に対応していません。` };
    }
    const result = await ctx.runCommand(
        'winget',
        ['install', '--id', wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements'],
        { env: ctx.env, timeoutMs: BREW_TIMEOUT_MS }
    );
    if (result.ok) {
        return { id: ctx.id, outcome: 'installed', message: `${toolName(ctx.id)} を導入しました。` };
    }
    return {
        id: ctx.id, outcome: 'failed',
        message: `${toolName(ctx.id)} の導入に失敗しました。時間をおいて、もう一度お試しください。`
    };
}

async function downloadTo(ctx: InstallContext, url: string, destinationPath: string): Promise<void> {
    const response = await ctx.fetchImpl(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await ctx.writeFile(destinationPath, buffer);
}

function toolName(id: AkariToolId): string {
    return TOOL_UI[id].name;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function defaultRunCommand(
    command: string,
    args: string[],
    options: RunCommandOptions = {}
): Promise<CommandResult> {
    return new Promise(resolve => {
        execFile(command, args, {
            env: options.env ?? process.env,
            timeout: options.timeoutMs ?? 5000,
            maxBuffer: 4 * 1024 * 1024
        }, (error, stdout, stderr) => {
            resolve({ ok: !error, stdout, stderr });
        });
    });
}

async function defaultPathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

async function defaultOpenPath(path: string): Promise<void> {
    const result = await defaultRunCommand('open', [path]);
    if (!result.ok) {
        throw new Error(result.stderr.trim() || 'open コマンドに失敗しました。');
    }
}
