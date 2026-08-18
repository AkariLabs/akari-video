import { execFile } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type {
    AkariToolCheckResponse,
    AkariToolCheckResult,
    AkariToolId,
    AkariToolTier
} from '../common/akari-new-project-protocol';

export interface CommandResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

export interface ToolDetectionOptions {
    platform?: NodeJS.Platform;
    arch?: string;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    now?: () => Date;
    runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>;
    pathExists?: (path: string) => Promise<boolean>;
    listDir?: (path: string) => Promise<string[]>;
    /** Electron パッケージ実行時の `process.resourcesPath`。既定は実プロセスの値。 */
    resourcesPath?: string;
    /**
     * 開発時の同梱バイナリ（`packages/media-bin/vendor/<target>/`）を上方探索する起点。
     * 既定は `__dirname` と `process.cwd()` の両方（`akari-new-project-service.ts` の
     * `findUpwardFile` と同じ流儀）。テストではここへ scratch ディレクトリを注入する。
     */
    devSearchRoots?: string[];
}

interface ExecutableSpec {
    id: Exclude<AkariToolId, 'voicevox' | 'xcode-clt'>;
    tier: AkariToolTier;
    envNames: string[];
    commands: (platform: NodeJS.Platform) => string[];
    paths: (platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv) => string[];
    versionArgs: string[];
    /**
     * アプリ同梱バイナリのファイル名（拡張子なし）。ffmpeg / whisper-cli のみ持つ
     * （`packages/media-bin` が供給する 2 種）。win は呼び出し側で `.exe` を足す。
     */
    bundledExeName?: string;
}

const NO_PATHS = (): string[] => [];
const command = (...names: string[]) => (): string[] => names;

const EXECUTABLE_SPECS: ExecutableSpec[] = [
    {
        id: 'ffmpeg', tier: 'required', envNames: ['AKARI_FFMPEG_BIN'], commands: command('ffmpeg'),
        paths: NO_PATHS, versionArgs: ['-version'], bundledExeName: 'ffmpeg'
    },
    {
        id: 'whisper', tier: 'required', envNames: ['AKARI_WHISPER_BIN'], commands: command('whisper-cli'),
        paths: NO_PATHS, versionArgs: ['--help'], bundledExeName: 'whisper-cli'
    },
    {
        id: 'chrome', tier: 'required',
        envNames: ['AKARI_CHROME_BIN', 'AKARI_CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH'],
        commands: platform => platform === 'win32'
            ? ['chrome', 'msedge']
            : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'],
        paths: chromePaths, versionArgs: ['--version']
    },
    {
        id: 'yt-dlp', tier: 'advanced', envNames: ['AKARI_YTDLP_BIN'], commands: command('yt-dlp'),
        paths: NO_PATHS, versionArgs: ['--version']
    },
    {
        id: 'blender', tier: 'advanced', envNames: ['AKARI_BLENDER_BIN'], commands: command('blender'),
        paths: blenderPaths, versionArgs: ['--version']
    }
];

const DEV_VENDOR_UPWARD_MAX_DEPTH = 12;
const WHISPER_MODEL_FILENAME_PATTERN = /^ggml-.*\.bin$/;

export async function defaultRunCommand(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
): Promise<CommandResult> {
    return new Promise(resolve => {
        execFile(command, args, { env, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                ok: !error,
                stdout,
                stderr
            });
        });
    });
}

export async function detectTools(options: ToolDetectionOptions = {}): Promise<AkariToolCheckResponse> {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? homedir();
    const runCommand = options.runCommand ?? defaultRunCommand;
    const pathExists = options.pathExists ?? defaultPathExists;
    const listDir = options.listDir ?? defaultListDir;
    const resourcesPath = options.resourcesPath ?? electronResourcesPath();
    const devSearchRoots = options.devSearchRoots ?? [__dirname, process.cwd()];

    const tools: AkariToolCheckResult[] = [];
    for (const spec of EXECUTABLE_SPECS) {
        tools.push(await detectExecutable(spec, platform, arch, homeDir, env, runCommand, pathExists, resourcesPath, devSearchRoots));
    }
    // VOICEVOX の run は起動すると常駐エンジンになるため、存在確認だけに留める。
    tools.splice(4, 0, await detectVoicevox(platform, homeDir, env, pathExists));
    if (platform === 'darwin') {
        tools.push(await detectCommandLineTools(env, runCommand));
    }
    await attachWhisperModelState(tools, env, homeDir, pathExists, listDir);
    return {
        platform,
        checkedAt: (options.now ?? (() => new Date()))().toISOString(),
        tools
    };
}

