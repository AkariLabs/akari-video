import { t } from '@akari-video/i18n';
import { INK_PALETTE } from '../common/ink-model';
import { InkLayer, InkTool } from './ink-layer';

/** Compact controls shared by the rough canvas and ink surfaces. */
export function createInkToolbar(layer: InkLayer): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'akari-rough-canvas-ink-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', t('annotations.inkToolbar.text.toolsOfAnnotation'));
    const segment = document.createElement('div');
    segment.className = 'akari-seg';
    segment.setAttribute('role', 'group');
    segment.setAttribute('aria-label', t('annotations.inkToolbar.text.tools'));
    const swatches = document.createElement('div');
    swatches.className = 'akari-rough-canvas-swatches';
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', t('annotations.inkToolbar.text.color'));
    const tools: Array<[InkTool, string, string]> = [
        ['select', t('annotations.inkToolbar.text.choose'), 'V'], ['pen', t('annotations.inkToolbar.text.pen'), 'P'], ['arrow', t('annotations.inkToolbar.text.arrow'), 'A'], ['text', t('annotations.inkToolbar.text.characters'), 'T']
    ];
    const buttons: HTMLButtonElement[] = [];
    const refresh = (): void => {
        for (const button of buttons) {
            if (button.dataset.tool) button.setAttribute('aria-pressed', String(layer.getTool() === button.dataset.tool));
            if (button.dataset.color) button.setAttribute('aria-pressed', String(layer.getColor() === button.dataset.color));
        }
    };
    for (const [tool, label, shortcut] of tools) {
        const button = document.createElement('button');
        button.className = 'theia-button quiet small'; button.type = 'button';
        button.textContent = label; button.title = `${label} (${shortcut})`; button.dataset.tool = tool;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => { layer.setTool(tool); refresh(); });
        buttons.push(button); segment.appendChild(button);
    }
    const colorNames = [t('annotations.inkToolbar.text.orange'), t('annotations.inkToolbar.text.blue'), t('annotations.inkToolbar.text.black')];
    for (const [index, color] of [INK_PALETTE[0], INK_PALETTE[1], INK_PALETTE[4]].entries()) {
        const button = document.createElement('button');
        button.className = 'theia-button quiet small icon akari-rough-canvas-swatch'; button.type = 'button';
        button.dataset.color = color; button.title = t('annotations.inkToolbar.text.lineColor', { color: colorNames[index] });
        button.setAttribute('aria-label', t('annotations.inkToolbar.text.lineColor', { color: colorNames[index] }));
        const swatch = document.createElement('span');
        swatch.style.backgroundColor = color;
        button.appendChild(swatch);
        button.addEventListener('click', () => { layer.setColor(color); refresh(); });
        buttons.push(button); swatches.appendChild(button);
    }
    layer.onToolChange(refresh);
    toolbar.append(segment, swatches);
    refresh();
    return toolbar;
}
