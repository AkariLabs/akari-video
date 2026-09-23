import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, dialog, ipcMain, session, shell, WebContentsView } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { existsSync, promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { AssetSite, highlightCandidateIndex, markHighlightScript, READ_HIGHLIGHT_CANDIDATES_SCRIPT, siteDownloadChainAllowed, siteUrlAllowed } from '../common/asset-sites';
import { CHANNEL_ASSET_SITE, CHANNEL_ASSET_SITE_EVENT, AssetSiteEvent } from '../electron-common/electron-api';
import { extractSiteZip } from './site-download';

interface SiteState { window: BrowserWindow; view: WebContentsView; site: AssetSite; temporary: string; url: string;
    navigationLog: { stage: string; url: string; allowed: boolean }[]; }
const HIGHLIGHT_CSS = '[data-akari-site-highlight="true"] { outline: 4px solid #f97316 !important; outline-offset: 4px !important; box-shadow: 0 0 0 7px #f9731666 !important; }';
const testHttp = !app.isPackaged && process.env.AKARI_ASSET_SITE_TEST_HTTP === '1'
    && Boolean(process.env.AKARI_ASSET_SITE_TEST_CATALOG);
// Electron main is loaded before the backend child starts; replace any inherited marker.
process.env.AKARI_ASSET_SITE_TEST_ALLOWED = testHttp ? '1' : '0';

@injectable()
export class AssetSiteMain implements ElectronMainApplicationContribution {
    private readonly states = new Map<number, SiteState>();
    private siteSession!: Electron.Session;

    onStart(_application: ElectronMainApplication): void {
        this.siteSession = session.fromPartition('persist:akari-asset-sites');
        this.siteSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        this.siteSession.setPermissionCheckHandler(() => false);
        // A user gesture may start a download; never click on behalf of the user or accept arbitrary hosts.
        this.siteSession.on('will-download', (event, item, source) => {
            const state = Array.from(this.states.values()).find(entry => entry.view.webContents === source);
            if (!state || !siteDownloadChainAllowed([...item.getURLChain(), item.getURL()], state.site, testHttp)) {
                event.preventDefault(); return;
            }
            const name = basename(item.getFilename()).replace(/[^\p{L}\p{N}._ -]/gu, '_');
            if (!name || name.startsWith('.')) { event.preventDefault(); return; }
            const path = join(state.temporary, `${Date.now()}-${name}`);
            const pageUrl = state.url;
            item.setSavePath(path);
            item.once('done', async (_event, status) => {
                if (status !== 'completed' || this.states.get(state.window.id) !== state) { await fs.rm(path, { force: true }); return; }
                try {
                    let paths = [path];
                    if (name.toLowerCase().endsWith('.zip')) {
                        const extracted = join(state.temporary, `extract-${Date.now()}`);
                        await fs.mkdir(extracted);
                        paths = await extractSiteZip(path, extracted);
                        await fs.rm(path, { force: true });
                    }
                    this.emit(state, { type: 'received', name, paths, url: pageUrl });
                    await state.view.webContents.executeJavaScript(markHighlightScript(-1));
                } catch (error) { this.emit(state, { type: 'error', message: String(error) }); }
            });
        });
        ipcMain.handle(CHANNEL_ASSET_SITE, async (event, operation: string, input?: any) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('ウィンドウが見つかりません');
            if (operation === 'open') return this.open(window, input?.site, input?.url);
            const state = this.states.get(window.id);
            if (!state) throw new Error('素材サイトが開いていません');
            if (operation === 'close') return this.close(state);
            if (operation === 'inspect' || operation === 'testWindowBounds') {
                if (!testHttp) throw new Error('この検証操作は開発時のみ使用できます');
                if (operation === 'inspect') return { viewBounds: state.view.getBounds(), windowBounds: window.getBounds(),
                    navigationLog: state.navigationLog.slice(-12) };
                const { x, y, width, height } = input ?? {};
                if (![x, y, width, height].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
                    || width < 600 || height < 450 || width > 2400 || height > 1600) throw new Error('ウィンドウ位置が不正です');
                window.setBounds({ x: Math.floor(x), y: Math.floor(y), width: Math.floor(width), height: Math.floor(height) });
                return;
            }
            if (operation === 'bounds') {
                const { x, y, width, height, visible } = input ?? {};
                if (![x, y, width, height].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) return;
                state.view.setBounds({ x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)),
                    width: visible ? Math.max(0, Math.floor(width)) : 0, height: visible ? Math.max(0, Math.floor(height)) : 0 });
                return;
            }
            if (operation === 'navigate') {
                if (!siteUrlAllowed(input?.url, state.site.hosts, testHttp)) throw new Error('このサイトの外へは移動できません');
                await state.view.webContents.loadURL(input.url); return;
            }
            if (operation === 'highlight') {
                const filenames = Array.isArray(input?.expectedFilenames) ? input.expectedFilenames.filter((v: unknown) => typeof v === 'string').slice(0, 100) : [];
                const patterns = Array.isArray(input?.filenamePatterns) ? input.filenamePatterns.filter((v: unknown) => typeof v === 'string').slice(0, 100) : [];
                // Read and mark only. No click delegation and no network request to arbitrary hosts.
                const links = await state.view.webContents.executeJavaScript(READ_HIGHLIGHT_CANDIDATES_SCRIPT) as { href: string; text: string }[];
                const index = highlightCandidateIndex(links, filenames, patterns);
                if (index < 0) return false;
                await state.view.webContents.insertCSS(HIGHLIGHT_CSS);
                return state.view.webContents.executeJavaScript(markHighlightScript(index));
            }
            if (operation === 'discard') {
                for (const path of input?.paths ?? []) {
                    if (typeof path === 'string' && resolve(path).startsWith(resolve(state.temporary) + sep)) await fs.rm(path, { recursive: true, force: true });
                }
                return;
            }
            throw new Error('操作が不正です');
        });
    }

    private async open(window: BrowserWindow, site: AssetSite, url: string): Promise<void> {
        const trusted = await this.readTrustedSite(site?.id);
        if (!trusted || !siteUrlAllowed(url, trusted.hosts, testHttp) ||
            !siteUrlAllowed(trusted.entry_url, trusted.hosts, testHttp)) throw new Error('サイト定義または URL が不正です');
        const previous = this.states.get(window.id);
        if (previous) await this.close(previous);
        const root = await this.libraryRoot();
        await fs.mkdir(root, { recursive: true });
        const temporary = await fs.mkdtemp(join(root, '.tmp-site-'));
        const view = new WebContentsView({ webPreferences: {
            partition: 'persist:akari-asset-sites', nodeIntegration: false, contextIsolation: true, sandbox: true
            // No preload in the untrusted site view.
        } });
        const wc = view.webContents;
        // Theia's global web-contents-created hook prevents every non-secondary will-navigate.
        // Remove that hook only from this dedicated site view, then install our own hosts[] guard below.
        wc.removeAllListeners('will-navigate');
        const state: SiteState = { window, view, site: trusted, temporary, url, navigationLog: [] };
        this.states.set(window.id, state);
        window.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        wc.setWindowOpenHandler(({ url: target }) => {
            if (siteUrlAllowed(target, state.site.hosts, testHttp)) void wc.loadURL(target);
            else void this.offerExternal(state, target);
            return { action: 'deny' };
        });
        wc.on('will-navigate', (event, target) => { const allowed = siteUrlAllowed(target, state.site.hosts, testHttp);
            if (testHttp) state.navigationLog.push({ stage: 'will-navigate', url: target, allowed });
            if (!allowed) {
            event.preventDefault(); void this.offerExternal(state, target);
        } });
        wc.on('will-redirect', (event, target) => { const allowed = siteUrlAllowed(target, state.site.hosts, testHttp);
            if (testHttp) state.navigationLog.push({ stage: 'will-redirect', url: target, allowed });
            if (!allowed) {
            event.preventDefault(); void this.offerExternal(state, target);
        } });
        wc.on('did-navigate', (_event, target) => { state.url = target;
            if (testHttp) state.navigationLog.push({ stage: 'did-navigate', url: target, allowed: true });
            this.emit(state, { type: 'navigated', url: target }); });
        wc.on('did-navigate-in-page', (_event, target) => { state.url = target; this.emit(state, { type: 'navigated', url: target }); });
        window.once('closed', () => { void this.close(state); });
        await wc.loadURL(url);
    }

    private async libraryRoot(): Promise<string> {
        if (process.env.AKARI_LIBRARY_ROOT) return resolve(process.env.AKARI_LIBRARY_ROOT);
        const home = resolve(process.env.AKARI_HOME ?? join(homedir(), '.akari'));
        try {
            const location = JSON.parse(await fs.readFile(join(home, 'library-location.json'), 'utf8'));
            if (location.version === 0 && ['migrating', 'done'].includes(location.state) &&
                typeof location.root === 'string' && isAbsolute(location.root)) return resolve(location.root);
        } catch { /* Legacy library location. */ }
        return join(home, 'assets');
    }

    private async readTrustedSite(id: unknown): Promise<AssetSite | undefined> {
        if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return undefined;
        const testRoot = testHttp && process.env.AKARI_ASSET_SITE_TEST_CATALOG;
        let sitesDir = testRoot ? join(testRoot, 'sites') : undefined;
        if (!sitesDir) {
            for (const base of [app.getAppPath(), __dirname]) {
                let cursor = base;
                for (let depth = 0; depth < 8; depth++) {
                    const candidate = join(cursor, 'catalog', 'sites');
                    if (existsSync(candidate)) { sitesDir = candidate; break; }
                    const parent = dirname(cursor);
                    if (parent === cursor) break;
                    cursor = parent;
                }
                if (sitesDir) break;
            }
        }
        if (!sitesDir) return undefined;
        try {
            const site = JSON.parse(await fs.readFile(join(sitesDir, `${id}.json`), 'utf8')) as AssetSite;
            return site.id === id && Array.isArray(site.hosts) && Array.isArray(site.download_hosts) ? site : undefined;
        } catch { return undefined; }
    }

    private emit(state: SiteState, event: AssetSiteEvent): void { if (!state.window.isDestroyed()) state.window.webContents.send(CHANNEL_ASSET_SITE_EVENT, event); }
    private async offerExternal(state: SiteState, raw: string): Promise<void> {
        let url: URL;
        try { url = new URL(raw); } catch { return; }
        // file:, data:, javascript: and non-HTTPS destinations are never opened.
        if (url.protocol !== 'https:' || url.username || url.password || testHttp || state.window.isDestroyed()) return;
        const answer = await dialog.showMessageBox(state.window, { type: 'question',
            title: '素材サイトの外へ移動', message: `${url.hostname} を既定のブラウザで開きますか？`,
            detail: raw, buttons: ['開かない', '既定ブラウザで開く'], defaultId: 0, cancelId: 0 });
        if (answer.response === 1) await shell.openExternal(url.toString());
    }
    private async close(state: SiteState): Promise<void> {
        if (this.states.get(state.window.id) !== state) return;
        this.states.delete(state.window.id);
        if (!state.window.isDestroyed()) state.window.contentView.removeChildView(state.view);
        state.view.webContents.close();
        await fs.rm(state.temporary, { recursive: true, force: true });
    }
}
