import type { GenerateStillResult, ImageRouteState, StillCandidate, StillCandidateBatch } from '../../common/akari-annotations-protocol';
import { aiActionCatalog } from '../../common/ai-action-catalog';
import { stillMakerBadge } from './maker-badge';

export type StillAspect = import('../../common/akari-annotations-protocol').StillAspect;
export type StillRoute = ImageRouteState['id'];
const routeStorageKey = 'akari-inspector-ai-still-route';
const cropStorageKey = 'akari-inspector-ai-still-crop';
export const stillAspects: readonly StillAspect[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '3:2', '21:9'];
const stillRoutes = aiActionCatalog([]).find(action => action.id === 'still')!.routes;
export const maxStillReferences = Math.max(...stillRoutes.map(route => route.inputs?.reference_images?.max ?? 0));
export function stillRouteAvailability(id: StillRoute, referenceCount: number): { disabled: boolean; reason?: string; note?: string } {
    const route = stillRoutes.find(row => row.id === id)!;
    const input = route.inputs?.reference_images;
    const note = referenceCount > 0 ? input?.note : undefined;
    if (referenceCount > (input?.max ?? 0)) return { disabled: true,
        reason: input?.max === 0 ? 'この手段は画像を受け取れません' : `${route.label} は ${input?.max} 枚まで`, note };
    return { disabled: false, note };
}
export function savedStillCrop(): boolean {
    try { return localStorage.getItem(cropStorageKey) !== 'false'; } catch { return true; }
}
export function rememberStillCrop(value: boolean): void {
    try { localStorage.setItem(cropStorageKey, String(value)); } catch { /* Keep in memory. */ }
}
export const stillRouteIds: readonly StillRoute[] = stillRoutes.map(route => route.id as StillRoute);
export const stillRouteGroups = {
    free: stillRoutes.filter(route => route.cost === 'free'),
    paid: stillRoutes.filter(route => route.cost === 'paid')
};
export function stillRouteLabel(route: StillRoute): string {
    return stillRoutes.find(row => row.id === route)?.label ?? route;
}
export interface StillFalEstimate { prices: { low: number; medium: number; high: number }; asOf: string }
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
    selectedRoutes?: Set<StillRoute>; preferencesLoaded?: boolean; selectionTouched?: boolean; batch?: StillCandidateBatch;
    timelineProgressKey?: string;
    polling?: boolean; pollingPromise?: Promise<void>; lastPolledAt?: number;
    batchInput?: { prompt: string; aspect: StillAspect; references: string[]; cropToAspect: boolean;
        quality: 'low' | 'medium' | 'high' };
    probingRoutes?: Set<StillRoute>;
    canvas?: { width: number; height: number }; liveAspectRevision?: number;
    lastAspectPointer?: { aspect: StillAspect; at: number };
    running: boolean; startedAt?: number; error?: string; mismatch?: string;
    references?: Array<{ path: string; thumbnail?: string }>;
    choosingReference?: boolean; availableReferences?: string[];
    cropToAspect?: boolean; croppedNotice?: string;
    quality?: 'low' | 'medium' | 'high';
    falEstimate?: StillFalEstimate;
    falEstimateError?: string;
    detailsOpen?: boolean;
}
export interface AiStillActions {
    change(aspect?: StillAspect): void; probe(): void; generate(): void; showResult(): void;
    addReference(path: string): void; chooseReference(): void; captureReference(): void;
    openConnections(): void;
}

export function firstSuccessfulStillCandidate(batch: StillCandidateBatch): StillCandidate | undefined {
    for (const route of batch.routes) {
        const candidate = batch.results?.find(row => row.route === route && row.ok && row.relativePath)
            ?? batch.candidates.find(row => row.route === route && row.ok && row.relativePath);
        if (candidate) return candidate;
    }
    return undefined;
}

