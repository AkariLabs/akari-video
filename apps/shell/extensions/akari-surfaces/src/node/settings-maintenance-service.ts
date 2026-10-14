import { t, childProcessEnv } from '@akari-video/i18n';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { constants, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { AkariSettingsMaintenanceService, PartnerDetail, PartnerFreshness, PartnerUpdateResult, StorageCleanTarget, StorageEntry, StorageSnapshot } from '../common/settings-maintenance-protocol';
import { AKARI_APP_ICON } from '../browser/settings/app-icon';
import { resolveUpdateChannel } from '../common/shell-update-applier';
import { partnerCliCandidates } from 'akari-partner/lib/node/partner-cli-candidates';
import { buildPrivateNodePathEnv } from 'akari-partner/lib/node/cli-provisioner';
import { resolveAkariHomeDir } from 'akari-partner/lib/node/partner-connection-writer';
import { AkariPartnerServer, PartnerAgentId } from 'akari-partner/lib/common/akari-partner-protocol';
import { createLatestVersionLookup, decidePartnerCliUpdate, extractCliVersion, isAppManagedCliPath, PARTNER_LATEST_SOURCES } from 'akari-partner/lib/common/partner-cli-freshness';
import rawPartnerCatalog = require('akari-partner/lib/common/partner-catalog.json');

const CLI_AGENTS = rawPartnerCatalog.filter(entry => entry.form === 'cli').map(entry => entry.agent as string);

async function installedPartnerPath(agent: string): Promise<string | undefined> {
    for (const candidate of partnerCliCandidates(agent as Parameters<typeof partnerCliCandidates>[0], {
        homeDir: os.homedir(), platform: process.platform, env: process.env
    })) {
        try { await fs.access(candidate, constants.X_OK); return candidate; } catch { /* 次の候補 */ }
    }
    return undefined;
}

const home = (): string => process.env.AKARI_HOME || path.join(os.homedir(), '.akari');
const localDate = (value: Date): string => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const safeRoot = (root?: string): string | undefined => root && path.isAbsolute(root) ? path.resolve(root) : undefined;
function cacheRoots(workspaceRoot?: string): string[] {
    const workspace = safeRoot(workspaceRoot);
    const appCache = process.env.AKARI_HOME ? path.join(home(), 'cache') : path.join(os.homedir(), 'Library', 'Caches', 'akari-video');
    return [...new Set([...(workspace ? [path.join(workspace, '.akari', 'cache')] : []), appCache])];
}
export function storageLocations(root?: string): StorageEntry[] {
    const workspace = safeRoot(root);
    return [
        { id: 'cache', label: t('surfaces.settings.storageLocationsCache.label'), path: cacheRoots(root)[0], paths: cacheRoots(root), bytes: 0, detail: t('surfaces.settings.storageLocationsTemporaryDataAppRecreatesNeededProjectsAssets.description'), safeToDelete: t('surfaces.settings.storageLocationsOkayDelete.label'), children: [] },
        { id: 'models', label: t('surfaces.settings.storageLocationsTranscriptionModel.label'), path: path.join(home(), 'tools', 'models'), paths: [path.join(home(), 'tools', 'models')], bytes: 0, detail: t('surfaces.settings.storageLocationsDeleteDownloadedAgainNextTimeFewMinutes.message'), safeToDelete: t('surfaces.settings.storageLocationsNeedDownloadAgain.label'), children: [] },
        { id: 'library', label: t('surfaces.settings.storageLocationsAssetLibrary.label'), path: workspace ? path.join(workspace, 'assets') : path.join(home(), 'assets'), paths: [workspace ? path.join(workspace, 'assets') : path.join(home(), 'assets')], bytes: 0, detail: t('surfaces.settings.storageLocationsIncludesPurchasedAssetsAssetsAddedOwnAssets.message'), safeToDelete: t('surfaces.settings.storageLocationsDeletedDataCannotRecovered.label'), children: [] },
        { id: 'exports', label: t('surfaces.settings.storageLocationsExport.label'), path: workspace ? path.join(workspace, 'exports') : path.join(home(), 'exports'), paths: [workspace ? path.join(workspace, 'exports') : path.join(home(), 'exports')], bytes: 0, detail: t('surfaces.settings.storageLocationsExportedVideosDeletingThemPermanentThoughExport.message'), safeToDelete: t('surfaces.settings.storageLocationsDeletedDataCannotRecovered.label'), children: [] },
        { id: 'history', label: t('surfaces.settings.storageLocationsEditHistory.label'), path: workspace ? path.join(workspace, '.akari', 'history') : path.join(home(), 'history'), paths: [workspace ? path.join(workspace, '.akari', 'history') : path.join(home(), 'history')], bytes: 0, detail: t('surfaces.settings.storageLocationsRecordRestoreDeleteOlderDaysRecentEdits.message'), safeToDelete: t('surfaces.settings.storageLocationsOldOnesDeleted.label'), children: [] }
    ];
}

async function directoryBytes(location: string): Promise<number> {
    let stat;
    try { stat = await fs.lstat(location); } catch { return 0; }
    if (stat.isSymbolicLink()) { return 0; }
    if (!stat.isDirectory()) { return stat.size; }
    let total = 0;
    for (const item of await fs.readdir(location)) { total += await directoryBytes(path.join(location, item)); }
    return total;
}

export function diagnosticEntries(info: { version: string; os: string }): Record<string, string> {
    return { 'diagnostic.json': JSON.stringify({ app: 'AKARI Video', ...info, generatedAt: new Date().toISOString(),
        note: t('surfaces.settings.diagnosticEntriesLogTextEditJsonAnonymizedRecorded.message') }, null, 2) };
}

/** 診断へ出す全テキストの共通匿名化。既知の鍵は値そのものでも伏せる。 */
export function sanitizeDiagnosticText(input: string, options: { homeDir: string; username: string; secretValues?: readonly string[] }): string {
    let value = input.replace(/\bsk-[A-Za-z0-9_-]{4,}/gi, '[REDACTED]')
        .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(api[_-]?key|key|token|secret|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]');
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (options.homeDir) { value = value.replace(new RegExp(escape(options.homeDir), 'gi'), '~'); }
    value = value.replace(/\/(?:Users|home)\/[^/\s"']+/gi, '~')
        .replace(/[A-Z]:\\Users\\[^\\\s"']+/gi, '~');
    if (options.username && options.username.length >= 3) {
        value = value.replace(new RegExp(escape(options.username), 'gi'), '[USER]');
    }
    for (const secret of options.secretValues || []) {
        if (secret.length > 0) { value = value.replace(new RegExp(escape(secret), 'g'), '[REDACTED]'); }
    }
    return value;
}

export function sanitizeDiagnosticJson(input: string, options: { homeDir: string; username: string; secretValues?: readonly string[] }): string {
    try {
        const walk = (value: unknown): unknown => {
            if (typeof value === 'string') { return sanitizeDiagnosticText(value, options); }
            if (Array.isArray(value)) { return value.map(walk); }
            if (value && typeof value === 'object') {
                return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
                    /(?:api.?key|token|secret|password|credential)/i.test(key) ? '[REDACTED]' : walk(item)]));
            }
            return value;
        };
        return JSON.stringify(walk(JSON.parse(input)), null, 2);
    } catch { return sanitizeDiagnosticText(input, options); }
}

async function credentialValues(locations: readonly string[]): Promise<string[]> {
    const values: string[] = [];
    for (const location of locations) {
        try {
            const content = await fs.readFile(location, 'utf8');
            for (const line of content.split(/\r?\n/)) {
                const match = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+?)\s*$/);
                if (match) { values.push(match[1].replace(/^["']|["']$/g, '')); }
            }
        } catch { /* 鍵が無い構成 */ }
    }
    return values;
}

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
    readCredentials(env: NodeJS.ProcessEnv): { values: Map<string, string> };
}>;

async function sharedCredentialValues(): Promise<string[]> {
    const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    for (const start of [resources, __dirname, process.cwd()].filter((value): value is string => !!value)) {
        let directory = start;
        for (let depth = 0; depth < 12; depth++) {
            const candidate = path.join(directory, 'packages/creator-root/src/index.mjs');
            if (existsSync(candidate)) {
                const creator = await importEsm(pathToFileURL(candidate).href);
                return [...creator.readCredentials(process.env).values.values()];
            }
            const parent = path.dirname(directory);
            if (parent === directory) break;
            directory = parent;
        }
    }
    throw new Error(t('surfaces.settings.sharedCredentialValuesCredentialsCannotAnonymized.message'));
}

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) { crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } }
    return (crc ^ 0xffffffff) >>> 0;
}

