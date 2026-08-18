import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AkariToolId, AkariToolInstallProgress, AkariToolInstallResult } from '../common/akari-new-project-protocol';
import { summarizeCommandInstallPhase } from '../common/tool-install-progress';
import { TOOL_UI } from '../common/tool-guidance';

/**
 * 道具のインストールエンジン（初回セットアップ v2・裁定 A / 進捗バー + 同梱ファースト
 * 裁定 = 正本 `planning/notes-2026-08-17-install-progress-and-bundled-tools.md`）。
 *
 * `tool-detection.ts` と同じ依存注入の流儀でテスト可能にする。取得元は**公式配布
 * チャネルのみ**（Homebrew / 各公式サイト / 公式 GitHub releases / Hugging Face 上の
 * whisper.cpp 公式配布）。URL はコードに定数で持ち、野良ミラーは使わない。実ネットワーク・
 * 実 brew はテストで叩かない（このモジュールを呼び出す側は必ず注入した偽実装でテストする）。
 */

export interface CommandResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

export interface RunCommandOptions {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    /** stdout/stderr の断片を逐次受け取る（進捗バーのフェーズ表示に使う）。 */
    onOutput?: (chunk: string) => void;
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
    /** 進捗バー（裁定 E1）。ダウンロードのバイト進捗・brew/winget のフェーズを逐次通知する。 */
    onProgress?: (progress: AkariToolInstallProgress) => void;
    /**
     * whisper モデルの検証に使う期待 sha256。既定は実配布物で確定した `WHISPER_MODEL_SHA256`。
     * テストが偽の小さいペイロードで検証成功/失敗の両方を決定論的に再現できるようにする
     * ためのフック（本番コードパスは常に既定値を使う）。
     */
    whisperModelSha256?: string;
}

const HOMEBREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const BREW_TIMEOUT_MS = 20 * 60 * 1000;

/** 認識モデルの既定ファイル名 + 版固定 sha256（実 DL で確定・2026-08-17）。 */
export const WHISPER_MODEL_FILENAME = 'ggml-large-v3-turbo-q5_0.bin';
export const WHISPER_MODEL_SHA256 = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2';

/** 取得元は公式配布チャネルのみ。URL は定数で持つ（野良ミラー禁止）。 */
export const OFFICIAL_SOURCES = {
    ytDlpMacBinary: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    ytDlpWindowsBinary: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    chromeDmg: 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg',
    chromeWindowsInstaller: 'https://dl.google.com/chrome/install/latest/chrome_installer.exe',
    voicevoxDownloadPage: 'https://voicevox.hiroshiba.jp/',
    blenderDownloadPage: 'https://www.blender.org/download/',
    /** ggerganov/whisper.cpp の Hugging Face 配布（MIT）。バージョンはコミット固定ではなく
     *  ファイル名固定 + sha256 検証で担保する（HF の `resolve/main` はブランチ追従だが、
     *  内容が変われば sha256 不一致で failed になり誤って古い検証をすり抜けない）。 */
    whisperModel: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
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
    onProgress?: (progress: AkariToolInstallProgress) => void;
    whisperModelSha256: string;
}

/** `~/.akari/tools/bin`（brew 不在時に DL 配置した道具の置き場）。`tool-detection.ts` の探索対象と一致させる。 */
export function akariToolsBinDir(homeDir: string): string {
    return join(homeDir, '.akari', 'tools', 'bin');
}

/** `tool-detection.ts` の同名ロジックと同じ場所（依存を増やさないためパス組み立てのみ複製）。 */
export function akariToolsModelsDir(homeDir: string): string {
    return join(homeDir, '.akari', 'tools', 'models');
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
        onProgress: options.onProgress,
        whisperModelSha256: options.whisperModelSha256 ?? WHISPER_MODEL_SHA256
    };
    const platform = options.platform ?? process.platform;

    // whisper は「本体」と「モデル」の 2 資産を持つ。モデルは brew/OS を問わず同じ経路
    // （公式配布から DL）なので、本体側の分岐より先に確認する — モデルさえ揃えば済む
    // ケース（本体は同梱/brew で既に揃っている）で余計な brew 呼び出しを起こさない。
    if (id === 'whisper' && !(await isWhisperModelPresent(ctx))) {
        return installWhisperModel(ctx);
    }

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
    const result = await ctx.runCommand(brewPath, args, {
        env: ctx.env, timeoutMs: BREW_TIMEOUT_MS, onOutput: chunk => reportCommandProgress(ctx, chunk)
    });
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
            return downloadAndOpenInstaller(ctx, OFFICIAL_SOURCES.chromeDmg, 'Chrome', 'dmg');
        case 'voicevox':
            return openOfficialDownloadPage(ctx, OFFICIAL_SOURCES.voicevoxDownloadPage, 'VOICEVOX');
        case 'blender':
            return openOfficialDownloadPage(ctx, OFFICIAL_SOURCES.blenderDownloadPage, 'Blender');
        case 'ffmpeg':
        case 'whisper':
            // 同梱検知（tool-detection.ts）で解決する前提のため、brew 不在時に brew を
            // 準備させる導線は持たない（「Homebrew 準備フロー」廃案・task.md §7）。
            // ここに来るのは同梱も brew も無い開発機の端ケースのみ。
            return bundledOnlyFallback(ctx);
        default:
            return { id: ctx.id, outcome: 'failed', message: `${toolName(ctx.id)} はこの環境では自動導入に対応していません。` };
    }
}

