import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { AkariPartnerWidget } from './akari-partner-widget';
import { PartnerTerminal } from './partner-session-service';
import { PartnerWebWidget } from './akari-partner-web-widget';
import { TerminalPartnerChannel } from './partner-channel';
import { PartnerActivityService } from './partner-activity-service';
import { typedPromptText } from '../common/type-prompt';
import { PARTNER_CATALOG } from './partner-catalog';
import { resolveDeliveryTarget } from '../common/delivery-target';

// ホームの接続案内カード（「パートナーに接続する」CTA）は裁定 C4 により撤去済み
// （task 2026-08-17-home-launcher-popup）。接続は右側「パートナーを追加」パネルが正。
const PARTNER_NOT_CONNECTED_MESSAGE = 'パートナー未接続。右側の「パートナーを追加」パネルから接続してください';

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
    OPEN: {
        id: 'akari.partner.open',
        label: 'パートナーを開く'
    } as Command,
    BEGIN_ONBOARDING: {
        id: 'akari.partner.beginOnboarding',
        label: 'AI パートナーに接続する'
    } as Command,
    SEND_TO_PARTNER: {
        id: 'akari.partner.send',
        label: 'パートナーにメッセージを送る'
    } as Command,
    /**
     * 輸入リスト④（素材カード「エージェントに頼む」）向けの注入コマンド。
     * SEND_TO_PARTNER と同じ送信経路（AkariPartnerWidget#sendFromExternal →
     * PartnerChannel#send）を再利用するが、未接続時に日本語トーストで案内する
     * 点が異なる。SEND_TO_PARTNER 自体の挙動（home-flow が使う）は変えない
     * ため、既存コマンドを改造せず別コマンドとして追加する。
     */
    INJECT_PROMPT: {
        id: 'akari.partner.injectPrompt',
        label: '文脈パケットをパートナーへ送る'
    } as Command,
    DELIVERY_TARGET: { id: 'akari.partner.deliveryTarget' } as Command,
    IS_BUSY: { id: 'akari.partner.isBusy' } as Command,
    TYPE_PROMPT: { id: 'akari.partner.typePrompt', label: 'パートナーの入力欄に書く' } as Command
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

    @inject(ClipboardService)
    protected readonly clipboard!: ClipboardService;

    @inject(PartnerActivityService)
    protected readonly activity!: PartnerActivityService;

    protected liveTerminal() {
        return this.terminals.all.find(terminal => terminal.kind === PartnerTerminal.KIND &&
            !terminal.isDisposed && !terminal.exitStatus && terminal.terminalId >= 0);
    }

    registerCommands(registry: CommandRegistry): void {
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
        registry.registerCommand(AkariPartnerCommands.TYPE_PROMPT, {
            execute: async (text: unknown): Promise<'typed' | 'no-partner' | 'unsupported'> => {
                if (typeof text !== 'string') return 'unsupported';
                const terminal = this.liveTerminal();
                if (terminal) {
                    const channel = new TerminalPartnerChannel(terminal);
                    try { channel.type(typedPromptText(text)); }
                    finally { channel.dispose(); }
                    await this.shell.activateWidget(terminal.id);
                    return 'typed';
                }
                const web = await this.widgetManager.getWidget<PartnerWebWidget>(PartnerWebWidget.ID);
                const extensionViewIds = PARTNER_CATALOG.filter(entry => entry.form === 'extension')
                    .flatMap(entry => entry.form === 'extension' ? entry.viewContainerIds : []);
                if (web?.isRunning() || this.shell.widgets.some(widget => widget.isAttached &&
                    extensionViewIds.some(id => widget.id === `plugin-view-container:${id}`))) {
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
            execute: async (text: unknown) => {
                if (typeof text !== 'string' || !text.trim()) {
                    return false;
                }
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                const sent = widget.sendFromExternal(text);
                if (!sent) {
                    this.messages.warn(PARTNER_NOT_CONNECTED_MESSAGE);
                }
                return sent;
            }
        });
        registry.registerCommand(AkariPartnerCommands.DELIVERY_TARGET, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariPartnerWidget>(AkariPartnerWidget.ID);
                return resolveDeliveryTarget({
                    cliAgent: widget.deliveryChannelAgent,
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
