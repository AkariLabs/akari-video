import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell, WebContentsView } from '@theia/core/electron-shared/electron';
import { randomBytes } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import { existsSync, promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { contextMenuActions, originalUrlHint, PickPayload, validatePickPayload, validatedViewPick,
    viewModeMessage } from '../common/browser-pick';
import { sanitizeExternalText } from '../common/external-text';
import { AssetSite, highlightCandidateIndex, markHighlightScript, READ_HIGHLIGHT_CANDIDATES_SCRIPT } from '../common/asset-sites';
import { BrowserDefinition } from '../common/browser-engines';
import { cssRectToViewBounds, CssRect } from '../common/browser-zoom';
import { downloadChainAllowed, navigationAllowed, SitePolicy } from '../common/site-navigation-policy';
import { CHANNEL_ASSET_SITE, CHANNEL_ASSET_SITE_EVENT, CHANNEL_SCRATCH, CHANNEL_SCRATCH_CHANGED,
    CHANNEL_VIEW_MODE, CHANNEL_VIEW_PICK, CHANNEL_VIEW_RESOLVE_AT, AssetSiteEvent } from '../electron-common/electron-api';
import { acceptImage, decodeDataImage, fetchScratchImage, ScratchFetchError, sniffImage } from './scratch-fetch';
import { cleanupScratch, listScratch, saveScratch } from './scratch-store';
import { extractSiteZip } from './site-download';
import { readBrowserConfig } from './browser-data';

type TrustedSite = (AssetSite | BrowserDefinition) & SitePolicy;
interface SiteState { window: BrowserWindow; view: WebContentsView; site: TrustedSite; temporary: string; url: string;
    navigationLog: { stage: string; url: string; allowed: boolean }[]; lastRect?: CssRect & { visible: boolean };
    guarded: boolean; pickMode: boolean; zoomListener: () => void; lastPick?: number;
    search: { engine: string; query: string } | null; pendingResolve?: { token: string; timer: ReturnType<typeof setTimeout>;
        show: (payload?: PickPayload) => void } }
const HIGHLIGHT_CSS = '[data-akari-site-highlight="true"] { outline: 4px solid #f97316 !important; outline-offset: 4px !important; box-shadow: 0 0 0 7px #f9731666 !important; }';
const testHttp = !app.isPackaged && process.env.AKARI_ASSET_SITE_TEST_HTTP === '1'
    && Boolean(process.env.AKARI_ASSET_SITE_TEST_CATALOG);
// Electron main is loaded before the backend child starts; replace any inherited marker.
process.env.AKARI_ASSET_SITE_TEST_ALLOWED = testHttp ? '1' : '0';

@injectable()
export class AssetSiteMain implements ElectronMainApplicationContribution {
    private readonly states = new Map<number, SiteState>();
    private readonly configuredPartitions = new Set<string>();
    private readonly pickModes = new Map<number, boolean>();

    onStart(_application: ElectronMainApplication): void {
        this.configurePartition('persist:akari-asset-sites');
        void cleanupScratch().catch(() => undefined);
        ipcMain.handle(CHANNEL_SCRATCH, async (event, operation: string) => {
            if (!BrowserWindow.fromWebContents(event.sender) || operation !== 'list') return [];
            const browser = await readBrowserConfig(testHttp ? process.env.AKARI_ASSET_SITE_TEST_CATALOG : undefined);
            const labels = new Map(browser?.engines.map(engine => [engine.id, engine.label]) ?? []);
            const items = await listScratch(undefined, id => labels.get(id));
            void cleanupScratch().catch(() => undefined);
            return items;
        });
        ipcMain.on(CHANNEL_VIEW_PICK, (event, input: { token?: string; payload?: unknown; unresolved?: unknown; preloadFailure?: unknown }) => {
            const state = Array.from(this.states.values()).find(item => item.view.webContents === event.sender);
            if (!state || state.site.navigation !== 'open' || event.senderFrame !== event.sender.mainFrame) return;
            if (input?.token) {
                const pending = state.pendingResolve;
                if (!pending || input.token !== pending.token) return;
                state.pendingResolve = undefined; clearTimeout(pending.timer);
                pending.show(validatedViewPick(event, { webContents: state.view.webContents, pickMode: state.pickMode }, input, pending.token));
                return;
            }
            if (!state.pickMode) return;
            if (input?.preloadFailure === 'too-large' || input?.preloadFailure === 'network') {
                this.emit(state, { type: 'scratch', result: 'failed', reason: input.preloadFailure }); return;
            }
            if (input?.unresolved === 'not-loaded' || input?.unresolved === 'unsupported') {
                this.emit(state, { type: 'scratch', result: 'failed', unresolved: input.unresolved }); return;
            }
            const payload = validatedViewPick(event, { webContents: state.view.webContents, pickMode: state.pickMode }, input);
            if (payload) void this.takePick(state, payload, 'browser:pick');
        });
        ipcMain.handle(CHANNEL_ASSET_SITE, async (event, operation: string, input?: any) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('ウィンドウが見つかりません');
            if (operation === 'browserConfig') return readBrowserConfig(testHttp ? process.env.AKARI_ASSET_SITE_TEST_CATALOG : undefined);
            if (operation === 'clearBrowserHistory') {
                const data = await readBrowserConfig(testHttp ? process.env.AKARI_ASSET_SITE_TEST_CATALOG : undefined);
                if (!data) throw new Error('ブラウザの設定ファイルが見つかりません');
                const browserSession = session.fromPartition(data.open_web.partition);
                await browserSession.clearStorageData(); await browserSession.clearCache(); await browserSession.clearAuthCache();
                return;
            }
            if (operation === 'pickMode') {
                if (typeof input?.on !== 'boolean') throw new Error('操作が不正です');
                this.pickModes.set(window.id, input.on);
                const current = this.states.get(window.id);
                if (current) { current.pickMode = input.on; current.view.webContents.send(CHANNEL_VIEW_MODE, viewModeMessage(input.on));
                    this.emit(current, { type: 'pickMode', on: input.on }); }
                return;
            }
            if (operation === 'searchContext') {
                const state = this.states.get(window.id);
                if (!state || state.site.navigation !== 'open') return;
                if (typeof input?.engine !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(input.engine)
                    || typeof input?.query !== 'string') return;
                state.search = { engine: input.engine, query: sanitizeExternalText(input.query, 512) };
                return;
            }
            if (operation === 'open') return this.open(window, input?.site, input?.url);
            const state = this.states.get(window.id);
            if (operation === 'close' && !state) { this.pickModes.delete(window.id); return; }
            if (!state) throw new Error('素材サイトが開いていません');
            if (operation === 'close') return this.close(state);
            if (operation === 'guardHide') {
                if (state.lastRect?.visible) { state.guarded = true; this.applyBounds(state); }
                return;
            }
            if (operation === 'guard') {
                if (typeof input?.on !== 'boolean') return;
                if (!input.on) { state.guarded = false; this.applyBounds(state); return undefined; }
                if (state.guarded || !state.lastRect?.visible || !state.lastRect.width || !state.lastRect.height) return undefined;
                try {
                    const image = await state.view.webContents.capturePage();
                    const size = image.getSize();
                    if (image.isEmpty()) return undefined;
                    const ratio = Math.min(1, 1280 / Math.max(size.width, size.height, 1));
                    const small = ratio < 1 ? image.resize({ width: Math.max(1, Math.floor(size.width * ratio)),
                        height: Math.max(1, Math.floor(size.height * ratio)) }) : image;
                    return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`;
                } catch { return undefined; }
            }
            if (operation === 'back') { if (state.view.webContents.canGoBack()) state.view.webContents.goBack(); return; }
            if (operation === 'forward') { if (state.view.webContents.canGoForward()) state.view.webContents.goForward(); return; }
            if (operation === 'reload') { state.view.webContents.reload(); return; }
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
                if (![x, y, width, height].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
                    || typeof visible !== 'boolean') return;
                state.lastRect = { x, y, width, height, visible };
                this.applyBounds(state); return;
            }
            if (operation === 'navigate') {
                if (typeof input?.url !== 'string' || input.url.length > 8192 || !navigationAllowed(input.url, state.site, testHttp))
                    throw new Error('このアドレスは開けません');
                await state.view.webContents.loadURL(input.url); return;
            }
            if (operation === 'highlight') {
                if (state.site.downloads === 'deny') return false;
                const filenames = Array.isArray(input?.expectedFilenames) ? input.expectedFilenames.filter((v: unknown) => typeof v === 'string').slice(0, 100) : [];
                const patterns = Array.isArray(input?.filenamePatterns) ? input.filenamePatterns.filter((v: unknown) => typeof v === 'string').slice(0, 100) : [];
                const links = await state.view.webContents.executeJavaScript(READ_HIGHLIGHT_CANDIDATES_SCRIPT) as { href: string; text: string }[];
                const index = highlightCandidateIndex(links, filenames, patterns);
                if (index < 0) return false;
                await state.view.webContents.insertCSS(HIGHLIGHT_CSS);
                return state.view.webContents.executeJavaScript(markHighlightScript(index));
            }
            if (operation === 'discard') {
                if (state.site.downloads === 'deny') return;
                for (const path of input?.paths ?? []) {
                    if (typeof path === 'string' && resolve(path).startsWith(resolve(state.temporary) + sep)) await fs.rm(path, { recursive: true, force: true });
                }
                return;
            }
            throw new Error('操作が不正です');
        });
    }

    private configurePartition(partition: string): void {
        if (this.configuredPartitions.has(partition)) return;
        this.configuredPartitions.add(partition);
        const siteSession = session.fromPartition(partition);
        siteSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        siteSession.setPermissionCheckHandler(() => false);
        // A user gesture may start a download; never click on behalf of the user or accept arbitrary hosts.
        siteSession.on('will-download', (event, item, source) => {
            const state = Array.from(this.states.values()).find(entry => entry.view.webContents === source);
            if (!state || !downloadChainAllowed([...item.getURLChain(), item.getURL()], state.site, testHttp)) {
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
    }

    private applyBounds(state: SiteState): void {
        const rect = state.lastRect;
        const bounds = rect ? cssRectToViewBounds(rect, state.window.webContents.getZoomFactor()) : { x: 0, y: 0, width: 0, height: 0 };
        const visible = Boolean(rect?.visible && !state.guarded && bounds.width && bounds.height);
        state.view.setBounds(visible ? bounds : { x: 0, y: 0, width: 0, height: 0 });
        state.view.setVisible(visible);
    }

    private async open(window: BrowserWindow, site: AssetSite | BrowserDefinition, url: string): Promise<void> {
        const trusted = await this.readTrustedSite(site?.id);
        if (!trusted || typeof url !== 'string' || url.length > 8192 || !navigationAllowed(url, trusted, testHttp) ||
            ('entry_url' in trusted && !navigationAllowed(trusted.entry_url, trusted, testHttp)))
            throw new Error('サイト定義または URL が不正です');
        const previous = this.states.get(window.id);
        if (previous) await this.close(previous);
        let temporary = '';
        if (trusted.downloads !== 'deny') {
            const root = await this.libraryRoot();
            await fs.mkdir(root, { recursive: true });
            temporary = await fs.mkdtemp(join(root, '.tmp-site-'));
        }
        const partition = trusted.partition ?? 'persist:akari-asset-sites';
        this.configurePartition(partition);
        const view = new WebContentsView({ webPreferences: {
            partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
            ...(trusted.navigation === 'open' ? { preload: join(app.getAppPath(), 'node_modules', 'akari-project',
                'lib', 'electron-main', 'browser-view-preload.js') } : {})
        } });
        const wc = view.webContents;
        // Theia's global web-contents-created hook prevents every non-secondary will-navigate.
        // Remove that hook only from this dedicated site view, then install our own hosts[] guard below.
        wc.removeAllListeners('will-navigate');
        const state: SiteState = { window, view, site: trusted, temporary, url, navigationLog: [],
            guarded: false, pickMode: this.pickModes.get(window.id) ?? false, search: null,
            zoomListener: () => this.applyBounds(state) };
        this.states.set(window.id, state);
        window.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        window.webContents.on('zoom-changed', state.zoomListener);
        if (trusted.navigation === 'open') {
            const syncMode = (): void => wc.send(CHANNEL_VIEW_MODE, viewModeMessage(state.pickMode));
            wc.on('dom-ready', syncMode);
            wc.on('context-menu', (_event, params) => {
                const contextPayload: PickPayload | undefined = params.mediaType === 'image' && params.srcURL
                    ? validatePickPayload({ kind: params.srcURL.startsWith('data:') ? 'data' : 'url', imageUrl: params.srcURL,
                        pageUrl: wc.getURL(), pageTitle: wc.getTitle().slice(0, 300), alt: params.altText?.slice(0, 300) ?? '',
                        linkUrl: params.linkURL || undefined,
                        naturalWidth: 0, naturalHeight: 0, resolvedFrom: 'context-menu' }) : undefined;
                if (contextPayload) { this.showPickMenu(state, contextPayload, params); return; }
                if (params.mediaType !== 'none') { this.showPickMenu(state, undefined, params); return; }
                if (state.pendingResolve) { clearTimeout(state.pendingResolve.timer); state.pendingResolve = undefined; }
                const token = randomBytes(16).toString('hex');
                const timer = setTimeout(() => { state.pendingResolve = undefined; this.showPickMenu(state, undefined, params); }, 1000);
                state.pendingResolve = { token, timer, show: payload => { this.showPickMenu(state, payload, params); } };
                wc.send(CHANNEL_VIEW_RESOLVE_AT, { x: params.x, y: params.y, token });
            });
        }
        wc.setWindowOpenHandler(({ url: target }) => {
            if (navigationAllowed(target, state.site, testHttp)) void wc.loadURL(target);
            else this.rejectNavigation(state, target);
            return { action: 'deny' };
        });
        wc.on('will-navigate', (event, target) => { const allowed = navigationAllowed(target, state.site, testHttp);
            if (testHttp) state.navigationLog.push({ stage: 'will-navigate', url: target, allowed });
            if (!allowed) {
            event.preventDefault(); this.rejectNavigation(state, target);
        } });
        wc.on('will-redirect', (event, target) => { const allowed = navigationAllowed(target, state.site, testHttp);
            if (testHttp) state.navigationLog.push({ stage: 'will-redirect', url: target, allowed });
            if (!allowed) {
            event.preventDefault(); this.rejectNavigation(state, target);
        } });
        wc.on('did-navigate', (_event, target) => { state.url = target;
            if (testHttp) state.navigationLog.push({ stage: 'did-navigate', url: target, allowed: true });
            this.emit(state, { type: 'navigated', url: target });
            if (trusted.navigation === 'open') wc.send(CHANNEL_VIEW_MODE, viewModeMessage(state.pickMode)); });
        wc.on('did-navigate-in-page', (_event, target) => { state.url = target; this.emit(state, { type: 'navigated', url: target });
            if (trusted.navigation === 'open') wc.send(CHANNEL_VIEW_MODE, viewModeMessage(state.pickMode)); });
        window.once('closed', () => { void this.close(state); });
        if (state.pickMode) this.emit(state, { type: 'pickMode', on: true });
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

    private showPickMenu(state: SiteState, payload?: PickPayload,
        params?: { srcURL?: string; linkURL?: string; x?: number; y?: number }): void {
        if (this.states.get(state.window.id) !== state) return;
        const menu = Menu.buildFromTemplate(contextMenuActions(Boolean(payload), Boolean(params?.srcURL), Boolean(params?.linkURL))
            .map(action => {
                if (action === 'pick') return { label: 'AKARI に取り込む', click: () => { void this.takePick(state, payload!, 'browser:contextmenu'); } };
                if (action === 'separator') return { type: 'separator' as const };
                if (action === 'copy-image') return { label: '画像をコピー', click: () => state.view.webContents.copyImageAt(params?.x ?? 0, params?.y ?? 0) };
                if (action === 'copy-image-address') return { label: '画像のアドレスをコピー', click: () => clipboard.writeText(params!.srcURL!) };
                if (action === 'copy-link-address') return { label: 'リンクのアドレスをコピー', click: () => clipboard.writeText(params!.linkURL!) };
                if (action === 'back') return { label: '戻る', enabled: state.view.webContents.canGoBack(), click: () => state.view.webContents.goBack() };
                if (action === 'forward') return { label: '進む', enabled: state.view.webContents.canGoForward(), click: () => state.view.webContents.goForward() };
                if (action === 'reload') return { label: '再読み込み', click: () => state.view.webContents.reload() };
                return { role: action };
            }));
        menu.popup({ window: state.window });
    }

    private async takePick(state: SiteState, original: PickPayload, via: 'browser:pick' | 'browser:contextmenu'): Promise<void> {
        if (this.states.get(state.window.id) !== state) return;
        if (Date.now() - (state.lastPick ?? 0) < 500) return;
        state.lastPick = Date.now();
        const payload = validatePickPayload({ ...original, pageUrl: state.view.webContents.getURL() });
        if (!payload) return;
        const userAgent = state.view.webContents.session.getUserAgent();
        const allowLoopbackForTest = !app.isPackaged && process.env.AKARI_ASSET_SITE_TEST_HTTP === '1';
        const options = { pageUrl: payload.pageUrl, userAgent, allowLoopbackForTest };
        let bytes: Buffer | undefined; let mime: string | undefined; let reason: AssetSiteEvent['reason'];
        let resolvedFrom: string = payload.resolvedFrom;
        let selectedImageUrl = payload.imageUrl;
        try {
            if (via === 'browser:contextmenu' && payload.imageUrl) {
                const hint = originalUrlHint(payload.linkUrl, allowLoopbackForTest);
                if (hint) try {
                    const fetched = await fetchScratchImage(hint.url, options);
                    bytes = fetched.bytes; mime = fetched.mime; resolvedFrom = `link-param:${hint.param}`;
                    selectedImageUrl = hint.url;
                } catch { /* The selected image remains the fallback. */ }
            }
            if (!bytes) {
                if (payload.kind === 'data') {
                    const result = decodeDataImage(payload.imageUrl!); bytes = result.bytes; mime = result.mime;
                } else if (payload.kind === 'blob') {
                    bytes = Buffer.from(payload.bytes!);
                    if (bytes.length > 25 * 1024 * 1024) throw new ScratchFetchError('too-large');
                    mime = sniffImage(bytes);
                    if (!mime) throw new ScratchFetchError('not-an-image');
                    acceptImage(bytes, mime);
                } else {
                    const fetched = await fetchScratchImage(payload.imageUrl!, options);
                    bytes = fetched.bytes; mime = fetched.mime;
                }
            }
        } catch (error) { reason = error instanceof ScratchFetchError ? error.reason : 'network'; }
        try {
            // Rejected content and unsafe destinations leave no scratch entry.
            const mayKeepUrl = reason && !['blocked-host', 'bad-scheme', 'too-large', 'not-an-image'].includes(reason);
            if (!bytes && !mayKeepUrl) {
                this.emit(state, { type: 'scratch', result: 'failed', reason: reason ?? 'network' }); return;
            }
            const saved = await saveScratch({ bytes, mime, pageUrl: payload.pageUrl, imageUrl: selectedImageUrl,
                linkUrl: payload.linkUrl, pageTitle: payload.pageTitle, alt: payload.alt, resolvedFrom, via,
                width: payload.naturalWidth, height: payload.naturalHeight, search: state.search,
                dataBytes: payload.kind === 'data' ? bytes?.length : undefined });
            this.emit(state, { type: 'scratch', result: bytes ? saved.duplicate ? 'duplicate' : 'added' : 'failed',
                id: saved.source.id, quality: saved.source.app.quality, reason, flags: saved.source.flags });
            for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed())
                window.webContents.send(CHANNEL_SCRATCH_CHANGED);
            void cleanupScratch().catch(() => undefined);
        } catch { this.emit(state, { type: 'scratch', result: 'failed', reason: 'network' }); }
    }

    private async readTrustedSite(id: unknown): Promise<TrustedSite | undefined> {
        if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return undefined;
        const browser = await readBrowserConfig(testHttp ? process.env.AKARI_ASSET_SITE_TEST_CATALOG : undefined);
        const catalogDef = [browser?.open_web].find(value => value?.id === id);
        if (catalogDef) return { ...catalogDef, hosts: [], download_hosts: [] };
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
    private rejectNavigation(state: SiteState, target: string): void {
        if (state.site.navigation === 'open') this.emit(state, { type: 'error', message: 'このアドレスは開けません' });
        else void this.offerExternal(state, target);
    }
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
        this.pickModes.delete(state.window.id);
        if (!state.window.isDestroyed()) state.window.webContents.removeListener('zoom-changed', state.zoomListener);
        if (!state.window.isDestroyed()) state.window.contentView.removeChildView(state.view);
        state.view.webContents.close();
        if (state.temporary) await fs.rm(state.temporary, { recursive: true, force: true });
    }
}
