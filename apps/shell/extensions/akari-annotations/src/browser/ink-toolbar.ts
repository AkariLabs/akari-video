import { INK_PALETTE } from '../common/ink-model';
import { InkLayer, InkTool } from './ink-layer';

/** Small, host-agnostic controls for the four tools and the content palette. */
export function createInkToolbar(layer: InkLayer): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '注釈の道具');
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
        button.className = 'theia-button quiet icon'; button.type = 'button';
        button.textContent = label; button.title = `${label} (${shortcut})`; button.dataset.tool = tool;
        button.addEventListener('click', () => { layer.setTool(tool); refresh(); });
        buttons.push(button); toolbar.appendChild(button);
    }
    for (const color of INK_PALETTE) {
        const button = document.createElement('button');
        button.className = 'theia-button secondary'; button.type = 'button';
        button.dataset.color = color; button.title = '線の色'; button.setAttribute('aria-label', `線の色 ${color}`);
        const swatch = document.createElement('span');
        swatch.style.display = 'inline-block'; swatch.style.width = '1em'; swatch.style.height = '1em';
        swatch.style.borderRadius = '50%'; swatch.style.backgroundColor = color;
        button.appendChild(swatch);
        button.addEventListener('click', () => { layer.setColor(color); refresh(); });
        buttons.push(button); toolbar.appendChild(button);
    }
    refresh();
    return toolbar;
}
