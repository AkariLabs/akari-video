import { COMING_SOON_ADJUST_SECTIONS } from './tab-model';

export interface AdjustPreviewSection {
    id: string;
    label: typeof COMING_SOON_ADJUST_SECTIONS[number];
    build: () => HTMLElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function buildBasicCorrection(): HTMLElement {
    const root = createPreviewRoot('basic');
    const rows: ReadonlyArray<readonly [string, string?]> = [
        ['露出', '0.00 EV'],
        ['コントラスト'],
        ['ハイライト'],
        ['シャドウ'],
        ['黒レベル'],
        ['白レベル'],
        ['色温度'],
        ['ティント'],
        ['自然な彩度'],
        ['彩度']
    ];
    rows.forEach(([label, value]) => root.appendChild(createValueRow(label, value)));
    return root;
}

function buildRgbCurve(): HTMLElement {
    const root = createPreviewRoot('rgb-curve');
    const channels = document.createElement('div');
    channels.className = 'akari-adjust-preview-channels';
    for (const channel of ['M', 'R', 'G', 'B']) {
        const chip = document.createElement('span');
        chip.className = `akari-adjust-preview-channel akari-adjust-preview-channel-${channel.toLowerCase()}`;
        if (channel === 'M') chip.className += ' is-active';
        chip.textContent = channel;
        channels.appendChild(chip);
    }

    const curve = document.createElementNS(SVG_NS, 'svg');
    curve.setAttribute('class', 'akari-adjust-preview-curve');
    curve.setAttribute('viewBox', '0 0 180 140');
    curve.setAttribute('aria-label', 'RGB カーブ（初期値）');
    const grid = document.createElementNS(SVG_NS, 'path');
    grid.setAttribute('class', 'akari-adjust-preview-curve-grid');
    grid.setAttribute('d', 'M45 0V140 M90 0V140 M135 0V140 M0 35H180 M0 70H180 M0 105H180');
    const identity = document.createElementNS(SVG_NS, 'path');
    identity.setAttribute('class', 'akari-adjust-preview-curve-identity');
    identity.setAttribute('d', 'M0 140L180 0');
    curve.append(grid, identity);
    root.append(channels, curve);
    return root;
}

function buildColorWheels(): HTMLElement {
    const root = createPreviewRoot('color-wheels');
    const grid = document.createElement('div');
    grid.className = 'akari-adjust-preview-wheel-grid';
    for (const label of ['Lift', 'Gamma', 'Gain', 'Offset']) {
        const item = document.createElement('div');
        item.className = 'akari-adjust-preview-wheel-item';
        const itemLabel = document.createElement('span');
        itemLabel.className = 'akari-adjust-preview-wheel-label';
        itemLabel.textContent = label;
        const wheel = document.createElement('div');
        wheel.className = 'akari-adjust-preview-wheel';
        const center = document.createElement('span');
        center.className = 'akari-adjust-preview-wheel-center';
        wheel.appendChild(center);
        const luminance = document.createElement('div');
        luminance.className = 'akari-adjust-preview-luminance';
        item.append(itemLabel, wheel, luminance);
        grid.appendChild(item);
    }
    root.appendChild(grid);
    return root;
}

function buildHueCurve(): HTMLElement {
    const root = createPreviewRoot('hue-curve');
    const curve = document.createElement('div');
    curve.className = 'akari-adjust-preview-hue-curve';
    const band = document.createElement('div');
    band.className = 'akari-adjust-preview-hue-band';
    const line = document.createElement('div');
    line.className = 'akari-adjust-preview-hue-line';
    curve.append(band, line);
    root.appendChild(curve);
    return root;
}

function buildLut(): HTMLElement {
    const root = createPreviewRoot('lut');
    const pickerRow = document.createElement('div');
    pickerRow.className = 'akari-adjust-preview-row akari-adjust-preview-lut-row';
    const picker = document.createElement('span');
    picker.className = 'akari-adjust-preview-ghost-button';
    picker.textContent = 'LUT (.cube) を選択';
    pickerRow.appendChild(picker);
    root.append(pickerRow, createValueRow('強度'));
    return root;
}

function buildEffects(): HTMLElement {
    const root = createPreviewRoot('effects');
    for (const label of ['シャープ', 'ぼかし', 'ビネット', 'フィルムグレイン', 'グロー', 'クロマキー']) {
        root.appendChild(createValueRow(label));
    }
    return root;
}

export const ADJUST_PREVIEW_SECTIONS: readonly AdjustPreviewSection[] = [
    { id: 'basic', label: COMING_SOON_ADJUST_SECTIONS[0], build: buildBasicCorrection },
    { id: 'rgb-curve', label: COMING_SOON_ADJUST_SECTIONS[1], build: buildRgbCurve },
    { id: 'color-wheels', label: COMING_SOON_ADJUST_SECTIONS[2], build: buildColorWheels },
    { id: 'hue-curve', label: COMING_SOON_ADJUST_SECTIONS[3], build: buildHueCurve },
    { id: 'lut', label: COMING_SOON_ADJUST_SECTIONS[4], build: buildLut },
    { id: 'effects', label: COMING_SOON_ADJUST_SECTIONS[5], build: buildEffects }
];
