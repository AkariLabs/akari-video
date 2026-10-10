import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import catalog = require('../common/connectors.json');
import { ConnectSnapshot, Connector, ConnectorRow, ConnectStatus } from '../common/connect-protocol';
import { credentialsFilePath, maskedTail, readCredentials, writeCredential } from 'akari-surfaces/lib/common/credentials-file';

export interface ConnectSettings { version: 1; enabled: Record<string, boolean>; generationOrder: string[]; fallbackOnFailure: boolean; }
export const DEFAULT_SETTINGS: ConnectSettings = { version: 1, enabled: {}, generationOrder: [], fallbackOnFailure: false };
const entries = catalog as Connector[];
const generationIds = entries.filter(entry => entry.group === '素材を作る').map(entry => entry.id);

export function connectorsPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
    return path.join(env.AKARI_HOME || path.join(home, '.akari'), 'connectors.json');
}

export function readSettings(file: string): ConnectSettings {
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ConnectSettings>;
        const enabled: Record<string, boolean> = {};
        if (data.enabled && typeof data.enabled === 'object') for (const [id, value] of Object.entries(data.enabled)) {
            if (entries.some(entry => entry.id === id) && typeof value === 'boolean') enabled[id] = value;
        }
        const order = Array.isArray(data.generationOrder) ? data.generationOrder.filter(id => generationIds.includes(id)) : [];
        return { version: 1, enabled, generationOrder: [...new Set(order)], fallbackOnFailure: data.fallbackOnFailure === true };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS, enabled: {}, generationOrder: [] };
        throw new Error('つなぐ設定を読めません。');
    }
}

