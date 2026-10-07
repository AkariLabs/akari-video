import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider, Disposable, Emitter, Event } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockState } from '../common/vibe-dock-state';

export const VibeDockTabContributionSymbol = Symbol('VibeDockTabContribution');

@injectable()
export class NowVibeDockTab implements VibeDockTabContribution {
    readonly id = 'now';
    readonly label = 'いま';
    readonly icon = '●';
    readonly order = 0;
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        const input = document.createElement('input');
        input.className = 'theia-input';
        input.placeholder = 'ここに書く';
        input.setAttribute('aria-label', 'いまのメモ');
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                this.state.submitNote(input.value);
                input.value = '';
            }
        });
        const empty = document.createElement('div');
        empty.textContent = '話したことがここに流れます';
        host.append(input, empty);
        return Disposable.create(() => host.replaceChildren());
    }
}

@injectable()
export class SettingsVibeDockTab implements VibeDockTabContribution {
    readonly id = 'settings';
    readonly label = '設定';
    readonly icon = '⚙';
    readonly order = 100;
    @inject(CommandService) protected readonly commands!: CommandService;
    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        const button = document.createElement('button');
        button.className = 'theia-button secondary';
        button.textContent = '設定を開く';
        button.addEventListener('click', () => void this.commands.executeCommand('akari.settings.open', { section: 'listening' }));
        const summary = document.createElement('div');
        summary.setAttribute('aria-label', '設定の要約');
        host.append(button, summary);
        return Disposable.create(() => host.replaceChildren());
    }
}

export function selectVibeDockTabs(contributions: readonly VibeDockTabContribution[]): VibeDockTabContribution[] {
    return contributions.filter(tab => tab.isAvailable?.() !== false).sort((a, b) => a.order - b.order);
}

@injectable()
export class VibeDockTabs {
    @inject(ContributionProvider) @named(VibeDockTabContributionSymbol)
    protected readonly provider!: ContributionProvider<VibeDockTabContribution>;
    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    protected badges = '';
    list(): VibeDockTabContribution[] { return selectVibeDockTabs(this.provider.getContributions()); }
    refreshBadges(): void {
        const badges = JSON.stringify(this.list().map(tab => [tab.id, tab.badge?.()]));
        if (badges !== this.badges) {
            this.badges = badges;
            this.changeEmitter.fire();
        }
    }
}
