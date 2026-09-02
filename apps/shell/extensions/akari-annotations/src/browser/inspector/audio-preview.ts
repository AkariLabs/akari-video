const AUDIO_PREVIEW_LABELS = [
    '音量',
    'フェード',
    '音声強調',
    'ダッキング',
    'A/V リンク',
    'ピッチ・タイム'
] as const;

export interface AudioPreviewSection {
    id: string;
    label: typeof AUDIO_PREVIEW_LABELS[number];
    build: () => HTMLElement;
}

function createPreviewRoot(id: string): HTMLDivElement {
    const root = document.createElement('div');
    root.className = `akari-adjust-preview akari-audio-preview akari-audio-preview-${id}`;
    root.setAttribute('aria-disabled', 'true');
    root.setAttribute('data-akari-audio-preview', id);
    root.style.pointerEvents = 'none';
    return root;
}

function createValueRow(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'akari-adjust-preview-row akari-audio-preview-row';
    const rowLabel = document.createElement('span');
    rowLabel.className = 'akari-adjust-preview-row-label';
    rowLabel.textContent = label;
    const valueBox = document.createElement('span');
    valueBox.className = 'akari-adjust-preview-value';
    valueBox.textContent = value;
    row.append(rowLabel, valueBox);
    return row;
}

function buildRows(id: string, rows: ReadonlyArray<readonly [string, string]>): HTMLElement {
    const root = createPreviewRoot(id);
    rows.forEach(([label, value]) => root.appendChild(createValueRow(label, value)));
    return root;
}

function buildVolume(): HTMLElement {
    return buildRows('volume', [
        ['ゲイン', '0.0 dB'],
        ['ミュート', 'オフ']
    ]);
}

function buildFades(): HTMLElement {
    return buildRows('fades', [
        ['fadeIn', '0.00 s'],
        ['fadeOut', '0.00 s']
    ]);
}

function buildEnhancement(): HTMLElement {
    return buildRows('enhancement', [
        ['ノイズ除去', '0'],
        ['ボイス分離', '0'],
        ['ラウドネス正規化', '−14 LUFS'],
        ['True Peak', '−1.0 dBTP']
    ]);
}

function buildDucking(): HTMLElement {
    return buildRows('ducking', [
        ['BGM を下げる', 'オフ'],
        ['深さ', '0 dB']
    ]);
}

function buildAvLink(): HTMLElement {
    return buildRows('av-link', [
        ['リンク', '維持'],
        ['J カット', '0.00 s'],
        ['L カット', '0.00 s']
    ]);
}

function buildPitchTime(): HTMLElement {
    return buildRows('pitch-time', [
        ['ピッチ保持', 'オン'],
        ['ピッチ', '±0 st']
    ]);
}

export const AUDIO_PREVIEW_SECTIONS: readonly AudioPreviewSection[] = [
    { id: 'volume', label: AUDIO_PREVIEW_LABELS[0], build: buildVolume },
    { id: 'fades', label: AUDIO_PREVIEW_LABELS[1], build: buildFades },
    { id: 'enhancement', label: AUDIO_PREVIEW_LABELS[2], build: buildEnhancement },
    { id: 'ducking', label: AUDIO_PREVIEW_LABELS[3], build: buildDucking },
    { id: 'av-link', label: AUDIO_PREVIEW_LABELS[4], build: buildAvLink },
    { id: 'pitch-time', label: AUDIO_PREVIEW_LABELS[5], build: buildPitchTime }
];

export const AUDIO_ITEM_PREVIEW_SECTIONS: readonly AudioPreviewSection[] = [
    AUDIO_PREVIEW_SECTIONS[2],
    AUDIO_PREVIEW_SECTIONS[5]
];
