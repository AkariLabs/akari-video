import { t } from './vibe-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';

interface CanvasState { open: boolean; count: number }

@injectable()
export class RoughCanvasDockTab implements VibeDockTabContribution {
    readonly id = 'canvas';
    readonly label = t('vibe.dock.canvasTab.canvasLabel');
    readonly icon = 'canvas';
    readonly order = 40;
    @inject(CommandService) protected readonly commands!: CommandService;

    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        const button = document.createElement('button');
        button.className = 'akari-vibe-nav';
        button.textContent = t('vibe.dock.canvasTab.openCanvasTabText');
        button.title = t('vibe.dock.canvasTab.openCanvasTabTooltip');
        button.setAttribute('aria-label', t('vibe.dock.canvasTab.openCanvasTabAriaLabel'));
        button.addEventListener('click', () => void this.commands.executeCommand('akari.sketch.open'));
        const status = document.createElement('div');
        status.className = 'akari-vibe-nav';
        status.setAttribute('role', 'status');
        status.textContent = t('vibe.dock.canvasTab.noPaperOpenText');
        const onState = (event: Event): void => {
            const detail = (event as CustomEvent<CanvasState>).detail;
            if (!detail || typeof detail.open !== 'boolean' || !Number.isSafeInteger(detail.count) || detail.count < 0) return;
            status.textContent = detail.open ? t('vibe.dock.canvasTab.paperOpenSheetsWithCountDescription', { value1: detail.count }) : t('vibe.dock.canvasTab.noPaperOpenDescription');
        };
        window.addEventListener('akari.sketch.state', onState);
        host.append(button, status);
        return Disposable.create(() => {
            window.removeEventListener('akari.sketch.state', onState);
            host.replaceChildren();
        });
    }
}
