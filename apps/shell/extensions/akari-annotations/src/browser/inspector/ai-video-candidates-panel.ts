import type { PreferredVideoRoutes, VideoBatchEstimate, VideoCandidate, VideoCandidateBatch } from '../../common/akari-annotations-protocol';
import type { GenerationCatalogRow, GenerationDraft } from './generation-fields';
import { stillMakerBadge } from './maker-badge';
import { replaceVideoCandidateItem } from '../../common/video-candidate-replace';

// The model shelf is the source of company marks and callable status; gen-models supplies generation capabilities.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const modelShelf = require('../../../../../../../packages/schemas/ai-models.json') as {
    models: Array<{ id: string; maker?: string; callable?: boolean }>;
};
const shelfById = new Map(modelShelf.models.map(row => [row.id, row]));

export interface AiVideoState {
    selected: Set<string>;
    preferred?: PreferredVideoRoutes;
    estimate?: VideoBatchEstimate;
    estimateKey?: string;
    estimateLoading?: Promise<void>;
    batch?: VideoCandidateBatch;
    batchBaseline?: Set<string>;
    timelineProgressKey?: string;
    timelineReload?: Promise<void>;
    running: boolean;
    externalRunning?: boolean;
    startedAt?: number;
    picked?: string;
    playerUrl?: string;
    playerElement?: HTMLVideoElement;
    thumbnails: Map<string, string>;
    thumbnailLoads?: Map<string, Promise<void>>;
    moreOpen?: boolean;
    error?: string;
    polling?: boolean;
    loading?: boolean;
    loaded?: boolean;
    batchDraft?: GenerationDraft;
    adopting?: boolean;
}

/** validate-inputs の duration 丸め規則と同じ値を、表示用に求める。 */
export function videoRoundedDuration(row: GenerationCatalogRow, requested: number): number | undefined {
    if (!Number.isFinite(requested) || requested <= 0) return undefined;
    const duration = row.duration;
    if (duration?.kind === 'enum') {
        const values = [...(duration.values ?? [])].filter(Number.isFinite).sort((a, b) => a - b);
        return values.find(value => value >= requested) ?? values[values.length - 1];
    }
    if (duration?.kind === 'range' && Number.isFinite(duration.min) && Number.isFinite(duration.max)) {
        const clamped = Math.min(duration.max!, Math.max(duration.min!, requested));
        const step = (duration as typeof duration & { step?: number }).step;
        if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) return clamped;
        const steps = (clamped - duration.min!) / step;
        const nearest = Math.abs(steps - Math.floor(steps) - 0.5) <= 1e-9 ? Math.floor(steps) : Math.round(steps);
        return Math.min(duration.max!, Math.max(duration.min!, duration.min! + nearest * step));
    }
    return requested;
}

export function videoOverhangSeconds(frameSeconds: number, generatedSeconds: number): number {
    return Number.isFinite(frameSeconds) && frameSeconds > 0 && Number.isFinite(generatedSeconds)
        && generatedSeconds > frameSeconds ? generatedSeconds - frameSeconds : 0;
}

export const videoSecondsLabel = (seconds: number): string =>
    Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(1)));

/** 見積キーには現在の draft が入る。生成開始後は承認時の batchDraft も使える。 */
export function videoRequestedDuration(state: AiVideoState): number | undefined {
    let value: unknown;
    try { value = (JSON.parse(state.estimateKey ?? 'null') as unknown[])?.[2] as GenerationDraft | undefined;
    } catch { /* 見積前や旧キーは batchDraft を使う。 */ }
    const requested = Number((value as GenerationDraft | undefined)?.output?.duration_s
        ?? state.batchDraft?.output?.duration_s);
    return Number.isFinite(requested) && requested > 0 ? Number(requested.toFixed(3)) : undefined;
}

export function videoModelName(row: GenerationCatalogRow): string {
    const name = row.family ?? row.id;
    if (!row.inputs) return name;
    const references = row.inputs.first_frame === 'none' && [row.inputs.reference_images,
        row.inputs.reference_videos, row.inputs.reference_audios].some(capability => capability && capability.max !== 0);
    const mode = references ? '参照から' : row.inputs.last_frame === 'required' ? '最初と最後' : '画像から';
    return `${name}（${mode}）`;
}
export const videoMakerId = (modelId: string): string => shelfById.get(modelId)?.maker ?? 'fal';
export const videoPrice = (value: number | null | undefined): string =>
    value === null || value === undefined ? '料金 未確認' : `$${value.toFixed(2)}`;

