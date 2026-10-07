import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WidgetManager } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { AkariProjectService } from '../common/akari-project-protocol';
import { AssetSiteListing, AssetSiteRecommendation, siteImportMetadata } from '../common/asset-sites';
import { AssetSiteEvent } from '../electron-common/electron-api';
import { composeSiteAgentPrompt, PARTNER_INJECT_PROMPT_COMMAND_ID } from '../common/asset-site-prompt';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';
import { BrowserConfig, BrowserEngine, buildSearchUrl, validUserEngines } from '../common/browser-engines';
import { BrowserSearchBar } from './browser-search-bar';
import { BROWSER_HOST_GUARD_EVENT, BROWSER_HOST_GUARD_QUERY_EVENT } from './browser-host-guard-contribution';
import { AKARI_BORDER, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

const layoutCss = `
.akari-asset-site-browser .akari-site-body { display:flex; flex:1 1 auto; min-height:0; min-width:0; overflow:hidden; }
.akari-asset-site-browser .akari-site-surface { flex:1 1 auto; min-width:280px; min-height:0; background:#fff; }
.akari-asset-site-browser .akari-site-recommendations { flex:0 1 190px; min-width:96px; box-sizing:border-box;
  overflow:auto; overflow-wrap:anywhere; padding:8px; border-left:1px solid var(--theia-panel-border); }
@container (max-width: 500px) {
  .akari-asset-site-browser .akari-site-body { flex-direction:column; }
  .akari-asset-site-browser .akari-site-surface { flex:1 1 0%; width:100%; min-width:0; min-height:160px; }
  .akari-asset-site-browser .akari-site-recommendations { flex:0 0 auto; width:100%; min-width:0; max-height:120px;
    border-left:0; border-top:1px solid var(--theia-panel-border); }
}`;

@injectable()
export class AssetSiteWidget extends ReactWidget {
    static readonly ID = 'akari-asset-site-browser';
    @inject(AkariProjectService) protected readonly service!: AkariProjectService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    private listing?: AssetSiteListing;
    private mode: 'allowlist' | 'open' = 'allowlist';
    private browserConfig?: BrowserConfig;
    private browserEngines: BrowserEngine[] = [];
    private selectedEngine = '';
    private query = '';
    private browserView = false;
    private browserError = '';
    private browserLoading = false;
    private pickMode = false;
    private scratchNotice = '';
    private scratchNoticeThumb?: string;
    private scratchNoticeVersion = 0;
    private scratchNoticeTimer?: ReturnType<typeof setTimeout>;
    private warnedSettings = new Set<string>();
    private snapshot?: string;
    private guardQueued = Promise.resolve();
    private address = '';
    private agentOpened = false;
    private pending?: { paths: string[]; name: string; sourceUrl: string };
    private host?: HTMLElement;
    private ticker?: ReturnType<typeof setInterval>;
    private resizeObserver?: ResizeObserver;
    private lastBounds?: string;
    private unsubscribe?: () => void;
    private busy = false;

    @postConstruct()
    protected init(): void {
        this.id = AssetSiteWidget.ID;
        this.title.label = '素材サイト'; this.title.closable = true;
        this.node.style.height = '100%';
        this.unsubscribe = window.electronAkariProject.assetSite.onEvent(event => this.receive(event));
        this.ticker = setInterval(() => void this.updateBounds(), 500);
        window.addEventListener('resize', this.onWindowResize);
        window.addEventListener(BROWSER_HOST_GUARD_EVENT, this.onHostGuard);
        this.disposed.connect(() => { if (this.ticker) clearInterval(this.ticker); this.unsubscribe?.();
            this.scratchNoticeVersion++;
            if (this.scratchNoticeTimer) clearTimeout(this.scratchNoticeTimer);
            window.removeEventListener('resize', this.onWindowResize);
            window.removeEventListener(BROWSER_HOST_GUARD_EVENT, this.onHostGuard);
            this.resizeObserver?.disconnect();
            void window.electronAkariProject.assetSite.close().catch(() => undefined); });
        this.update();
    }

    async open(listing: AssetSiteListing, url?: string, agent = false): Promise<void> {
        this.mode = listing.site.navigation === 'open' ? 'open' : 'allowlist';
        this.listing = listing; this.address = url ?? listing.site.entry_url; this.agentOpened = agent;
        this.browserView = false; this.snapshot = undefined; this.lastBounds = undefined;
        this.pending = undefined; this.title.label = listing.site.name;
        await window.electronAkariProject.assetSite.open(listing.site, this.address, agent);
        this.browserView = this.mode === 'open';
        this.update();
        await this.updateBounds();
        window.dispatchEvent(new CustomEvent(BROWSER_HOST_GUARD_QUERY_EVENT));
    }

    async highlight(expectedFilenames: string[], filenamePatterns: string[] = []): Promise<boolean> {
        return window.electronAkariProject.assetSite.highlight(expectedFilenames, filenamePatterns);
    }

    private readonly onWindowResize = (): void => { void this.updateBounds(); };
    private readonly onHostGuard = (event: Event): void => {
        const hide = (event as CustomEvent<{ hide: boolean }>).detail?.hide;
        this.guardQueued = this.guardQueued.then(async () => {
            if (!this.browserView && !this.listing) return;
            if (hide) {
                const image = await window.electronAkariProject.assetSite.guard(true);
                if (image) { this.snapshot = image; this.update(); }
                await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                await window.electronAkariProject.assetSite.guardHide();
            } else {
                await window.electronAkariProject.assetSite.guard(false);
                this.snapshot = undefined; this.update();
            }
        }).catch(() => undefined);
    };

    private bindHost = (node: HTMLDivElement | null): void => {
        if (this.host === (node ?? undefined)) return;
        this.resizeObserver?.disconnect(); this.host = node ?? undefined;
        if (node) { this.resizeObserver = new ResizeObserver(() => void this.updateBounds());
            this.resizeObserver.observe(node); void this.updateBounds(); }
    };

    private loadUserEngines(): void {
        const builtIn = this.browserConfig?.engines ?? [];
        const { engines, invalidIds } = validUserEngines(this.preferences.get('akari.browser.userEngines', []), builtIn);
        this.browserEngines = [...builtIn, ...engines];
        for (const id of invalidIds) if (!this.warnedSettings.has(id)) {
            this.warnedSettings.add(id); this.messages.warn(`検索サイトの設定に使えないものがあります: ${id.slice(0, 40)}`);
        }
    }

    async openEmptyBrowser(): Promise<void> {
        this.browserConfig = await window.electronAkariProject.assetSite.browserConfig();
        this.mode = 'open'; this.listing = undefined; this.browserView = false; this.address = ''; this.pickMode = false;
        this.snapshot = undefined; this.pending = undefined; this.browserError = ''; this.browserLoading = false;
        this.title.label = 'ブラウザ';
        await window.electronAkariProject.assetSite.close();
        this.lastBounds = undefined;
        this.loadUserEngines();
        let recent = '';
        try { recent = localStorage.getItem('akari.browser.recentEngine') ?? ''; } catch { /* Storage can be unavailable. */ }
        this.selectedEngine = this.browserEngines.find(engine => engine.id === recent)?.id ?? this.browserEngines[0]?.id ?? '';
        this.update();
    }

    async ensureBrowser(): Promise<boolean> {
        if (this.mode !== 'open') await this.openEmptyBrowser();
        else { this.browserConfig = await window.electronAkariProject.assetSite.browserConfig(); this.loadUserEngines(); }
        return Boolean(this.browserConfig);
    }

    get engines(): readonly BrowserEngine[] { return this.browserEngines; }
    get isBrowser(): boolean { return this.mode === 'open'; }
    get testHttp(): boolean { return Boolean(this.browserConfig?.testHttp); }

    async openBrowserUrl(url: string): Promise<void> {
        if (!this.browserConfig) throw new Error('ブラウザの設定ファイルが見つかりません');
        this.browserError = ''; this.browserLoading = true; this.update();
        if (this.browserView) await window.electronAkariProject.assetSite.navigate(url);
        else { await window.electronAkariProject.assetSite.open(this.browserConfig.open_web, url);
            this.browserView = true; }
        this.address = url; this.update(); await this.updateBounds();
        window.dispatchEvent(new CustomEvent(BROWSER_HOST_GUARD_QUERY_EVENT));
    }

    async search(engineId: string, query: string): Promise<'ok' | 'empty-query' | 'invalid-url' | 'unknown-engine' | 'unavailable'> {
        if (!await this.ensureBrowser()) return 'unavailable';
        const engine = this.browserEngines.find(item => item.id === engineId);
        if (!engine) return 'unknown-engine';
        const built = buildSearchUrl(engine, query, this.testHttp);
        if (built.ok === false) return built.code;
        this.selectedEngine = engine.id; this.query = query;
        try { localStorage.setItem('akari.browser.recentEngine', engine.id); } catch { /* Storage can be unavailable. */ }
        await this.openBrowserUrl(built.url);
        await window.electronAkariProject.assetSite.searchContext({ engine: engine.id, query });
        return 'ok';
    }

    async setPickMode(on: boolean): Promise<void> {
        await window.electronAkariProject.assetSite.pickMode(on);
        this.pickMode = on; this.update();
    }

    private async clearBrowserHistory(): Promise<void> {
        if (!await new ConfirmDialog({ title: 'ブラウザの記録を消す',
            msg: 'ログイン状態や閲覧の記録が消えます', ok: '消す', cancel: 'キャンセル' }).open()) return;
        await window.electronAkariProject.assetSite.clearBrowserHistory();
        this.messages.info('ブラウザの記録を消しました');
    }

    private async updateBounds(): Promise<void> {
        if (!this.host || !(this.listing || this.browserView)) return;
        const rect = this.host.getBoundingClientRect();
        const visible = this.isVisible && (this.mode !== 'open' || !this.browserError)
            && rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth;
        const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible };
        const key = JSON.stringify(bounds);
        if (key === this.lastBounds) return;
        this.lastBounds = key;
        await window.electronAkariProject.assetSite.bounds(bounds);
    }

    private receive(event: AssetSiteEvent): void {
        if (event.type === 'navigated' && event.url) {
            this.address = event.url; this.browserLoading = false; this.browserError = '';
            void this.updateBounds();
        }
        if (event.type === 'pickMode') this.pickMode = Boolean(event.on);
        if (event.type === 'scratch') {
            const noticeVersion = ++this.scratchNoticeVersion;
            this.scratchNoticeThumb = undefined;
            const reasons: Record<string, string> = { 'blocked-host': '安全でない接続先です', 'bad-scheme': '対応していないアドレスです',
                'too-many-redirects': '転送が多すぎます', 'too-large': '画像が大きすぎます', timeout: '時間がかかりすぎました',
                'http-error': '画像を取得できませんでした', 'not-an-image': '画像ではありません', network: '通信できませんでした' };
            this.scratchNotice = event.result === 'duplicate' ? 'すでに取り込み済みです'
                : event.result === 'added' ? event.flags?.includes('injection-suspect')
                    ? 'このページに指示のような文が含まれています（取り込みは済んでいます）'
                    : event.quality === 'thumbnail'
                        ? '小さい画像を取り込みました。ページで大きく開いてから、もう一度選ぶと原寸に近づきます'
                        : '画像を取り込みました — 渡すに入れました（一時取り込み）'
                    : event.unresolved === 'not-loaded' ? 'この画像は取り込めません（まだ読み込まれていません。少し待ってからもう一度）'
                        : event.unresolved === 'unsupported' ? 'この画像は取り込めません（対応していない形式です）'
                            : `取り込めませんでした: ${reasons[event.reason ?? ''] ?? '画像を取得できませんでした'}`;
            if (this.scratchNoticeTimer) clearTimeout(this.scratchNoticeTimer);
            this.scratchNoticeTimer = setTimeout(() => { if (noticeVersion !== this.scratchNoticeVersion) return;
                this.scratchNoticeVersion++; this.scratchNotice = ''; this.scratchNoticeThumb = undefined; this.update(); }, 6000);
            if (event.result === 'added' && event.id) {
                const list = window.electronAkariProject?.scratch?.list();
                if (list) void list.then(items => {
                    if (noticeVersion !== this.scratchNoticeVersion) return;
                    this.scratchNoticeThumb = items.find(item => item.id === event.id)?.thumb;
                    this.update();
                }).catch(() => undefined);
            }
        }
        if (event.type === 'received' && event.paths?.length) this.pending = {
            paths: event.paths, name: event.name ?? '素材', sourceUrl: event.url ?? this.address
        };
        if (event.type === 'error') {
            if (this.mode === 'open') {
                this.browserError = event.message ?? 'このアドレスは開けません';
                this.browserLoading = false; void this.updateBounds();
            }
            else this.messages.error(event.message ?? '受け取りに失敗しました');
        }
        this.update();
    }

    private async recommend(item: AssetSiteRecommendation): Promise<void> {
        await window.electronAkariProject.assetSite.navigate(item.pageUrl);
        await this.highlight(item.expectedFilenames, item.filenamePatterns);
    }

    private async importPending(): Promise<void> {
        if (!this.listing || !this.pending || this.busy) return;
        this.busy = true; this.update();
        try {
            const plan = await this.service.planLibraryImport(this.pending.paths);
            const result = await this.service.applyLibraryImport({ ...plan,
                ...siteImportMetadata(this.listing.site, this.pending.sourceUrl) });
            await (await this.widgets.getWidget<AkariRoleBucketsWidget>(AkariRoleBucketsWidget.ID))?.siteImportCompleted(result);
            await window.electronAkariProject.assetSite.discard(this.pending.paths);
            this.pending = undefined;
        } catch (error) { this.messages.error(`ライブラリに入れられませんでした: ${String(error)}`); }
        finally { this.busy = false; this.update(); }
    }

    protected override render(): React.ReactNode {
        if (this.mode === 'open') return <div data-akari-browser className='akari-asset-site-browser'
            style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
            <style>{layoutCss}</style>
            <style>{`
                [data-akari-browser-empty] .akari-browser-engine-choice {
                    background-color: ${AKARI_SURFACE.card} !important;
                    border-color: var(--akari-button-secondary-line) !important;
                }
                [data-akari-browser-empty] .akari-browser-engine-choice[aria-pressed="true"] {
                    background-color: ${AKARI_SURFACE.elevated} !important;
                    border-color: var(--akari-accent) !important;
                }
            `}</style>
            {this.browserConfig ? <BrowserSearchBar engines={this.browserEngines} selected={this.selectedEngine}
                query={this.query} address={this.address} loading={this.browserLoading}
                hasView={this.browserView} pickMode={this.pickMode} onPickMode={on => { void this.setPickMode(on); }}
                onSelect={id => { this.selectedEngine = id; this.update(); }}
                onQuery={value => { this.query = value; this.update(); }}
                onSearch={() => { void this.search(this.selectedEngine, this.query).then(code => {
                    if (code !== 'ok') { this.browserError = code === 'empty-query' ? '検索語を入力してください' :
                        '検索サイトを開けません'; this.browserLoading = false; this.update(); void this.updateBounds(); }
                }).catch(() => { this.browserError = '検索サイトを開けません'; this.browserLoading = false;
                    this.update(); void this.updateBounds(); }); }}
                onBack={() => { this.browserError = ''; this.update(); void this.updateBounds();
                    if (this.browserView) void window.electronAkariProject.assetSite.back(); }}
                onForward={() => { if (this.browserView) { this.browserLoading = true; this.update();
                    void window.electronAkariProject.assetSite.forward(); } }}
                onReload={() => { if (this.browserView) { this.browserLoading = true; this.update();
                    void window.electronAkariProject.assetSite.reload(); } }}
                onClearHistory={() => void this.clearBrowserHistory()} />
                : <header style={{ padding: '8px 12px' }}>ブラウザの設定ファイルが見つかりません</header>}
            <div className='akari-site-body'><div ref={this.bindHost} data-akari-site-surface className='akari-site-surface'
                style={{ position: 'relative', background: AKARI_SURFACE.card, color: AKARI_INK }}>
                {this.browserError ? <div role='alert' style={{ height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20, boxSizing: 'border-box' }}>
                    <span>{this.browserError}</span>
                    <button type='button' className='theia-button secondary' aria-label='戻る' onClick={() => {
                        this.browserError = ''; this.update(); void this.updateBounds();
                        if (this.browserView) void window.electronAkariProject.assetSite.back();
                    }}>戻る</button>
                </div> : !this.browserView && !this.snapshot && <div data-akari-browser-empty style={{ height: '100%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 18, boxSizing: 'border-box', padding: 20 }}>
                    <p style={{ margin: 0, textAlign: 'center', color: AKARI_INK }}>
                        調べたいものを入れて、検索するサイトを選びます
                    </p>
                    <div role='group' aria-label='検索サイト' style={{ display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, width: 'min(100%, 420px)' }}>
                        {(this.browserConfig?.engines ?? []).slice(0, 4).map(engine =>
                            <button key={engine.id} type='button' className='theia-button secondary akari-browser-engine-choice'
                                aria-label={engine.label} aria-pressed={this.selectedEngine === engine.id}
                                onClick={() => { this.selectedEngine = engine.id; this.update(); }}
                                style={{ minHeight: 52, borderRadius: AKARI_RADIUS.panel,
                                    textAlign: 'left', justifyContent: 'flex-start' }}>{engine.label}</button>)}
                    </div>
                    <small style={{ color: 'var(--akari-muted)', textAlign: 'center', maxWidth: 420,
                        textWrap: 'balance' }}>
                        見るだけです。画像の利用条件は、使う前にそのサイトで確かめてください
                    </small>
                </div>}
                {this.snapshot && <img src={this.snapshot} alt='' aria-hidden='true'
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} />}
            </div></div>
            <output data-akari-scratch-notice role='status' aria-live='polite' style={{ display: 'flex', alignItems: 'center',
                alignSelf: 'center', boxSizing: 'border-box', maxWidth: 'calc(100% - 24px)', gap: 8,
                margin: this.scratchNotice ? '8px 12px' : 0, padding: this.scratchNotice ? '8px 12px' : 0,
                border: this.scratchNotice ? AKARI_BORDER.edge : undefined,
                borderRadius: AKARI_RADIUS.panel, background: this.scratchNotice ? AKARI_SURFACE.raised : undefined,
                color: AKARI_INK, fontSize: 12 }}>
                {this.scratchNoticeThumb && <img src={this.scratchNoticeThumb} alt='' style={{ width: 28, height: 28,
                    flex: 'none', borderRadius: AKARI_RADIUS.chip, objectFit: 'cover' }} />}
                <span>{this.scratchNotice}</span>
            </output>
        </div>;
        const listing = this.listing;
        if (!listing) return <div>素材サイトを開いています…</div>;
        return <div data-akari-asset-site className='akari-asset-site-browser'
            style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
                containerType: 'inline-size' }}>
            <style>{layoutCss}</style>
            <header style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                <strong>{listing.site.name}</strong> {listing.site.price === 'subscription' && <span>サブスク</span>}
                <div>このサイトの中だけ移動できます</div>
                {this.agentOpened && <div>エージェントがこのページを開きました</div>}
                <output data-akari-site-address style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{this.address}</output>
                <small title={listing.site.terms.source_url} style={{ display: 'block', maxHeight: 32, overflow: 'hidden' }}>{listing.site.terms.summary_ja}</small>
            </header>
            <div className='akari-site-body'>
                <div ref={this.bindHost} data-akari-site-surface className='akari-site-surface'>
                    {this.snapshot && <img src={this.snapshot} alt='' aria-hidden='true'
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <aside className='akari-site-recommendations'>
                    <strong>AKARI のおすすめ</strong>
                    {listing.recommendations.length ? listing.recommendations.map(item =>
                        <div key={item.id} style={{ marginTop: 10 }}><div>{item.title}</div>
                            <button className='theia-button secondary' style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.recommend(item)}>ページを開いて光らせる</button>
                            <button className='theia-button quiet' style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID,
                                composeSiteAgentPrompt(listing.site, `おすすめ「${item.title}」を探して`))}>エージェントに頼む</button></div>)
                        : <p>このサイトのおすすめは未登録です</p>}
                </aside>
            </div>
            {this.pending && <footer data-akari-site-received style={{ padding: 8, borderTop: '1px solid var(--theia-panel-border)',
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{this.pending.name} を受け取りました —</span>
                <button className='theia-button' disabled={this.busy} onClick={() => void this.importPending()}>ライブラリに入れる</button>
                <button className='theia-button danger' disabled={this.busy} onClick={() => { if (this.pending) void window.electronAkariProject.assetSite.discard(this.pending.paths);
                    this.pending = undefined; this.update(); }}>捨てる</button>
            </footer>}
        </div>;
    }
}
