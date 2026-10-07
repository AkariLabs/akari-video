import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { Disposable, MessageService } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { AkariProjectService } from '../../common/akari-project-protocol';
import { formatRecordingClock, levelToBars } from '../../common/voice-recording';
import { VoiceRecorder, VoiceRecorderState } from './voice-recorder';
import { ensureVoiceRecordDialogStyle } from './voice-record-dialog-style';

interface DialogPosition { left: number; top: number }

const POSITION_KEY = 'akari.voice.record.position';
let rememberedPosition: DialogPosition | undefined;

function readPosition(): DialogPosition | undefined {
    if (rememberedPosition) return rememberedPosition;
    try {
        const stored = window.localStorage.getItem(POSITION_KEY);
        if (!stored) return undefined;
        const parsed = JSON.parse(stored) as Partial<DialogPosition>;
        if (Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
            rememberedPosition = { left: parsed.left!, top: parsed.top! };
        }
    } catch { /* Storage may be unavailable in a private or restricted window. */ }
    return rememberedPosition;
}

function rememberPosition(position: DialogPosition): void {
    rememberedPosition = position;
    try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(position)); }
    catch { /* Keep the position for this session. */ }
}

export class AkariVoiceRecordDialog extends ReactDialog<void> {
    protected readonly recorder: VoiceRecorder;
    protected state: VoiceRecorderState;
    protected closing = false;
    protected position?: DialogPosition;
    protected dragCleanup?: () => void;
    protected positionFrame?: number;
    protected readonly handleResize = (): void => { this.placeWithinViewport(false); };

    constructor(protected readonly service: AkariProjectService, protected readonly messages: MessageService,
        protected readonly projectUri: string) {
        super({ title: 'アフレコ' });
        this.addClass('akari-voice-record-dialog-host');
        ensureVoiceRecordDialogStyle();
        this.recorder = new VoiceRecorder(service, state => {
            const previous = this.state?.lastSaved?.assetPath;
            this.state = state;
            if (state.lastSaved && state.lastSaved.assetPath !== previous) {
                this.messages.info(`アフレコを素材に保存しました: ${state.lastSaved.assetPath.split('/').pop()}`);
            }
            this.update();
        });
        this.state = this.recorder.state;
    }

    get value(): void { return undefined; }

    protected override preventTabbingOutsideDialog(): Disposable { return Disposable.NULL; }

    protected override handleEnter(): boolean { return false; }

    protected dialogBlock(): HTMLElement | null { return this.node.querySelector<HTMLElement>('.dialogBlock'); }

    protected placeWithinViewport(useDefaultWhenStoredPositionDoesNotFit: boolean): void {
        const block = this.dialogBlock();
        if (!block) return;
        const rect = block.getBoundingClientRect();
        const width = rect.width || 360;
        const height = rect.height || block.scrollHeight;
        const maxLeft = Math.max(0, window.innerWidth - width);
        const maxTop = Math.max(0, window.innerHeight - height);
        const defaultPosition = { left: window.innerWidth - 360 - 24, top: 72 };
        const position = this.position && (!useDefaultWhenStoredPositionDoesNotFit ||
            (this.position.left >= 0 && this.position.left <= maxLeft && this.position.top >= 0 && this.position.top <= maxTop))
            ? this.position : defaultPosition;
        this.position = {
            left: Math.min(maxLeft, Math.max(0, position.left)),
            top: Math.min(maxTop, Math.max(0, position.top))
        };
        block.style.left = `${this.position.left}px`;
        block.style.top = `${this.position.top}px`;
    }

