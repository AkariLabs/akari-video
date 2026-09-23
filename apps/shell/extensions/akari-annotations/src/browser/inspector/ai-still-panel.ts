import type { GenerateStillResult, ImageRouteState } from '../../common/akari-annotations-protocol';

export type StillAspect = '16:9' | '9:16' | '1:1';
export type StillRoute = ImageRouteState['id'];
const routeStorageKey = 'akari-inspector-ai-still-route';
export const stillRouteIds: readonly StillRoute[] = ['codex', 'antigravity', 'grok'];
export function savedStillRoute(): StillRoute {
    try {
        const value = localStorage.getItem(routeStorageKey);
        if (stillRouteIds.includes(value as StillRoute)) return value as StillRoute;
    } catch { /* Storage may be disabled in a webview. */ }
    return 'codex';
}
export function rememberStillRoute(route: StillRoute): void {
    try { localStorage.setItem(routeStorageKey, route); } catch { /* Keep the in-memory selection. */ }
}
export interface AiStillState {
    prompt: string; aspect: StillAspect; routeId?: StillRoute; routes?: ImageRouteState[]; route?: ImageRouteState; probing: boolean;
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
    const id = route?.id ?? 'codex';
    if (route?.state === 'signed-out') return id === 'antigravity'
        ? 'ターミナルで agy を起動してサインインしてください'
        : id === 'grok' ? 'ターミナルで grok login を実行してサインインしてください'
            : 'ターミナルで codex login を実行してください';
    return `${id === 'antigravity' ? 'Antigravity' : id === 'grok' ? 'Grok' : 'Codex'} CLI が見つかりません`;
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
    prompt.addEventListener('input', () => { state.prompt = prompt.value; state.error = undefined; submit.disabled = !state.prompt.trim() || selectedRoute()?.state !== 'ready' || state.running; });
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
    const selectedRoute = (): ImageRouteState | undefined => state.routes?.find(row => row.id === (state.routeId ?? 'codex'))
        ?? ((state.routeId ?? 'codex') === 'codex' ? state.route : undefined);
    const routes = make('div', 'akari-inspector-ai-still-routes');
    for (const id of stillRouteIds) {
        const routeState = state.routes?.find(row => row.id === id) ?? (id === 'codex' ? state.route : undefined);
        const label = make('label', 'akari-inspector-ai-still-route');
        label.setAttribute('data-akari-inspector-ai-route', id);
        const radio = make('input', 'akari-inspector-ai-still-route-radio');
        radio.type = 'radio';
        radio.name = 'akari-inspector-ai-still-route';
        radio.value = id;
        radio.disabled = state.running;
        radio.checked = (state.routeId ?? 'codex') === id;
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            state.routeId = id;
            rememberStillRoute(id);
            actions.change();
        });
        label.appendChild(radio);
        label.appendChild(make('span', 'akari-inspector-ai-still-route-name', `${id === 'antigravity' ? 'Antigravity' : id === 'grok' ? 'Grok' : 'Codex'} · サインインの範囲`));
        const badge = make('span', 'akari-inspector-ai-still-badge', imageRouteBadgeText(routeState, state.probing));
        badge.setAttribute('data-akari-inspector-ai-route-state', routeState?.state ?? 'checking');
        label.appendChild(badge);
        routes.appendChild(label);
    }
    panel.appendChild(routes);
    const refresh = make('button', 'akari-inspector-ai-still-secondary', '状態を確かめ直す');
    refresh.type = 'button';
    refresh.disabled = state.probing || state.running;
    refresh.setAttribute('data-akari-inspector-ai-refresh', 'true');
    refresh.addEventListener('click', actions.probe);
    panel.appendChild(refresh);
    if (selectedRoute()?.state !== 'ready' && !state.probing) panel.appendChild(make('p', 'akari-inspector-ai-still-next',
        imageRouteNextText(selectedRoute() ?? { id: state.routeId ?? 'codex', state: 'missing', detail: '' })));
    const submit = make('button', 'akari-inspector-ai-still-primary', '作る');
    submit.type = 'button';
    submit.disabled = !state.prompt.trim() || selectedRoute()?.state !== 'ready' || state.running;
    submit.setAttribute('data-akari-inspector-ai-create', 'true');
    submit.addEventListener('click', actions.generate);
    panel.appendChild(submit);
    if (state.running) {
        const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000));
        const name = state.routeId === 'antigravity' ? 'Antigravity' : state.routeId === 'grok' ? 'Grok' : 'Codex';
        panel.appendChild(make('p', 'akari-inspector-ai-still-progress', `${name} で作っています · ${elapsed} 秒`));
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
        retry.disabled = !state.prompt.trim() || selectedRoute()?.state !== 'ready';
        retry.addEventListener('click', actions.generate);
        panel.appendChild(retry);
    }
    if (state.mismatch) panel.appendChild(make('p', 'akari-inspector-ai-still-mismatch', state.mismatch));
    parent.appendChild(panel);
}
