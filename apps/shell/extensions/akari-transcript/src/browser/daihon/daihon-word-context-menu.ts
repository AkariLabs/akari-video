export type WordMenuAction = { kind: 'play' } | { kind: 'edit' } | { kind: 'dictionary' } | { kind: 'cut-video' }
    | { kind: 'caption-only' } | { kind: 'freeze' } | { kind: 'preset'; presetId: string } | { kind: 'preset-clear' }
    | { kind: 'coming-soon'; what: string } | { kind: 'pause' } | { kind: 'break' } | { kind: 'split' }
    | { kind: 'merge-prev' } | { kind: 'insert-word' } | { kind: 'item-captions' } | { kind: 'mark'; color: string };
export interface WordMenuItem { label: string; action?: WordMenuAction; accel?: string; disabled?: boolean; title?: string; danger?: boolean }
export interface WordMenuGroup { title: string; note?: string; items: WordMenuItem[]; presets?: { id: string; name: string }[]; colors?: string[] }

const COLORS = ['#ff5c5c', '#ffb347', '#f5c451', '#6fd18a', '#4fa8ff', '#c77dff'];
export function wordContextMenuGroups(input: {
    rangeCount: number; wordCount: number; text: string; nextWordText: string;
    presets: readonly { id: string; name: string }[];
    splitAvailable: boolean; mergeAvailable: boolean; wordInsertAvailable: boolean; itemCaptionsAvailable: boolean;
}): WordMenuGroup[] {
    const subject = input.rangeCount > 1 ? `${input.rangeCount} 範囲を一括`
        : input.wordCount > 1 ? 'この範囲' : 'この語';
    const coming = (label: string, what: string): WordMenuItem => ({ label, disabled: true, action: { kind: 'coming-soon', what } });
    return [
        { title: `${subject}「${input.text}」`, items: [
            { label: '▶ ここから再生', action: { kind: 'play' } }, { label: '✎ 直す', action: { kind: 'edit' } },
            { label: '📖 辞書に覚える', action: { kind: 'dictionary' } },
            { label: '✂ 映像ごとカット', action: { kind: 'cut-video' }, danger: true },
            { label: '字幕からだけ消す', action: { kind: 'caption-only' } },
            { label: '⏸ この語の間だけ止める（Freeze）', action: { kind: 'freeze' } }
        ] },
        { title: '強調', presets: [...input.presets], items: [
            ...input.presets.map(preset => ({ label: preset.name, action: { kind: 'preset' as const, presetId: preset.id } })),
            { label: '強調を外す', action: { kind: 'preset-clear' } }
        ] },
        { title: '挿入', note: `「${input.nextWordText}」の前に`, items: [
            coming('🖼 画像 Coming soon', '画像'), coming('🎬 B-roll Coming soon', 'B-roll'),
            coming('🅰 テロップ Coming soon', 'テロップ'), input.wordInsertAvailable
                ? { label: '＋ 語', action: { kind: 'insert-word' } }
                : coming('＋ 語 Coming soon', '語'),
            { label: '⏸ 間 0.5 秒', accel: '⌘;', action: { kind: 'pause' } }
        ] },
        { title: '行', items: [
            { label: '／ ここで改行（表示だけ・行は 1 つのまま）', accel: '⇧⏎', action: { kind: 'break' } },
            input.splitAvailable ? { label: '⏎ ここで分割（行が 2 つになる）', accel: '⏎', action: { kind: 'split' } }
                : coming('⏎ ここで分割（行が 2 つになる） — Coming soon', 'ここで分割'),
            input.mergeAvailable ? { label: '前の行と結合', accel: '⌫', action: { kind: 'merge-prev' } }
                : coming('前の行と結合 — Coming soon', '前の行と結合'),
            { label: 'この行だけの字幕にする（同じ素材の他クリップでは出さない）', action: { kind: 'item-captions' },
                disabled: !input.itemCaptionsAvailable, title: input.itemCaptionsAvailable ? undefined : '票 1（item の captions スイッチ）待ち' }
        ] },
        { title: 'マーク', colors: COLORS, items: COLORS.map(color => ({ label: color, action: { kind: 'mark' as const, color } })) }
    ];
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
        if (group.presets) {
            const presets = document.createElement('div'); presets.className = 'akari-daihon-cmpresets';
            for (const preset of group.presets) {
                const button = document.createElement('button'); button.type = 'button'; button.dataset.presetId = preset.id;
                button.textContent = preset.name; button.addEventListener('click', event => {
                    event.stopPropagation(); options.onAction({ kind: 'preset', presetId: preset.id });
                }); presets.appendChild(button);
            }
            pop.appendChild(presets);
        }
        const items = document.createElement('div'); items.className = group.colors ? 'akari-daihon-cmcolors' : 'akari-daihon-cmitems';
        for (const item of group.items) {
            if (group.presets && item.action?.kind === 'preset') continue;
            const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label;
            if (item.danger) button.classList.add('danger');
            if (item.disabled) button.classList.add('disabled');
            if (item.title) button.title = item.title;
            if (group.colors) button.style.background = item.label;
            if (item.accel) { const accel = document.createElement('span'); accel.className = 'akari-daihon-cmaccel'; accel.textContent = item.accel; button.appendChild(accel); }
            button.addEventListener('click', event => { event.stopPropagation(); if (item.action) options.onAction(item.action); });
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