export function videoModelGroups(rows: readonly GenerationCatalogRow[], preferred: PreferredVideoRoutes | undefined):
    { usual: GenerationCatalogRow[]; favorites: GenerationCatalogRow[]; others: GenerationCatalogRow[] } {
    const callable = rows.filter(row => row.kind === 'video' && row.callable !== false && shelfById.get(row.id)?.callable !== false);
    const usual = callable.filter(row => row.id === preferred?.defaultModelId);
    const favorites = preferred?.favorites.flatMap(id => callable.filter(row => row.id === id && !usual.includes(row))) ?? [];
    return { usual, favorites, others: callable.filter(row => !usual.includes(row) && !favorites.includes(row)) };
}

export function videoSelectionEstimate(estimate: VideoBatchEstimate | undefined, selected: ReadonlySet<string>):
    { count: number; total: number; unknown: number; invalid: boolean; label: string } {
    const models = estimate?.models.filter(row => selected.has(row.modelId)) ?? [];
    const count = selected.size;
    const total = models.reduce((sum, row) => sum + (row.estimateUsd ?? 0), 0);
    const unknown = models.filter(row => !row.error && row.estimateUsd === null).length;
    const invalid = !count || !estimate || models.length !== count || models.some(row => !!row.error);
    return { count, total, unknown, invalid,
        label: `${count} 案を作る · ${!estimate ? '見積確認中' : `見積 $${total.toFixed(2)}${unknown ? ` + 未確認 ${unknown}` : ''}`}` };
}

export function videoApprovalMessage(estimate: VideoBatchEstimate, selected: ReadonlySet<string>, rows: readonly GenerationCatalogRow[]): string {
    const entries = estimate.models.filter(row => selected.has(row.modelId));
    const detail = entries.map(row => `${videoModelName(rows.find(model => model.id === row.modelId) ?? { id: row.modelId } as GenerationCatalogRow)}: ${videoPrice(row.estimateUsd)}（as_of ${row.asOf ?? '不明'}）`).join('\n');
    const unknown = entries.filter(row => row.estimateUsd === null).length;
    return `${detail}\n合計 見積 $${estimate.models.filter(row => selected.has(row.modelId)).reduce((sum, row) => sum + (row.estimateUsd ?? 0), 0).toFixed(2)}${unknown ? ` + 料金未確認 ${unknown} 件（実際の費用が見積もれません）` : ''}で送ります。費用承認しますか`;
}

export function videoProgress(candidate: VideoCandidate | undefined, elapsed: number): { state: string; label: string } {
    if (candidate?.status === 'failed' || candidate && !candidate.ok && candidate.status !== 'generating')
        return { state: 'failed', label: `失敗 · ${candidate.reason ?? '生成できませんでした。'}` };
    if (candidate?.status === 'done' || candidate?.ok) return { state: 'done', label: '完了' };
    if (candidate?.queueStatus === 'IN_PROGRESS') return { state: 'running', label: `生成中 · ${Math.round(elapsed)} 秒` };
    if (candidate?.status === 'generating' && candidate.queueStatus === 'COMPLETED') {
        return { state: 'running', label: '仕上げ中' };
    }
    return { state: 'waiting', label: '待ち' };
}

export function videoCandidateDetail(candidate: VideoCandidate, name: string): string {
    const parts = [name];
    if (Number.isFinite(candidate.durationSeconds)) {
        const duration = candidate.durationSeconds!;
        parts.push(`尺 ${Number.isInteger(duration) ? duration : duration.toFixed(1)} 秒`);
    }
    if (Number.isFinite(candidate.elapsedSeconds)) parts.push(`作成 ${Math.round(candidate.elapsedSeconds!)} 秒`);
    if (Number.isFinite(candidate.width) && Number.isFinite(candidate.height)) {
        parts.push(`${candidate.width}×${candidate.height}`);
    }
    if (candidate.costUsd !== undefined) parts.push(videoPrice(candidate.costUsd));
    return parts.join(' · ');
}