export function diagnosticFileNameAt(date: Date): string {
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
    return t('surfaces.settings.diagnosticFileNameAtAkariDiagnosisZip.message', { stamp: stamp });
}

/** 外部依存なしの ZIP store。入れる内容は固定名の診断 JSON のみ。 */
export function zipEntries(entries: Record<string, string>): Buffer {
    const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
    for (const [name, value] of Object.entries(entries)) {
        if (!/^[a-z0-9._-]+$/i.test(name)) { throw new Error('Invalid diagnostic entry'); }
        const filename = Buffer.from(name); const body = Buffer.from(value); const checksum = crc32(body);
        const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
        header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
        local.push(header, filename, body);
        const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
        directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24);
        directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
        central.push(directory, filename); offset += header.length + filename.length + body.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const footer = Buffer.alloc(22); footer.writeUInt32LE(0x06054b50, 0); footer.writeUInt16LE(Object.keys(entries).length, 8);
    footer.writeUInt16LE(Object.keys(entries).length, 10); footer.writeUInt32LE(centralSize, 12); footer.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, ...central, footer]);
}

/** `--version` の待ち時間。表示は先に「確認中」なので、読めないより待つ方を選ぶ。 */
const PARTNER_VERSION_TIMEOUT_MS = 12_000;