async function detectExecutable(
    spec: ExecutableSpec,
    platform: NodeJS.Platform,
    arch: string,
    homeDir: string,
    env: NodeJS.ProcessEnv,
    runCommand: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>,
    pathExists: (path: string) => Promise<boolean>,
    resourcesPath: string | undefined,
    devSearchRoots: string[]
): Promise<AkariToolCheckResult> {
    // 初回セットアップ v2 のインストールエンジン（tool-install.ts）が brew 不在時に
    // DL 配置する置き場。導入直後の再チェックで検出できるよう、全道具の探索候補へ
    // 一律で足す（実在しない候補は単に見つからないだけで無害）。
    const primaryCommand = spec.commands(platform)[0];
    const bundledCandidates = spec.bundledExeName
        ? await resolveBundledMediaBinCandidates(spec.bundledExeName, platform, arch, resourcesPath, devSearchRoots, pathExists)
        : [];
    const candidates = unique([
        ...spec.envNames.map(name => env[name]),
        // 優先順: env override → 同梱（パッケージ / 開発 vendor） → PATH → その他パス → ~/.akari/tools/bin
        ...bundledCandidates,
        ...spec.commands(platform),
        ...spec.paths(platform, homeDir, env),
        primaryCommand ? akariToolsBinPath(homeDir, exeNameForPlatform(primaryCommand, platform)) : undefined
    ].filter((value): value is string => Boolean(value)));
    for (const candidate of candidates) {
        const result = await runCommand(candidate, spec.versionArgs, env);
        if (result.ok) {
            return {
                id: spec.id,
                tier: spec.tier,
                available: true,
                executable: candidate,
                version: firstLine(result.stdout || result.stderr)
            };
        }
    }
    return { id: spec.id, tier: spec.tier, available: false };
}

/**
 * ffmpeg / whisper-cli の同梱バイナリ候補。パッケージ版は `process.resourcesPath` 配下の
 * `media-bin/`（`akari-project-service.ts` の `bundledMediaBinPath()` と同じ規約）、
 * 開発時はリポ内 `packages/media-bin/vendor/<platform>-<arch>/` を上方探索する
 * （`media-bin` パッケージ自体は import しない — 薄いパス規約ミラーの流儀）。
 */
async function resolveBundledMediaBinCandidates(
    exeName: string,
    platform: NodeJS.Platform,
    arch: string,
    resourcesPath: string | undefined,
    devSearchRoots: string[],
    pathExists: (path: string) => Promise<boolean>
): Promise<string[]> {
    const fileName = exeNameForPlatform(exeName, platform);
    const candidates: string[] = [];
    if (resourcesPath) {
        candidates.push(join(resourcesPath, 'media-bin', fileName));
    }
    const devPath = await findDevVendorMediaBinPath(fileName, platform, arch, devSearchRoots, pathExists);
    if (devPath) {
        candidates.push(devPath);
    }
    return candidates;
}

