import { INK_PALETTE } from '../common/ink-model';
import { InkLayer, InkTool } from './ink-layer';

/** Compact controls shared by the rough canvas and ink surfaces. */
export function createInkToolbar(layer: InkLayer): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'akari-rough-canvas-ink-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '注釈の道具');
    const segment = document.createElement('div');
    segment.className = 'akari-seg';
    segment.setAttribute('role', 'group');
    segment.setAttribute('aria-label', '道具');
    const swatches = document.createElement('div');
    swatches.className = 'akari-rough-canvas-swatches';
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', '色');
    const tools: Array<[InkTool, string, string]> = [
        ['select', '選ぶ', 'V'], ['pen', 'ペン', 'P'], ['arrow', '矢印', 'A'], ['text', '文字', 'T']
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
    const colorNames = ['オレンジ', '青', '黒'];
    for (const [index, color] of [INK_PALETTE[0], INK_PALETTE[1], INK_PALETTE[4]].entries()) {
        const button = document.createElement('button');
        button.className = 'theia-button quiet small icon akari-rough-canvas-swatch'; button.type = 'button';
        button.dataset.color = color; button.title = `線の色: ${colorNames[index]}`;
        button.setAttribute('aria-label', `線の色: ${colorNames[index]}`);
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
