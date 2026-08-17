import { execFile } from 'child_process';
import { constants as fsConstants, promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
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
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    now?: () => Date;
    runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>;
    pathExists?: (path: string) => Promise<boolean>;
}

interface ExecutableSpec {
    id: Exclude<AkariToolId, 'voicevox' | 'xcode-clt'>;
    tier: AkariToolTier;
    envNames: string[];
    commands: (platform: NodeJS.Platform) => string[];
    paths: (platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv) => string[];
    versionArgs: string[];
}

const NO_PATHS = (): string[] => [];
const command = (...names: string[]) => (): string[] => names;

const EXECUTABLE_SPECS: ExecutableSpec[] = [
    {
        id: 'ffmpeg', tier: 'required', envNames: ['AKARI_FFMPEG_BIN'], commands: command('ffmpeg'),
        paths: NO_PATHS, versionArgs: ['-version']
    },
    {
        id: 'whisper', tier: 'required', envNames: ['AKARI_WHISPER_BIN'], commands: command('whisper-cli'),
        paths: NO_PATHS, versionArgs: ['--help']
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
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? homedir();
    const runCommand = options.runCommand ?? defaultRunCommand;
    const pathExists = options.pathExists ?? defaultPathExists;

    const tools: AkariToolCheckResult[] = [];
    for (const spec of EXECUTABLE_SPECS) {
        tools.push(await detectExecutable(spec, platform, homeDir, env, runCommand));
    }
    // VOICEVOX の run は起動すると常駐エンジンになるため、存在確認だけに留める。
    tools.splice(4, 0, await detectVoicevox(platform, homeDir, env, pathExists));
    if (platform === 'darwin') {
        tools.push(await detectCommandLineTools(env, runCommand));
    }
    return {
        platform,
        checkedAt: (options.now ?? (() => new Date()))().toISOString(),
        tools
    };
}

async function detectExecutable(
    spec: ExecutableSpec,
    platform: NodeJS.Platform,
    homeDir: string,
    env: NodeJS.ProcessEnv,
    runCommand: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CommandResult>
): Promise<AkariToolCheckResult> {
    // 初回セットアップ v2 のインストールエンジン（tool-install.ts）が brew 不在時に
    // DL 配置する置き場。導入直後の再チェックで検出できるよう、全道具の探索候補へ
    // 一律で足す（実在しない候補は単に見つからないだけで無害）。
    const primaryCommand = spec.commands(platform)[0];
    const candidates = unique([
        ...spec.envNames.map(name => env[name]),
        ...spec.commands(platform),
        ...spec.paths(platform, homeDir, env),
        primaryCommand ? akariToolsBinPath(homeDir, primaryCommand) : undefined
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

async function defaultPathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
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