export function savedStillInput(meta?: { inputs?: { prompt?: string; reference_images?: Array<{ path: string }>;
    extra?: { still_batch?: { prompt?: string; aspect?: StillAspect; routes?: StillRoute[];
        references?: string[]; cropToAspect?: boolean; quality?: AiStillState['quality'] } } };
    output?: { aspect?: StillAspect; resolution?: string } }): {
    prompt: string; aspect: StillAspect; routes: StillRoute[]; references: string[];
    cropToAspect?: boolean; quality?: AiStillState['quality']; savedRoutes: boolean
} {
    const saved = meta?.inputs?.extra?.still_batch;
    const [width, height] = String(meta?.output?.resolution ?? '').split('x').map(Number);
    return {
        prompt: saved?.prompt ?? meta?.inputs?.prompt ?? '',
        aspect: saved?.aspect ?? meta?.output?.aspect ?? (width > 0 && height > 0 ? nearestStillAspect(width, height) : '16:9'),
        routes: saved?.routes ?? [],
        references: saved?.references ?? meta?.inputs?.reference_images?.map(ref => ref.path) ?? [],
        cropToAspect: saved?.cropToAspect, quality: saved?.quality, savedRoutes: !!saved?.routes?.length
    };
}

export function nearestStillAspect(width: number, height: number): StillAspect {
    const ratio = width / height;
    return stillAspects.reduce((best, current) =>
        Math.abs(Math.log(ratio / (Number(current.split(':')[0]) / Number(current.split(':')[1]))))
            < Math.abs(Math.log(ratio / (Number(best.split(':')[0]) / Number(best.split(':')[1])))) ? current : best);
}

export function stillDimensionMismatch(aspect: StillAspect, result: GenerateStillResult): string | undefined {
    if (!result.width || !result.height) return undefined;
    const [w, h] = aspect.split(':').map(Number);
    return Math.abs(result.width / result.height - w / h) > 0.02
        ? `頼んだ ${aspect} と違う ${result.width}×${result.height} でできました` : undefined;
}

export function stillCroppedNotice(aspect: StillAspect, croppedFrom: string): string {
    const [width, height] = croppedFrom.split('x').map(Number);
    return `${aspect} を頼んで${width === height ? '正方形' : `${width}×${height}`} → 切りそろえました`;
}

/** A completed size warning belongs only to the currently selected frame. */
export function stillMismatchNotice(
    states: Map<string, AiStillState>, selectedKey: string | undefined, previousClipKey?: string, clipKey?: string
): string | undefined {
    if (previousClipKey !== undefined && clipKey !== previousClipKey) {
        for (const state of states.values()) { state.mismatch = undefined; state.croppedNotice = undefined; }
    }
    return selectedKey ? states.get(selectedKey)?.croppedNotice ?? states.get(selectedKey)?.mismatch : undefined;
}

export function appendAiStillNotice(parent: HTMLElement, message: string): void {
    parent.appendChild(make('p', 'akari-inspector-ai-still-notice', message));
}

export function imageRouteBadgeText(route: ImageRouteState | undefined, probing: boolean): string {
    if (probing) return '確かめています…';
    if (route?.state === 'unknown') return '確かめられませんでした';
    if (route?.detail.includes('確かめられませんでした')) return '確かめられませんでした';
    if (route?.id === 'fal') return route.state === 'ready' ? '使える' : 'キーが未設定';
    return route?.state === 'ready' ? '使える' : route?.state === 'signed-out' ? 'サインインが必要' : '入っていない';
}

