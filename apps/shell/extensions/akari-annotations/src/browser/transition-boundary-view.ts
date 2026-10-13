import type { BoundaryBandGeometry } from '../common/transition-boundary-model';

export interface TransitionBoundaryViewInput {
    kind: 'band' | 'add' | 'blocked' | 'dead' | 'unknown';
    label: string;
    ariaLabel: string;
    previewUrl?: string;
    geometry?: BoundaryBandGeometry;
    leftPercent: number;
    rowTopPx: number;
    rowHeightPx: number;
    hidden: boolean;
    selected?: boolean;
    micro?: boolean;
}

/** Draw only the interactive center strip; its outer row remains available for clip edge grips. */
export function renderTransitionBoundaryView(button: HTMLButtonElement, input: TransitionBoundaryViewInput): void {
    button.type = 'button';
    button.className = `akari-transition-boundary akari-transition-boundary-${input.kind}`;
    button.setAttribute('aria-label', input.ariaLabel);
    button.title = input.ariaLabel;
    button.dataset.akariBoundaryKind = input.kind;
    button.style.left = `calc(${input.leftPercent}% + ${input.geometry?.leftPx ?? -11}px)`;
    button.style.top = `${input.rowTopPx + input.rowHeightPx / 2}px`;
    button.style.width = `${input.geometry?.widthPx ?? 22}px`;
    button.style.height = `${Math.max(input.kind === 'add' || input.kind === 'blocked' || input.kind === 'dead'
        ? 22 : 18, input.rowHeightPx * 0.45)}px`;
    button.dataset.akariBoundaryHidden = String(input.hidden);
    button.dataset.akariBoundarySelected = String(!!input.selected);
    button.dataset.akariBoundaryMicro = String(!!input.micro);
    const signature = JSON.stringify([input.kind, input.label, input.previewUrl,
        !!input.geometry?.freezeIncomingPx, !!input.geometry?.freezeOutgoingPx,
        (input.geometry?.widthPx ?? 0) >= 118]);
    if (button.dataset.akariBoundaryContent === signature) {
        const cut = button.querySelector<HTMLElement>('.akari-transition-boundary-cut');
        if (cut) cut.style.left = `${input.geometry?.cutPx ?? 0}px`;
        const incoming = button.querySelector<HTMLElement>('.akari-transition-boundary-freeze-incoming');
        if (incoming) incoming.style.width = `${input.geometry?.freezeIncomingPx ?? 0}px`;
        const outgoing = button.querySelector<HTMLElement>('.akari-transition-boundary-freeze-outgoing');
        if (outgoing) outgoing.style.width = `${input.geometry?.freezeOutgoingPx ?? 0}px`;
        return;
    }
    button.dataset.akariBoundaryContent = signature;
    button.replaceChildren();
    if (input.kind === 'band' || input.kind === 'unknown') {
        if (input.previewUrl && input.kind === 'band') {
            const preview = document.createElement('span');
            preview.className = 'akari-transition-boundary-preview';
            const image = document.createElement('img');
            image.src = input.previewUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.addEventListener('error', () => preview.remove());
            preview.appendChild(image);
            button.appendChild(preview);
        }
        for (const side of ['incoming', 'outgoing'] as const) {
            const width = side === 'incoming' ? input.geometry?.freezeIncomingPx : input.geometry?.freezeOutgoingPx;
            if (!width || width <= 0) continue;
            const freeze = document.createElement('span');
            freeze.className = `akari-transition-boundary-freeze akari-transition-boundary-freeze-${side}`;
            freeze.style.width = `${width}px`;
            button.appendChild(freeze);
        }
        if (input.geometry) {
            const cut = document.createElement('span');
            cut.className = 'akari-transition-boundary-cut';
            cut.style.left = `${input.geometry.cutPx}px`;
            button.appendChild(cut);
        }
        if ((input.geometry?.widthPx ?? 0) >= 118 || input.kind === 'unknown') {
            const title = document.createElement('span');
            title.className = 'akari-transition-boundary-label';
            title.textContent = input.kind === 'unknown'
                ? (input.geometry?.widthPx ?? 0) >= 118 ? `? ${input.label}` : '?'
                : input.label;
            button.appendChild(title);
        }
    } else {
        button.textContent = input.kind === 'dead' ? '!' : '+';
    }
}

export function renderSourceEdgeMarks(
    clip: HTMLElement,
    marks: { atSourceStart: boolean; atSourceEnd: boolean }
): void {
    clip.querySelectorAll('.akari-transition-source-edge').forEach(element => element.remove());
    for (const side of ['start', 'end'] as const) {
        if (side === 'start' ? !marks.atSourceStart : !marks.atSourceEnd) continue;
        const mark = document.createElement('span');
        mark.className = `akari-transition-source-edge akari-transition-source-edge-${side}`;
        mark.setAttribute('aria-hidden', 'true');
        clip.appendChild(mark);
    }
}
