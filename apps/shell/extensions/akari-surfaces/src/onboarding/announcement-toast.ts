/** App-level notices for guide discovery and dismissal. */
export class GuideAnnouncementToast {
    protected node?: HTMLElement;
    protected timer?: number;

    show(onOpen: () => void): void {
        this.mount('<button class="close" type="button" aria-label="閉じる">×</button><b>新しく「はじめてのガイド」ができました</b><p>設定からいつでも見られます</p><button class="open" type="button">今すぐ見る</button>', 20_000, onOpen);
    }

    showClosed(): void {
        this.mount('<button class="close" type="button" aria-label="閉じる">×</button><b>ガイドを閉じました</b><p>設定からいつでも見られます</p>', 7_000);
    }

    protected mount(content: string, durationMs: number, onOpen?: () => void): void {
        this.close();
        if (!document.getElementById('akari-guide-announcement-style')) {
            const style = document.createElement('style');
            style.id = 'akari-guide-announcement-style';
            style.textContent = `
.akari-guide-announcement{position:fixed;right:20px;bottom:20px;z-index:10025;width:min(340px,calc(100vw - 40px));box-sizing:border-box;padding:15px;border:1px solid var(--theia-widget-border,#555);border-left:3px solid #f97316;border-radius:11px;background:var(--theia-sideBar-background,#181818);color:var(--theia-foreground,#f5f5f5);box-shadow:0 12px 35px rgba(0,0,0,.4);font:13px/1.55 var(--theia-ui-font-family,system-ui);animation:akari-guide-notice-in .35s ease-out}
.akari-guide-announcement b{display:block;font-size:14px;margin:0 26px 3px 0}.akari-guide-announcement p{margin:0 0 12px;color:var(--theia-descriptionForeground,#bbb)}.akari-guide-announcement button{cursor:pointer}.akari-guide-announcement .close{position:absolute;right:10px;top:8px;border:0;background:transparent;color:inherit;font-size:19px}.akari-guide-announcement .open{border:0;border-radius:6px;background:#f97316;color:#1f1007;font-weight:700;padding:7px 13px}.akari-guide-announcement button:focus-visible{outline:2px solid #fb923c;outline-offset:3px}
@keyframes akari-guide-notice-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.akari-guide-announcement{animation:none}}
`;
            document.head.appendChild(style);
        }
        const node = document.createElement('aside');
        node.className = 'akari-guide-announcement';
        node.setAttribute('role', 'status');
        node.innerHTML = content;
        node.querySelector('.close')?.addEventListener('click', () => this.close());
        node.querySelector('.open')?.addEventListener('click', () => { this.close(); onOpen?.(); });
        document.body.appendChild(node);
        this.node = node;
        this.timer = window.setTimeout(() => this.close(), durationMs);
    }

    close(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
        this.node?.remove();
        this.node = undefined;
    }
}
