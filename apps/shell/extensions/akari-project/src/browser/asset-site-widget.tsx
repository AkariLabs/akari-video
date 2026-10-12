import { t } from '../common/project-text';
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
        this.title.label = t('project.library.creator.site'); this.title.closable = true;
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
        this.update();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const rect = this.host?.getBoundingClientRect();
        const bounds = rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height,
            visible: this.isVisible && rect.width > 0 && rect.height > 0 } : undefined;
        const openWithBounds = window.electronAkariProject.assetSite.open as (site: typeof listing.site, url: string,
            agent?: boolean, rect?: typeof bounds) => Promise<void>;
        await openWithBounds(listing.site, this.address, agent, this.mode === 'open' ? bounds : undefined);
        this.browserView = this.mode === 'open';
        this.lastBounds = undefined;
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
            this.warnedSettings.add(id); this.messages.warn(t('project.web.assetSite.someSearchSiteSettingsAreInvalidLabel', { value1: id.slice(0, 40) }));
        }
    }

    async openEmptyBrowser(): Promise<void> {
        this.browserConfig = await window.electronAkariProject.assetSite.browserConfig();
        this.mode = 'open'; this.listing = undefined; this.browserView = false; this.address = ''; this.pickMode = false;
        this.snapshot = undefined; this.pending = undefined; this.browserError = ''; this.browserLoading = false;
        this.title.label = t('project.web.assetSite.browserLabel');
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
        if (!this.browserConfig) throw new Error(t('project.web.assetSite.browserConfigurationFileNotFoundMessage'));
        this.browserError = ''; this.browserLoading = true; this.update();
        if (this.browserView) await window.electronAkariProject.assetSite.navigate(url);
        else { const rect = this.host?.getBoundingClientRect();
            const bounds = rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height,
                visible: this.isVisible && rect.width > 0 && rect.height > 0 } : undefined;
            const openWithBounds = window.electronAkariProject.assetSite.open as (
                site: typeof this.browserConfig.open_web, url: string, agent?: boolean, rect?: typeof bounds) => Promise<void>;
            await openWithBounds(this.browserConfig.open_web, url, false, bounds);
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
        if (!await new ConfirmDialog({ title: t('project.web.assetSite.clearBrowserHistoryAction'),
            msg: t('project.web.assetSite.willClearSignStateBrowsingHistoryMessage'), ok: t('project.library.menu.delete'), cancel: t('project.library.pane.cancelLabel') }).open()) return;
        await window.electronAkariProject.assetSite.clearBrowserHistory();
        this.messages.info(t('project.web.assetSite.browserHistoryClearedMessage'));
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
            const reasons: Record<string, string> = { 'blocked-host': t('project.web.assetSite.unsafeDestinationMessage'), 'bad-scheme': t('project.web.assetSite.unsupportedAddressError'),
                'too-many-redirects': t('project.web.assetSite.tooManyRedirectsMessage'), 'too-large': t('project.web.assetSite.imageIsTooLargeMessage'), timeout: t('project.web.assetSite.timedOutError'),
                'http-error': t('project.web.assetSite.couldNotLoadImageError'), 'not-an-image': t('project.web.assetSite.isNotImageMessage'), network: t('project.web.assetSite.couldNotConnectError') };
            this.scratchNotice = event.result === 'duplicate' ? t('project.web.assetSite.alreadyImportedMessage')
                : event.result === 'added' ? event.flags?.includes('injection-suspect')
                    ? t('project.web.assetSite.pageContainsTextLooksLikeInstructionsMessage')
                    : event.quality === 'thumbnail'
                        ? t('project.web.assetSite.smallImageWasImportedOpenLargerMessage')
                        : t('project.web.assetSite.imageImportedAddedHandoffTemporarilyMessage')
                    : event.unresolved === 'not-loaded' ? t('project.web.assetSite.cannotImportImageYetWaitItError')
                        : event.unresolved === 'unsupported' ? t('project.web.assetSite.cannotImportImageBecauseItsFormatError')
                            : t('project.web.assetSite.couldNotImportError', { value1: reasons[event.reason ?? ''] ?? t('project.web.assetSite.couldNotLoadImageError') });
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
            paths: event.paths, name: event.name ?? t('project.catalog.purchase.asset'), sourceUrl: event.url ?? this.address
        };
        if (event.type === 'error') {
            if (this.mode === 'open') {
                this.browserError = event.message ?? t('project.web.assetSite.cannotOpenAddressError');
                this.browserLoading = false; void this.updateBounds();
            }
            else this.messages.error(event.message ?? t('project.web.assetSite.couldNotReceiveFileError'));
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
        } catch (error) { this.messages.error(t('project.web.assetSite.couldNotAddLibraryError', { value1: String(error) })); }
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
                    if (code !== 'ok') { this.browserError = code === 'empty-query' ? t('project.web.assetSite.enterSearchTermAction') :
                        t('project.web.assetSite.couldNotOpenSearchSiteError'); this.browserLoading = false; this.update(); void this.updateBounds(); }
                }).catch(() => { this.browserError = t('project.web.assetSite.couldNotOpenSearchSiteError'); this.browserLoading = false;
                    this.update(); void this.updateBounds(); }); }}
                onBack={() => { this.browserError = ''; this.update(); void this.updateBounds();
                    if (this.browserView) void window.electronAkariProject.assetSite.back(); }}
                onForward={() => { if (this.browserView) { this.browserLoading = true; this.update();
                    void window.electronAkariProject.assetSite.forward(); } }}
                onReload={() => { if (this.browserView) { this.browserLoading = true; this.update();
                    void window.electronAkariProject.assetSite.reload(); } }}
                onClearHistory={() => void this.clearBrowserHistory()} />
                : <header style={{ padding: '8px 12px' }}>{t('project.web.assetSite.browserConfigurationFileNotFoundMessage')}</header>}
            <div className='akari-site-body'><div ref={this.bindHost} data-akari-site-surface className='akari-site-surface'
                style={{ position: 'relative', background: AKARI_SURFACE.card, color: AKARI_INK }}>
                {this.browserError ? <div role='alert' style={{ height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20, boxSizing: 'border-box' }}>
                    <span>{this.browserError}</span>
                    <button type='button' className='theia-button secondary' aria-label={t('project.web.assetSite.backLabel')} onClick={() => {
                        this.browserError = ''; this.update(); void this.updateBounds();
                        if (this.browserView) void window.electronAkariProject.assetSite.back();
                    }}>{t('project.web.assetSite.backLabel')}</button>
                </div> : !this.browserView && !this.snapshot && <div data-akari-browser-empty style={{ height: '100%',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 18, boxSizing: 'border-box', padding: 20 }}>
                    <p style={{ margin: 0, textAlign: 'center', color: AKARI_INK }}>
                        {t('project.web.assetSite.enterWhatYouWantFindChooseAction')}</p>
                    <div role='group' aria-label={t('project.web.assetSite.searchSiteAction')} style={{ display: 'grid',
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
                        {t('project.web.assetSite.browseOnlyCheckImageUsageTermsAction')}</small>
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
        if (!listing) return <div>{t('project.web.assetSite.openingAssetSiteStatus')}</div>;
        return <div data-akari-asset-site className='akari-asset-site-browser'
            style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
                containerType: 'inline-size' }}>
            <style>{layoutCss}</style>
            <header style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                <strong>{listing.site.name}</strong> {listing.site.price === 'subscription' && <span>{t('project.catalog.distribution.subscription')}</span>}
                <div>{t('project.web.assetSite.youCanNavigateOnlyWithinSiteMessage')}</div>
                {this.agentOpened && <div>{t('project.web.assetSite.agentOpenedPageMessage')}</div>}
                <output data-akari-site-address style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{this.address}</output>
                <small title={listing.site.terms.source_url} style={{ display: 'block', maxHeight: 32, overflow: 'hidden' }}>{listing.site.terms.summary_ja}</small>
            </header>
            <div className='akari-site-body'>
                <div ref={this.bindHost} data-akari-site-surface className='akari-site-surface'>
                    {this.snapshot && <img src={this.snapshot} alt='' aria-hidden='true'
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <aside className='akari-site-recommendations'>
                    <strong>{t('project.web.assetSite.akariRecommendationsLabel')}</strong>
                    {listing.recommendations.length ? listing.recommendations.map(item =>
                        <div key={item.id} style={{ marginTop: 10 }}><div>{item.title}</div>
                            <button className='theia-button secondary' style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.recommend(item)}>{t('project.web.assetSite.openPageHighlightAction')}</button>
                            <button className='theia-button quiet' style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID,
                                composeSiteAgentPrompt(listing.site, t('project.web.assetSite.findRecommendationTitleAction', { title: item.title })))}>{t('project.web.assetSite.askAgentAction')}</button></div>)
                        : <p>{t('project.web.assetSite.noRecommendationsAreRegisteredSiteError')}</p>}
                </aside>
            </div>
            {this.pending && <footer data-akari-site-received style={{ padding: 8, borderTop: '1px solid var(--theia-panel-border)',
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{this.pending.name} {t('project.web.assetSite.receivedLabel')}</span>
                <button className='theia-button' disabled={this.busy} onClick={() => void this.importPending()}>{t('project.web.assetSite.addLibraryAction')}</button>
                <button className='theia-button danger' disabled={this.busy} onClick={() => { if (this.pending) void window.electronAkariProject.assetSite.discard(this.pending.paths);
                    this.pending = undefined; this.update(); }}>{t('project.web.assetSite.discardAction')}</button>
            </footer>}
        </div>;
    }
}
