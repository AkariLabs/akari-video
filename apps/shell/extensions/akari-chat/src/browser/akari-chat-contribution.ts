import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import type { ChatAttachment } from '../common/chat-attachments';
import { AkariChatWidget } from './akari-chat-widget';
import { markChatLastUsed } from './chat-last-used';

export const ChatCommands = {
    OPEN: { id: 'akari.chat.open', label: 'AKARI チャットを開く' } as Command,
    PREFILL: { id: 'akari.chat.prefill', label: 'AKARI チャットに入力' } as Command,
    ATTACH: { id: 'akari.chat.attach', label: 'AKARI チャットに添付' } as Command
};

@injectable()
export class AkariChatContribution implements CommandContribution {
    @inject(WidgetManager)
    protected readonly widgets!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(StorageService)
    protected readonly storage!: StorageService;

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
                const widget = await this.show();
                widget.prefill(arg.text);
            }
        });
        registry.registerCommand(ChatCommands.ATTACH, {
            execute: async (arg: { attachments: ChatAttachment[] }) => {
                const widget = await this.show();
                widget.attach(arg.attachments);
            }
        });
    }
}
