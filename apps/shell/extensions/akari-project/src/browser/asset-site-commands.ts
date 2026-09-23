import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariProjectService } from '../common/akari-project-protocol';
import { siteUrlAllowed } from '../common/asset-sites';
import { AssetSiteWidget } from './asset-site-widget';

export const ASSET_SITE_OPEN: Command = { id: 'akari.assetSite.open', label: '素材サイトを開く' };
export const ASSET_SITE_HIGHLIGHT: Command = { id: 'akari.assetSite.highlight', label: '素材サイトのダウンロード場所を光らせる' };

@injectable()
export class AssetSiteCommands implements CommandContribution {
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(AkariProjectService) protected readonly service!: AkariProjectService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ASSET_SITE_OPEN, { execute: (request: string | { siteId: string; url?: string }, url?: string, agent = false) =>
            this.open(request, url, agent) });
        registry.registerCommand(ASSET_SITE_HIGHLIGHT, { execute: (request: string[] | { filenames: string[] }) => this.highlight(request) });
    }

    protected async open(request: string | { siteId: string; url?: string }, url?: string, agent = false): Promise<void> {
        const siteId = typeof request === 'string' ? request : request?.siteId;
        const targetUrl = typeof request === 'string' ? url : request?.url;
        agent = agent || typeof request !== 'string';
        const listing = (await this.service.getAssetSiteListings()).find(value => value.site.id === siteId);
        if (!listing) throw new Error('掲載サイトではありません');
        const target = targetUrl ?? listing.site.entry_url;
        if (!siteUrlAllowed(target, listing.site.hosts, target.startsWith('http://127.0.0.1'))) {
            throw new Error('このサイトの外へは移動できません');
        }
        const widget = await this.widgets.getOrCreateWidget<AssetSiteWidget>(AssetSiteWidget.ID);
        if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
        await widget.open(listing, target, agent);
    }

    protected async highlight(request: string[] | { filenames: string[] }): Promise<boolean> {
        const filenames = Array.isArray(request) ? request : request?.filenames;
        if (!Array.isArray(filenames) || !filenames.every(value => typeof value === 'string')) throw new Error('ファイル名が不正です');
        const widget = await this.widgets.getWidget<AssetSiteWidget>(AssetSiteWidget.ID);
        if (!widget) return false;
        return widget.highlight(filenames);
    }
}
