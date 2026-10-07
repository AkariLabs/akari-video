import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider, Disposable, Emitter, Event } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockState } from '../common/vibe-dock-state';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarStatus } from '../common/ear-protocol';
import { EAR_ENGINE_LABELS, EarCapabilities, effectiveVibeMode, readEngine, readVibeMode, resolveEarEngine, VIBE_MODE_LABELS } from '../common/vibe-mode';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';

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
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;
    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        let disposed = false;
        let capabilities: EarCapabilities = { engines: [] };
        let mic: EarStatus['mic'] = lastKnownListeningMic;
        const button = document.createElement('button');
        button.className = 'theia-button secondary';
        button.textContent = '設定を開く';
        button.addEventListener('click', () => void this.commands.executeCommand('akari.settings.open', { section: 'listening' }));
        const summary = document.createElement('div');
        summary.setAttribute('aria-label', '設定の要約');
        host.append(button, summary);
        const paint = (): void => {
            const engine = resolveEarEngine(this.preferences, capabilities);
            const engineLabel = readEngine(this.preferences) === 'auto' && !engine ? EAR_ENGINE_LABELS.auto
                : engine ? EAR_ENGINE_LABELS[engine] : EAR_ENGINE_LABELS[readEngine(this.preferences)];
            const mode = effectiveVibeMode({
                mode: readVibeMode(this.preferences),
                companionEnabled: this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false,
                liveAvailable: capabilities.engines.some(value => value.id === 'speechanalyzer-live' && value.available)
            });
            const lines = [
                `聞き取り: ${engineLabel}`,
                `Jev: ${VIBE_MODE_LABELS[mode.mode]}`,
                `マイク: ${mic === 'ok' ? '許可あり' : mic === 'denied' ? '許可なし' : '未確認'}`
            ];
            summary.replaceChildren(...lines.map(line => {
                const row = document.createElement('div');
                row.textContent = line;
                return row;
            }));
        };
        paint();
        const statusSubscription = this.ear.onStatus(status => {
            if (status.mic === 'ok' || status.mic === 'denied') {
                mic = status.mic; rememberListeningMic(mic); if (!disposed) paint();
            }
        });
        const preferenceSubscription = this.preferences.onPreferenceChanged(change => {
            if (['akari.listening.engine', 'akari.vibe.mode', 'akari.companion.enabled'].includes(change.preferenceName) && !disposed) { paint(); }
        });
        void this.ear.capabilities().then(value => { if (!disposed) { capabilities = value; paint(); } });
        return Disposable.create(() => {
            disposed = true;
            statusSubscription.dispose();
            preferenceSubscription.dispose();
            host.replaceChildren();
        });
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
