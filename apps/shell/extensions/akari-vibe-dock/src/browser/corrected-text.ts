import { buildCorrectedSegments, CorrectedApplied } from '../common/corrected-text-model';

export function renderCorrectedText(host: HTMLElement,
    utterance: { raw: string; text: string; applied: CorrectedApplied[] },
    actions: { onRevert(entryId: string): void; onOpen(entryId: string): void }): void {
    host.replaceChildren();
    for (const segment of buildCorrectedSegments(utterance.text, utterance.applied)) {
        if (!segment.applied) { host.append(document.createTextNode(segment.text)); continue; }
        const item = segment.applied;
        const wrapper = document.createElement('span');
        wrapper.style.textDecoration = 'underline dashed';
        wrapper.style.textUnderlineOffset = '3px';
        wrapper.title = `${item.from} → ${item.to}（${item.layer === 'builtin' ? '同梱' : '自分'}）`;
        wrapper.tabIndex = 0;
        wrapper.append(document.createTextNode(segment.text));
        const controls = document.createElement('span');
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
