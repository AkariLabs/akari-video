import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandService, Disposable, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { VibeDockContext, VibeDockIconName, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockTabs } from './vibe-dock-tabs';

interface HandoffItem {
    uri: string;
    path: string;
    name: string;
    origin: 'output' | 'material' | 'scratch';
    badge: string;
    fresh: boolean;
    ref?: string; badges?: readonly string[]; thumb?: string; quality?: string; status?: 'ready' | 'url_only';
}

const HANDOFF_MIME = 'application/x-akari-handoff';
const THEIA_URI_MIME = 'application/vnd.code.uri-list';

@injectable()
export class HandoffVibeDockTab implements VibeDockTabContribution, FrontendApplicationContribution {
    readonly id = 'handoff';
    readonly label = '渡す';
    readonly icon = 'handoff' as VibeDockIconName;
    readonly order = 30;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(VibeDockTabs) protected readonly tabs!: VibeDockTabs;
    protected items: HandoffItem[] = [];
    protected readonly changed = new Emitter<void>();
    readonly onChanged: Event<void> = this.changed.event;

    onStart(): void {
        try { if (window.localStorage.getItem('akari.vibePreview.enabled') !== '1') return; }
        catch { return; }
        window.addEventListener('akari.handoff.changed', () => { void this.load(); });
        // Internal drops must never enter the global URI-list video importer. A terminal
        // receives the plain path; other AKARI drop targets reject this drag.
        window.addEventListener('dragover', event => {
            if (!event.dataTransfer?.types.includes(HANDOFF_MIME)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            event.dataTransfer.dropEffect = event.target instanceof Element && event.target.closest('.xterm') ? 'copy' : 'none';
        }, true);
        window.addEventListener('drop', event => {
            const transfer = event.dataTransfer;
            if (!transfer?.types.includes(HANDOFF_MIME)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.target instanceof Element && event.target.closest('.xterm')) {
                const plain = new DataTransfer();
                plain.setData('text/plain', transfer.getData('text/plain'));
                event.target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: plain }));
            }
        }, true);
        void this.load();
    }

    badge(): { count: number } { return { count: this.items.filter(item => item.fresh).length }; }

    async load(): Promise<void> {
        try {
            const items = await this.commands.executeCommand<HandoffItem[]>('akari.handoff.list');
            if (!Array.isArray(items)) return;
            this.items = items;
            this.tabs.refreshBadges();
            this.changed.fire();
        } catch { /* 接続前は空欄を保つ。 */ }
    }

    render(host: HTMLElement, ctx: VibeDockContext): Disposable {
        let disposed = false;
        const previousStyle = { boxSizing: host.style.boxSizing, display: host.style.display,
            flexDirection: host.style.flexDirection, height: host.style.height, minHeight: host.style.minHeight };
        Object.assign(host.style, { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
        const paint = (): void => {
            if (disposed) return;
            host.replaceChildren();
            const style = document.createElement('style');
            style.textContent = `
.akari-vibe-handoff-list { flex:1; min-height:0; overflow:auto; }
.akari-vibe-handoff-row { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:8px; width:100%; min-height:28px; padding:5px 9px; margin-bottom:5px; border-radius:8px; background:var(--akari-card); color:var(--akari-ink); cursor:grab; }
.akari-vibe-handoff-row:hover { background:var(--akari-elevated); }
.akari-vibe-handoff-row:focus-visible { outline:2px solid var(--akari-accent-light); }
.akari-vibe-handoff-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-vibe-handoff-badge { flex:none; color:var(--akari-faint); font-size:10px; }
.akari-vibe-handoff-row.akari-vibe-handoff-external { min-height:46px; max-height:46px; }
.akari-vibe-handoff-row.akari-vibe-handoff-external-unavailable { color:var(--akari-muted); }
.akari-vibe-handoff-thumb { flex:none; width:28px; height:28px; border-radius:5px; object-fit:cover; }
.akari-vibe-handoff-external-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.akari-vibe-handoff-license { color:var(--akari-faint); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-vibe-handoff-external-badge { flex:none; border:1px dashed var(--akari-muted); border-radius:4px;
 padding:1px 4px; color:var(--akari-muted); font-size:10px; }
.akari-vibe-handoff-hint { flex:none; margin-top:auto; padding:5px 2px; color:var(--akari-faint); font-size:10px; line-height:1.4; }
`;
            host.append(style);
            const list = document.createElement('div');
            list.className = 'akari-vibe-handoff-list';
            if (!this.items.length) {
                const empty = document.createElement('div');
                empty.className = 'akari-vibe-empty';
                empty.textContent = '渡せるファイルはありません';
                list.append(empty);
            }
            for (const item of this.items) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = `akari-vibe-handoff-row${item.origin === 'scratch' ? ' akari-vibe-handoff-external' : ''}`
                    + `${item.origin === 'scratch' && item.status === 'url_only' ? ' akari-vibe-handoff-external-unavailable' : ''}`;
                row.draggable = item.origin !== 'scratch' || item.status === 'ready';
                if (item.path) { row.title = item.path; row.setAttribute('data-handoff-path', item.path); }
                const name = document.createElement('span');
                name.className = 'akari-vibe-handoff-name';
                name.textContent = item.name;
                if (item.origin === 'scratch') {
                    if (item.thumb) {
                        const thumb = document.createElement('img'); thumb.className = 'akari-vibe-handoff-thumb';
                        thumb.src = item.thumb; thumb.alt = ''; row.append(thumb);
                    } else {
                        const icon = document.createElement('span'); icon.className = 'codicon codicon-file-media';
                        icon.setAttribute('aria-hidden', 'true'); row.append(icon);
                    }
                    const copy = document.createElement('span'); copy.className = 'akari-vibe-handoff-external-copy';
                    const license = document.createElement('small'); license.className = 'akari-vibe-handoff-license';
                    license.textContent = item.status === 'url_only' ? '本体なし（渡せません）・利用条件: 不明' : '利用条件: 不明';
                    copy.append(name, license); row.append(copy);
                    const external = document.createElement('small'); external.className = 'akari-vibe-handoff-external-badge';
                    external.textContent = '外'; row.append(external);
                } else {
                    const badge = document.createElement('small');
                    badge.className = 'akari-vibe-handoff-badge';
                    badge.textContent = item.fresh ? '新着' : item.badge;
                    row.append(name, badge);
                }
                row.addEventListener('dragstart', event => {
                    if (item.origin === 'scratch' && item.status !== 'ready') { event.preventDefault(); return; }
                    if (!event.dataTransfer) return;
                    event.dataTransfer.setData('text/uri-list', item.uri);
                    event.dataTransfer.setData('text/plain', item.path);
                    event.dataTransfer.setData(THEIA_URI_MIME, item.uri);
                    event.dataTransfer.setData(HANDOFF_MIME, item.path);
                    event.dataTransfer.effectAllowed = 'copy';
                    // プレビューの window バブル側 dragstart は text/uri-list を素材として読む。
                    // 外へのドラッグは続けつつ、アプリ内の素材ドラッグ状態を作らせない。
                    event.stopPropagation();
                });
                row.addEventListener('click', () => {
                    if (item.origin === 'scratch' && item.status !== 'ready') {
                        const notice = ctx.status.set('本体が取れていないため渡せません', 'info');
                        setTimeout(() => notice.dispose(), 4000); return;
                    }
                    void navigator.clipboard.writeText(item.path).then(() => {
                        const notice = ctx.status.set('パスを写しました', 'info');
                        setTimeout(() => notice.dispose(), 4000);
                    }).catch(() => {
                        const notice = ctx.status.set('パスを写せませんでした', 'error');
                        setTimeout(() => notice.dispose(), 4000);
                    });
                });
                list.append(row);
            }
            host.append(list);
            const hint = document.createElement('div');
            hint.className = 'akari-vibe-handoff-hint';
            hint.textContent = '行をエージェントのパネルへドラッグするか、押してパスを写します';
            host.append(hint);
        };
        const subscription = this.onChanged(paint);
        paint();
        void this.load();
        return Disposable.create(() => { disposed = true; subscription.dispose(); host.replaceChildren(); Object.assign(host.style, previousStyle); });
    }
}
