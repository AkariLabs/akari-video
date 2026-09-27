import type { AkariAnnotationsService, NarrationCandidate, NarrationEngine, NarrationVoice } from '../../common/akari-annotations-protocol';
import { irodoriCustomVoiceMissing, narrationEstimate, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice } from '../../common/read-aloud-model';
import { stillMakerBadge } from './maker-badge';
import { aiNarrationNeedsChoice, placeAiNarration, planAiNarrationPlacement,
    type NarrationEdit, type NarrationTrack } from '../../common/ai-narration-placement';

export interface AiNarrationState {
    script: string; reading: string; style?: string; engineId: string; voiceId: string;
    voices: NarrationVoice[]; running: boolean; cancelled?: boolean; startedAt?: number; error?: string; placement?: string;
    placementChoice?: 'lower' | 'shift';
    selectedEngineIds?: string[]; voicesByEngine?: Record<string, NarrationVoice[]>; voiceByEngine?: Record<string, string>;
    preferredEngineId?: string; favorites?: string[]; candidates?: NarrationCandidate[]; completed?: number;
    playingPath?: string; lastRoutes?: string[];
    runningRoutes?: string[];
}
export interface AiNarrationActions {
    change(): void; chooseEngine(engineId: string): void; chooseVoice?(engineId: string, voiceId: string): void;
    generate(): void; cancel(): void; play?(candidate: NarrationCandidate): void; adopt?(candidate: NarrationCandidate): void;
    retry?(candidate: NarrationCandidate): void;
}

export function selectedNarrationEngines(engines: readonly NarrationEngine[], preferred?: string): string[] {
    return [selectReadAloudEngine(engines, preferred)?.id].filter((id): id is string => !!id);
}

export function orderedNarrationEngines(engines: readonly NarrationEngine[], favorites: readonly string[] = []): NarrationEngine[] {
    return [...engines].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
}

export function narrationBatchConfirm(engines: readonly NarrationEngine[], reading: string):
    { title: string; msg: string; ok: string; cancel: string } | undefined {
    const paid = engines.filter(engine => engine.place === 'cloud');
    if (!paid.length) return undefined;
    const estimates = paid.map(engine => ({ engine, quote: narrationEstimate(engine, reading) }));
    const total = estimates.some(row => row.quote.usd === null) ? '見積不可' :
        `$${estimates.reduce((sum, row) => sum + (row.quote.usd ?? 0), 0).toFixed(3)}`;
    return { title: '費用承認', msg: `${estimates.map(row => `${row.engine.label}: ${row.quote.usd === null ? '見積不可' : `$${row.quote.usd.toFixed(3)}`}`).join(' / ')}\n合計 ${total}。読み原稿 ${reading.length} 字を送ります。費用承認しますか`, ok: '費用承認する', cancel: 'キャンセル' };
}

export function narrationRowEstimate(engine: NarrationEngine, reading: string): string {
    if (engine.place !== 'cloud') return '無料';
    const quote = narrationEstimate(engine, reading);
    return quote.usd === null ? '見積不可' : `見積 $${quote.usd.toFixed(3)}`;
}

export function aiNarrationChoiceVisible(state: Pick<AiNarrationState, 'script' | 'reading'>,
    placement?: { tracks: readonly NarrationTrack[]; itemId: string; fps: number }): boolean {
    if (!placement || !state.script.trim()) return false;
    const reading = state.reading.trim() || state.script;
    const estimatedSeconds = Math.max(0.1, Array.from(reading.trim()).length / 5);
    return aiNarrationNeedsChoice(placement.tracks, placement.itemId, estimatedSeconds, placement.fps);
}

