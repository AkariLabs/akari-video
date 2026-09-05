import { BaseWidget, Message } from '@theia/core/lib/browser';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { AudioMeterFrame, holdPeak, isAudioMeterFrame, latchClip, linearToDbfs, meterFraction } from '../common/audio-meter-model';

@injectable()
export class AkariAudioMeterWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-audio-meter-widget';
    protected readonly canvas = document.createElement('canvas');
    protected readonly notice = document.createElement('div');
    protected readonly clipButton = document.createElement('button');
    protected frame?: AudioMeterFrame;
    protected source = '';
    protected receivedAt = -Infinity;
    protected peaks: ReturnType<typeof holdPeak>[] = [];
    protected levels: ReturnType<typeof holdPeak>[] = [];
    protected clipped = false;
    protected animation = 0;

    @postConstruct()
    protected init(): void {
        this.id = AkariAudioMeterWidget.FACTORY_ID;
        this.title.label = '音声メーター';
        this.title.caption = '出力プレビューのマスター音量（L / R のピークと RMS・クリップ）';
        this.title.iconClass = 'codicon codicon-pulse';
        this.title.closable = true;
        this.node.classList.add('akari-audio-meter-widget');
        this.node.tabIndex = -1;
        const style = document.createElement('style');
        style.textContent = `
            .akari-audio-meter-widget { display: flex; flex-direction: column; padding: 14px;
                box-sizing: border-box; overflow: auto; min-width: 160px;
                color: var(--theia-foreground); background: var(--theia-editor-background); }
            .akari-audio-meter-widget canvas { display: block; width: 100%; flex: 1 1 auto;
                min-height: 180px; height: 0; }
            .akari-audio-meter-widget .audio-meter-notice { color: var(--theia-descriptionForeground);
                font-size: 11px; line-height: 1.6; padding-top: 8px; }
            .akari-audio-meter-widget .audio-meter-notice:empty { display: none; }
            .akari-audio-meter-widget button { align-self: center; font: inherit; font-size: 11px;
                margin: 0 0 8px; padding: 3px 12px; cursor: pointer; border-radius: 3px;
                border: 1px solid var(--theia-widget-border); color: var(--theia-descriptionForeground);
                background: var(--theia-editor-background); }
            .akari-audio-meter-widget button::before { content: ''; display: inline-block;
                width: 7px; height: 7px; margin-right: 6px; border-radius: 50%;
                background: var(--theia-widget-border); }
            .akari-audio-meter-widget button[aria-pressed="true"] { color: var(--theia-errorForeground); }
            .akari-audio-meter-widget button[aria-pressed="true"]::before { background: var(--theia-errorForeground); }
            .akari-audio-meter-widget button:focus-visible { outline: 1px solid var(--theia-focusBorder); }
        `;
        this.clipButton.type = 'button';
        this.clipButton.textContent = 'CLIP';
        this.clipButton.title = 'クリックでクリップ表示を解除';
        this.clipButton.setAttribute('aria-label', 'クリップ表示を解除');
        this.clipButton.setAttribute('aria-pressed', 'false');
        this.clipButton.onclick = () => {
            this.clipped = false;
            this.clipButton.setAttribute('aria-pressed', 'false');
        };
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', 'マスター音量 L / R（dBFS）');
        this.notice.className = 'audio-meter-notice';
        this.notice.textContent = 'プレビューを再生すると表示します';
        this.node.append(style, this.clipButton, this.canvas, this.notice);
        const onFrame = (event: Event): void => {
            const detail = (event as CustomEvent).detail;
            if (!isAudioMeterFrame(detail)) return;
            const source = JSON.stringify([(detail as any).videoUri, (detail as any).kind]);
            if (source !== this.source) {
                this.peaks = [];
                this.levels = [];
                this.clipped = false;
                this.source = source;
            }
            this.frame = detail;
            this.receivedAt = performance.now();
            for (let channel = 0; channel < 2; channel++) {
                this.peaks[channel] = detail.playing
                    ? holdPeak(this.peaks[channel] ?? null, detail.peak[channel], this.receivedAt)
                    : { value: 0, heldAt: this.receivedAt };
                this.levels[channel] = { value: detail.playing ? detail.rms[channel] : 0, heldAt: this.receivedAt };
                this.clipped = latchClip(this.clipped || detail.clip, linearToDbfs(detail.peak[channel]));
            }
            this.clipButton.setAttribute('aria-pressed', String(this.clipped));
            this.notice.textContent = detail.engine === 'legacy'
                ? 'legacy プレビューでは土台の音声は含まれません' : '';
        };
        window.addEventListener('akari.preview.audioMeter', onFrame);
        const observer = new ResizeObserver(() => this.draw());
        observer.observe(this.canvas);
        const animate = (): void => {
            if (this.isDisposed) return;
            if (this.isVisible) this.draw();
            this.animation = requestAnimationFrame(animate);
        };
        this.animation = requestAnimationFrame(animate);
        this.toDispose.push({ dispose: () => {
            cancelAnimationFrame(this.animation);
            observer.disconnect();
            window.removeEventListener('akari.preview.audioMeter', onFrame);
            this.clipButton.onclick = null;
        } });
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected draw(): void {
        const { width, height } = this.canvas.getBoundingClientRect();
        if (width < 1 || height < 1) return;
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.round(width * ratio);
        const pixelHeight = Math.round(height * ratio);
        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }
        const ctx = this.canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const styles = getComputedStyle(this.node);
        const token = (name: string): string => styles.getPropertyValue(name).trim();
        const blue = token('--theia-focusBorder') || '#4da3ff';
        const muted = token('--theia-descriptionForeground');
        const border = token('--theia-widget-border') || muted;
        const warning = token('--theia-editorWarning-foreground') || blue;
        const error = token('--theia-errorForeground') || warning;
        const top = 25;
        const bottom = height - 30;
        const plotHeight = Math.max(1, bottom - top);
        const y = (db: number): number => bottom - meterFraction(db) * plotHeight;
        const left = Math.max(40, (width - 140) / 2);
        const barWidth = Math.max(12, Math.min(34, (width - left - 24) / 3));
        const positions = [left + 8, left + 24 + barWidth];
        ctx.font = '10px ' + (styles.fontFamily || 'sans-serif');
        ctx.textBaseline = 'middle';
        for (const db of [-60, -48, -36, -24, -18, -12, -6, -3, 0]) {
            ctx.fillStyle = muted;
            ctx.textAlign = 'right';
            ctx.fillText(String(db), left - 5, y(db));
            ctx.fillStyle = border;
            ctx.fillRect(left, y(db), positions[1] + barWidth - left + 4, 1);
        }
        ctx.fillStyle = muted;
        ctx.textAlign = 'right';
        ctx.fillText('dBFS', left - 5, 9);
        const now = performance.now();
        for (let channel = 0; channel < 2; channel++) {
            this.peaks[channel] = holdPeak(this.peaks[channel] ?? null, 0, now);
            if (now - this.receivedAt > 500) {
                this.levels[channel] = holdPeak(this.levels[channel] ?? null, 0, now, 500);
            }
            const peakDb = linearToDbfs(this.peaks[channel].value);
            const rmsDb = linearToDbfs(this.levels[channel]?.value ?? 0);
            const x = positions[channel];
            ctx.fillStyle = border;
            ctx.fillRect(x, top, barWidth, plotHeight);
            for (const [low, high, color] of [[-60, -12, blue], [-12, -3, warning], [-3, 0, error]] as const) {
                const capped = Math.min(high, rmsDb);
                if (capped <= low) continue;
                ctx.fillStyle = color;
                ctx.fillRect(x, y(capped), barWidth, y(low) - y(capped));
            }
            ctx.fillStyle = peakDb >= -3 ? error : peakDb >= -12 ? warning : blue;
            ctx.fillRect(x - 2, y(peakDb) - 1, barWidth + 4, 2);
            ctx.textAlign = 'center';
            ctx.fillStyle = muted;
            ctx.fillText(channel === 0 ? 'L' : 'R', x + barWidth / 2, 9);
            ctx.fillText(Math.max(-60, peakDb).toFixed(1), x + barWidth / 2, bottom + 17);
        }
    }
}
