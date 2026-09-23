import type { AkariAnnotationsService, NarrationEngine, NarrationVoice } from '../../common/akari-annotations-protocol';
import { irodoriCustomVoiceMissing, narrationEstimate, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice } from '../../common/read-aloud-model';
import { placeAiNarration, type NarrationEdit } from '../../common/ai-narration-placement';

export interface AiNarrationState {
    script: string; reading: string; style?: string; engineId: string; voiceId: string;
    voices: NarrationVoice[]; running: boolean; cancelled?: boolean; startedAt?: number; error?: string; placement?: string;
}
export interface AiNarrationActions {
    change(): void; chooseEngine(engineId: string): void; generate(): void; cancel(): void;
}

export function appendAiNarrationPanel(parent: HTMLElement, state: AiNarrationState,
    engines: readonly NarrationEngine[], actions: AiNarrationActions): void {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, content?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag); node.className = `akari-inspector-ai-narration-${name}`;
        if (content !== undefined) node.textContent = content;
        return node;
    };
    const panel = make('section', 'panel');
    const scriptLabel = make('label', 'label', '原稿');
    const script = make('textarea', 'textarea'); script.setAttribute('aria-label', '原稿'); script.value = state.script;
    script.addEventListener('input', () => { state.script = script.value; actions.change(); updateEstimate(); });
    scriptLabel.append(script);
    const readingLabel = make('label', 'label', '読み（任意）');
    const reading = make('textarea', 'textarea'); reading.setAttribute('aria-label', '読み'); reading.value = state.reading;
    reading.addEventListener('input', () => { state.reading = reading.value; actions.change(); updateEstimate(); });
    readingLabel.append(reading);
    panel.append(scriptLabel, readingLabel, make('h4', 'heading', 'エンジン'));
    const cards = make('div', 'engines');
    for (const engine of engines.filter(row => ['voicevox', 'gemini-tts', 'irodori'].includes(row.id))) {
        const card = make('label', 'engine');
        const radio = make('input', 'engine-radio'); radio.type = 'radio'; radio.name = 'akari-inspector-ai-narration-engine';
        radio.value = engine.id; radio.checked = engine.id === state.engineId;
        radio.disabled = engine.availability.state !== 'available' && !(engine.id === 'voicevox' && engine.availability.state === 'needs');
        radio.addEventListener('change', () => actions.chooseEngine(engine.id));
        const text = make('span', 'engine-text');
        text.append(make('strong', 'engine-name', engine.label),
            make('span', 'engine-cost', engine.place === 'local' ? 'この Mac · 無料'
                : engine.place === 'network' ? `別の PC · ${engine.availability.detail?.url ?? '接続先を確認'}`
                    : `有料 · $${engine.price?.usd_per_1000_chars ?? 0} / 1000 字${engine.price?.verified === false ? '（暫定）' : ''}`),
            make('span', 'engine-availability', engine.availability.label));
        card.append(radio, text); cards.append(card);
    }
    panel.append(cards);
    const voiceLabel = make('label', 'label', '声');
    const voice = make('select', 'voice'); voice.setAttribute('aria-label', '声');
    for (const option of state.voices) {
        const row = document.createElement('option'); row.value = option.id; row.textContent = option.label; voice.append(row);
    }
    voice.value = state.voiceId;
    voice.addEventListener('change', () => { state.voiceId = voice.value; actions.change(); });
    voiceLabel.append(voice); panel.append(voiceLabel);
    const engine = engines.find(row => row.id === state.engineId);
    if (engine?.id === 'gemini-tts' || engine?.id === 'irodori' && state.voiceId === 'custom') {
        const required = engine.id === 'irodori';
        const styleLabel = make('label', 'label', required ? '声の指示（必須）' : '話し方の指示（任意）');
        const style = make('textarea', 'textarea'); style.value = state.style ?? '';
        style.setAttribute('aria-label', required ? '声の指示（必須）' : '話し方の指示（任意）');
        style.addEventListener('input', () => { state.style = style.value; actions.change(); });
        styleLabel.append(style); panel.append(styleLabel);
    }
    let estimateNode: HTMLParagraphElement | undefined;
    const updateEstimate = (): void => {
        if (!engine || !estimateNode) return;
        const estimate = narrationEstimate(engine, state.reading.trim() || state.script);
        estimateNode.textContent = `${engine.label} · ${estimate.chars} 字 · ${estimate.label}`;
    };
    if (engine) {
        const estimate = narrationEstimate(engine, state.reading.trim() || state.script);
        estimateNode = make('p', 'estimate', `${engine.label} · ${estimate.chars} 字 · ${estimate.label}`);
        panel.append(estimateNode);
    }
    const button = make('button', 'button', state.running ? '生成中…' : state.error ? 'もう一度' : '声を作る');
    button.type = 'button'; button.disabled = state.running || !state.script.trim() || !state.voiceId || !engine
        || irodoriCustomVoiceMissing(engine.id, state.voiceId, state.style ?? '');
    button.addEventListener('click', () => actions.generate()); panel.append(button);
    if (state.running) {
        panel.append(make('p', 'progress', `声を作っています · ${Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000)} 秒`));
        const cancel = make('button', 'button', 'キャンセル'); cancel.type = 'button';
        cancel.addEventListener('click', () => actions.cancel()); panel.append(cancel);
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
    if (!script.trim() || !state.voiceId || irodoriCustomVoiceMissing(engine.id, state.voiceId, state.style ?? '')) return undefined;
    const plan = readAloudPreviewPlan(engine, reading);
    if (plan.needsApproval && !(await options.confirm(plan.confirm!))) return undefined;
    if (state.cancelled) return undefined;
    const result = await options.service.generateNarration({ projectRootUri: options.projectRootUri,
        engine: engine.id, voice: state.voiceId, script, reading, captionId: null,
        t: options.atSeconds, approved: plan.needsApproval,
        style: engine.id === 'gemini-tts' || engine.id === 'irodori' && state.voiceId === 'custom' ? state.style : undefined,
        irodoriUrl: engine.id === 'irodori' ? options.irodoriUrl : undefined });
    if (state.cancelled) return undefined;
    if (result.status !== 'ok' || !result.path || !result.duration_s) throw new Error('音声を生成できませんでした。');
    let label = '';
    await options.commit('ナレーションを置く', doc => {
        // Recalculate inside the history mutation so intervening timeline edits cannot be overwritten.
        const placement = planAiNarrationPlacement(doc.tracks, options.itemId, result.duration_s!, options.fps);
        label = placement.label;
        return placeAiNarration(doc, options.itemId, result.path!, result.duration_s!, options.fps);
    });
    return label;
}

import { planAiNarrationPlacement } from '../../common/ai-narration-placement';

export function initialAiNarrationState(engines: readonly NarrationEngine[]): AiNarrationState {
    return { script: '', reading: '', style: '', engineId: selectReadAloudEngine(engines)?.id ?? '', voiceId: '',
        voices: [], running: false };
}
export function chooseAiNarrationVoice(state: AiNarrationState, voices: readonly NarrationVoice[]): void {
    state.voices = [...voices]; state.voiceId = selectReadAloudVoice(voices, state.voiceId)?.id ?? '';
}