async function findDevVendorMediaBinPath(
    fileName: string,
    platform: NodeJS.Platform,
    arch: string,
    searchRoots: string[],
    pathExists: (path: string) => Promise<boolean>
): Promise<string | undefined> {
    const target = `${platform}-${arch}`;
    for (const start of searchRoots) {
        let dir = start;
        for (let depth = 0; depth < DEV_VENDOR_UPWARD_MAX_DEPTH; depth++) {
            const candidate = join(dir, 'packages', 'media-bin', 'vendor', target, fileName);
            if (await pathExists(candidate)) {
                return candidate;
            }
            const parent = dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }
    return undefined;
}

async function detectVoicevox(
    platform: NodeJS.Platform,
    homeDir: string,
    env: NodeJS.ProcessEnv,
    pathExists: (path: string) => Promise<boolean>
): Promise<AkariToolCheckResult> {
    const candidates = unique([
        env.VOICEVOX_RUN,
        ...voicevoxPaths(platform, homeDir, env)
    ].filter((value): value is string => Boolean(value)));
    for (const candidate of candidates) {
        if (await pathExists(candidate)) {
            return { id: 'voicevox', tier: 'advanced', available: true, executable: candidate };
        }
    }
    return { id: 'voicevox', tier: 'advanced', available: false };
}

async function detectCommandLineTools(
    env: NodeJS.ProcessEnv,
    runCommand: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>
): Promise<AkariToolCheckResult> {
    // `/usr/bin/git` は未導入 Mac でインストールダイアログを出す shim のため、絶対に呼ばない。
    const result = await runCommand('xcode-select', ['-p'], env);
    return result.ok
        ? { id: 'xcode-clt', tier: 'recommended', available: true, executable: result.stdout.trim() || 'xcode-select' }
        : { id: 'xcode-clt', tier: 'recommended', available: false };
}

/**
 * whisper 行へモデル状態（`model.available` / `model.path`）を載せ、モデル未取得なら
 * 行全体の `available` も false に倒す（本体はあってもモデルが無いと文字起こしできない
 * ため、UI のチェックボックス選択対象に自然に入る — 裁定は task.md §3・受け入れ条件）。
 */
async function attachWhisperModelState(
    tools: AkariToolCheckResult[],
    env: NodeJS.ProcessEnv,
    homeDir: string,
    pathExists: (path: string) => Promise<boolean>,
    listDir: (path: string) => Promise<string[]>
): Promise<void> {
    const index = tools.findIndex(entry => entry.id === 'whisper');
    if (index === -1) {
        return;
    }
    const modelPath = await findWhisperModelPath(env, homeDir, pathExists, listDir);
    const modelAvailable = modelPath !== undefined;
    const whisper = tools[index];
    tools[index] = {
        ...whisper,
        available: whisper.available && modelAvailable,
        model: { available: modelAvailable, path: modelPath }
    };
}

/** `tool-install.ts` の同名ロジックと同じ場所（依存を増やさないためパス組み立てのみ複製）。 */
export function akariToolsModelsDir(homeDir: string): string {
    return join(homeDir, '.akari', 'tools', 'models');
}

async function findWhisperModelPath(
    env: NodeJS.ProcessEnv,
    homeDir: string,
    pathExists: (path: string) => Promise<boolean>,
    listDir: (path: string) => Promise<string[]>
): Promise<string | undefined> {
    const override = env.AKARI_WHISPER_MODEL;
    if (override && await pathExists(override)) {
        return override;
    }
    const dir = akariToolsModelsDir(homeDir);
    const entries = await listDir(dir);
    const match = entries.find(name => WHISPER_MODEL_FILENAME_PATTERN.test(name));
    return match ? join(dir, match) : undefined;
}

async function defaultPathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function defaultListDir(path: string): Promise<string[]> {
    try {
        return await fs.readdir(path);
    } catch {
        return [];
    }
}

function electronResourcesPath(): string | undefined {
    return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function chromePaths(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string[] {
    if (platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
        ];
    }
    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA ?? join(homeDir, 'AppData', 'Local');
        return [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ];
    }
    return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
}

function blenderPaths(platform: NodeJS.Platform): string[] {
    if (platform === 'darwin') {
        return ['/Applications/Blender.app/Contents/MacOS/Blender'];
    }
    return [];
}

/** `tool-install.ts` の `akariToolsBinDir()` と同じ場所（依存を増やさないためパス組み立てのみ複製）。 */
function akariToolsBinPath(homeDir: string, commandName: string): string {
    return join(homeDir, '.akari', 'tools', 'bin', commandName);
}

/** win32 の絶対パス候補（`.akari/tools/bin` 等）は拡張子が無いと解決されないため、`.exe` を補う。 */
function exeNameForPlatform(name: string, platform: NodeJS.Platform): string {
    if (platform !== 'win32' || name.toLowerCase().endsWith('.exe')) {
        return name;
    }
    return `${name}.exe`;
}

function voicevoxPaths(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string[] {
    if (platform === 'darwin') {
        return ['/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run'];
    }
    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA ?? join(homeDir, 'AppData', 'Local');
        return [join(localAppData, 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe')];
    }
    return [];
}

function firstLine(output: string): string | undefined {
    const value = output.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    return value ? value.slice(0, 180) : undefined;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}
