import { t } from '../transcript-text';
export type WordMenuAction = { kind: 'play' } | { kind: 'edit' } | { kind: 'cut-video' }
    | { kind: 'caption-only' } | { kind: 'pause' } | { kind: 'break' } | { kind: 'split' }
    | { kind: 'merge-prev' } | { kind: 'merge-next' } | { kind: 'insert-word' } | { kind: 'mark'; color: string };
export interface WordMenuItem { label: string; action?: WordMenuAction; accel?: string; disabled?: boolean; title?: string; danger?: boolean }
export interface WordMenuGroup { title: string; note?: string; items: WordMenuItem[]; colors?: string[] }

const COLORS = ['#ff5c5c', '#ffb347', '#f5c451', '#6fd18a', '#4fa8ff', '#c77dff'];
export function wordContextMenuGroups(input: {
    rangeCount: number; wordCount: number; text: string; nextWordText: string;
    splitAvailable: boolean; mergeAvailable: boolean; mergeNextAvailable: boolean;
    wordInsertAvailable: boolean; itemCaptionsAvailable: boolean;
    cutDisabledReason?: string;
}): WordMenuGroup[] {
    const subject = input.rangeCount > 1 ? t('transcript.daihon.wordMenu.applyRangesWithCountLabel', { value1: input.rangeCount })
        : input.wordCount > 1 ? t('transcript.daihon.wordMenu.rangeLabel') : t('transcript.daihon.wordMenu.wordLabel');
    const groups: WordMenuGroup[] = [
        { title: `${subject}「${input.text}」`, items: [
            { label: t('transcript.daihon.wordMenu.playPlayFromHereLabel'), action: { kind: 'play' } }, { label: t('transcript.daihon.wordMenu.editLabel'), action: { kind: 'edit' } },
            { label: t('transcript.daihon.wordMenu.cutCutVideoLabel'), action: { kind: 'cut-video' }, danger: true,
                disabled: !!input.cutDisabledReason, title: input.cutDisabledReason },
            { label: t('transcript.daihon.wordMenu.removeOnlyFromCaptionsKeepAudioLabel'), action: { kind: 'caption-only' } },
            { label: t('transcript.daihon.wordMenu.addPauseLabel'), accel: '⌘;', action: { kind: 'pause' } }
        ] },
        { title: t('transcript.daihon.wordMenu.insertTooltip'), note: t('transcript.daihon.wordMenu.beforeWithValueTooltip', { value1: input.nextWordText }), items: [
            ...(input.wordInsertAvailable ? [{ label: t('transcript.daihon.wordMenu.addWordLabel'), action: { kind: 'insert-word' } as WordMenuAction }] : [])
        ] },
        { title: t('transcript.daihon.wordMenu.lineTooltip'), items: [
            { label: t('transcript.daihon.wordMenu.breakHereDisplayOnlyStillOneLineLabel'), accel: '⇧⏎', action: { kind: 'break' } },
            ...(input.splitAvailable ? [{ label: t('transcript.daihon.wordMenu.splitHereCreatesTwoLinesLabel'), accel: '⏎', action: { kind: 'split' } as WordMenuAction }] : []),
            ...(input.mergeAvailable ? [{ label: t('transcript.daihon.wordMenu.mergePreviousLineLabel'), accel: '⌫', action: { kind: 'merge-prev' } as WordMenuAction }] : []),
            ...(input.mergeNextAvailable ? [{ label: t('transcript.daihon.wordMenu.mergeNextLineLabel'), action: { kind: 'merge-next' } as WordMenuAction }] : [])
        ] },
        { title: t('transcript.daihon.wordMenu.markTooltip'), colors: COLORS, items: COLORS.map(color => ({ label: color, action: { kind: 'mark' as const, color } })) }
    ];
    return groups.filter(group => group.items.length > 0);
}

export function openWordContextMenu(options: {
    x: number; y: number; groups: WordMenuGroup[]; onAction(action: WordMenuAction): void
}): HTMLDivElement {
    const pop = document.createElement('div');
    pop.className = 'akari-daihon-pop akari-daihon-wordcm';
    for (const group of options.groups) {
        const title = document.createElement('div'); title.className = 'akari-daihon-pttl'; title.textContent = group.title;
        pop.appendChild(title);
        if (group.note) { const note = document.createElement('div'); note.className = 'akari-daihon-cmnote'; note.textContent = group.note; pop.appendChild(note); }
        const items = document.createElement('div'); items.className = group.colors ? 'akari-daihon-cmcolors' : 'akari-daihon-cmitems';
        for (const item of group.items) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label;
            if (item.danger) button.classList.add('danger');
            if (item.disabled) { button.disabled = true; button.classList.add('disabled'); }
            if (item.title) button.title = item.title;
            if (group.colors) button.style.background = item.label;
            if (item.accel) { const accel = document.createElement('span'); accel.className = 'akari-daihon-cmaccel'; accel.textContent = item.accel; button.appendChild(accel); }
            button.addEventListener('click', event => { event.stopPropagation(); if (!item.disabled && item.action) options.onAction(item.action); });
            items.appendChild(button);
        }
        pop.appendChild(items);
    }
    document.body.appendChild(pop);
    const margin = 8;
    pop.style.left = `${Math.max(margin, Math.min(options.x, window.innerWidth - pop.offsetWidth - margin))}px`;
    pop.style.top = `${Math.max(margin, Math.min(options.y, window.innerHeight - pop.offsetHeight - margin))}px`;
    return pop;
}
