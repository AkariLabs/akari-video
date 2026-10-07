import { buildCorrectedSegments, CorrectedApplied } from '../common/corrected-text-model';

export function ensureCorrectedTextStyles(): void {
    if (document.getElementById('akari-corrected-text-style')) return;
    const style = document.createElement('style');
    style.id = 'akari-corrected-text-style';
    style.textContent = `
.akari-corrected-word { text-decoration: underline dotted color-mix(in srgb, var(--akari-accent) 55%, transparent); text-underline-offset: 3px; }
html[data-akari-corrections="false"] .akari-corrected-word { text-decoration: none; }
.akari-corrected-actions { display: inline-flex; gap: 4px; margin-inline-start: 5px; }
.akari-corrected-actions[hidden] { display: none; }
`;
    document.head.append(style);
}

export function renderCorrectedText(host: HTMLElement,
    utterance: { raw: string; text: string; applied: CorrectedApplied[] },
    actions: { onRevert(entryId: string): void; onOpen(entryId: string): void }): void {
    ensureCorrectedTextStyles();
    host.replaceChildren();
    for (const segment of buildCorrectedSegments(utterance.text, utterance.applied)) {
        if (!segment.applied) { host.append(document.createTextNode(segment.text)); continue; }
        const item = segment.applied;
        const wrapper = document.createElement('span');
        wrapper.className = 'akari-corrected-word';
        wrapper.title = `聞こえたまま: ${item.from}`;
        wrapper.tabIndex = 0;
        wrapper.append(document.createTextNode(segment.text));
        const controls = document.createElement('span');
        controls.className = 'akari-corrected-actions';
        controls.hidden = true;
        const revert = document.createElement('button');
        revert.className = 'theia-button secondary';
        revert.type = 'button';
        revert.textContent = '元に戻す';
        revert.onclick = () => {
            const range = item.range!;
            utterance.text = utterance.text.slice(0, range[0]) + item.from + utterance.text.slice(range[1]);
            const shift = item.from.length - item.to.length;
            utterance.applied = utterance.applied.filter(applied => applied !== item).map(applied => {
                if (!applied.range || applied.range[0] < range[1]) return applied;
                return { ...applied, range: [applied.range[0] + shift, applied.range[1] + shift] as [number, number] };
            });
            actions.onRevert(item.id);
            renderCorrectedText(host, utterance, actions);
        };
        const open = document.createElement('button');
        open.className = 'theia-button quiet';
        open.type = 'button';
        open.textContent = 'この項目を開く';
        open.onclick = () => actions.onOpen(item.id);
        controls.append(revert, open);
        wrapper.onmouseenter = () => { controls.hidden = false; };
        wrapper.onmouseleave = () => { if (!wrapper.contains(document.activeElement)) controls.hidden = true; };
        wrapper.onfocus = () => { controls.hidden = false; };
        wrapper.append(controls);
        host.append(wrapper);
    }
}