/** Live result rows are terminal; generating sidecars carry the queue state before those rows exist. */
export function videoProgressCandidate(state: AiVideoState, route: string): VideoCandidate | undefined {
    const batch = state.batch;
    if (!batch) return undefined;
    const current = batch.candidates.filter(row => row.route === route
        && (!row.relativePath || !state.batchBaseline?.has(row.relativePath)));
    const generating = current.filter(row => row.status === 'generating').slice(-1)[0];
    const result = batch.results.find(row => row.route === route
        && (!state.running || batch.running)
        && (!row.relativePath || !state.batchBaseline?.has(row.relativePath)));
    return result ?? generating ?? current.slice(-1)[0];
}

export function videoProgressLayoutKey(batch: VideoCandidateBatch): string {
    return JSON.stringify([batch.routes, batch.completed,
        batch.candidates.map(row => [row.route, row.status, row.relativePath, row.reason]),
        batch.results.map(row => [row.route, row.ok, row.reason])]);
}

export function clearVideoPlayer(state: AiVideoState): void {
    state.playerElement?.pause();
    if (state.playerUrl) URL.revokeObjectURL(state.playerUrl);
    state.playerElement = undefined;
    state.playerUrl = undefined;
    state.picked = undefined;
}

/** Both edits are committed by the timeline as a single undo step. */
export function replaceVideoInEdit<T extends { sources?: Array<{ id: string; path: string }>;
    tracks?: Array<{ items?: Array<{ id: string; source: { kind: string; src: string; in: number; out: number } }> }> }>(
    doc: T, itemId: string, candidate: VideoCandidate
): T {
    if (!candidate.ok || !candidate.relativePath || !Number.isFinite(candidate.durationSeconds)) throw new Error('完成した候補を選んでください。');
    const track = doc.tracks?.find(row => row.items?.some(item => item.id === itemId));
    const index = track?.items?.findIndex(item => item.id === itemId) ?? -1;
    if (!track?.items || index < 0) throw new Error('差し替える枠がありません。');
    const replaced = replaceVideoCandidateItem(track.items[index], candidate.durationSeconds!);
    const sourceId = `gen-${itemId}-video`;
    const source = doc.sources?.find(row => row.id === sourceId);
    if (source) source.path = candidate.relativePath;
    else (doc.sources ??= []).push({ id: sourceId, path: candidate.relativePath });
    track.items[index] = replaced;
    return doc;
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, label?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
};