export function appendAiNarrationPanel(parent: HTMLElement, state: AiNarrationState,
    engines: readonly NarrationEngine[], actions: AiNarrationActions,
    placement?: { tracks: readonly NarrationTrack[]; itemId: string; fps: number }): void {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, content?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag); node.className = `akari-inspector-ai-narration-${name}`;
        if (content !== undefined) node.textContent = content;
        return node;
    };
    const panel = make('section', 'panel');
    const scriptLabel = make('label', 'label', '原稿');
    const script = make('textarea', 'textarea'); script.setAttribute('aria-label', '原稿'); script.value = state.script;
    script.addEventListener('input', () => { state.script = script.value; actions.change(); updateEstimate(); updateChoice(); });
    scriptLabel.append(script);
    const readingLabel = make('label', 'label', '読み（任意）');
    const reading = make('textarea', 'textarea'); reading.setAttribute('aria-label', '読み'); reading.value = state.reading;
    reading.addEventListener('input', () => { state.reading = reading.value; actions.change(); updateEstimate(); updateChoice(); });
    readingLabel.append(reading);
    panel.append(scriptLabel, readingLabel, make('h4', 'heading', 'エンジン'));
    const cards = make('div', 'engines');
    const rowEstimates: Array<{ engine: NarrationEngine; node: HTMLElement }> = [];
    const shown = orderedNarrationEngines(engines.filter(row => ['voicevox', 'gemini-tts', 'irodori'].includes(row.id)
        || row.id === 'fal-qwen3' && row.availability.state === 'available'), state.favorites);
    for (const place of ['free', 'paid'] as const) {
        const group = shown.filter(row => (row.place === 'cloud' ? 'paid' : 'free') === place);
        if (!group.length) continue;
        cards.append(make('h5', 'group', place === 'free' ? '追加料金なし' : '使った分だけ'));
        for (const engine of group) {
        const card = make('div', 'engine');
        card.setAttribute('data-akari-narration-engine', engine.id);
        const radio = make('input', 'engine-checkbox'); radio.type = 'checkbox';
        radio.value = engine.id; radio.checked = (state.selectedEngineIds ?? [state.engineId]).includes(engine.id);
        radio.disabled = state.running || engine.availability.state !== 'available' && !(engine.id === 'voicevox' && engine.availability.state === 'needs');
        radio.addEventListener('change', () => actions.chooseEngine(engine.id));
        const text = make('span', 'engine-text');
        text.append(stillMakerBadge(engine.id === 'voicevox' ? 'voicevox' : engine.id === 'irodori' ? 'irodori'
            : engine.id === 'fal-qwen3' ? 'qwen' : 'google'),
            make('strong', 'engine-name', `${state.favorites?.includes(engine.id) ? '★ ' : ''}${engine.id === 'fal-qwen3' ? '自声' : engine.label}`),
            make('span', 'engine-cost', engine.place === 'local' ? 'この Mac · 無料'
                : engine.place === 'network' ? `別の PC · ${engine.availability.detail?.url ?? '接続先を確認'}`
                    : `有料 · $${engine.price?.usd_per_1000_chars ?? 0} / 1000 字${engine.price?.verified === false ? '（暫定）' : ''}`),
            make('span', 'engine-availability', engine.availability.label));
        const rowEstimate = make('span', 'engine-estimate', narrationRowEstimate(engine, state.reading.trim() || state.script));
        rowEstimates.push({ engine, node: rowEstimate });
        text.append(rowEstimate);
        card.append(radio, text);
        const voiceLabel = make('label', 'label', '声');
        const voice = make('select', 'voice'); voice.setAttribute('aria-label', `${engine.label} の声`);
        for (const option of state.voicesByEngine?.[engine.id] ?? (engine.id === state.engineId ? state.voices : [])) {
            const row = document.createElement('option'); row.value = option.id; row.textContent = option.label; voice.append(row);
        }
        voice.value = state.voiceByEngine?.[engine.id] ?? (engine.id === state.engineId ? state.voiceId : '');
        voice.disabled = state.running || !radio.checked;
        voice.addEventListener('change', () => actions.chooseVoice?.(engine.id, voice.value));
        voiceLabel.append(voice); card.append(voiceLabel); cards.append(card);
        }
    }
    panel.append(cards);
    const selected = state.selectedEngineIds ?? [state.engineId];
    if (selected.includes('gemini-tts') || selected.includes('irodori') && state.voiceByEngine?.irodori === 'custom') {
        const required = selected.includes('irodori') && state.voiceByEngine?.irodori === 'custom';
        const styleLabel = make('label', 'label', required ? '声の指示（必須）' : '話し方の指示（任意）');
        const style = make('textarea', 'textarea'); style.value = state.style ?? '';
        style.setAttribute('aria-label', required ? '声の指示（必須）' : '話し方の指示（任意）');
        style.addEventListener('input', () => { state.style = style.value; actions.change(); });
        styleLabel.append(style); panel.append(styleLabel, make('p', 'note', '話し方の指示は対応するエンジンにだけ効きます。'));
    }
    let estimateNode: HTMLParagraphElement | undefined;
    const updateEstimate = (): void => {
        const currentReading = state.reading.trim() || state.script;
        for (const row of rowEstimates) row.node.textContent = narrationRowEstimate(row.engine, currentReading);
        if (!estimateNode) return;
        const estimates = engines.filter(row => selected.includes(row.id)).map(row => narrationEstimate(row, currentReading));
        const total = estimates.reduce((sum, row) => sum + (row.usd ?? 0), 0);
        estimateNode.textContent = estimates.some(row => row.usd === null)
            ? '合計見積不可（従量） · 承認 1 回' : `合計 $${total.toFixed(3)} · 承認 1 回`;
    };
    if (selected.length) {
        estimateNode = make('p', 'estimate'); updateEstimate();
        panel.append(estimateNode);
    }
    const choice = make('fieldset', 'placement-choice');
    choice.append(make('legend', 'placement-heading', '枠より声が長いとき'));
    for (const [value, label] of [
        ['lower', '下の音声トラックに置く（既定）'],
        ['shift', '後ろのクリップをずらして収める']
    ] as const) {
        const option = make('label', 'placement-option');
        const input = make('input', 'placement-radio'); input.type = 'radio';
        input.name = 'akari-inspector-ai-narration-placement-choice'; input.value = value;
        input.checked = (state.placementChoice ?? 'lower') === value;
        input.disabled = state.running;
        input.addEventListener('change', () => { state.placementChoice = value; actions.change(); });
        option.append(input, document.createTextNode(label)); choice.append(option);
    }
    const updateChoice = (): void => {
        choice.hidden = !aiNarrationChoiceVisible(state, placement);
        if (choice.hidden) {
            state.placementChoice = 'lower';
            const lower = choice.querySelector<HTMLInputElement>('input[value="lower"]');
            if (lower) lower.checked = true;
        }
    };
    updateChoice(); panel.append(choice);
    const button = make('button', 'button', state.running ? '生成中…' : state.error ? '同じ入力でもう一度' : `${selected.length} 案を作る`);
    button.type = 'button'; button.disabled = state.running || !state.script.trim() || !selected.length
        || selected.some(id => !state.voiceByEngine?.[id])
        || irodoriCustomVoiceMissing(selected.includes('irodori') ? 'irodori' : undefined, state.voiceByEngine?.irodori ?? '', state.style ?? '');
    button.addEventListener('click', () => actions.generate()); panel.append(button);
    if (state.running) {
        const activeRoutes = state.runningRoutes ?? selected;
        panel.append(make('p', 'progress', `${activeRoutes.length} 案作成中 · ${state.completed ?? 0}/${activeRoutes.length}`));
        for (const id of activeRoutes) {
            const candidate = state.candidates?.find(row => row.route === id);
            if (!candidate) panel.append(make('p', 'route-progress', `◌ ${engines.find(row => row.id === id)?.label ?? id} · ${Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000)} 秒`));
        }
        const cancel = make('button', 'button', 'キャンセル'); cancel.type = 'button';
        cancel.addEventListener('click', () => actions.cancel()); panel.append(cancel);
    }
    if (state.candidates?.length) {
        panel.append(make('h4', 'heading', `候補 ${state.candidates.filter(row => row.ok).length}`));
        for (const candidate of state.candidates) {
            const row = make('div', 'candidate'); row.setAttribute('data-akari-narration-candidate', candidate.route);
            if (candidate.ok && candidate.relativePath) {
                const play = make('button', 'play', state.playingPath === candidate.relativePath ? '■' : '▶');
                play.type = 'button'; play.addEventListener('click', () => actions.play?.(candidate));
                row.append(play);
            }
            row.append(make('span', 'candidate-label', `${engines.find(engine => engine.id === candidate.route)?.label ?? candidate.route} · ${candidate.voice || '声'} · ${candidate.durationSeconds?.toFixed(2) ?? '?'} 秒 · ${candidate.elapsedSeconds?.toFixed(1) ?? '?'} 秒 · $${(candidate.costUsd ?? 0).toFixed(3)}`));
            if (candidate.ok) {
                const adopt = make('button', 'adopt', 'この案を使う'); adopt.type = 'button';
                adopt.addEventListener('click', () => actions.adopt?.(candidate)); row.append(adopt);
            } else {
                row.append(make('span', 'error', `失敗 · ${candidate.reason ?? '生成できませんでした。'}`));
                const retry = make('button', 'retry', '同じ入力でもう一度'); retry.type = 'button';
                retry.addEventListener('click', () => actions.retry?.(candidate)); row.append(retry);
            }
            panel.append(row);
        }
        panel.append(make('p', 'note', 'ほかの候補は素材に残ります。'));
    }
    if (state.error) panel.append(make('p', 'error', state.error));
    if (state.placement) panel.append(make('p', 'placement', state.placement));
    parent.append(panel);
}