export function imageRouteNextText(route: ImageRouteState | undefined): string {
    if (route?.state === 'unknown') return '状態を確かめ直すか、そのまま作ってみてください';
    if (route?.detail.includes('確かめられませんでした')) return route.detail;
    const id = route?.id ?? 'codex';
    if (id === 'fal') return 'キーを設定すると使えます →';
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

/** Place a completed image in one edit mutation; a deleted frame is a no-op. */
export function placeStillInEdit<T extends {
    sources?: Array<{ id: string; path: string }>;
    tracks?: Array<{ items?: Array<{ id: string; name?: string; source?: { kind?: string; src?: string; [key: string]: unknown } }> }>;
}>(doc: T, itemId: string, relativePath: string): T {
    const items = doc.tracks?.flatMap(track => track.items ?? []) ?? [];
    const item = items.find(row => row.id === itemId);
    if (!item || item.source?.kind !== 'media') return doc;
    const sources = doc.sources ?? [];
    const oldId = item.source.src;
    let source = sources.find(row => row.path === relativePath);
    if (!source) {
        let serial = 1;
        while (sources.some(row => row.id === `still-src-${serial}`)) serial++;
        source = { id: `still-src-${serial}`, path: relativePath };
        sources.push(source);
    }
    item.source.src = source.id;
    if (item.name === '空の枠') delete item.name;
    if (oldId?.startsWith('still-src-') && !items.some(row => row.source?.src === oldId)) {
        doc.sources = sources.filter(row => row.id !== oldId);
    } else doc.sources = sources;
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
    prompt.addEventListener('input', () => { state.prompt = prompt.value; state.error = undefined; submit.disabled = !canSubmit(); });
    promptLabel.appendChild(prompt);
    panel.appendChild(promptLabel);
    const references = make('div', 'akari-inspector-ai-still-references');
    references.setAttribute('data-akari-inspector-ai-references', 'true');
    references.appendChild(make('span', 'akari-inspector-ai-still-label', `参照画像（任意・最大 ${maxStillReferences} 枚）`));
    const drop = make('div', 'akari-inspector-ai-still-reference-drop');
    drop.setAttribute('data-akari-inspector-ai-reference-drop', 'true');
    const acceptMaterialDrag = (event: DragEvent): void => {
        if (!event.dataTransfer?.types.includes('application/x-akari-material')) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
    };
    drop.addEventListener('dragenter', acceptMaterialDrag);
    drop.addEventListener('dragover', acceptMaterialDrag);
    drop.addEventListener('drop', event => {
        const raw = event.dataTransfer?.getData('application/x-akari-material');
        if (!raw) return;
        event.preventDefault(); event.stopPropagation();
        try { const item = JSON.parse(raw) as { relativePath?: string; kind?: string };
            if (item.kind === 'image' && item.relativePath) actions.addReference(item.relativePath);
        } catch { /* Ignore malformed drag data. */ }
    });
    for (const [index, reference] of (state.references ?? []).entries()) {
        const chip = make('span', 'akari-inspector-ai-still-reference-chip');
        chip.setAttribute('data-akari-inspector-ai-reference', reference.path);
        const thumb = make('img', 'akari-inspector-ai-still-reference-thumbnail');
        thumb.setAttribute('data-akari-inspector-ai-reference-thumbnail', reference.path);
        if (reference.thumbnail) thumb.src = reference.thumbnail;
        thumb.alt = '';
        const remove = make('button', 'akari-inspector-ai-still-reference-remove', '×');
        remove.type = 'button'; remove.setAttribute('data-akari-inspector-ai-reference-remove', reference.path);
        remove.setAttribute('aria-label', `${reference.path} を外す`);
        remove.addEventListener('click', () => { state.references?.splice(index, 1); actions.change(); });
        chip.append(thumb, make('span', '', reference.path.split('/').pop()), remove);
        drop.appendChild(chip);
    }
    const pick = make('button', 'akari-inspector-ai-still-secondary', '素材から選ぶ');
    pick.type = 'button'; pick.disabled = state.running || (state.references?.length ?? 0) >= maxStillReferences;
    pick.setAttribute('data-akari-inspector-ai-reference-pick', 'true');
    pick.addEventListener('click', actions.chooseReference);
    const capture = make('button', 'akari-inspector-ai-still-secondary', '今のコマ');
    capture.type = 'button'; capture.disabled = state.running || (state.references?.length ?? 0) >= maxStillReferences;
    capture.setAttribute('data-akari-inspector-ai-reference-capture', 'true');
    capture.addEventListener('click', actions.captureReference);
    drop.append(pick, capture);
    references.appendChild(drop);
    if (state.choosingReference) {
        const list = make('div', 'akari-inspector-ai-still-reference-list');
        list.setAttribute('data-akari-inspector-ai-reference-list', 'true');
        for (const path of state.availableReferences ?? []) {
            const item = make('button', 'akari-inspector-ai-still-secondary', path);
            item.type = 'button'; item.setAttribute('data-akari-inspector-ai-reference-option', path);
            item.addEventListener('click', () => actions.addReference(path));
            list.appendChild(item);
        }
        references.appendChild(list);
    }
    panel.appendChild(references);
    panel.appendChild(make('div', 'akari-inspector-ai-still-label', '画角'));
    const aspects = make('div', 'akari-inspector-ai-still-aspects');
    for (const aspect of stillAspects) {
        const button = make('button', 'akari-inspector-ai-still-aspect');
        button.type = 'button';
        button.setAttribute('data-akari-inspector-ai-aspect', aspect);
        button.setAttribute('aria-pressed', String(state.aspect === aspect));
        const picture = make('span', 'akari-inspector-ai-still-aspect-picture');
        const [w, h] = aspect.split(':').map(Number);
        picture.style.width = `${Math.round(30 * Math.min(1, w / h))}px`;
        picture.style.height = `${Math.round(30 * Math.min(1, h / w))}px`;
        button.append(picture, make('span', 'akari-inspector-ai-still-aspect-label', aspect));
        const changeAspect = (): void => { state.aspect = aspect; actions.change(aspect); };
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            state.lastAspectPointer = { aspect, at: Date.now() };
            changeAspect();
        });
        button.addEventListener('click', event => {
            if ((event?.detail ?? 0) > 0 && state.lastAspectPointer?.aspect === aspect
                && Date.now() - state.lastAspectPointer.at < 1000) return;
            changeAspect();
        });
        aspects.appendChild(button);
    }
    panel.appendChild(aspects);
    const cropLabel = make('label', 'akari-inspector-ai-still-crop');
    const crop = make('input', ''); crop.type = 'checkbox';
    crop.checked = state.cropToAspect !== false;
    crop.setAttribute('data-akari-inspector-ai-crop', 'true');
    crop.addEventListener('change', () => { state.cropToAspect = crop.checked; rememberStillCrop(crop.checked); actions.change(); });
    cropLabel.append(crop, make('span', '', 'ずれたら選んだ比率に切りそろえる（絵の端が切れることがあります）'));
    panel.appendChild(cropLabel);
    panel.appendChild(make('div', 'akari-inspector-ai-still-label', '手段'));
    const selectedChecking = (): boolean => (state.selectedRoutes?.size ?? 0) > 0
        ? [...state.selectedRoutes!].some(id => state.probingRoutes?.has(id) ?? state.probing) : state.probing;
    const selectedRoute = (): ImageRouteState | undefined => state.routes?.find(row => row.id === (state.routeId ?? 'codex'))
        ?? ((state.routeId ?? 'codex') === 'codex' ? state.route : undefined);
    const selected = (): StillRoute[] => [...(state.selectedRoutes ?? new Set<StillRoute>())].filter(id =>
        !stillRouteAvailability(id, state.references?.length ?? 0).disabled
        && ['ready', 'unknown'].includes(state.routes?.find(row => row.id === id)?.state ?? ''));
    const canSubmit = (routes: StillRoute[] = [...(state.selectedRoutes ?? [])],
        input = { prompt: state.prompt, referenceCount: state.references?.length ?? 0 },
        checkSelection = true): boolean =>
        !!input.prompt.trim() && !state.running && routes.length > 0 && (!checkSelection || !selectedChecking())
        && routes.every(id => !state.probingRoutes?.has(id)
            && !stillRouteAvailability(id, input.referenceCount).disabled
            && ['ready', 'unknown'].includes(state.routes?.find(row => row.id === id)?.state ?? ''))
        && (!routes.includes('fal') || !!state.falEstimate);
    const routes = make('div', 'akari-inspector-ai-still-routes');
    for (const [group, groupRoutes] of Object.entries(stillRouteGroups)) {
        const section = make('div', 'akari-inspector-ai-still-route-group');
        section.setAttribute('data-akari-inspector-ai-route-group', group);
        section.appendChild(make('div', 'akari-inspector-ai-still-label', group === 'free'
            ? '追加料金なし — いま使っているサブスク' : '使った分だけ — API キー'));
        for (const declaration of groupRoutes) {
        const id = declaration.id as StillRoute;
        const routeState = state.routes?.find(row => row.id === id) ?? (id === 'codex' ? state.route : undefined);
        const label = make('label', 'akari-inspector-ai-still-route');
        label.setAttribute('data-akari-inspector-ai-route', id);
        const availability = stillRouteAvailability(id, state.references?.length ?? 0);
        label.setAttribute('data-akari-inspector-ai-route-disabled', String(availability.disabled));
        const checkbox = make('input', 'akari-inspector-ai-still-route-radio');
        checkbox.type = 'checkbox';
        checkbox.value = id;
        checkbox.setAttribute('data-akari-inspector-ai-route-checkbox', id);
        checkbox.disabled = state.running || availability.disabled || routeState?.state === 'missing' || routeState?.state === 'signed-out';
        checkbox.checked = state.selectedRoutes?.has(id) === true && !availability.disabled
            && routeState?.state !== 'missing' && routeState?.state !== 'signed-out';
        checkbox.addEventListener('change', () => {
            state.selectedRoutes ??= new Set();
            state.selectionTouched = true;
            if (checkbox.checked) state.selectedRoutes.add(id);
            else state.selectedRoutes.delete(id);
            state.routeId = id;
            actions.change();
        });
        label.appendChild(checkbox);
        const name = make('span', 'akari-inspector-ai-still-route-name');
        name.appendChild(stillMakerBadge(declaration.maker ?? id));
        name.appendChild(make('span', '', declaration.label));
        if (id === 'fal') name.appendChild(stillMakerBadge('fal', true));
        label.appendChild(name);
        const checking = state.probingRoutes?.has(id) ?? state.probing;
        const badge = make('span', 'akari-inspector-ai-still-badge', imageRouteBadgeText(routeState, checking));
        badge.setAttribute('data-akari-inspector-ai-route-state', checking ? 'checking' : routeState?.state ?? 'checking');
        label.appendChild(badge);
        if (availability.reason) {
            const reason = make('span', 'akari-inspector-ai-still-route-reason', availability.reason);
            reason.setAttribute('data-akari-inspector-ai-route-reason', id); label.appendChild(reason);
        }
        if (availability.note) {
            const note = make('span', 'akari-inspector-ai-still-route-note', availability.note);
            note.setAttribute('data-akari-inspector-ai-route-note', id); label.appendChild(note);
        }
        if (id === 'fal') {
            label.appendChild(make('span', 'akari-inspector-ai-still-route-price', state.falEstimate
                ? `見積もり $${state.falEstimate.prices[state.quality ?? 'high'].toFixed(3)} / 枚`
                : state.falEstimateError ?? '見積もりを確認中'));
            if (routeState?.state !== 'ready') {
                const link = make('button', 'akari-inspector-ai-still-secondary', 'キーを設定すると使えます →');
                link.type = 'button'; link.setAttribute('data-akari-inspector-ai-fal-settings', 'true');
                link.addEventListener('click', event => { event.preventDefault(); actions.openConnections(); });
                label.appendChild(link);
            }
        }
        section.appendChild(label);
        }
        routes.appendChild(section);
    }
    panel.appendChild(routes);
    const details = make('details', 'akari-inspector-ai-still-details');
    details.setAttribute('data-akari-inspector-ai-details', 'true');
    details.open = state.detailsOpen === true;
    details.addEventListener('toggle', () => { state.detailsOpen = details.open; });
    details.appendChild(make('summary', '', '詳細'));
    if (state.selectedRoutes?.has('fal')) {
        details.appendChild(make('p', '', 'モデル: GPT Image 2.5 Flare'));
        const quality = make('select', 'akari-inspector-ai-still-quality');
        quality.setAttribute('data-akari-inspector-ai-fal-quality', 'true');
        for (const [value, text] of [['low', '低'], ['medium', '中'], ['high', '高']] as const) {
            const option = make('option', '', state.falEstimate
                ? `${text} · $${state.falEstimate.prices[value].toFixed(3)} / 枚` : text);
            option.value = value; option.selected = (state.quality ?? 'high') === value;
            quality.appendChild(option);
        }
        quality.addEventListener('change', () => { state.quality = quality.value as AiStillState['quality']; actions.change(); });
        details.appendChild(quality);
        if (state.falEstimate) details.appendChild(make('small', '', `${state.falEstimate.asOf} 時点の 1024² の料金。画角・参照画像で実額は変わる場合があります。`));
    } else details.appendChild(make('p', '', '指示文・画角・参照画像のほかに設定できる項目はありません'));
    panel.appendChild(details);
    const refresh = make('button', 'akari-inspector-ai-still-secondary', '状態を確かめ直す');
    refresh.type = 'button';
    refresh.disabled = state.probing || state.running;
    refresh.setAttribute('data-akari-inspector-ai-refresh', 'true');
    refresh.addEventListener('click', actions.probe);
    panel.appendChild(refresh);
    if (selectedRoute()?.state !== 'ready' && !selectedChecking() && state.routeId !== 'fal') panel.appendChild(make('p', 'akari-inspector-ai-still-next',
        imageRouteNextText(selectedRoute() ?? { id: state.routeId ?? 'codex', state: 'missing', detail: '' })));
    const selectedCount = selected().length;
    const needsEstimate = selected().includes('fal');
    const estimate = needsEstimate ? state.falEstimate?.prices[state.quality ?? 'high'] : 0;
    const submit = make('button', 'akari-inspector-ai-still-primary', `${selectedCount} 案を作る · ${estimate === undefined
        ? state.falEstimateError ? '見積不可' : '見積確認中'
        : estimate ? `見積 $${estimate.toFixed(3)}` : '追加料金なし'}`);
    submit.type = 'button';
    submit.disabled = !canSubmit();
    submit.setAttribute('data-akari-inspector-ai-create', 'true');
    submit.setAttribute('data-akari-inspector-ai-create-count', String(selectedCount));
    submit.addEventListener('click', actions.generate);
    const footer = make('div', 'akari-inspector-ai-still-form-footer');
    footer.appendChild(submit);
    if (state.batch?.candidates.some(row => row.ok && row.relativePath)) {
        const show = make('button', 'akari-inspector-ai-still-secondary', '結果を見る');
        show.type = 'button'; show.setAttribute('data-akari-inspector-ai-show-result', 'true');
        show.addEventListener('click', actions.showResult);
        footer.appendChild(show);
    }
    panel.appendChild(footer);
    if (needsEstimate && state.falEstimateError) {
        const notice = make('p', 'akari-inspector-ai-still-error', `${state.falEstimateError}。「状態を確かめ直す」で読み直せます`);
        notice.setAttribute('data-akari-inspector-ai-estimate-error', 'true');
        panel.appendChild(notice);
    }
    if (state.error) {
        panel.appendChild(make('p', 'akari-inspector-ai-still-error', state.error));
        const retry = make('button', 'akari-inspector-ai-still-secondary', 'もう一度');
        retry.type = 'button';
        retry.setAttribute('data-akari-inspector-ai-retry', 'true');
        retry.disabled = !canSubmit();
        retry.addEventListener('click', actions.generate);
        panel.appendChild(retry);
    }
    if (state.mismatch) panel.appendChild(make('p', 'akari-inspector-ai-still-mismatch', state.mismatch));
    if (state.croppedNotice) {
        const notice = make('p', 'akari-inspector-ai-still-cropped', state.croppedNotice);
        notice.setAttribute('data-akari-inspector-ai-cropped', 'true'); panel.appendChild(notice);
    }
    parent.appendChild(panel);
}
