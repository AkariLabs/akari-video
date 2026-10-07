import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { navigationAllowed } from '../common/site-navigation-policy';
import { BROWSER_COMMAND_IDS, BrowserCommandResult, OPEN_WEB_POLICY, validateBrowserArgs } from '../common/browser-engines';
import { AssetSiteWidget } from './asset-site-widget';

const VIBE_PREVIEW_KEY = 'akari.vibePreview.enabled';
const previewEnabled = (): boolean => {
    try { return window.localStorage.getItem(VIBE_PREVIEW_KEY) === '1'; } catch { return false; }
};

export const BROWSER_SEARCH: Command = { id: BROWSER_COMMAND_IDS.search, label: 'ブラウザで検索' };
export const BROWSER_PICK_MODE: Command = { id: BROWSER_COMMAND_IDS.pickMode, label: 'ブラウザの選ぶモード' };
export const BROWSER_CLOSE: Command = { id: BROWSER_COMMAND_IDS.close, label: 'ブラウザを閉じる' };
export const BROWSER_OPEN: Command = { id: BROWSER_COMMAND_IDS.open, label: 'ブラウザで URL を開く' };

@injectable()
export class BrowserCommands implements CommandContribution {
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;

    registerCommands(registry: CommandRegistry): void {
        const available = { isEnabled: previewEnabled, isVisible: previewEnabled };
        registry.registerCommand(BROWSER_SEARCH, { ...available, execute: (args: unknown) => previewEnabled() && this.search(args) });
        registry.registerCommand(BROWSER_PICK_MODE, { ...available, execute: (args: unknown) => previewEnabled() && this.pickMode(args) });
        registry.registerCommand(BROWSER_CLOSE, { ...available, execute: (args: unknown) => previewEnabled() && this.close(args) });
        registry.registerCommand(BROWSER_OPEN, { ...available, execute: (args: unknown) => previewEnabled() && this.open(args) });
    }

    private async activate(): Promise<AssetSiteWidget> {
        const widget = await this.widgets.getOrCreateWidget<AssetSiteWidget>(AssetSiteWidget.ID);
        if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    private async search(args: unknown): Promise<BrowserCommandResult> {
        const valid = validateBrowserArgs(BROWSER_SEARCH.id, args);
        if (!valid.ok) return valid;
        const { engine, query } = args as { engine: string; query: string };
        try {
            const widget = await this.activate();
            const result = await widget.search(engine, query);
            return result === 'ok' ? { ok: true } : { ok: false, code: result,
                message: result === 'empty-query' ? '検索語を入力してください' : '検索サイトを開けません' };
        } catch { return { ok: false, code: 'navigation-failed', message: '検索サイトを開けません' }; }
    }

    private async open(args: unknown): Promise<BrowserCommandResult> {
        const valid = validateBrowserArgs(BROWSER_OPEN.id, args);
        if (!valid.ok) return valid;
        try {
            const config = await window.electronAkariProject.assetSite.browserConfig();
            if (!config) return { ok: false, code: 'unavailable', message: 'ブラウザを開けません' };
            const url = (args as { url: string }).url;
            if (!navigationAllowed(url, OPEN_WEB_POLICY, Boolean(config.testHttp)))
                return { ok: false, code: 'invalid-url', message: 'このアドレスは開けません' };
            const widget = await this.activate();
            if (!await widget.ensureBrowser()) return { ok: false, code: 'unavailable', message: 'ブラウザを開けません' };
            await widget.openBrowserUrl(url); return { ok: true };
        }
        catch { return { ok: false, code: 'navigation-failed', message: 'このアドレスは開けません' }; }
    }

    private async pickMode(args: unknown): Promise<BrowserCommandResult> {
        const valid = validateBrowserArgs(BROWSER_PICK_MODE.id, args);
        if (!valid.ok) return valid;
        try {
            const widget = await this.widgets.getWidget<AssetSiteWidget>(AssetSiteWidget.ID);
            if (!widget?.isBrowser) return { ok: false, code: 'no-browser', message: 'ブラウザが開いていません' };
            await widget.setPickMode((args as { on: boolean }).on);
            return { ok: true };
        } catch { return { ok: false, code: 'operation-failed', message: '操作できませんでした' }; }
    }

    private async close(args: unknown): Promise<BrowserCommandResult> {
        const valid = validateBrowserArgs(BROWSER_CLOSE.id, args);
        if (!valid.ok) return valid;
        const widget = await this.widgets.getWidget<AssetSiteWidget>(AssetSiteWidget.ID);
        if (!widget?.isBrowser) return { ok: false, code: 'no-browser', message: 'ブラウザが開いていません' };
        await window.electronAkariProject.assetSite.close().catch(() => undefined);
        widget.close();
        return { ok: true };
    }
}