export async function generateAiNarration(options: {
    state: AiNarrationState; engine: NarrationEngine; projectRootUri: string; itemId: string; atSeconds: number;
    service: Pick<AkariAnnotationsService, 'generateNarration'>;
    irodoriUrl?: string;
    confirm: (message: NonNullable<ReturnType<typeof readAloudPreviewPlan>['confirm']>) => Promise<boolean>;
    commit: (label: string, mutate: (doc: NarrationEdit) => NarrationEdit) => Promise<unknown>;
    fps: number;
}): Promise<string | undefined> {
    const { state, engine } = options;
    const script = state.script; const reading = state.reading.trim() || script;
    const placementChoice = state.placementChoice ?? 'lower';
    if (!script.trim() || !state.voiceId || irodoriCustomVoiceMissing(engine.id, state.voiceId, state.style ?? '')) return undefined;
    const plan = readAloudPreviewPlan(engine, reading);
    if (plan.needsApproval && !(await options.confirm(plan.confirm!))) return undefined;
    if (state.cancelled) return undefined;
    const result = await options.service.generateNarration({ projectRootUri: options.projectRootUri,
        engine: engine.id, voice: state.voiceId, script, reading, captionId: null,
        t: options.atSeconds, approved: plan.needsApproval,
        profile: engine.id === 'fal-qwen3' ? state.voiceId : undefined,
        style: engine.id === 'gemini-tts' || engine.id === 'irodori' && state.voiceId === 'custom' ? state.style : undefined,
        irodoriUrl: engine.id === 'irodori' ? options.irodoriUrl : undefined });
    if (state.cancelled) return undefined;
    if (result.status !== 'ok' || !result.path || !result.duration_s) throw new Error('音声を生成できませんでした。');
    let label = '';
    await options.commit('ナレーションを置く', doc => {
        // Recalculate inside the history mutation so intervening timeline edits cannot be overwritten.
        const placement = planAiNarrationPlacement(doc.tracks, options.itemId, result.duration_s!, options.fps,
            placementChoice);
        label = placement.label;
        return placeAiNarration(doc, options.itemId, result.path!, result.duration_s!, options.fps,
            placementChoice);
    });
    return label;
}

export function initialAiNarrationState(engines: readonly NarrationEngine[], preferred?: string): AiNarrationState {
    const selected = selectedNarrationEngines(engines, preferred);
    return { script: '', reading: '', style: '', engineId: selected[0] ?? '', voiceId: '',
        voices: [], selectedEngineIds: selected, voicesByEngine: {}, voiceByEngine: {},
        running: false, placementChoice: 'lower' };
}
export function chooseAiNarrationVoice(state: AiNarrationState, voices: readonly NarrationVoice[], engineId = state.engineId): void {
    state.voicesByEngine ??= {}; state.voiceByEngine ??= {};
    state.voicesByEngine[engineId] = [...voices];
    state.voiceByEngine[engineId] = selectReadAloudVoice(voices, state.voiceByEngine[engineId])?.id ?? '';
    if (engineId === state.engineId) { state.voices = [...voices]; state.voiceId = state.voiceByEngine[engineId]; }
}
