import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { AkariSettingsMaintenanceService, PartnerDetail, StorageCleanTarget, StorageEntry, StorageSnapshot } from '../common/settings-maintenance-protocol';
import { AKARI_APP_ICON } from '../browser/settings/app-icon';
import { resolveUpdateChannel } from '../common/shell-update-applier';

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
        { id: 'cache', label: 'キャッシュ', path: cacheRoots(root)[0], paths: cacheRoots(root), bytes: 0, detail: '作業に必要になったら自動で作り直すものだけです。プロジェクト・素材・書き出しには触りません。消した直後は、初めて開くパネルの表示が少し遅くなります。', safeToDelete: '消しても大丈夫', children: [] },
        { id: 'models', label: '文字起こしのモデル', path: path.join(home(), 'tools', 'models'), paths: [path.join(home(), 'tools', 'models')], bytes: 0, detail: '消すと、次に使うときにもう一度ダウンロードします（数分）。', safeToDelete: 'もう一度ダウンロードが必要', children: [] },
        { id: 'library', label: '素材ライブラリ', path: workspace ? path.join(workspace, 'assets') : path.join(home(), 'assets'), paths: [workspace ? path.join(workspace, 'assets') : path.join(home(), 'assets')], bytes: 0, detail: 'Store で買った素材と自分で入れた素材です。自分の素材は戻りません。', safeToDelete: '消すと戻らない', children: [] },
        { id: 'exports', label: '書き出し', path: workspace ? path.join(workspace, 'exports') : path.join(home(), 'exports'), paths: [workspace ? path.join(workspace, 'exports') : path.join(home(), 'exports')], bytes: 0, detail: '書き出した動画です。消すと戻りません（プロジェクトから書き出し直すことはできます）。', safeToDelete: '消すと戻らない', children: [] },
        { id: 'history', label: '編集の履歴', path: workspace ? path.join(workspace, '.akari', 'history') : path.join(home(), 'history'), paths: [workspace ? path.join(workspace, '.akari', 'history') : path.join(home(), 'history')], bytes: 0, detail: '元に戻すための記録です。30 日より古いものだけを消します。最近の編集は残ります。', safeToDelete: '古いものだけ消せる', children: [] }
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
        note: 'ログ本文と edit.json は匿名化して収録します。' }, null, 2) };
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

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) { crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } }
    return (crc ^ 0xffffffff) >>> 0;
}

export function diagnosticFileNameAt(date: Date): string {
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
    return `AKARI-診断-${stamp}.zip`;
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

@injectable()
export class AkariSettingsMaintenanceServiceImpl implements AkariSettingsMaintenanceService {
    async getUpdateSettings(): Promise<{ channel: 'stable' | 'prerelease'; autoCheck: boolean }> {
        try {
            const value = JSON.parse(await fs.readFile(path.join(home(), 'update-preferences.json'), 'utf8')) as { channel?: string; autoCheck?: boolean };
            return { channel: resolveUpdateChannel(value.channel), autoCheck: value.autoCheck !== false };
        } catch { return { channel: 'prerelease', autoCheck: true }; }
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
        const commands: Record<string, string[]> = { claude: ['claude'], codex: ['codex'], opencode: ['opencode'],
            commandcode: ['commandcode'], copilot: ['copilot'], cursor: ['cursor-agent'], antigravity: ['antigravity'], grok: ['grok'] };
        const directories = (process.env.PATH || '').split(path.delimiter);
        const result: Record<string, boolean> = {};
        for (const [id, names] of Object.entries(commands)) {
            result[id] = false;
            for (const directory of directories) {
                for (const name of names) {
                    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
                        try { await fs.access(path.join(directory, name + suffix)); result[id] = true; break; } catch { /* 続ける */ }
                    }
                    if (result[id]) { break; }
                }
                if (result[id]) { break; }
            }
        }
        return result;
    }
    async partnerDetails(): Promise<Record<string, PartnerDetail>> {
        const commands: Record<string, string> = { claude: 'claude', codex: 'codex', opencode: 'opencode',
            commandcode: 'commandcode', copilot: 'copilot', cursor: 'cursor-agent', antigravity: 'antigravity', grok: 'grok' };
        const available = await this.partnerAvailability();
        const result: Record<string, PartnerDetail> = {};
        await Promise.all(Object.entries(commands).map(async ([id, command]) => {
            if (!available[id]) { result[id] = { installed: false, detail: id === 'cursor' ? 'cursor-agent が見つかりません' : '—' }; return; }
            const version = await new Promise<string | undefined>(resolve => {
                const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
                let output = '';
                const timeout = setTimeout(() => { child.kill(); resolve(undefined); }, 4000);
                const collect = (chunk: Buffer): void => { if (output.length < 500) { output += chunk.toString('utf8'); } };
                child.stdout.on('data', collect); child.stderr.on('data', collect);
                child.on('error', () => { clearTimeout(timeout); resolve(undefined); });
                child.on('close', () => { clearTimeout(timeout); resolve(output.split(/\r?\n/)[0]?.replace(/[\\/].*$/, '').slice(0, 80) || undefined); });
            });
            result[id] = { installed: true, version, detail: version || '—' };
        }));
        return result;
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
        const secrets = await credentialValues([path.join(home(), 'credentials.env'),
            ...(workspace ? [path.join(workspace, '.akari', 'credentials.env')] : []),
            ...(credentialsPath && path.isAbsolute(credentialsPath) ? [credentialsPath] : [])]);
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
        entries['logs-summary.json'] = JSON.stringify({ last24Hours: { files: recentCount, bytes: recentBytes }, note: 'ログ本文は recent-logs.txt に匿名化して収録' }, null, 2);
        entries['recent-logs.json'] = JSON.stringify({ events: recentEvents, note: '時刻と重要度だけの索引' }, null, 2);
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
        let version = '開発版'; let buildDate = '開発ビルド'; const icon = AKARI_APP_ICON;
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
