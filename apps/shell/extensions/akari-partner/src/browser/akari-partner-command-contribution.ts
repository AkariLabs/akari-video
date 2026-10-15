import { t } from '../common/partner-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { ShellTerminalServerProxy } from '@theia/terminal/lib/common/shell-terminal-protocol';
import { AkariPartnerWidget } from './akari-partner-widget';
import { PartnerTerminal } from './partner-session-service';
import { PartnerWebWidget } from './akari-partner-web-widget';
import { TerminalPartnerChannel } from './partner-channel';
import { PartnerActivityService } from './partner-activity-service';
import { typedPromptText } from '../common/type-prompt';
import { PARTNER_CATALOG } from './partner-catalog';
import { resolveDeliveryTarget } from '../common/delivery-target';
import { insertReviewText, partnerReviewTarget, PartnerReviewTarget } from './partner-review-target';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { CHAT_ENABLED_PREFERENCE, visibleReviewKind } from './partner-chat-visibility';
import { choosePromptPartner, ForegroundWidget, PromptPartnerTarget, rememberPromptPartner } from '../common/prompt-partner-target';

import { resolvePromptRoute } from '../common/prompt-route';
import { activePartnerTerminals, stopPartnerTerminals } from './partner-terminal-shutdown';

type ReviewWidget = { id: string; isAttached: boolean; isDisposed: boolean;
    kind?: string; title: { caption: string }; options?: { attributes?: Record<string, string | null> } };

export function partnerPanelWidth(windowWidth: number, currentWidth: number | undefined): number | undefined {
    return currentWidth === undefined || currentWidth > windowWidth * 0.4
        ? Math.min(400, Math.round(windowWidth * 0.36)) : undefined;
}

/**
 * ホーム v2（task.md 2026-07-21-home-flow）向けの薄いコマンド境界。
 *
 * akari-surfaces の接続ゲート／進め方フォームは、akari-partner の内部実装
 * （AkariPartnerWidget のフィールドや PartnerChannel の型）に直接依存せず、
 * このコマンド 2 本だけを呼ぶ。理由は 2 つ:
 * 1. 拡張間の TypeScript 型 import は `apps/shell/package.json` の
 *    `build:ext`（`tsc -b extensions/akari-shell-strip extensions/akari-surfaces
 *    extensions/akari-project extensions/akari-partner ...`）の並び上、
 *    akari-surfaces が akari-partner より先にビルドされるため、コンパイル時の
 *    型解決が壊れる（ビルド順を変えない限り）。
 * 2. CommandService 経由の呼び出しは Theia の標準的な拡張間連携パターンであり、
 *    どちらの拡張も相手の内部構造を知らずに済む。
 *
 * 「PartnerChannel / 隠しターミナル sendText の最小 DI 公開」という指示は、
 * このコマンド越しに同じ送信経路（`AkariPartnerWidget` が保持する
 * `PartnerChannel#send`）を再利用することで満たす。
 */
export const AkariPartnerCommands = {
    LOGIN_CLAUDE: { id: 'akari.partner.loginClaude', label: t('partner.akariPartnerCommandContribution.ui.loginClaudeCodeLabel') } as Command,
    OPEN: {
        id: 'akari.partner.open',
        label: t('partner.navigation.commands.openPartnerAction')
    } as Command,
    BEGIN_ONBOARDING: {
        id: 'akari.partner.beginOnboarding',
        label: t('partner.navigation.commands.connectAiPartnerAction')
    } as Command,
    SEND_TO_PARTNER: {
        id: 'akari.partner.send',
        label: t('partner.navigation.commands.sendMessagePartnerAction')
    } as Command,
    /**
     * 輸入リスト④（素材カード「エージェントに頼む」）向けの注入コマンド。
     * CLI は SEND_TO_PARTNER と同じ経路で送り、拡張と web はコピーして入力欄を示す。
     * SEND_TO_PARTNER 自体の挙動（home-flow が使う）は変えない。
     */
    INJECT_PROMPT: {
        id: 'akari.partner.injectPrompt',
        label: t('partner.navigation.commands.sendContextPacketPartnerText')
    } as Command,
    DELIVERY_TARGET: { id: 'akari.partner.deliveryTarget' } as Command,
    IS_BUSY: { id: 'akari.partner.isBusy' } as Command,
    CURRENT: { id: 'akari.partner.current' } as Command,
    INSERT_TEXT: { id: 'akari.partner.insertText' } as Command,
    STOP_FOR_GUIDE: { id: 'akari.partner.stopForGuide' } as Command,
    HAS_LIVE_FOR_GUIDE: { id: 'akari.partner.hasLiveForGuide' } as Command,
    TYPE_PROMPT: { id: 'akari.partner.typePrompt', label: t('partner.navigation.commands.typeInPartnerInputAction') } as Command
};

