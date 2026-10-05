import type { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';

export const TIMELINE_MESSAGE_ID = 'akari-timeline-message';

export function isTimelineWarning(text: string): boolean {
    return /できません|できない|失敗|問題|課題|注意|警告|⚠|拒否|ロック中|見つかりません|置けません|残しました|重なるので/.test(text);
}

export class TimelineStatusMessage {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private sequence = 0;
    private readonly chip: HTMLDivElement | undefined;
    private current: { text: string; warning: boolean; onclick?: (event: MouseEvent) => void } | undefined;

    constructor(private readonly bar: Pick<StatusBar, 'setElement' | 'removeElement'>,
        private readonly panel?: { host: HTMLElement; isMaximized(): boolean }) {
        if (panel) {
            this.chip = panel.host.ownerDocument.createElement('div');
            this.chip.className = 'akari-timeline-message-chip';
            this.chip.dataset.testid = 'akari-timeline-message-chip';
            this.chip.hidden = true;
            panel.host.appendChild(this.chip);
        }
    }

    show(text: string, warning = isTimelineWarning(text), onclick?: (event: MouseEvent) => void): void {
        this.sequence++;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.current = text ? { text, warning, onclick } : undefined;
        this.refreshRoute();
        if (!text) return;
        const sequence = this.sequence;
        this.timer = setTimeout(() => {
            if (sequence === this.sequence) {
                this.current = undefined;
                this.refreshRoute();
            }
            this.timer = undefined;
        }, warning ? 8000 : 4000);
    }

    refreshRoute(): void {
        const inPanel = this.panel?.isMaximized() ?? false;
        if (this.chip) {
            this.chip.hidden = !inPanel || !this.current;
            this.chip.textContent = this.chip.hidden ? '' : this.current!.text;
            this.chip.classList.toggle('akari-timeline-message-warning', !!this.current?.warning);
            this.chip.onclick = inPanel && this.current?.onclick ? this.current.onclick : null;
            this.chip.style.pointerEvents = this.chip.onclick ? 'auto' : 'none';
        }
        if (inPanel || !this.current) {
            void this.bar.removeElement(TIMELINE_MESSAGE_ID);
        } else {
            const { text, warning, onclick } = this.current;
            void this.bar.setElement(TIMELINE_MESSAGE_ID, {
                text, alignment: 1 as StatusBarAlignment, priority: -1000,
                name: 'タイムライン',
                ...(warning ? { className: 'akari-timeline-message-warning',
                    color: 'var(--theia-editorWarning-foreground)' } : {}),
                ...(onclick ? { onclick } : {})
            });
        }
    }

    dispose(): void {
        this.sequence++;
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.current = undefined;
        this.chip?.remove();
        void this.bar.removeElement(TIMELINE_MESSAGE_ID);
    }
}

/** The detached footer is a single message sink, including legacy child-node writes. */
export function installTimelineFooterSink(footer: HTMLElement, status: TimelineStatusMessage): () => void {
    const nativeText = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    let disposed = false;
    const publish = (): void => {
        if (disposed) return;
        const action = footer.querySelector('button');
        status.show(footer.textContent ?? '', undefined, action
            ? () => action.click() : undefined);
    };
    const observer = new MutationObserver(publish);
    observer.observe(footer, { childList: true, subtree: true, characterData: true });
    if (nativeText?.get && nativeText.set) {
        Object.defineProperty(footer, 'textContent', {
            configurable: true,
            get: () => nativeText.get!.call(footer) as string | null,
            set: (text: string | null) => {
                nativeText.set!.call(footer, text);
                publish();
            }
        });
    }
    return () => {
        disposed = true;
        observer.disconnect();
        delete (footer as HTMLElement & { textContent: string | null }).textContent;
    };
}
