import { ContainerModule, inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core/lib/common';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { VibeDockState } from '../common/vibe-dock-state';
import { VibeDockTabContributionSymbol } from './vibe-dock-tabs';

@injectable()
export class NoteToTaskBridge implements FrontendApplicationContribution {
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;

    onStart(): void {
        this.state.onDidSubmitInstruction(input => { void this.submit(input); });
    }

    async submit(input: { text: string; mode: 'task' | 'send' }): Promise<void> {
        if (!input.text.trim()) return;
        const pointed = this.state.pointedTarget;
        try {
            const created = await this.commands.executeCommand<{ id: string }>('akari.tasks.create', {
                text: input.text, via: 'chat', ...(pointed ? { target: `ui:${pointed.target}` } : {})
            });
            if (!created?.id) throw new Error('タスクを作成できませんでした。');
            if (pointed && this.state.pointedTarget === pointed) this.state.consumePointed();
            if (input.mode === 'send') {
                await this.commands.executeCommand('akari.tasks.send', { ids: [created.id] });
            } else {
                this.messages.info('タスクにしました。');
            }
        } catch (error) {
            this.messages.error(`タスクを作れませんでした: ${String(error)}`);
        }
    }
}

export default new ContainerModule(bind => {
    // Browser bindings load only when Theia applies the module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FrontendApplicationContribution } = require('@theia/core/lib/browser');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NextVibeDockTab } = require('./next-tab');
    bind(NextVibeDockTab).toSelf().inSingletonScope();
    bind(VibeDockTabContributionSymbol).toService(NextVibeDockTab);
    bind(FrontendApplicationContribution).toService(NextVibeDockTab);
    bind(NoteToTaskBridge).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(NoteToTaskBridge);
});
