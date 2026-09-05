import {
    AkariPreviewService,
    ReviewRectStroke,
    ReviewStroke,
    ReviewStrokeFrame,
    ReviewSessionSummary,
    ReviewSessionTransportEvent,
    ReviewSessionUiEvent,
    StartReviewSessionRequest,
    StartReviewSessionResult
} from '../common/akari-preview-protocol';
import {
    EditableTargetLike,
    REVIEW_TOOL_MODE_INITIAL,
    ReviewToolMode,
    ReviewToolModeState,
    isEditableEventTarget,
    isImeCompositionKeydown,
    reduceReviewToolMode,
    reviewToolModeForShortcutKey
} from '../common/review-tool-mode';
import { classifyUiEventType, resolveUiEventTarget } from '../common/ui-event-target';

export type ReviewSessionRecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

/** task.md 指示2: select ツールで直近クリックした登録済み UI 要素（review.json ui: target 着地の元）。 */
export interface ReviewSelectedUiTarget {
    target: string;
    label: string;
}

export interface ReviewSessionUiState {
    editUri: string;
    projectRootUri: string;
    status: ReviewSessionRecorderStatus;
    active: boolean;
    elapsedSec: number;
    level: number;
    silenceWarning: boolean;
    toolMode: ReviewToolMode;
    sessions: ReviewSessionSummary[];
    selectedUiTarget?: ReviewSelectedUiTarget;
    error?: string;
}

/** buildUiEvent が返しうる 3 種のうち target/label を必ず持つもの（tool.mode を除く）。 */
type ResolvedUiTargetEvent = Extract<ReviewSessionUiEvent, { target: string; label: string }>;

interface PendingPointerUpFallback {
    active: ActiveReviewSession;
    target: string;
    suppressed: boolean;
}

export interface ReviewTransportSnapshot {
    timelineT: number;
    playing: boolean;
    rate: number;
}

export type ReviewTransportChange =
    | { type: 'play'; timelineT: number }
    | { type: 'pause'; timelineT: number }
    | { type: 'seek'; from: number; to: number }
    | { type: 'rate'; value: number; timelineT: number };

interface ActiveReviewSession extends StartReviewSessionResult {
    projectRootUri: string;
    editUri: string;
    monotonicStartedAt: number;
    lastRecT: number;
    transport: ReviewTransportSnapshot;
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    silentGain: GainNode;
    pendingSamples: Float32Array[];
    pendingSampleCount: number;
    level: number;
    lastNonSilentAt: number;
    writeTail: Promise<void>;
    writeError?: Error;
    nextStrokeNumber: number;
    pendingStroke?: Pick<ReviewStroke, 'id' | 'recTStart' | 'frame'>;
    pendingRect?: Pick<ReviewRectStroke, 'id' | 'recTStart' | 'frame'>;
}

const TARGET_SAMPLE_RATE = 16_000;
const AUDIO_FLUSH_INTERVAL_MS = 1_000;
const UI_UPDATE_INTERVAL_MS = 250;
const TICK_INTERVAL_MS = 1_000;
const SILENCE_WARNING_AFTER_MS = 5_000;
/** akari-review-panel-widget.ts の `data-akari-ui="panel:review"`（自身）とミラー。 */
const REVIEW_PANEL_TARGET_ID = 'panel:review';

export class ReviewSessionRecorder {
    protected active: ActiveReviewSession | undefined;
    protected status: ReviewSessionRecorderStatus = 'idle';
    protected sessions: ReviewSessionSummary[] = [];
    protected uiTimer: number | undefined;
    protected tickTimer: number | undefined;
    protected requestedEditUri = '';
    protected requestedProjectRootUri = '';
    protected uiClickListener: ((event: MouseEvent) => void) | undefined;
    protected uiPointerUpListener: ((event: PointerEvent) => void) | undefined;
    protected keydownListener: ((event: KeyboardEvent) => void) | undefined;
    protected toolModeState: ReviewToolModeState = REVIEW_TOOL_MODE_INITIAL;
    /** pointerup ごとの遅延記録。後続ジェスチャの click と抑止状態を共有しない。 */
    protected readonly pendingPointerUpFallbacks = new Set<PendingPointerUpFallback>();
    /** task.md 指示2: select ツール中に直近クリックした登録済み UI 要素。session-start/end でリセットする。 */
    protected selectedUiTarget: ReviewSelectedUiTarget | undefined;

