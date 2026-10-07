import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';

interface CanvasState { open: boolean; count: number }

@injectable()
export class RoughCanvasDockTab implements VibeDockTabContribution {
    readonly id = 'canvas';
    readonly label = 'キャンバス';
    readonly icon = '✎';
    readonly order = 40;
    @inject(CommandService) protected readonly commands!: CommandService;

    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        const button = document.createElement('button');
        button.className = 'theia-button secondary';
        button.textContent = '開く';
        button.addEventListener('click', () => void this.commands.executeCommand('akari.sketch.open'));
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.textContent = '紙は開いていません';
        const onState = (event: Event): void => {
            const detail = (event as CustomEvent<CanvasState>).detail;
            if (!detail || typeof detail.open !== 'boolean' || !Number.isSafeInteger(detail.count) || detail.count < 0) return;
            status.textContent = detail.open ? `紙を開いています（${detail.count} 枚）` : '紙は開いていません';
        };
        window.addEventListener('akari.sketch.state', onState);
        host.append(button, status);
        return Disposable.create(() => {
            window.removeEventListener('akari.sketch.state', onState);
            host.replaceChildren();
        });
    }
}