function bundledOnlyFallback(ctx: InstallContext): AkariToolInstallResult {
    return {
        id: ctx.id, outcome: 'failed',
        message: `${toolName(ctx.id)} はアプリに同梱されています。アプリを最新版に更新すると自動で使えるようになります。`
    };
}

async function installYtDlpBinary(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const destination = join(akariToolsBinDir(ctx.homeDir), 'yt-dlp');
    try {
        await ctx.ensureDir(akariToolsBinDir(ctx.homeDir));
        await downloadTo(ctx, OFFICIAL_SOURCES.ytDlpMacBinary, destination, reportDownloadProgress(ctx));
        await ctx.makeExecutable(destination);
        return { id: 'yt-dlp', outcome: 'installed', message: 'yt-dlp を導入しました。' };
    } catch (error) {
        return {
            id: 'yt-dlp', outcome: 'failed',
            message: `yt-dlp のダウンロードに失敗しました（${describeError(error)}）。もう一度お試しください。`
        };
    }
}

async function downloadAndOpenInstaller(
    ctx: InstallContext, url: string, label: string, extension: string
): Promise<AkariToolInstallResult> {
    const destination = join(ctx.homeDir, 'Downloads', `${label}-installer.${extension}`);
    try {
        await ctx.ensureDir(join(ctx.homeDir, 'Downloads'));
        await downloadTo(ctx, url, destination, reportDownloadProgress(ctx));
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

async function installOnWindows(ctx: InstallContext): Promise<AkariToolInstallResult> {
    // yt-dlp / Chrome は公式配布の直 DL を第一経路にする（winget が無い/塞がれている
    // 環境があるため）。それ以外は現行どおり winget（task.md §6）。
    if (ctx.id === 'yt-dlp') {
        return installYtDlpWindowsBinary(ctx);
    }
    if (ctx.id === 'chrome') {
        return downloadAndOpenWindowsChromeInstaller(ctx);
    }
    return installWithWinget(ctx);
}

async function installYtDlpWindowsBinary(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const destination = join(akariToolsBinDir(ctx.homeDir), 'yt-dlp.exe');
    try {
        await ctx.ensureDir(akariToolsBinDir(ctx.homeDir));
        await downloadTo(ctx, OFFICIAL_SOURCES.ytDlpWindowsBinary, destination, reportDownloadProgress(ctx));
        return { id: 'yt-dlp', outcome: 'installed', message: 'yt-dlp を導入しました。' };
    } catch {
        // 公式 GitHub releases への到達性が無い環境向けのフォールバック。
        return installWithWinget(ctx);
    }
}

async function downloadAndOpenWindowsChromeInstaller(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const destination = join(ctx.homeDir, 'Downloads', 'Chrome-installer.exe');
    try {
        await ctx.ensureDir(join(ctx.homeDir, 'Downloads'));
        await downloadTo(ctx, OFFICIAL_SOURCES.chromeWindowsInstaller, destination, reportDownloadProgress(ctx));
        await ctx.openPath(destination);
        return {
            id: 'chrome', outcome: 'external-installer-opened',
            message: 'Chrome の公式インストーラーを開きました。画面の案内に沿って導入し、完了したら再チェックしてください。'
        };
    } catch {
        return installWithWinget(ctx);
    }
}

async function installWithWinget(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const wingetId = WINGET_ID[ctx.id];
    if (!wingetId) {
        return { id: ctx.id, outcome: 'failed', message: `${toolName(ctx.id)} はこの環境では自動導入に対応していません。` };
    }
    const result = await ctx.runCommand(
        'winget',
        ['install', '--id', wingetId, '-e', '--accept-source-agreements', '--accept-package-agreements'],
        { env: ctx.env, timeoutMs: BREW_TIMEOUT_MS, onOutput: chunk => reportCommandProgress(ctx, chunk) }
    );
    if (result.ok) {
        return { id: ctx.id, outcome: 'installed', message: `${toolName(ctx.id)} を導入しました。` };
    }
    return {
        id: ctx.id, outcome: 'failed',
        message: `${toolName(ctx.id)} の導入に失敗しました。時間をおいて、もう一度お試しください。`
    };
}

// --- Whisper 認識モデル（裁定 E2 の本命 — アプリ管理の取得を新設） -----------------

async function isWhisperModelPresent(ctx: InstallContext): Promise<boolean> {
    const override = ctx.env.AKARI_WHISPER_MODEL;
    if (override && await ctx.pathExists(override)) {
        return true;
    }
    return ctx.pathExists(join(akariToolsModelsDir(ctx.homeDir), WHISPER_MODEL_FILENAME));
}

/** 版固定 URL + sha256 で DL する。検証失敗時はファイルを一切書かず failed を返す。 */
async function installWhisperModel(ctx: InstallContext): Promise<AkariToolInstallResult> {
    const destination = join(akariToolsModelsDir(ctx.homeDir), WHISPER_MODEL_FILENAME);
    try {
        const buffer = await fetchBuffer(ctx, OFFICIAL_SOURCES.whisperModel, reportDownloadProgress(ctx));
        const digest = createHash('sha256').update(buffer).digest('hex');
        if (digest !== ctx.whisperModelSha256) {
            return {
                id: 'whisper', outcome: 'failed',
                message: '認識モデルの検証に失敗しました（データが壊れている可能性があります）。もう一度お試しください。'
            };
        }
        await ctx.ensureDir(akariToolsModelsDir(ctx.homeDir));
        await ctx.writeFile(destination, buffer);
        return { id: 'whisper', outcome: 'installed', message: '認識モデルを取得しました。' };
    } catch (error) {
        return {
            id: 'whisper', outcome: 'failed',
            message: `認識モデルの取得に失敗しました（${describeError(error)}）。もう一度お試しください。`
        };
    }
}

// --- ダウンロード（進捗ストリーミング対応） -----------------------------------------

function reportDownloadProgress(ctx: InstallContext): (downloadedBytes: number, totalBytes?: number) => void {
    return (downloadedBytes, totalBytes) => {
        ctx.onProgress?.({ toolId: ctx.id, kind: 'download', phase: 'ダウンロードしています…', downloadedBytes, totalBytes });
    };
}

function reportCommandProgress(ctx: InstallContext, outputChunk: string): void {
    ctx.onProgress?.({ toolId: ctx.id, kind: 'command', phase: summarizeCommandInstallPhase(outputChunk) });
}

async function downloadTo(
    ctx: InstallContext,
    url: string,
    destinationPath: string,
    onDownloadProgress?: (downloadedBytes: number, totalBytes?: number) => void
): Promise<void> {
    const buffer = await fetchBuffer(ctx, url, onDownloadProgress);
    await ctx.writeFile(destinationPath, buffer);
}

/**
 * fetch ストリーミングでバイト進捗を逐次通知しながら全体を読み切る。`response.body` が
 * 無い（テストの簡易 fetch 実装等）場合は `arrayBuffer()` へフォールバックする。
 */
async function fetchBuffer(
    ctx: InstallContext,
    url: string,
    onDownloadProgress?: (downloadedBytes: number, totalBytes?: number) => void
): Promise<Buffer> {
    const response = await ctx.fetchImpl(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const totalBytes = parseContentLength(response.headers);
    const reader = response.body?.getReader?.();
    if (!reader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        onDownloadProgress?.(buffer.length, totalBytes);
        return buffer;
    }
    const chunks: Buffer[] = [];
    let downloaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (value) {
            const chunk = Buffer.from(value);
            chunks.push(chunk);
            downloaded += chunk.length;
            onDownloadProgress?.(downloaded, totalBytes);
        }
    }
    return Buffer.concat(chunks);
}

function parseContentLength(headers: unknown): number | undefined {
    const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
    if (typeof get !== 'function') {
        return undefined;
    }
    const raw = get.call(headers, 'content-length');
    const value = raw ? Number(raw) : undefined;
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function toolName(id: AkariToolId): string {
    return TOOL_UI[id].name;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * `execFile` ではなく `spawn` を使い、stdout/stderr を逐次 `onOutput` へ流す
 * （brew / winget の進捗フェーズ表示に使う）。完了時の `ok`/`stdout`/`stderr` の
 * 意味は従来の execFile 版と同じ。
 */
export async function defaultRunCommand(
    command: string,
    args: string[],
    options: RunCommandOptions = {}
): Promise<CommandResult> {
    return new Promise(resolve => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result: CommandResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(command, args, { env: options.env ?? process.env });
        } catch {
            resolve({ ok: false, stdout: '', stderr: '' });
            return;
        }
        const timer = setTimeout(() => {
            child.kill();
            finish({ ok: false, stdout, stderr: stderr || 'timeout' });
        }, options.timeoutMs ?? 5000);
        child.stdout?.on('data', chunk => {
            const text = chunk.toString();
            stdout += text;
            options.onOutput?.(text);
        });
        child.stderr?.on('data', chunk => {
            const text = chunk.toString();
            stderr += text;
            options.onOutput?.(text);
        });
        child.on('error', () => finish({ ok: false, stdout, stderr }));
        child.on('close', code => finish({ ok: code === 0, stdout, stderr }));
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