    protected startDrag(event: React.PointerEvent<HTMLDivElement>): void {
        if (event.button !== 0 || (event.target as HTMLElement).closest?.('button')) return;
        const block = this.dialogBlock();
        if (!block) return;
        event.preventDefault();
        this.dragCleanup?.();
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const start = this.position ?? { left: block.getBoundingClientRect().left, top: block.getBoundingClientRect().top };
        const move = (next: PointerEvent): void => {
            if (next.pointerId !== pointerId) return;
            this.position = { left: start.left + next.clientX - startX, top: start.top + next.clientY - startY };
            this.placeWithinViewport(false);
        };
        const end = (next: PointerEvent): void => {
            if (next.pointerId !== pointerId) return;
            this.dragCleanup?.();
            this.dragCleanup = undefined;
            if (this.position) rememberPosition(this.position);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        this.dragCleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.position = readPosition();
        this.placeWithinViewport(true);
        this.positionFrame = window.requestAnimationFrame(() => this.placeWithinViewport(true));
        window.addEventListener('resize', this.handleResize);
        void this.recorder.openMonitor();
    }

    protected override onAfterDetach(msg: Message): void {
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        window.removeEventListener('resize', this.handleResize);
        if (this.positionFrame !== undefined) window.cancelAnimationFrame(this.positionFrame);
        super.onAfterDetach(msg);
        void this.recorder.dispose();
    }

    override close(): void {
        if (this.closing) return;
        this.closing = true;
        void this.recorder.dispose().finally(() => super.close());
    }

    protected render(): React.ReactNode {
        const state = this.state;
        const recording = state.phase === 'recording';
        const error = state.error;
        const status = error || (state.phase === 'saving' ? '保存しています…'
            : recording ? '録音中'
                : state.lastSaved && state.phase === 'monitoring'
                    ? `保存しました: ${state.lastSaved.assetPath.split('/').pop()}（${Math.round(state.lastSaved.durationSec)} 秒）`
                    : '録音は始まっていません');
        const lit = levelToBars(state.level, 40);
        return <div className='voice-popup' role='dialog' aria-modal='false' aria-labelledby='akari-voice-title'>
            <div className='voice-header' onPointerDown={event => this.startDrag(event)}><span id='akari-voice-title'>アフレコ</span>
                <button type='button' className='voice-close-x' aria-label='閉じる'
                    data-akari-ui='voice-record:close' data-akari-ui-label='閉じる' onClick={() => this.close()}>×</button></div>
            <div className='voice-body'>
                <div className='voice-card'>
                    <button type='button' className={`voice-record${recording ? ' is-recording' : ''}`}
                        aria-label={recording ? '録音停止' : '録音開始'}
                        data-akari-ui='voice-record:record' data-akari-ui-label={recording ? '録音停止' : '録音開始'}
                        disabled={state.phase !== 'monitoring' && !recording}
                        onClick={() => void (recording ? this.recorder.stop() : this.recorder.start(this.projectUri))}>
                        {recording && <span className='stop-square' />}
                    </button>
                    <div><div className='voice-clock'>{formatRecordingClock(state.elapsedSec)}</div>
                        <div className={`voice-status${error ? ' error' : ''}`}>{status}</div></div>
                </div>
                <div className='voice-meter' aria-label='入力レベル'>
                    {Array.from({ length: 40 }, (_, index) => <span key={index} className={index < lit ? 'active' : ''} />)}
                </div>
                <div className='voice-field'><label htmlFor='akari-voice-device'>入力デバイス</label>
                    <select id='akari-voice-device' value={state.deviceId || ''} disabled={recording || state.phase === 'saving'}
                        data-akari-ui='voice-record:device' data-akari-ui-label='入力デバイス'
                        onChange={event => void this.recorder.setDevice(event.currentTarget.value)}>
                        {!state.deviceId && <option value=''>既定のマイク</option>}
                        {state.devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                    </select>
                    <div className='voice-hint'>{state.phase === 'error' ? 'マイクを使えません' : 'マイクが接続されました'}</div>
                </div>
                <div className='voice-field'><label htmlFor='akari-voice-gain'>音量</label>
                    <div className='voice-gain'>
                        <input id='akari-voice-gain' type='range' min='0' max='200' value={state.gainPercent}
                            data-akari-ui='voice-record:gain' data-akari-ui-label='音量'
                            onChange={event => this.recorder.setGain(Number(event.currentTarget.value))} />
                        <input className='voice-gain-number' type='number' min='0' max='200' value={state.gainPercent}
                            data-akari-ui='voice-record:gain-number' data-akari-ui-label='音量'
                            onChange={event => this.recorder.setGain(Number(event.currentTarget.value))} />
                    </div>
                </div>
            </div>
            <div className='voice-options'>
                <label className='voice-option'><input type='checkbox' disabled /><span>録音中はプロジェクトの音を消す
                    <small>録音の間だけプレビューの音を止めます</small></span><span className='voice-soon'>近日</span></label>
                <label className='voice-option'><input type='checkbox' disabled /><span>ノイズを取り除く
                    <small>録った音からエコーやクリック音を自動で除きます</small></span><span className='voice-soon'>近日</span></label>
            </div>
            <div className='voice-footer'><button type='button' data-akari-ui='voice-record:close'
                data-akari-ui-label='閉じる' onClick={() => this.close()}>閉じる</button></div>
        </div>;
    }
}