export function writeSettings(file: string, settings: ConnectSettings): void {
    const directory = path.dirname(file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.connectors-${randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

const macPatterns: Record<string, RegExp[]> = {
    blender: [/^Blender(?: \d+(?:\.\d+)*)?\.app$/i],
    photoshop: [/^Adobe Photoshop(?: \d{4})?$/i, /^Adobe Photoshop(?: \d{4})?\.app$/i],
    'after-effects': [/^Adobe After Effects(?: \d{4})?$/i, /^Adobe After Effects(?: \d{4})?\.app$/i],
    'ableton-live': [/^Ableton Live .+\.app$/i],
    'davinci-resolve': [/^DaVinci Resolve$/i, /^DaVinci Resolve\.app$/i],
    'final-cut-pro': [/^Final Cut Pro\.app$/i]
};
const winPatterns: Record<string, RegExp[]> = {
    blender: [/^Blender Foundation$/i, /^Blender(?: \d+)?$/i],
    photoshop: [/^Adobe$/i, /^Adobe Photoshop/i],
    'after-effects': [/^Adobe$/i, /^Adobe After Effects/i],
    'ableton-live': [/^Ableton$/i, /^Ableton Live/i],
    'davinci-resolve': [/^Blackmagic Design$/i, /^DaVinci Resolve$/i],
    'final-cut-pro': []
};
const leafPatterns: Record<string, RegExp> = {
    photoshop: /^Adobe Photoshop(?: \d{4})?\.app$/i,
    'after-effects': /^Adobe After Effects(?: \d{4})?\.app$/i,
    'davinci-resolve': /^DaVinci Resolve\.app$/i
};
function directories(root: string): string[] {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
    catch { return []; }
}
export function detectApp(id: string, roots: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
    const patterns = platform === 'win32' ? winPatterns[id] : macPatterns[id];
    if (!patterns?.length) return false;
    for (const root of roots) for (const name of directories(root)) {
        if (!patterns.some(pattern => pattern.test(name))) continue;
        if (platform === 'win32') {
            if (id === 'final-cut-pro') continue;
            if (id === 'photoshop' && name.toLowerCase() === 'adobe') {
                if (directories(path.join(root, name)).some(child => /^Adobe Photoshop/i.test(child))) return true;
                continue;
            }
            if (id === 'after-effects' && name.toLowerCase() === 'adobe') {
                if (directories(path.join(root, name)).some(child => /^Adobe After Effects/i.test(child))) return true;
                continue;
            }
            return true;
        }
        const leaf = leafPatterns[id];
        if (leaf && !name.endsWith('.app')) {
            if (directories(path.join(root, name)).some(child => leaf.test(child))) return true;
            continue;
        }
        return true;
    }
    return false;
}
export function appRoots(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
    return platform === 'win32'
        ? [env.ProgramFiles, env['ProgramFiles(x86)']].filter((value): value is string => !!value)
        : ['/Applications', path.join(home, 'Applications')];
}
export interface ResolvedCredential { value: string; source: 'env' | 'credentials.env'; }
export function credentialValues(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): Map<string, ResolvedCredential> {
    const primary = credentialsFilePath(env, home);
    const legacy = env.AKARI_CREDENTIALS_FILE ? null : path.join(home, '.config', 'akari-video', 'credentials.env');
    const values = new Map<string, ResolvedCredential>();
    if (legacy) for (const [key, value] of readCredentials(legacy).values) {
        if (value.trim()) values.set(key, { value, source: 'credentials.env' });
    }
    for (const [key, value] of readCredentials(primary).values) {
        if (value.trim()) values.set(key, { value, source: 'credentials.env' });
    }
    for (const entry of entries) if (entry.env && typeof env[entry.env] === 'string' && env[entry.env]!.trim()) {
        values.set(entry.env, { value: env[entry.env]!, source: 'env' });
    }
    return values;
}
export function orderedGenerationIds(settings: ConnectSettings): string[] {
    return [...settings.generationOrder, ...generationIds.filter(id => !settings.generationOrder.includes(id))];
}
export function connectorStatus(entry: Connector, hasKey: boolean, detected: boolean): ConnectStatus {
    if (entry.kind === 'built-in') return 'つながった';
    if (entry.kind === 'planned') return '準備中';
    if (entry.kind === 'key') return hasKey ? 'つながった' : '準備が要る';
    if (entry.kind === 'browser') return '見つかった';
    if (entry.kind === 'blender-recipe') return detected ? '見つかった' : '準備が要る';
    if (entry.id === 'after-effects' && detected) return '準備が要る';
    return detected ? '見つかった' : '準備が要る';
}
export function connectSnapshot(options: { env?: NodeJS.ProcessEnv; home?: string; roots?: string[]; platform?: NodeJS.Platform } = {}): ConnectSnapshot {
    const env = options.env ?? process.env;
    const home = options.home ?? os.homedir();
    const platform = options.platform ?? process.platform;
    const roots = options.roots ?? appRoots(env, home, platform);
    const values = credentialValues(env, home);
    const settings = readSettings(connectorsPath(env, home));
    const order = orderedGenerationIds(settings);
    const rows: ConnectorRow[] = entries.map(entry => {
        const detected = entry.app ? detectApp(entry.app, roots, platform) : entry.kind === 'blender-recipe' ? detectApp('blender', roots, platform) : false;
        const credential = entry.env ? values.get(entry.env) : undefined;
        return { ...entry, status: connectorStatus(entry, !!credential, detected), enabled: entry.kind === 'built-in' || settings.enabled[entry.id] !== false,
            maskedTail: maskedTail(credential?.value), credentialSource: credential?.source ?? null, detected };
    });
    rows.sort((a, b) => a.group === '素材を作る' && b.group === '素材を作る' ? order.indexOf(a.id) - order.indexOf(b.id) : 0);
    return { rows, generationOrder: order, fallbackOnFailure: settings.fallbackOnFailure };
}

export function saveCredential(id: string, value: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): void {
    const entry = entries.find(item => item.id === id);
    if (!entry?.env) throw new Error('鍵を追加できない接続です。');
    writeCredential(credentialsFilePath(env, home), entry.env, value);
}
export function updateSettings(change: (settings: ConnectSettings) => void, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): void {
    const file = connectorsPath(env, home);
    const settings = readSettings(file);
    change(settings);
    writeSettings(file, settings);
}
export function validateGenerationOrder(ids: string[]): void {
    if (ids.length !== generationIds.length || new Set(ids).size !== generationIds.length || ids.some(id => !generationIds.includes(id))) {
        throw new Error('生成サービスの並び順が不正です。');
    }
}