export function appendAiVideoCandidatesPanel(parent: HTMLElement, state: AiVideoState, catalog: readonly GenerationCatalogRow[], actions: {
    select(modelId: string, checked: boolean): void; generate(models?: string[]): void; cancel(): void;
    pick(candidate: VideoCandidate): void; adopt(): void; thumbnail(candidate: VideoCandidate, image: HTMLImageElement): void;
}): void {
    const panel = make('div', 'akari-inspector-ai-still-panel akari-inspector-ai-video-panel');
    panel.setAttribute('data-akari-inspector-video-panel', 'true');
    const groups = videoModelGroups(catalog, state.preferred);
    const entries = [['いつもの', groups.usual], ['★ お気に入り', groups.favorites], ['ほかのモデル', groups.others]] as const;
    for (const [heading, models] of entries) {
        if (!models.length) continue;
        const section = make('div', 'akari-inspector-ai-still-route-group');
        section.setAttribute('data-akari-inspector-video-model-group', heading);
        if (heading === 'ほかのモデル') {
            const toggle = make('button', 'akari-inspector-ai-still-secondary', heading);
            toggle.type = 'button'; toggle.setAttribute('data-akari-inspector-video-more', 'true');
            toggle.setAttribute('aria-expanded', String(!!state.moreOpen));
            toggle.addEventListener('click', () => { state.moreOpen = !state.moreOpen; section.hidden = !state.moreOpen; toggle.hidden = false; });
            panel.appendChild(toggle); section.hidden = !state.moreOpen;
        } else section.appendChild(make('div', 'akari-inspector-ai-still-label', heading));
        for (const model of models) {
            const estimate = state.estimate?.models.find(row => row.modelId === model.id);
            const disabled = !!estimate?.error;
            const label = make('label', 'akari-inspector-ai-still-route');
            label.setAttribute('data-akari-inspector-video-model', model.id);
            label.setAttribute('data-akari-inspector-video-model-disabled', String(disabled));
            if (disabled) label.style.opacity = '0.55';
            const check = make('input', ''); check.type = 'checkbox'; check.checked = state.selected.has(model.id);
            check.disabled = disabled || state.running;
            check.setAttribute('data-akari-inspector-video-model-check', model.id);
            check.addEventListener('change', () => {
                actions.select(model.id, check.checked);
                window.dispatchEvent(new Event('akari.videoModelsChanged'));
            });
            const name = make('span', 'akari-inspector-ai-still-route-name');
            name.append(stillMakerBadge(videoMakerId(model.id)), make('span', '', videoModelName(model)));
            const requested = videoRequestedDuration(state);
            const seconds = videoRoundedDuration(model, requested ?? NaN);
            if (seconds !== undefined) {
                const duration = make('span', 'akari-inspector-ai-video-model-duration', `${videoSecondsLabel(seconds)} 秒で作ります`);
                duration.setAttribute('data-akari-inspector-video-model-duration', model.id);
                duration.style.display = 'block';
                duration.style.fontSize = '10px';
                duration.style.opacity = '0.78';
                name.appendChild(duration);
            }
            label.append(check, name, make('span', 'akari-inspector-ai-still-route-price',
                estimate ? videoPrice(estimate.estimateUsd) : '見積もりを確認中'));
            if (estimate?.error) {
                const reason = make('span', 'akari-inspector-ai-still-route-reason', estimate.error);
                reason.setAttribute('data-akari-inspector-video-model-reason', model.id);
                label.appendChild(reason);
            }
            section.appendChild(label);
        }
        panel.appendChild(section);
    }
    const summary = videoSelectionEstimate(state.estimate, state.selected);
    const requested = videoRequestedDuration(state);
    const longest = Math.max(0, ...catalog.filter(row => state.selected.has(row.id))
        .map(row => videoRoundedDuration(row, requested ?? NaN) ?? 0));
    if (requested !== undefined && videoOverhangSeconds(requested, longest) > 0) {
        const note = make('div', 'akari-inspector-ai-video-duration-note',
            `枠 ${videoSecondsLabel(requested)} 秒 → ${videoSecondsLabel(longest)} 秒の動画を作ります（枠に入るのは ${videoSecondsLabel(requested)} 秒ぶん。残りはタイムラインに点線で出ます）`);
        note.setAttribute('data-akari-inspector-video-duration-note', 'true');
        note.style.cssText = 'font-size:11px;line-height:1.4;opacity:.82;margin:6px 0';
        panel.appendChild(note);
    }
    const submit = make('button', 'akari-inspector-ai-still-primary', summary.label);
    submit.type = 'button'; submit.disabled = summary.invalid || state.running;
    submit.setAttribute('data-akari-inspector-video-create', 'true');
    submit.setAttribute('data-akari-inspector-video-create-count', String(summary.count));
    submit.addEventListener('click', () => actions.generate()); panel.appendChild(submit);
    if (state.batch?.routes.length) {
        const progress = make('div', 'akari-inspector-ai-still-progress');
        progress.setAttribute('data-akari-inspector-video-progress', `${state.batch.completed}/${state.batch.routes.length}`);
        for (const route of state.batch.routes) {
            const candidate = videoProgressCandidate(state, route);
            const elapsed = candidate?.elapsedSeconds ?? Math.max(0, (Date.now() - (state.startedAt ?? Date.now())) / 1000);
            const status = videoProgress(candidate, elapsed);
            const model = catalog.find(row => row.id === route);
            const row = make('div', 'akari-inspector-ai-still-progress-row',
                `${status.state === 'done' ? '✓' : status.state === 'failed' ? '×' : '◌'} ${model ? videoModelName(model) : route} · ${status.label}`);
            row.setAttribute('data-akari-inspector-video-progress-model', route);
            row.setAttribute('data-akari-inspector-video-progress-state', status.state);
            row.setAttribute('data-akari-inspector-video-progress-elapsed', String(Math.round(elapsed)));
            row.setAttribute('data-akari-inspector-video-progress-queue', candidate?.queueStatus ?? '');
            progress.appendChild(row);
        }
        panel.appendChild(progress);
    }
    if (state.running) {
        const cancel = make('button', 'akari-inspector-ai-still-secondary', '中止');
        cancel.type = 'button'; cancel.setAttribute('data-akari-inspector-video-cancel', 'true');
        cancel.addEventListener('click', actions.cancel); panel.appendChild(cancel);
    }
    if (state.batch?.candidates.length) {
        panel.appendChild(make('div', 'akari-inspector-ai-still-label', '候補（押すとここで再生します）'));
        for (const candidate of state.batch.candidates) {
            if (candidate.status === 'generating') continue;
            const model = catalog.find(row => row.id === candidate.route);
            const name = model ? videoModelName(model) : candidate.route;
            if (!candidate.ok || !candidate.relativePath) {
                const failed = make('div', 'akari-inspector-ai-still-error', `${name} · 失敗 · ${candidate.reason ?? '生成できませんでした。'}`);
                failed.setAttribute('data-akari-inspector-video-failed-model', candidate.route);
                const retry = make('button', 'akari-inspector-ai-still-secondary', '同じ入力でもう一度');
                retry.type = 'button'; retry.disabled = state.running;
                retry.setAttribute('data-akari-inspector-video-retry-model', candidate.route);
                retry.addEventListener('click', () => actions.generate([candidate.route]));
                failed.appendChild(retry); panel.appendChild(failed); continue;
            }
            const button = make('button', 'akari-inspector-ai-video-candidate');
            button.type = 'button'; button.setAttribute('data-akari-inspector-video-candidate', candidate.relativePath);
            button.setAttribute('data-akari-inspector-video-candidate-selected', String(state.picked === candidate.relativePath));
            button.setAttribute('aria-pressed', String(state.picked === candidate.relativePath));
            const image = make('img', 'akari-inspector-ai-video-candidate-thumbnail');
            image.alt = `${name} の候補`; image.setAttribute('data-akari-inspector-video-candidate-thumbnail', candidate.relativePath);
            image.style.aspectRatio = Number.isFinite(candidate.width) && Number.isFinite(candidate.height)
                && candidate.width! > 0 && candidate.height! > 0 ? `${candidate.width} / ${candidate.height}` : '16 / 9';
            actions.thumbnail(candidate, image);
            const detail = make('span', 'akari-inspector-ai-video-candidate-detail');
            detail.append(stillMakerBadge(videoMakerId(candidate.route)), make('span', '', videoCandidateDetail(candidate, name)));
            button.append(image, detail);
            button.addEventListener('click', () => actions.pick(candidate)); panel.appendChild(button);
            if (state.picked === candidate.relativePath && state.playerUrl) {
                const player = state.playerElement ?? make('video', 'akari-inspector-ai-video-player');
                if (!state.playerElement) {
                    player.controls = true; player.playsInline = true; player.src = state.playerUrl;
                    player.style.cssText = 'display:block;width:100%;max-height:220px;margin:10px 0';
                    state.playerElement = player;
                }
                player.setAttribute('data-akari-inspector-video-player', state.picked);
                panel.appendChild(player);
            }
        }
        const adopt = make('button', 'akari-inspector-ai-still-primary', 'この案を使う');
        adopt.type = 'button'; adopt.disabled = !state.picked || state.running || !!state.adopting;
        adopt.setAttribute('data-akari-inspector-video-adopt', 'true');
        adopt.addEventListener('click', actions.adopt); panel.appendChild(adopt);
        const note = make('p', 'akari-inspector-ai-still-next', 'ほかの候補は素材に残ります');
        note.setAttribute('data-akari-inspector-video-candidates-remain', 'true'); panel.appendChild(note);
    }
    if (state.error) {
        panel.appendChild(make('p', 'akari-inspector-ai-still-error', state.error));
        const retry = make('button', 'akari-inspector-ai-still-secondary', 'もう一度');
        retry.type = 'button'; retry.setAttribute('data-akari-inspector-video-retry', 'true');
        retry.addEventListener('click', () => actions.generate()); panel.appendChild(retry);
    }
    parent.appendChild(panel);
}
