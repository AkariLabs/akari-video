import { t } from '@akari-video/i18n';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry, MessageService, PreferenceService } from '@theia/core/lib/common';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import type { ChatAttachment } from '../common/chat-attachments';
import { AkariChatWidget } from './akari-chat-widget';
import { markChatLastUsed } from './chat-last-used';
import { CHAT_ENABLED_PREFERENCE, chatCommandAllowed, chatEnabled, shouldCloseRestoredChat } from './chat-visibility';
import { AkariChatService } from '../common/chat-protocol';

export const ChatCommands = {
    OPEN: { id: 'akari.chat.open', label: t('chat.akariChatContribution.ui.openAkariAction') } as Command,
    PREFILL: { id: 'akari.chat.prefill', label: t('chat.akariChatContribution.ui.enterAkariLabel') } as Command,
    ATTACH: { id: 'akari.chat.attach', label: t('chat.akariChatContribution.ui.attachedAkariLabel') } as Command
};

@injectable()
export class AkariChatContribution implements CommandContribution, FrontendApplicationContribution {
    @inject(WidgetManager)
    protected readonly widgets!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(StorageService)
    protected readonly storage!: StorageService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(AkariChatService)
    protected readonly chat!: AkariChatService;

    private visibilityTail = Promise.resolve();

    private queueVisibility(): Promise<void> {
        this.visibilityTail = this.visibilityTail.then(() => this.syncVisibility()).catch(error => {
            console.warn(t('chat.akariChatContribution.ui.failedSwitchDisplayError'), error);
        });
        return this.visibilityTail;
    }

    private async syncVisibility(): Promise<void> {
        await this.preferences.ready;
        if (chatEnabled(this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false))) {
            const widget = await this.widgets.getOrCreateWidget<AkariChatWidget>(AkariChatWidget.ID);
            if (!widget.isAttached) await this.shell.addWidget(widget, { area: 'right', rank: 90 });
        } else {
            const widget = await this.widgets.getWidget<AkariChatWidget>(AkariChatWidget.ID);
            widget?.dispose();
            if (widget) await this.chat.closeAll().catch(error => console.warn(t('chat.akariChatContribution.ui.couldNotCloseConversationError'), error));
        }
    }

    onStart(): void {
        this.queueVisibility();
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === CHAT_ENABLED_PREFERENCE) this.queueVisibility();
        });
        this.shell.onDidAddWidget(widget => {
            if (shouldCloseRestoredChat(widget.id, this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false))) {
                void this.queueVisibility();
            }
        });
    }

    async onDidInitializeLayout(): Promise<void> {
        await this.queueVisibility();
    }

    private allowed(): boolean {
        if (chatCommandAllowed(this.preferences.get<boolean>(CHAT_ENABLED_PREFERENCE, false))) return true;
        void this.messages.info(t('chat.akariChatContribution.ui.akariChatTrialMustEnabledSettingsPartnerMessage'));
        return false;
    }

    private async show(): Promise<AkariChatWidget> {
        const widget = await this.widgets.getOrCreateWidget<AkariChatWidget>(AkariChatWidget.ID);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'right', rank: 90 });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ChatCommands.OPEN, {
            execute: async (arg?: { agent?: string; resumeLast?: boolean }) => {
                if (!this.allowed()) return;
                const widget = await this.show();
                if (arg?.agent) {
                    await widget.openAgent(arg.agent);
                }
                if (arg?.resumeLast) {
                    await widget.resumeLast();
                } else {
                    await markChatLastUsed(this.storage);
                }
            }
        });
        registry.registerCommand(ChatCommands.PREFILL, {
            execute: async (arg: { text: string }) => {
                if (!this.allowed()) return;
                const widget = await this.show();
                widget.prefill(arg.text);
            }
        });
        registry.registerCommand(ChatCommands.ATTACH, {
            execute: async (arg: { attachments: ChatAttachment[] }) => {
                if (!this.allowed()) return;
                const widget = await this.show();
                widget.attach(arg.attachments);
            }
        });
    }
}