    constructor(
        protected readonly service: AkariPreviewService,
        protected readonly onState: (state: ReviewSessionUiState) => void
    ) {}

    async refresh(projectRootUri: string, editUri: string): Promise<void> {
        if (!projectRootUri || !editUri) {
            return;
        }
        this.requestedProjectRootUri = projectRootUri;
        this.requestedEditUri = editUri;
        try {
            this.sessions = await this.service.listReviewSessions({ projectRootUri });
            this.emitState();
        } catch (error) {
            console.warn('[akari-preview] failed to list review sessions', error);
            this.emitState(this.message(error));
        }
    }

    async start(request: StartReviewSessionRequest, initial: ReviewTransportSnapshot): Promise<void> {
        if (this.active || this.status === 'starting' || this.status === 'stopping') {
            return;
        }
        this.requestedProjectRootUri = request.projectRootUri;
        this.requestedEditUri = request.editUri;
        this.status = 'starting';
        this.emitState();

        let stream: MediaStream | undefined;
        let context: AudioContext | undefined;
        try {
            const askForMicrophoneAccess = typeof window !== 'undefined'
                ? window.electronAkariPreview?.askForMicrophoneAccess
                : undefined;
            if (askForMicrophoneAccess && !await askForMicrophoneAccess()) {
                throw new DOMException('Microphone access denied', 'NotAllowedError');
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('この環境ではマイク録音を利用できません。');
            }
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
            await context.resume();
            const source = context.createMediaStreamSource(stream);
            const processor = context.createScriptProcessor(4096, 1, 1);
            const silentGain = context.createGain();
            silentGain.gain.value = 0;
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(context.destination);

            const started = await this.service.startReviewSession(request);
            const monotonicStartedAt = performance.now();
            const active: ActiveReviewSession = {
                ...started,
                projectRootUri: request.projectRootUri,
                editUri: request.editUri,
                monotonicStartedAt,
                lastRecT: 0,
                transport: { ...initial },
                stream,
                context,
                source,
                processor,
                silentGain,
                pendingSamples: [],
                pendingSampleCount: 0,
                level: 0,
                lastNonSilentAt: monotonicStartedAt,
                writeTail: Promise.resolve(),
                nextStrokeNumber: 1
            };
            processor.onaudioprocess = event => this.captureAudio(active, event);
            this.active = active;
            this.installUiClickListener();
            this.installKeydownListener();
            // task.md 指示1: 記録セッション開始時は必ず neutral から始まる。
            this.toolModeState = reduceReviewToolMode(this.toolModeState, { type: 'session-start' });
            // task.md 指示2: 新しいセッションでは前回の選択を持ち越さない。
            this.selectedUiTarget = undefined;
            if (initial.rate !== 1) {
                this.enqueue(active, () => this.service.appendReviewSessionEvent({
                    sessionDir: active.sessionDir,
                    event: { recT: this.recT(active), type: 'rate', value: initial.rate }
                }));
            }
            this.status = 'recording';
            this.startTimers();
            this.emitState();
        } catch (error) {
            stream?.getTracks().forEach(track => track.stop());
            if (context) {
                await context.close().catch(() => undefined);
            }
            this.removeUiClickListener();
            this.status = 'error';
            this.emitState(this.message(error));
        }
    }

    reportError(projectRootUri: string, editUri: string, error: string): void {
        this.requestedProjectRootUri = projectRootUri;
        this.requestedEditUri = editUri;
        this.status = 'error';
        this.emitState(error);
    }

