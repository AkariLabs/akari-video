import type { GenerateStillResult, ImageRouteState } from '../../common/akari-annotations-protocol';

export type StillAspect = '16:9' | '9:16' | '1:1';
export interface AiStillState {
    prompt: string; aspect: StillAspect; route?: ImageRouteState; probing: boolean;
    running: boolean; startedAt?: number; error?: string; mismatch?: string;
}
export interface AiStillActions {
    change(): void; probe(): void; generate(): void; cancel(): void;
}

export function nearestStillAspect(width: number, height: number): StillAspect {
    const ratio = width / height;
    return (['16:9', '9:16', '1:1'] as const).reduce((best, current) =>
        Math.abs(Math.log(ratio / (Number(current.split(':')[0]) / Number(current.split(':')[1]))))
            < Math.abs(Math.log(ratio / (Number(best.split(':')[0]) / Number(best.split(':')[1])))) ? current : best);
}

export function stillDimensionMismatch(aspect: StillAspect, result: GenerateStillResult): string | undefined {
    if (!result.width || !result.height) return undefined;
    const [w, h] = aspect.split(':').map(Number);
    return Math.abs(result.width / result.height - w / h) > 0.02
        ? `頼んだ ${aspect} と違う ${result.width}×${result.height} でできました` : undefined;
}

/** A completed size warning belongs only to the currently selected frame. */
export function stillMismatchNotice(
    states: Map<string, AiStillState>, selectedKey: string | undefined, previousClipKey?: string, clipKey?: string
): string | undefined {
    if (previousClipKey !== undefined && clipKey !== previousClipKey) {
        for (const state of states.values()) state.mismatch = undefined;
    }
    return selectedKey ? states.get(selectedKey)?.mismatch : undefined;
}

export function appendAiStillNotice(parent: HTMLElement, message: string): void {
    parent.appendChild(make('p', 'akari-inspector-ai-still-notice', message));
}

export function imageRouteBadgeText(route: ImageRouteState | undefined, probing: boolean): string {
    if (probing) return '確認中';
    if (route?.detail.includes('確かめられませんでした')) return '確かめられませんでした';
    return route?.state === 'ready' ? '使える' : route?.state === 'signed-out' ? 'サインインが必要' : '入っていない';
}

export function imageRouteNextText(route: ImageRouteState | undefined): string {
    if (route?.detail.includes('確かめられませんでした')) return route.detail;
    return route?.state === 'signed-out' ? 'ターミナルで codex login を実行してください' : 'Codex CLI が見つかりません';
}

/** Timeline's commitEditMutation calls this once, so undo restores both source table and item reference. */
export function replaceStillInEdit<T extends {
    sources?: Array<{ id: string; path: string }>;
    tracks?: Array<{ items?: Array<{ id: string; source?: { kind?: string; src?: string; [key: string]: unknown } }> }>;
}>(doc: T, itemId: string, relativePath: string): T {
    const item = doc.tracks?.flatMap(track => track.items ?? []).find(row => row.id === itemId);
    if (!item || item.source?.kind !== 'media') throw new Error('差し替える枠がありません。');
    const sources = doc.sources ?? [];
    let serial = 1;
    while (sources.some(row => row.id === `still-src-${serial}`)) serial++;
    const sourceId = `still-src-${serial}`;
    sources.push({ id: sourceId, path: relativePath });
    doc.sources = sources;
    item.source.src = sourceId;
    return doc;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function appendAiStillPanel(parent: HTMLElement, state: AiStillState, actions: AiStillActions): void {
    const panel = make('div', 'akari-inspector-ai-still-panel');
    const promptLabel = make('label', 'akari-inspector-ai-still-label', '指示文');
    const prompt = make('textarea', 'akari-inspector-ai-still-prompt');
    prompt.setAttribute('data-akari-inspector-ai-prompt', 'true');
    prompt.rows = 5;
    prompt.value = state.prompt;
    prompt.placeholder = '作りたい絵を言葉で書いてください';
    prompt.addEventListener('input', () => { state.prompt = prompt.value; state.error = undefined; submit.disabled = !state.prompt.trim() || state.route?.state !== 'ready' || state.running; });
    promptLabel.appendChild(prompt);
    panel.appendChild(promptLabel);
    panel.appendChild(make('div', 'akari-inspector-ai-still-label', '画角'));
    const aspects = make('div', 'akari-inspector-ai-still-aspects');
    for (const aspect of ['16:9', '9:16', '1:1'] as const) {
        const button = make('button', 'akari-inspector-ai-still-aspect', aspect);
        button.type = 'button';
        button.setAttribute('data-akari-inspector-ai-aspect', aspect);
        button.setAttribute('aria-pressed', String(state.aspect === aspect));
        button.addEventListener('click', () => { state.aspect = aspect; actions.change(); });
        aspects.appendChild(button);
    }
    panel.appendChild(aspects);
    panel.appendChild(make('div', 'akari-inspector-ai-still-label', '手段'));
    const route = make('div', 'akari-inspector-ai-still-route');
    route.appendChild(make('span', 'akari-inspector-ai-still-route-name', 'Codex · 無料'));
    const stateText = imageRouteBadgeText(state.route, state.probing);
    const badge = make('span', 'akari-inspector-ai-still-badge', stateText);
    badge.setAttribute('data-akari-inspector-ai-route-state', state.route?.state ?? 'checking');
    route.appendChild(badge);
    panel.appendChild(route);
    const refresh = make('button', 'akari-inspector-ai-still-secondary', '状態を確かめ直す');
    refresh.type = 'button';
    refresh.disabled = state.probing || state.running;
    refresh.setAttribute('data-akari-inspector-ai-refresh', 'true');
    refresh.addEventListener('click', actions.probe);
    panel.appendChild(refresh);
    if (state.route?.state !== 'ready' && !state.probing) panel.appendChild(make('p', 'akari-inspector-ai-still-next',
        imageRouteNextText(state.route)));
    const submit = make('button', 'akari-inspector-ai-still-primary', '作る');
    submit.type = 'button';
    submit.disabled = !state.prompt.trim() || state.route?.state !== 'ready' || state.running;
    submit.setAttribute('data-akari-inspector-ai-create', 'true');
    submit.addEventListener('click', actions.generate);
    panel.appendChild(submit);
    if (state.running) {
        const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000));
        panel.appendChild(make('p', 'akari-inspector-ai-still-progress', `Codex で作っています · ${elapsed} 秒`));
        const cancel = make('button', 'akari-inspector-ai-still-secondary', 'キャンセル');
        cancel.type = 'button';
        cancel.setAttribute('data-akari-inspector-ai-cancel', 'true');
        cancel.addEventListener('click', actions.cancel);
        panel.appendChild(cancel);
    }
    if (state.error) {
        panel.appendChild(make('p', 'akari-inspector-ai-still-error', state.error));
        const retry = make('button', 'akari-inspector-ai-still-secondary', 'もう一度');
        retry.type = 'button';
        retry.setAttribute('data-akari-inspector-ai-retry', 'true');
        retry.disabled = !state.prompt.trim() || state.route?.state !== 'ready';
        retry.addEventListener('click', actions.generate);
        panel.appendChild(retry);
    }
    if (state.mismatch) panel.appendChild(make('p', 'akari-inspector-ai-still-mismatch', state.mismatch));
    parent.appendChild(panel);
}
