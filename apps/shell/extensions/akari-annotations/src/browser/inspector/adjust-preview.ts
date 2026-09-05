import { COMING_SOON_ADJUST_SECTIONS } from './tab-model';

export interface AdjustPreviewSection {
    id: string;
    label: typeof COMING_SOON_ADJUST_SECTIONS[number];
    build: () => HTMLElement;
}

function createPreviewRoot(id: string): HTMLDivElement {
    const root = document.createElement('div');
    root.className = `akari-adjust-preview akari-adjust-preview-${id}`;
    root.setAttribute('aria-disabled', 'true');
    root.setAttribute('data-akari-adjust-preview', id);
    root.style.pointerEvents = 'none';
    return root;
}

function createValueRow(label: string, value = '0'): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'akari-adjust-preview-row';
    const rowLabel = document.createElement('span');
    rowLabel.className = 'akari-adjust-preview-row-label';
    rowLabel.textContent = label;
    const valueBox = document.createElement('span');
    valueBox.className = 'akari-adjust-preview-value';
    valueBox.textContent = value;
    row.append(rowLabel, valueBox);
    return row;
}

function buildEffects(): HTMLElement {
    const root = createPreviewRoot('effects');
    for (const label of ['シャープ', 'ぼかし', 'ビネット', 'フィルムグレイン', 'グロー', 'クロマキー']) {
        root.appendChild(createValueRow(label));
    }
    return root;
}

export const ADJUST_PREVIEW_SECTIONS: readonly AdjustPreviewSection[] = [
    { id: 'effects', label: COMING_SOON_ADJUST_SECTIONS[0], build: buildEffects }
];
