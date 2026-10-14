import { t } from '@akari-video/i18n';
const AUDIO_PREVIEW_LABELS = [
    t('inspector.audioPreview.label.volume'),
    t('inspector.audioPreview.label.fade'),
    t('inspector.audioPreview.label.audioHighlighting'),
    t('inspector.audioPreview.label.ducking'),
    t('inspector.audioPreview.label.vLink'),
    t('inspector.audioPreview.label.pitchTime')
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
        [t('inspector.audioPreview.label.gain'), '0.0 dB'],
        [t('inspector.audioPreview.label.mute'), t('inspector.audioPreview.label.off')]
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
        [t('inspector.audioPreview.label.noiseReductionPerClip'), '0'],
        [t('inspector.audioPreview.label.voiceIsolation'), '0']
    ]);
}

function buildDucking(): HTMLElement {
    return buildRows('ducking', [
        [t('inspector.audioPreview.label.lowerBgm'), t('inspector.audioPreview.label.off')],
        [t('inspector.audioPreview.label.depth'), '0 dB']
    ]);
}

function buildAvLink(): HTMLElement {
    return buildRows('av-link', [
        [t('inspector.audioPreview.action.link'), t('inspector.audioPreview.label.keep')],
        [t('inspector.audioPreview.label.jCut'), '0.00 s'],
        [t('inspector.audioPreview.label.lCut'), '0.00 s']
    ]);
}

function buildPitchTime(): HTMLElement {
    return buildRows('pitch-time', [
        [t('inspector.audioPreview.label.pitchRetention'), t('inspector.audioPreview.label.message')],
        [t('inspector.audioPreview.label.pitch'), '±0 st']
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

export const AUDIO_ITEM_PREVIEW_SECTIONS: readonly AudioPreviewSection[] = [];