    async stop(): Promise<void> {
        const active = this.active;
        if (!active || this.status === 'stopping') {
            return;
        }
        this.status = 'stopping';
        active.pendingStroke = undefined;
        active.pendingRect = undefined;
        this.stopTimers();
        this.removeUiClickListener();
        this.removeKeydownListener();
        // task.md 指示1: セッション終了で必ず neutral へ戻す。
        this.toolModeState = reduceReviewToolMode(this.toolModeState, { type: 'session-end' });
        // task.md 指示2: セッションが終われば「選択中」の文脈も無効になる。
        this.selectedUiTarget = undefined;
        this.emitState();
        active.processor.onaudioprocess = null;
        this.flushAudio(active);
        active.source.disconnect();
        active.processor.disconnect();
        active.silentGain.disconnect();
        active.stream.getTracks().forEach(track => track.stop());
        await active.context.close().catch(() => undefined);

        try {
            await active.writeTail;
            if (active.writeError) {
                throw active.writeError;
            }
            const recT = this.recT(active);
            await this.service.endReviewSession({
                sessionDir: active.sessionDir,
                startedAt: active.startedAt,
                endedAt: new Date().toISOString(),
                editHash: active.editHash,
                recT,
                timelineT: active.transport.timelineT
            });
            this.active = undefined;
            this.status = 'idle';
            await this.refresh(active.projectRootUri, active.editUri);
        } catch (error) {
            this.active = undefined;
            this.status = 'error';
            await this.refresh(active.projectRootUri, active.editUri);
            this.emitState(`録音セッションを完了できませんでした: ${this.message(error)}`);
        }
    }