// 最新版の問い合わせは 1 時間キャッシュ。失敗しても throw せず「不明」を返す。
const latestPartnerVersion = createLatestVersionLookup({
    fetchImpl: (url, init) => fetch(url, init)
});

@injectable()
export class AkariSettingsMaintenanceServiceImpl implements AkariSettingsMaintenanceService {
    @inject(AkariPartnerServer) @optional() protected readonly partnerServer?: AkariPartnerServer;
    protected readonly updating = new Set<string>();
    async getUpdateSettings(): Promise<{ channel: 'stable' | 'prerelease'; autoCheck: boolean }> {
        try {
            const value = JSON.parse(await fs.readFile(path.join(home(), 'update-preferences.json'), 'utf8')) as { channel?: string; autoCheck?: boolean };
            return { channel: resolveUpdateChannel(value.channel), autoCheck: value.autoCheck !== false };
        } catch { return { channel: 'stable', autoCheck: true }; }
    }
    async setUpdateSettings(change: { channel?: 'stable' | 'prerelease'; autoCheck?: boolean }): Promise<void> {
        const location = path.join(home(), 'update-preferences.json');
        let current: { channel?: string; autoCheck?: boolean } = {};
        try { current = JSON.parse(await fs.readFile(location, 'utf8')); } catch { /* 初期値 */ }
        const next = { channel: change.channel || resolveUpdateChannel(current.channel),
            autoCheck: change.autoCheck ?? (current.autoCheck !== false) };
        await fs.mkdir(path.dirname(location), { recursive: true });
        await fs.writeFile(location, JSON.stringify(next, null, 2), { mode: 0o600 });
    }
    async partnerAvailability(): Promise<Record<string, boolean>> {
        const result: Record<string, boolean> = {};
        await Promise.all(CLI_AGENTS.map(async agent => { result[agent] = Boolean(await installedPartnerPath(agent)); }));
        return result;
    }
    async partnerDetails(): Promise<Record<string, PartnerDetail>> {
        const result: Record<string, PartnerDetail> = {};
        await Promise.all(CLI_AGENTS.map(async id => {
            const executable = await installedPartnerPath(id);
            if (!executable) { result[id] = { installed: false, detail: id === 'cursor' ? t('surfaces.settings.partnerDetailsCursorAgentFound.label') : '—' }; return; }
            const privateEnv = id === 'commandcode' || id === 'pi' ? buildPrivateNodePathEnv({
                agent: id, akariHome: resolveAkariHomeDir(), platform: process.platform, existingPath: process.env.PATH
            }) : {};
            const version = await new Promise<string | undefined>(resolve => {
                const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
                let child: ReturnType<typeof spawn>;
                try {
                    child = spawn(isWindowsShim ? `"${executable.replace(/"/g, '\\"')}"` : executable,
                        [isWindowsShim ? '"--version"' : '--version'], {
                            stdio: ['ignore', 'pipe', 'pipe'], env: childProcessEnv({ ...process.env, ...privateEnv }), shell: isWindowsShim
                        });
                } catch { resolve(undefined); return; }
                let output = '';
                let timedOut = false;
                let spawnFailed = false;
                // 全 CLI を同時に起こすので、負荷の高い起動直後は node / bun 製の CLI（opencode・Command Code）が
                // 4 秒を超えて「—」になり、版が読めず更新ボタンも出なかった（実機 2026-10-12: 単独 1 秒・同時 3.7 秒）。
                const timeout = setTimeout(() => { timedOut = true; child.kill(); resolve(undefined); }, PARTNER_VERSION_TIMEOUT_MS);
                const collect = (chunk: Buffer): void => { if (output.length < 500) { output += chunk.toString('utf8'); } };
                child.stdout.on('data', collect); child.stderr.on('data', collect);
                child.on('error', () => { spawnFailed = true; clearTimeout(timeout); resolve(undefined); });
                child.on('close', (code, signal) => {
                    clearTimeout(timeout);
                    if (timedOut || spawnFailed || code !== 0 || signal) { resolve(undefined); return; }
                    resolve(output.split(/\r?\n/)[0]?.replace(/[\\/].*$/, '').slice(0, 80) || undefined);
                });
            });
            result[id] = { installed: true, version, detail: version || '—',
                managedByApp: isAppManagedCliPath(executable, { homeDir: os.homedir(), platform: process.platform, env: process.env }) };
        }));
        return result;
    }
    async partnerFreshness(details: Record<string, PartnerDetail>): Promise<Record<string, PartnerFreshness>> {
        const result: Record<string, PartnerFreshness> = {};
        await Promise.all(Object.entries(details).map(async ([id, detail]) => {
            if (!detail.installed || !PARTNER_LATEST_SOURCES[id]) { return; }
            const latest = await latestPartnerVersion(id).catch(() => undefined);
            result[id] = decidePartnerCliUpdate(id, extractCliVersion(detail.version), latest);
        }));
        return result;
    }
    async updatePartner(agent: string): Promise<PartnerUpdateResult> {
        // 更新できるのは取得元が分かる CLI だけ（Claude は自己更新、それ以外は元の方法で）。
        const source = PARTNER_LATEST_SOURCES[agent];
        if (!CLI_AGENTS.includes(agent) || !source || source.kind === 'self-updating' || !this.partnerServer) {
            return { ok: false, message: t('surfaces.settings.partnerUpdateUnsupported.message') };
        }
        if (this.updating.has(agent)) { return { ok: false, message: t('surfaces.settings.partnerUpdateRunning.message') }; }
        this.updating.add(agent);
        try {
            // 同じ導入経路を強制で通す。ボタンを押したこと自体が同意なので consent を立てる。
            const outcome = await this.partnerServer.bootstrap(agent as PartnerAgentId, undefined, true, true);
            if ('consentRequired' in outcome) { return { ok: false, message: t('surfaces.settings.partnerUpdateUnsupported.message') }; }
            const detail = (await this.partnerDetails())[agent];
            return { ok: true, version: extractCliVersion(detail?.version) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Windows は実行中の exe を置き換えられない。起動中のセッションを勝手に止めず、閉じてから再実行してもらう。
            if (process.platform === 'win32' && /EBUSY|EPERM|EACCES|being used by another process/i.test(message)) {
                return { ok: false, busy: true, message: t('surfaces.settings.partnerUpdateBusy.message') };
            }
            return { ok: false, message: message.split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 200) };
        } finally {
            this.updating.delete(agent);
        }
    }
    async measure(workspaceRoot?: string): Promise<StorageSnapshot> {
        const entries = await Promise.all(storageLocations(workspaceRoot).map(async entry => {
            const locations = entry.id === 'cache' ? cacheRoots(workspaceRoot) : [entry.path];
            let bytes = 0;
            const children: StorageEntry['children'] = [];
            for (const base of locations) {
                bytes += await directoryBytes(base);
                try {
                    for (const name of await fs.readdir(base)) {
                        const location = path.join(base, name);
                        children.push({ label: name, path: location, bytes: await directoryBytes(location) });
                    }
                } catch { /* 無いディレクトリは 0 B */ }
            }
            if (children.length === 0) { children.push({ label: entry.label, path: entry.path, bytes }); }
            return { ...entry, paths: locations, bytes, children };
        }));
        let freeBytes = 0;
        try { const stats = await fs.statfs(safeRoot(workspaceRoot) || home()); freeBytes = stats.bavail * stats.bsize; } catch { /* 空き容量を表示できない */ }
        return { entries, freeBytes };
    }
    async cleanCache(workspaceRoot?: string): Promise<number> {
        return this.cleanStorage('cache', workspaceRoot);
    }
    async cleanStorage(target: StorageCleanTarget, workspaceRoot?: string): Promise<number> {
        if (target !== 'cache' && target !== 'models' && target !== 'old-history') { throw new Error('Unknown storage clean target'); }
        const entries = storageLocations(workspaceRoot);
        const locations = target === 'cache' ? cacheRoots(workspaceRoot) : [target === 'models' ? entries[1].path : entries[4].path];
        const existing: string[] = [];
        for (const location of locations) {
            const stat = await fs.lstat(location).catch(() => undefined);
            if (!stat) { continue; }
            if (stat.isSymbolicLink() || !stat.isDirectory()) { throw new Error('Storage target is not a directory'); }
            existing.push(location);
        }
        if (existing.length === 0) { return 0; }
        if (target === 'old-history') {
            const location = existing[0];
            let removed = 0;
            for (const name of await fs.readdir(location)) {
                const child = path.join(location, name);
                const childStat = await fs.lstat(child);
                if (childStat.isSymbolicLink() || Date.now() - childStat.mtimeMs <= 30 * 86400000) { continue; }
                removed += await directoryBytes(child);
                await fs.rm(child, { recursive: true, force: false });
            }
            return removed;
        }
        let bytes = 0;
        for (const location of existing) {
            if (target === 'cache') {
                for (const name of await fs.readdir(location)) {
                    if (name === '.gitkeep') { continue; }
                    const child = path.join(location, name);
                    bytes += await directoryBytes(child);
                    await fs.rm(child, { recursive: true, force: false });
                }
            } else {
                bytes += await directoryBytes(location);
                await fs.rm(location, { recursive: true, force: false });
            }
        }
        return bytes;
    }
    async diagnosticDefaultPath(): Promise<string> {
        return path.join(os.homedir(), 'Desktop', diagnosticFileNameAt(new Date()));
    }
    async exportDiagnostics(destination?: string, layout?: { width: number; height: number; leftPanelWidth?: number; rightPanelWidth?: number },
        workspaceRoot?: string, credentialsPath?: string): Promise<string> {
        const target = destination || await this.diagnosticDefaultPath();
        if (!path.isAbsolute(target) || !target.endsWith('.zip')) { throw new Error('Invalid diagnostic destination'); }
        const info = await this.appInfo();
        const workspace = safeRoot(workspaceRoot);
        const secrets = [...await sharedCredentialValues(), ...await credentialValues([
            ...(workspace ? [path.join(workspace, '.akari', 'credentials.env')] : []),
            ...(credentialsPath && path.isAbsolute(credentialsPath) ? [credentialsPath] : [])])];
        const sanitizerOptions = { homeDir: os.homedir(), username: os.userInfo().username, secretValues: secrets };
        const sanitize = (value: string): string => sanitizeDiagnosticText(value, sanitizerOptions);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const entries = diagnosticEntries({ version: info.version, os: info.os });
        const tools = await this.partnerAvailability();
        entries['tools.json'] = JSON.stringify({ partnerCli: tools }, null, 2);
        entries['layout.json'] = JSON.stringify({ window: { width: Math.max(0, Math.round(layout?.width || 0)),
            height: Math.max(0, Math.round(layout?.height || 0)), leftPanelWidth: layout?.leftPanelWidth || 0,
            rightPanelWidth: layout?.rightPanelWidth || 0 } }, null, 2);
        const logDirectories = [path.join(home(), 'logs'), path.join(os.homedir(), 'Library', 'Logs', 'AKARI Video')];
        let recentCount = 0; let recentBytes = 0;
        const recentEvents: { time: string; level: string }[] = [];
        const logLines: string[] = [];
        for (const logs of logDirectories) {
            try { for (const name of await fs.readdir(logs)) {
                const logPath = path.join(logs, name);
                const stat = await fs.lstat(logPath);
                if (stat.isFile() && Date.now() - stat.mtimeMs <= 86400000) {
                    recentCount++; recentBytes += stat.size;
                    const length = Math.min(65536, stat.size);
                    const buffer = Buffer.alloc(length);
                    const handle = await fs.open(logPath, 'r');
                    try { await handle.read(buffer, 0, length, stat.size - length); }
                    finally { await handle.close(); }
                    const tail = buffer.toString('utf8');
                    for (const line of tail.split(/\r?\n/)) {
                        if (line && logLines.length < 500) { logLines.push(sanitize(line)); }
                    }
                    for (const line of tail.split(/\r?\n/)) {
                        const match = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z).*?\b(ERROR|WARN|INFO|DEBUG)\b/i);
                        if (match && recentEvents.length < 200) { recentEvents.push({ time: match[1], level: match[2].toUpperCase() }); }
                    }
                }
            } } catch { /* ログが無くても診断は出す */ }
        }
        entries['logs-summary.json'] = JSON.stringify({ last24Hours: { files: recentCount, bytes: recentBytes }, note: t('surfaces.settings.exportDiagnosticsLogTextAnonymizedRecordedRecentLogsTxt.label') }, null, 2);
        entries['recent-logs.json'] = JSON.stringify({ events: recentEvents, note: t('surfaces.settings.exportDiagnosticsIndexTimeImportance.label') }, null, 2);
        entries['recent-logs.txt'] = logLines.join('\n') + '\n';
        if (workspace) {
            try { entries['edit.json'] = sanitizeDiagnosticJson((await fs.readFile(path.join(workspace, 'edit.json'), 'utf8')).slice(0, 4 * 1024 * 1024), sanitizerOptions); }
            catch { /* edit.json が無いときは含めない */ }
        }
        await fs.writeFile(target, zipEntries(entries), { flag: 'w', mode: 0o600 });
        return target;
    }
    async openPath(location: string): Promise<void> { await this.runOpen(location, false); }
    async revealPath(location: string): Promise<void> { await this.runOpen(location, true); }
    private async runOpen(location: string, reveal: boolean): Promise<void> {
        if (location.startsWith('~/')) { location = path.join(os.homedir(), location.slice(2)); }
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        const args = process.platform === 'darwin' && reveal ? ['-R', location] : [location];
        await new Promise<void>((resolve, reject) => { const child = spawn(command, args, { stdio: 'ignore' }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`open exited ${code}`))); });
    }
    async appInfo(): Promise<{ version: string; buildDate: string; os: string; icon: string; lastChecked?: string;
        recentChanges?: { version: string; date?: string; notesUrl?: string } }> {
        const shellRoot = process.cwd();
        let version = t('surfaces.settings.appInfoDevelopmentVersion.label'); let buildDate = t('surfaces.settings.appInfoDevelopmentBuild.label'); const icon = AKARI_APP_ICON;
        for (const candidate of [path.join(shellRoot, 'package.json'), path.join(shellRoot, 'apps/shell/package.json')]) {
            try {
                const stat = await fs.stat(candidate);
                const pkg = JSON.parse(await fs.readFile(candidate, 'utf8')) as { version?: string };
                if (pkg.version) { version = pkg.version; buildDate = localDate(stat.mtime); break; }
            } catch { /* 次の実パスを試す */ }
        }
        for (const artifact of [path.join(shellRoot, 'lib/backend/electron-main.js'), path.join(process.resourcesPath || '', 'app.asar')]) {
            try { buildDate = localDate((await fs.stat(artifact)).mtime); break; }
            catch { /* 開発と配布で配置が異なる */ }
        }
        let lastChecked: string | undefined;
        let recentChanges: { version: string; date?: string; notesUrl?: string } | undefined;
        try {
            const cache = JSON.parse(await fs.readFile(path.join(home(), 'update-check.json'), 'utf8')) as {
                fetched_at?: unknown; feed?: { notes_url?: unknown; released?: unknown; components?: { shell?: { version?: unknown } } }
            };
            if (typeof cache.fetched_at === 'string') { lastChecked = cache.fetched_at; }
            const versionValue = cache.feed?.components?.shell?.version;
            const url = cache.feed?.notes_url;
            if (typeof versionValue === 'string') { recentChanges = { version: versionValue,
                date: typeof cache.feed?.released === 'string' ? cache.feed.released : undefined,
                notesUrl: typeof url === 'string' && /^https:\/\//.test(url) ? url : undefined }; }
        } catch { /* フィード未取得 */ }
        return { version, buildDate, os: `${process.platform === 'darwin' ? 'macOS' : os.type()} ${process.arch}`, icon,
            lastChecked, recentChanges };
    }
}
