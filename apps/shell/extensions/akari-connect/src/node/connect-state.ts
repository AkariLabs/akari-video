import { t } from '@akari-video/i18n';
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
const connectorCopy = (): Record<string, { name?: string; description: string; tryLabel: string }> => ({
    'akari-video': { description: t('connect.catalog.connector.akariVideoDescription'), tryLabel: t('connect.catalog.connector.akariVideoTryLabel') },
    '3d-recipes': { name: t('connect.catalog.connector.recipesLabel'), description: t('connect.catalog.connector.recipesDescription'), tryLabel: t('connect.catalog.connector.recipesTryLabel') },
    fal: { description: t('connect.catalog.connector.falDescription'), tryLabel: t('connect.catalog.connector.falTryLabel') },
    'fish-audio': { description: t('connect.catalog.connector.fishDescription'), tryLabel: t('connect.catalog.connector.narrationTryLabel') },
    'google-ai': { description: t('connect.catalog.connector.googleDescription'), tryLabel: t('connect.catalog.connector.narrationTryLabel') },
    elevenlabs: { description: t('connect.catalog.connector.elevenlabsDescription'), tryLabel: t('connect.catalog.connector.transcriptionTryLabel') },
    groq: { description: t('connect.catalog.connector.groqDescription'), tryLabel: t('connect.catalog.connector.transcriptionTryLabel') }
});
const generationIds = entries.filter(entry => entry.group === 'generate').map(entry => entry.id);
interface MakerMark { logo?: string; background?: string; color?: string; initials?: string; }

export function readMakerMarks(starts: readonly string[] = [__dirname, process.cwd(), process.resourcesPath].filter((value): value is string => !!value)): Record<string, MakerMark> {
    for (const start of starts) {
        let directory = start;
        for (;;) {
            const candidate = path.resolve(directory, 'packages/schemas/ai-makers.json');
            try {
                const value: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, MakerMark>;
            } catch { /* メーカー印が無ければ頭文字を使う。 */ }
            const parent = path.dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
    }
    return {};
}

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
        throw new Error(t('connect.connectState.ui.couldNotReadConnectionSettingsError'));
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
    blender: [/^Blender(?: \d+(?:\.\d+)*)?\.app$/i]
};
const winPatterns: Record<string, RegExp[]> = {
    blender: [/^Blender Foundation$/i, /^Blender(?: \d+)?$/i]
};
function directories(root: string): string[] {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
    catch { return []; }
}
export function detectApp(id: string, roots: readonly string[], platform: NodeJS.Platform = process.platform): boolean {
    if (id !== 'blender') return false;
    const patterns = platform === 'win32' ? winPatterns.blender : macPatterns.blender;
    return roots.some(root => directories(root).some(name => patterns.some(pattern => pattern.test(name))));
}
function detectBlenderCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
    const executable = platform === 'win32' ? 'blender.exe' : 'blender';
    const candidates = [env.BLENDER, ...(env.PATH || '').split(platform === 'win32' ? ';' : ':').map(directory => path.join(directory, executable))];
    return candidates.some(candidate => {
        if (!candidate) return false;
        try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
    });
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
    if (entry.kind === 'built-in') return 'ready';
    if (entry.kind === 'planned') return 'planned';
    if (entry.kind === 'key') return hasKey ? 'ready' : 'needs-key';
    if (entry.kind === 'blender-recipe') return detected ? 'ready' : 'needs-blender';
    return 'planned';
}
export function connectSnapshot(options: { env?: NodeJS.ProcessEnv; home?: string; roots?: string[]; platform?: NodeJS.Platform; makerRoots?: string[] } = {}): ConnectSnapshot {
    const env = options.env ?? process.env;
    const home = options.home ?? os.homedir();
    const platform = options.platform ?? process.platform;
    const roots = options.roots ?? appRoots(env, home, platform);
    const values = credentialValues(env, home);
    const settings = readSettings(connectorsPath(env, home));
    const order = orderedGenerationIds(settings);
    const makers = readMakerMarks(options.makerRoots);
    const localized = connectorCopy();
    const rows: ConnectorRow[] = entries.map(entry => {
        const detected = entry.kind === 'blender-recipe' ? detectApp('blender', roots, platform) || (!options.roots && detectBlenderCommand(env, platform)) : false;
        const credential = entry.env ? values.get(entry.env) : undefined;
        const mark = entry.maker ? makers[entry.maker] : undefined;
        const visual = mark && typeof mark === 'object' ? {
            logo: typeof mark.logo === 'string' ? mark.logo : undefined,
            background: typeof mark.background === 'string' ? mark.background : undefined,
            color: typeof mark.color === 'string' ? mark.color : undefined,
            initials: typeof mark.initials === 'string' ? mark.initials : undefined
        } : {};
        return { ...entry, ...localized[entry.id], ...visual, status: connectorStatus(entry, !!credential, detected), enabled: entry.kind === 'built-in' || settings.enabled[entry.id] !== false,
            maskedTail: maskedTail(credential?.value), credentialSource: credential?.source ?? null, detected };
    });
    rows.sort((a, b) => a.group === 'generate' && b.group === 'generate' ? order.indexOf(a.id) - order.indexOf(b.id) : 0);
    return { rows, generationOrder: order, fallbackOnFailure: settings.fallbackOnFailure };
}

export function saveCredential(id: string, value: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): void {
    const entry = entries.find(item => item.id === id);
    if (!entry?.env) throw new Error(t('connect.connectState.ui.connectionWhereCannotAddKeyError'));
    writeCredential(credentialsFilePath(env, home), entry.env, value);
}
export function deleteCredential(id: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): void {
    const entry = entries.find(item => item.id === id);
    if (!entry?.env) throw new Error(t('connect.connectState.ui.connectionWhoseKeyCannotDeletedError'));
    writeCredential(credentialsFilePath(env, home), entry.env, null);
}
export function updateSettings(change: (settings: ConnectSettings) => void, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): void {
    const file = connectorsPath(env, home);
    const settings = readSettings(file);
    change(settings);
    writeSettings(file, settings);
}
export function validateGenerationOrder(ids: string[]): void {
    if (ids.length !== generationIds.length || new Set(ids).size !== generationIds.length || ids.some(id => !generationIds.includes(id))) {
        throw new Error(t('connect.connectState.ui.orderGenerationServicesIncorrectMessage'));
    }
}