    handlePlaybackTick(editUri: string, time: number, playing: boolean): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || !Number.isFinite(time)) {
            return;
        }
        active.transport.timelineT = time;
        active.transport.playing = playing;
    }

    handleTransport(editUri: string, change: ReviewTransportChange): void {
        const active = this.active;
        if (!active || active.editUri !== editUri) {
            return;
        }
        let event: ReviewSessionTransportEvent;
        const recT = this.recT(active);
        if (change.type === 'play' || change.type === 'pause') {
            if (change.type === 'play') {
                active.pendingStroke = undefined;
                active.pendingRect = undefined;
            }
            active.transport.timelineT = change.timelineT;
            active.transport.playing = change.type === 'play';
            event = { recT, type: change.type, timelineT: change.timelineT };
        } else if (change.type === 'seek') {
            active.transport.timelineT = change.to;
            event = { recT, type: 'seek', from: change.from, to: change.to };
        } else {
            active.transport.timelineT = change.timelineT;
            active.transport.rate = change.value;
            event = { recT, type: 'rate', value: change.value };
        }
        this.enqueue(active, () => this.service.appendReviewSessionEvent({
            sessionDir: active.sessionDir,
            event
        }));
    }

    handleStrokeStart(editUri: string, frame: ReviewStrokeFrame): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || active.transport.playing || active.pendingStroke) {
            return;
        }
        active.pendingStroke = {
            id: `st-${String(active.nextStrokeNumber++).padStart(4, '0')}`,
            recTStart: this.recT(active),
            frame
        };
    }

    handleStrokeEnd(editUri: string, points: Array<[number, number]>): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || !active.pendingStroke) {
            return;
        }
        const pendingStroke = active.pendingStroke;
        active.pendingStroke = undefined;
        if (!Array.isArray(points) || points.length < 2) {
            return;
        }
        const stroke: ReviewStroke = {
            ...pendingStroke,
            tool: 'pen',
            space: 'content-rect',
            recTEnd: this.recT(active),
            points
        };
        this.enqueue(active, () => this.service.appendReviewSessionStroke({
            sessionDir: active.sessionDir,
            stroke
        }));
    }

    /**
     * task.md 指示4 (rect tool). Mirrors handleStrokeStart/handleStrokeEnd's pendingStroke
     * pattern (recTStart captured at drag start, not drag end) but is new code with no existing
     * caller to stay compatible with, so it additionally requires toolMode === 'rect' -- the
     * webview already gates pointer capture on the same condition (canDrawRect()), this is
     * defense in depth against a stale/racing message.
     */
    handleRectStart(editUri: string, frame: ReviewStrokeFrame): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || active.transport.playing || active.pendingRect
            || this.toolModeState.mode !== 'rect') {
            return;
        }
        active.pendingRect = {
            id: `st-${String(active.nextStrokeNumber++).padStart(4, '0')}`,
            recTStart: this.recT(active),
            frame
        };
    }

    handleRectEnd(editUri: string, box: [number, number, number, number]): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || !active.pendingRect) {
            return;
        }
        const pendingRect = active.pendingRect;
        active.pendingRect = undefined;
        if (!Array.isArray(box) || box.length !== 4 || box.some(value => !Number.isFinite(value))
            || box[2] <= 0 || box[3] <= 0) {
            // 退化した矩形（ドラッグなしのクリック等）は pen の points.length<2 破棄と同じ扱い。
            return;
        }
        const stroke: ReviewRectStroke = {
            ...pendingRect,
            tool: 'rect',
            space: 'content-rect',
            recTEnd: this.recT(active),
            box
        };
        this.enqueue(active, () => this.service.appendReviewSessionStroke({
            sessionDir: active.sessionDir,
            stroke
        }));
    }

    /**
     * task.md 指示1/6: the single mode-change entry point -- used by the right panel's tool
     * buttons, the preview's pen-toggle (re-wired onto this in M2), and this class's own keyboard
     * shortcut handler. A no-op (state unchanged, nothing emitted) outside a recording session or
     * when the requested mode is already current.
     */
    setToolMode(editUri: string, mode: ReviewToolMode): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || this.status !== 'recording') {
            return;
        }
        const next = reduceReviewToolMode(this.toolModeState, { type: 'set-mode', mode });
        if (next === this.toolModeState) {
            return;
        }
        this.toolModeState = next;
        const recT = this.recT(active);
        this.enqueue(active, () => this.service.appendReviewSessionEvent({
            sessionDir: active.sessionDir,
            event: { recT, type: 'tool.mode', mode: next.mode }
        }));
        this.emitState();
    }

    async dispose(): Promise<void> {
        if (this.active) {
            await this.stop();
        } else {
            this.stopTimers();
            this.removeUiClickListener();
            this.removeKeydownListener();
        }
    }

    /**
     * docs/contract-2026-08-11-review-session-ui-events.md #2/#3: one capture-phase click
     * listener, installed only while a session is recording (removed on stop/dispose so idle
     * sessions do no per-click work at all -- "常時監視をしない"). Resolves the nearest
     * data-akari-ui ancestor; unregistered clicks are silently ignored.
     */
    protected installUiClickListener(): void {
        if (this.uiClickListener || typeof document === 'undefined') {
            return;
        }
        const listener = (event: MouseEvent): void => this.handleUiClick(event);
        document.addEventListener('click', listener, true);
        this.uiClickListener = listener;
        // task.md 指示1: pointerup 併用。同じ capture-phase 一本の方針を踏襲し、click と
        // 対で install/remove する（呼び出し側の変更は不要）。
        const pointerUpListener = (event: PointerEvent): void => this.handleUiPointerUp(event);
        document.addEventListener('pointerup', pointerUpListener, true);
        this.uiPointerUpListener = pointerUpListener;
    }

    protected removeUiClickListener(): void {
        if (this.uiClickListener && typeof document !== 'undefined') {
            document.removeEventListener('click', this.uiClickListener, true);
        }
        this.uiClickListener = undefined;
        if (this.uiPointerUpListener && typeof document !== 'undefined') {
            document.removeEventListener('pointerup', this.uiPointerUpListener, true);
        }
        this.uiPointerUpListener = undefined;
    }

    /** click / pointerup 共通: 登録済み祖先の解決 + 語彙分類 + intent 付与まで組み立てる。 */
    protected buildUiEvent(active: ActiveReviewSession, target: Node | null): ResolvedUiTargetEvent | undefined {
        const resolved = resolveUiEventTarget(target);
        if (!resolved) {
            return undefined;
        }
        const { target: targetId, label } = resolved;
        const kind = classifyUiEventType(targetId);
        const recT = this.recT(active);
        // task.md 指示5: select ツール中のクリックにだけ intent: true を乗せる。通常のクリック
        // 動作（開く・アクティブ化）は preventDefault しない -- ここは記録するだけで一切ブロックしない。
        const intent = kind === 'ui.click' && this.toolModeState.mode === 'select';
        if (kind === 'ui.panel') {
            return { recT, type: 'ui.panel', target: targetId, label };
        }
        if (kind === 'ui.tab') {
            return { recT, type: 'ui.tab', target: targetId, label };
        }
        return intent
            ? { recT, type: 'ui.click', target: targetId, label, intent: true }
            : { recT, type: 'ui.click', target: targetId, label };
    }

    /**
     * task.md 指示2: select ツール中に解決された要素はすべて「いま選択中の UI 要素」として
     * 記憶する（panel:/tab: を含む -- ui: target の id 空間は docs/contract-2026-08-11
     * -review-session-ui-events.md §2 と同一なので、intent: true が付く ui.click 種別に限らない）。
     * 例外: 注釈パネル自身（panel:review）は除く。コメント入力欄へのフォーカスなど、
     * パネル内の操作は登録済み祖先の解決上すべて panel:review に丸まってしまうため、
     * 除外しないと「選択 → コメント欄をクリック → 選択が panel:review に上書きされる」
     * という実機検証で確認済みの巻き添え事故になる（L1 実測: report.md 参照）。
     */
    protected applyUiSelection(uiEvent: ResolvedUiTargetEvent): void {
        if (this.toolModeState.mode !== 'select' || uiEvent.target === REVIEW_PANEL_TARGET_ID) {
            return;
        }
        this.selectedUiTarget = { target: uiEvent.target, label: uiEvent.label };
        this.emitState();
    }

    /** task.md 指示2: 注釈パネルの「選択を解除」導線から呼ばれる。 */
    clearUiSelection(editUri: string): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || !this.selectedUiTarget) {
            return;
        }
        this.selectedUiTarget = undefined;
        this.emitState();
    }

    protected handleUiClick(event: MouseEvent): void {
        const active = this.active;
        if (!active || this.status !== 'recording') {
            return;
        }
        const uiEvent = this.buildUiEvent(active, event.target as Node | null);
        if (!uiEvent) {
            return;
        }
        this.applyUiSelection(uiEvent);
        // 同じ target の最新 pointerup だけを、この click と対になるフォールバックとして抑止する。
        let matchingFallback: PendingPointerUpFallback | undefined;
        for (const pending of this.pendingPointerUpFallbacks) {
            if (pending.active === active && pending.target === uiEvent.target) {
                matchingFallback = pending;
            }
        }
        if (matchingFallback) {
            matchingFallback.suppressed = true;
        }
        this.enqueue(active, () => this.service.appendReviewSessionEvent({
            sessionDir: active.sessionDir,
            event: uiEvent
        }));
    }

    /**
     * task.md 指示1: pointerdown で preventDefault() された要素（cuts/overlays の
     * installDragListeners 参照）では 'click' が合成されないため、pointerup 側でも同じ登録済み
     * 祖先解決を通して記録する。preventDefault されなかった通常要素では pointerup 直後に 'click' が
     * 同期的に合成される（Pointer Events 仕様）ため、1 マクロタスク（setTimeout 0）待ってから
     * この pointerup 専用の抑止状態を見て二重記録を避ける。
     */
    protected handleUiPointerUp(event: PointerEvent): void {
        const active = this.active;
        if (!active || this.status !== 'recording' || event.button !== 0) {
            return;
        }
        const uiEvent = this.buildUiEvent(active, event.target as Node | null);
        if (!uiEvent) {
            return;
        }
        this.applyUiSelection(uiEvent);
        const pending: PendingPointerUpFallback = {
            active,
            target: uiEvent.target,
            suppressed: false
        };
        this.pendingPointerUpFallbacks.add(pending);
        setTimeout(() => {
            this.pendingPointerUpFallbacks.delete(pending);
            if (pending.suppressed || this.active !== active || this.status !== 'recording') {
                return;
            }
            this.enqueue(active, () => this.service.appendReviewSessionEvent({
                sessionDir: active.sessionDir,
                event: uiEvent
            }));
        }, 0);
    }

    /**
     * task.md 指示6: 1=select / 2=pen / 3=rect / Esc=neutral, active recording session only,
     * inert while typing (isEditableEventTarget checks both the event target and
     * document.activeElement -- matches akari-annotations-widget.ts's own isEditableTarget
     * double-check pattern). Installed/removed alongside the UI click listener. Deliberately does
     * not call stopPropagation -- see report.md's keybinding conflict investigation: no existing
     * bare 1/2/3/Escape bindings were found, and co-existing with unrelated Escape handlers
     * (timeline drag-cancel, Theia quick-open close) only requires not blocking their delivery.
     */
    protected installKeydownListener(): void {
        if (this.keydownListener || typeof document === 'undefined') {
            return;
        }
        const listener = (event: KeyboardEvent): void => this.handleKeydown(event);
        document.addEventListener('keydown', listener, true);
        this.keydownListener = listener;
    }

    protected removeKeydownListener(): void {
        if (this.keydownListener && typeof document !== 'undefined') {
            document.removeEventListener('keydown', this.keydownListener, true);
        }
        this.keydownListener = undefined;
    }

    protected handleKeydown(event: KeyboardEvent): void {
        const active = this.active;
        if (!active || this.status !== 'recording' || event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        // IME 変換中の 1 / 2 / 3 / Escape でツールモードを切り替えない（issue #51）。
        if (isImeCompositionKeydown(event)) {
            return;
        }
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
        if (isEditableEventTarget(event.target as EditableTargetLike | null)
            || isEditableEventTarget(activeElement as EditableTargetLike | null)) {
            return;
        }
        const mode = event.key === 'Escape' ? 'neutral' : reviewToolModeForShortcutKey(event.key);
        if (!mode) {
            return;
        }
        event.preventDefault();
        this.setToolMode(active.editUri, mode);
    }

    protected captureAudio(active: ActiveReviewSession, event: AudioProcessingEvent): void {
        if (this.active !== active || this.status !== 'recording') {
            return;
        }
        const input = event.inputBuffer;
        const samples = new Float32Array(input.length);
        const channels = Math.max(1, input.numberOfChannels);
        for (let channel = 0; channel < channels; channel += 1) {
            const data = input.getChannelData(channel);
            for (let index = 0; index < samples.length; index += 1) {
                samples[index] += data[index] / channels;
            }
        }
        let squaredTotal = 0;
        for (const sample of samples) {
            squaredTotal += sample * sample;
        }
        active.level = samples.length > 0
            ? Math.min(1, Math.sqrt(squaredTotal / samples.length))
            : 0;
        if (active.level > 0) {
            active.lastNonSilentAt = performance.now();
        }
        active.pendingSamples.push(samples);
        active.pendingSampleCount += samples.length;
        if (active.pendingSampleCount >= active.context.sampleRate * (AUDIO_FLUSH_INTERVAL_MS / 1000)) {
            this.flushAudio(active);
        }
    }

    protected flushAudio(active: ActiveReviewSession): void {
        if (active.pendingSampleCount === 0) {
            return;
        }
        const samples = new Float32Array(active.pendingSampleCount);
        let offset = 0;
        for (const chunk of active.pendingSamples) {
            samples.set(chunk, offset);
            offset += chunk.length;
        }
        active.pendingSamples = [];
        active.pendingSampleCount = 0;
        const pcm = this.toPcm16(samples, active.context.sampleRate);
        const pcmBase64 = this.base64(pcm);
        this.enqueue(active, () => this.service.appendReviewSessionAudio({
            sessionDir: active.sessionDir,
            pcmBase64
        }));
    }

    protected toPcm16(samples: Float32Array, inputRate: number): Uint8Array {
        const outputLength = Math.max(1, Math.round(samples.length * TARGET_SAMPLE_RATE / inputRate));
        const output = new Uint8Array(outputLength * 2);
        const view = new DataView(output.buffer);
        const ratio = inputRate / TARGET_SAMPLE_RATE;
        for (let index = 0; index < outputLength; index += 1) {
            const start = Math.min(samples.length - 1, Math.floor(index * ratio));
            const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
            let total = 0;
            for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
                total += samples[sourceIndex];
            }
            const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
            view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return output;
    }

    protected base64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        }
        return btoa(binary);
    }

    protected enqueue(active: ActiveReviewSession, operation: () => Promise<void>): void {
        active.writeTail = active.writeTail.then(async () => {
            if (active.writeError) {
                return;
            }
            try {
                await operation();
            } catch (error) {
                active.writeError = error instanceof Error ? error : new Error(String(error));
                this.status = 'error';
                this.emitState(`録音データを書き込めません: ${active.writeError.message}`);
            }
        });
    }

    protected startTimers(): void {
        this.stopTimers();
        this.uiTimer = window.setInterval(() => this.emitState(), UI_UPDATE_INTERVAL_MS);
        this.tickTimer = window.setInterval(() => {
            const active = this.active;
            if (!active || this.status !== 'recording' || !active.transport.playing) {
                return;
            }
            this.enqueue(active, () => this.service.appendReviewSessionEvent({
                sessionDir: active.sessionDir,
                event: {
                    recT: this.recT(active),
                    type: 'tick',
                    timelineT: active.transport.timelineT
                }
            }));
        }, TICK_INTERVAL_MS);
    }

    protected stopTimers(): void {
        if (this.uiTimer !== undefined) {
            window.clearInterval(this.uiTimer);
            this.uiTimer = undefined;
        }
        if (this.tickTimer !== undefined) {
            window.clearInterval(this.tickTimer);
            this.tickTimer = undefined;
        }
    }

    protected recT(active: ActiveReviewSession): number {
        const elapsed = Math.max(0, (performance.now() - active.monotonicStartedAt) / 1000);
        active.lastRecT = Math.max(active.lastRecT, elapsed);
        return active.lastRecT;
    }

    protected emitState(error?: string): void {
        const active = this.active;
        const level = active?.level ?? 0;
        this.onState({
            editUri: active?.editUri ?? this.requestedEditUri,
            projectRootUri: active?.projectRootUri ?? this.requestedProjectRootUri,
            status: this.status,
            active: Boolean(active),
            elapsedSec: active ? this.recT(active) : 0,
            level,
            silenceWarning: Boolean(
                active
                && level === 0
                && performance.now() - active.lastNonSilentAt >= SILENCE_WARNING_AFTER_MS
            ),
            toolMode: this.toolModeState.mode,
            sessions: [...this.sessions],
            ...(this.selectedUiTarget ? { selectedUiTarget: this.selectedUiTarget } : {}),
            ...(error ? { error } : {})
        });
    }

    protected message(error: unknown): string {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
            return 'マイクの使用が許可されませんでした。設定で権限を確認してください。';
        }
        return error instanceof Error ? error.message : String(error);
    }
}
