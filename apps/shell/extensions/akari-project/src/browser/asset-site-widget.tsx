import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WidgetManager } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { AkariProjectService } from '../common/akari-project-protocol';
import { AssetSiteListing, AssetSiteRecommendation, siteImportMetadata } from '../common/asset-sites';
import { AssetSiteEvent } from '../electron-common/electron-api';
import { composeSiteAgentPrompt, PARTNER_INJECT_PROMPT_COMMAND_ID } from '../common/asset-site-prompt';
import { AkariRoleBucketsWidget } from './akari-role-buckets-widget';

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
    private listing?: AssetSiteListing;
    private address = '';
    private agentOpened = false;
    private pending?: { paths: string[]; name: string; sourceUrl: string };
    private host?: HTMLElement;
    private ticker?: ReturnType<typeof setInterval>;
    private unsubscribe?: () => void;
    private busy = false;

    @postConstruct()
    protected init(): void {
        this.id = AssetSiteWidget.ID;
        this.title.label = '素材サイト'; this.title.closable = true;
        this.node.style.height = '100%';
        this.unsubscribe = window.electronAkariProject.assetSite.onEvent(event => this.receive(event));
        this.ticker = setInterval(() => void this.updateBounds(), 120);
        this.disposed.connect(() => { if (this.ticker) clearInterval(this.ticker); this.unsubscribe?.();
            void window.electronAkariProject.assetSite.close(); });
        this.update();
    }

    async open(listing: AssetSiteListing, url?: string, agent = false): Promise<void> {
        this.listing = listing; this.address = url ?? listing.site.entry_url; this.agentOpened = agent;
        this.pending = undefined; this.title.label = listing.site.name;
        await window.electronAkariProject.assetSite.open(listing.site, this.address, agent);
        this.update();
        await this.updateBounds();
    }

    async highlight(expectedFilenames: string[], filenamePatterns: string[] = []): Promise<boolean> {
        return window.electronAkariProject.assetSite.highlight(expectedFilenames, filenamePatterns);
    }

    private async updateBounds(): Promise<void> {
        if (!this.host || !this.listing) return;
        const rect = this.host.getBoundingClientRect();
        const visible = this.isVisible && rect.width > 0 && rect.height > 0 && rect.left < window.innerWidth;
        await window.electronAkariProject.assetSite.bounds({ x: rect.left, y: rect.top,
            width: rect.width, height: rect.height, visible });
    }

    private receive(event: AssetSiteEvent): void {
        if (event.type === 'navigated' && event.url) this.address = event.url;
        if (event.type === 'received' && event.paths?.length) this.pending = {
            paths: event.paths, name: event.name ?? '素材', sourceUrl: event.url ?? this.address
        };
        if (event.type === 'error') this.messages.error(event.message ?? '受け取りに失敗しました');
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
                <div ref={node => { this.host = node ?? undefined; }} data-akari-site-surface className='akari-site-surface' />
                <aside className='akari-site-recommendations'>
                    <strong>AKARI のおすすめ</strong>
                    {listing.recommendations.length ? listing.recommendations.map(item =>
                        <div key={item.id} style={{ marginTop: 10 }}><div>{item.title}</div>
                            <button style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.recommend(item)}>ページを開いて光らせる</button>
                            <button style={{ display: 'block', width: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                onClick={() => void this.commands.executeCommand(PARTNER_INJECT_PROMPT_COMMAND_ID,
                                composeSiteAgentPrompt(listing.site, `おすすめ「${item.title}」を探して`))}>エージェントに頼む</button></div>)
                        : <p>このサイトのおすすめは未登録です</p>}
                </aside>
            </div>
            {this.pending && <footer data-akari-site-received style={{ padding: 8, borderTop: '1px solid var(--theia-panel-border)',
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{this.pending.name} を受け取りました —</span>
                <button disabled={this.busy} onClick={() => void this.importPending()}>ライブラリに入れる</button>
                <button disabled={this.busy} onClick={() => { if (this.pending) void window.electronAkariProject.assetSite.discard(this.pending.paths);
                    this.pending = undefined; this.update(); }}>捨てる</button>
            </footer>}
        </div>;
    }
}