@injectable()
export class AkariPartnerCommandContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(TerminalService)
    protected readonly terminals!: TerminalService;
    @inject(ShellTerminalServerProxy)
    protected readonly terminalServer!: ShellTerminalServerProxy;

    @inject(ClipboardService)
    protected readonly clipboard!: ClipboardService;

    @inject(PartnerActivityService)
    protected readonly activity!: PartnerActivityService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    protected liveTerminal() {
        return this.terminals.all.find(terminal => terminal.kind === PartnerTerminal.KIND &&
            !terminal.isDisposed && !terminal.exitStatus && terminal.terminalId >= 0);
    }

    protected lastReviewWidgetId?: string;
    protected lastPromptPartnerId?: string;

    protected promptTargets(web?: PartnerWebWidget): PromptPartnerTarget[] {
        const extensionViewIds = PARTNER_CATALOG.filter(entry => entry.form === 'extension')
            .flatMap(entry => entry.form === 'extension' ? entry.viewContainerIds : []);
        return [
            ...this.terminals.all.filter(terminal => terminal.kind === PartnerTerminal.KIND)
                .map(terminal => ({ id: terminal.id, form: 'terminal' as const,
                    live: !terminal.isDisposed && !terminal.exitStatus && terminal.terminalId >= 0 })),
            ...(web ? [{ id: web.id, form: 'web' as const, live: !web.isDisposed && web.isRunning() }] : []),
            ...this.shell.widgets.filter(widget => extensionViewIds.some(id => widget.id === `plugin-view-container:${id}`))
                .map(widget => ({ id: widget.id, form: 'extension' as const,
                    live: widget.isAttached && !widget.isDisposed }))
        ];
    }

    protected rememberForegroundPartner(widget?: ForegroundWidget): void {
        const web = this.shell.widgets.find(widget => widget.id === PartnerWebWidget.ID) as PartnerWebWidget | undefined;
        this.lastPromptPartnerId = rememberPromptPartner(this.lastPromptPartnerId, widget, this.promptTargets(web));
    }

    protected currentReviewWidget(): ReviewWidget | undefined {
        const current = this.shell.rightPanelHandler.tabBar.currentTitle?.owner;
        if (current && !current.isDisposed && current.isAttached) {
            const widget = current as ReviewWidget;
            const agent = widget.options?.attributes?.['akari.partner'] ?? undefined;
            const target = partnerReviewTarget({ id: widget.id, kind: widget.kind, agent, caption: widget.title.caption }, PARTNER_CATALOG);
            if (target && visibleReviewKind(target.kind, this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false))) {
                this.lastReviewWidgetId = widget.id;
                return widget;
            }
        }
        return this.shell.widgets.find(widget => widget.id === this.lastReviewWidgetId && widget.isAttached && !widget.isDisposed
            && (widget.id !== 'akari-chat-widget' || this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false))) as ReviewWidget | undefined
            ?? this.liveTerminal() as ReviewWidget | undefined;
    }

    protected reviewTarget(): PartnerReviewTarget | undefined {
        const widget = this.currentReviewWidget();
        if (!widget) return undefined;
        const agent = widget.options?.attributes?.['akari.partner'] ?? undefined;
        const target = partnerReviewTarget({ id: widget.id, kind: widget.kind, agent, caption: widget.title.caption }, PARTNER_CATALOG);
        return target && visibleReviewKind(target.kind, this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false)) ? target : undefined;
    }

    protected extensionTarget(webRunning: boolean) {
        const visibleWidgetIds = this.shell.widgets.filter(candidate => candidate.isVisible).map(candidate => candidate.id);
        const visible = resolveDeliveryTarget({ visibleWidgetIds, catalog: PARTNER_CATALOG });
        if (visible.form === 'extension') return visible;
        if (webRunning) return undefined;
        const attachedWidgetIds = this.shell.widgets.filter(candidate => candidate.isAttached).map(candidate => candidate.id);
        const attached = resolveDeliveryTarget({ visibleWidgetIds: attachedWidgetIds, catalog: PARTNER_CATALOG });
        return attached.form === 'extension' ? attached : undefined;
    }

    registerCommands(registry: CommandRegistry): void {
        this.shell.onDidChangeActiveWidget(change => {
            this.currentReviewWidget();
            this.rememberForegroundPartner(change.newValue ?? undefined);
        });
        this.shell.onDidChangeCurrentWidget(change => {
            this.currentReviewWidget();
            this.rememberForegroundPartner(change.newValue ?? undefined);
        });
        this.rememberForegroundPartner(this.shell.activeWidget);
        registry.registerCommand(AkariPartnerCommands.CURRENT, { execute: () => this.reviewTarget() });
        registry.registerCommand(AkariPartnerCommands.INSERT_TEXT, {
            execute: async (request: { text?: unknown }): Promise<boolean> => {
                if (typeof request?.text !== 'string' || this.reviewTarget()?.kind !== 'terminal') return false;
                const widget = this.currentReviewWidget();
                const terminal = this.terminals.all.find(candidate => candidate.id === widget?.id &&
                    candidate.kind === PartnerTerminal.KIND && !candidate.isDisposed && !candidate.exitStatus && candidate.terminalId >= 0);
                if (!terminal) return false;
                try {
                    await this.shell.activateWidget(terminal.id);
                    insertReviewText(terminal, request.text);
                    return true;
                } catch { return false; }
            }
        });
        registry.registerCommand(AkariPartnerCommands.LOGIN_CLAUDE, { execute: async () => {
            const entry = PARTNER_CATALOG.find(candidate => candidate.agent === 'claude' && candidate.form === 'cli');
            if (!entry) return;
            const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
            if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'right', rank: 100 });
            await this.shell.activateWidget(widget.id);
            await widget.begin(entry);
        } });

        window.addEventListener('akari.onboarding.revealPartner', () => {
            void registry.executeCommand(AkariPartnerCommands.OPEN.id).catch(error =>
                console.warn('[akari-onboarding] partner could not be revealed:', error));
        });
        registry.registerCommand(AkariPartnerCommands.OPEN, {
            execute: async () => {
                const handler = (this.shell as unknown as { rightPanelHandler?: { container: { node: HTMLElement } } }).rightPanelHandler;
                if (handler) {
                    const expanded = this.shell.isExpanded('right');
                    const current = expanded ? handler.container.node.getBoundingClientRect().width : undefined;
                    const size = partnerPanelWidth(window.innerWidth, current);
                    if (size !== undefined) {
                        this.shell.resize(size, 'right');
                    }
                }
                const terminal = this.liveTerminal();
                if (terminal) {
                    await this.shell.revealWidget(terminal.id);
                    return;
                }
                const web = await this.widgetManager.getWidget<PartnerWebWidget>(PartnerWebWidget.ID);
                if (web?.isRunning()) {
                    await this.shell.revealWidget(web.id);
                    return;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                if (!widget.isAttached) {
                    await this.shell.addWidget(widget, { area: 'right', rank: 100 });
                }
                await this.shell.activateWidget(widget.id);
            }
        });
        registry.registerCommand(AkariPartnerCommands.IS_BUSY, {
            execute: () => this.activity.anyBusy
        });
        registry.registerCommand(AkariPartnerCommands.STOP_FOR_GUIDE, {
            execute: () => stopPartnerTerminals(this.terminals.all, id => this.terminalServer.close(id))
        });
        registry.registerCommand(AkariPartnerCommands.HAS_LIVE_FOR_GUIDE, {
            execute: () => activePartnerTerminals(this.terminals.all).length > 0
        });
        registry.registerCommand(AkariPartnerCommands.TYPE_PROMPT, {
            execute: async (text: unknown): Promise<'typed' | 'no-partner' | 'unsupported'> => {
                if (typeof text !== 'string') return 'unsupported';
                const web = await this.widgetManager.getWidget<PartnerWebWidget>(PartnerWebWidget.ID);
                const target = choosePromptPartner(this.lastPromptPartnerId, this.promptTargets(web));
                if (target?.form === 'terminal') {
                    const terminal = this.terminals.all.find(candidate => candidate.id === target.id);
                    if (!terminal) return 'no-partner';
                    const channel = new TerminalPartnerChannel(terminal);
                    try { channel.type(typedPromptText(text)); }
                    finally { channel.dispose(); }
                    await this.shell.activateWidget(terminal.id);
                    return 'typed';
                }
                if (target) {
                    await this.clipboard.writeText(text);
                    return 'unsupported';
                }
                return 'no-partner';
            }
        });
        registry.registerCommand(AkariPartnerCommands.BEGIN_ONBOARDING, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                await widget.beginRecommended();
            }
        });
        registry.registerCommand(AkariPartnerCommands.SEND_TO_PARTNER, {
            execute: async (text: unknown) => {
                if (typeof text !== 'string' || !text.trim()) {
                    return false;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                return widget.sendFromExternal(text);
            }
        });
        registry.registerCommand(AkariPartnerCommands.INJECT_PROMPT, {
            execute: async (text: unknown): Promise<true | 'copied' | false> => {
                if (typeof text !== 'string' || !text.trim()) {
                    return false;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                const terminal = this.liveTerminal();
                const web = await this.widgetManager.getWidget<PartnerWebWidget>(PartnerWebWidget.ID);
                const webRunning = !!web?.isRunning();
                const extension = this.extensionTarget(webRunning);
                let route = resolvePromptRoute({
                    hasChannel: widget.hasDeliveryChannel,
                    hasLiveTerminal: !!terminal,
                    visibleExtension: extension?.agent
                        ? { agent: extension.agent, focusCommandId: extension.focusCommandId } : undefined,
                    webPartner: webRunning && web?.agentId ? { agent: web.agentId } : undefined
                });
                if (route.route === 'pty' && widget.sendFromExternal(text)) return true;
                if (route.route === 'reattach-pty') {
                    if (terminal && widget.reattachDeliveryTerminal(terminal) && widget.sendFromExternal(text)) return true;
                    route = resolvePromptRoute({
                        hasChannel: false,
                        hasLiveTerminal: false,
                        visibleExtension: extension?.agent
                            ? { agent: extension.agent, focusCommandId: extension.focusCommandId } : undefined,
                        webPartner: webRunning && web?.agentId ? { agent: web.agentId } : undefined
                    });
                }
                if (route.route === 'copy') {
                    try { await this.clipboard.writeText(text); }
                    catch {
                        this.messages.warn(t('partner.navigation.commands.couldNotCopyRequestCopyManuallyWarning', { request: text }));
                        return false;
                    }
                    if (route.form === 'extension' && route.focusCommandId) {
                        try { await registry.executeCommand(route.focusCommandId); }
                        catch { /* コピーした依頼文はそのまま使える。 */ }
                    }
                    if (route.form === 'web' && web) {
                        try { await this.shell.revealWidget(web.id); }
                        catch { /* コピーした依頼文はそのまま使える。 */ }
                    }
                    const name = PARTNER_CATALOG.find(entry => entry.form === route.form && entry.agent === route.agent)?.name ?? route.agent;
                    this.messages.info(t('partner.navigation.commands.requestCopiedPastePartnerInputInfo', { name }));
                    return 'copied';
                }
                const open = t('partner.navigation.commands.openPartnerAction');
                const copy = t('partner.navigation.commands.copyRequestAction');
                void this.messages.warn(t('partner.navigation.commands.partnerNotOpenWarning'), open, copy)
                    .then(async choice => {
                        if (choice === open) {
                            try {
                                await this.clipboard.writeText(text);
                                this.messages.info(t('partner.navigation.commands.requestCopiedOpenPartnerInfo'));
                            } catch {
                                await this.messages.warn(t('partner.navigation.commands.couldNotCopyRequestCopyManuallyWarning', { request: text }));
                            }
                            try { await registry.executeCommand(AkariPartnerCommands.OPEN.id); }
                            catch { /* 元の案内は表示済み。 */ }
                        }
                        if (choice === copy) {
                            try { await this.clipboard.writeText(text); }
                            catch { await this.messages.warn(t('partner.navigation.commands.couldNotCopyRequestCopyManuallyWarning', { request: text })); }
                        }
                    }).catch(() => undefined);
                return false;
            }
        });
        registry.registerCommand(AkariPartnerCommands.DELIVERY_TARGET, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                const web = await this.widgetManager.getWidget<PartnerWebWidget>(PartnerWebWidget.ID);
                return resolveDeliveryTarget({
                    cliAgent: widget.deliveryChannelAgent,
                    webAgent: web?.isRunning() ? web.agentId : undefined,
                    visibleWidgetIds: this.shell.widgets.filter(candidate => candidate.isAttached).map(candidate => candidate.id),
                    catalog: PARTNER_CATALOG
                });
            }
        });
    }
}

// begin() の呼び出し元がカタログの中身を知らなくて済むよう、推奨エントリの
// 選定はここ（コマンド境界）に置く。PARTNER_CATALOG 自体は既存 T4 の資産。
export function recommendedPartnerEntry(): typeof PARTNER_CATALOG[number] | undefined {
    return PARTNER_CATALOG.find(entry => entry.recommended) ?? PARTNER_CATALOG[0];
}
