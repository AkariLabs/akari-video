import { guardInitLayout } from 'akari-theme/lib/browser/init-layout-guard';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandRegistry, DisposableCollection } from '@theia/core/lib/common';
import { TabBar, Widget } from '@theia/core/shared/@lumino/widgets';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalCommands } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import {
    BOTTOM_PANEL_MENU_ITEMS, BottomPanelMenuItemId, PARTNER_TERMINAL_KIND,
    shouldCloseAtStartup
} from '../common/bottom-panel-curation';

// akari-menu-widget.tsx と同様、annotations 拡張へ依存せず既存の再表示経路を呼ぶ。
const OPEN_TIMELINE_COMMAND = 'akari.annotations.open';

/** 下パネルの掃除は一度だけ行い、その後はユーザーが開いたタブを保持する。 */
@injectable()
export class AkariBottomPanelCuration implements FrontendApplicationContribution {
    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;

    @inject(CommandRegistry)
    protected readonly commands!: CommandRegistry;

    @inject(TerminalService)
    protected readonly terminals!: TerminalService;

    protected shell: ApplicationShell | undefined;
    protected readonly toDispose = new DisposableCollection();
    protected readonly tabBars = new Map<TabBar<Widget>, () => void>();
    protected closePopup: (() => void) | undefined;
    protected creatingTerminal = false;

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        return guardInitLayout('akari-shell-strip', async () => {
            if (this.shell) return;
            this.shell = app.shell;
            // 復元済みの集合をここで確定する。追加イベントや F6 では掃除を繰り返さない。
            const startupWidgets = [...app.shell.bottomPanel.widgets()];
            if (!this.developerMode.isEnabled) {
                for (const widget of startupWidgets) {
                    if (shouldCloseAtStartup({
                        id: widget.id,
                        area: app.shell.getAreaFor(widget),
                        isTerminal: widget instanceof TerminalWidget,
                        kind: widget instanceof TerminalWidget ? widget.kind : undefined
                    })) {
                        await app.shell.closeWidget(widget.id);
                    }
                }
            }
            this.reconcile();
            this.toDispose.push(app.shell.onDidAddWidget(() => this.reconcile()));
            this.toDispose.push(this.developerMode.onDidChange(() => this.reconcile()));
            // 分割・移動・最後のタブのクローズでも tab bar 自体が入れ替わるため追従する。
            app.shell.bottomPanel.layoutModified.connect(this.reconcile, this);
            this.toDispose.push({ dispose: () => app.shell.bottomPanel.layoutModified.disconnect(this.reconcile, this) });
        });
    }

    protected reconcile(): void {
        const current = new Set(this.shell?.bottomPanel.tabBars() ?? []);
        for (const [bar, dispose] of this.tabBars) {
            if (!current.has(bar) || this.developerMode.isEnabled) {
                dispose();
                this.tabBars.delete(bar);
                this.closePopup?.();
            }
        }
        if (this.developerMode.isEnabled) return;
        for (const bar of current) {
            if (this.tabBars.has(bar)) continue;
            const button = bar.addButtonNode;
            const original = { enabled: bar.addButtonEnabled, html: button.innerHTML, style: button.getAttribute('style'),
                title: button.title, label: button.getAttribute('aria-label'), role: button.getAttribute('role'),
                tabindex: button.getAttribute('tabindex'), parent: button.parentNode, next: button.nextSibling };
            // Theia の ScrollableTabBar はタブ列を内側へ移し、入力リスナーも
            // contentNode にだけ付ける。Lumino の add ノードも同じ行へ移し、入力を補う。
            bar.node.querySelector('.theia-tabBar-tab-row')?.appendChild(button);
            bar.addButtonEnabled = true;
            button.textContent = '+';
            button.title = '下パネルに追加';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            Object.assign(button.style, {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flex: '0 0 28px', cursor: 'pointer', fontSize: '20px', color: 'var(--theia-tab-activeForeground)'
            });
            const open = (): void => this.openMenu(button);
            const pointer = (event: PointerEvent): void => event.stopPropagation();
            const key = (event: KeyboardEvent): void => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    open();
                }
            };
            button.addEventListener('pointerdown', pointer);
            button.addEventListener('click', open);
            button.addEventListener('keydown', key);
            bar.addRequested.connect(open);
            this.tabBars.set(bar, () => {
                bar.addRequested.disconnect(open);
                button.removeEventListener('pointerdown', pointer);
                button.removeEventListener('click', open);
                button.removeEventListener('keydown', key);
                if (bar.isDisposed) return;
                bar.addButtonEnabled = original.enabled;
                button.innerHTML = original.html;
                button.title = original.title;
                original.parent?.insertBefore(button, original.next?.parentNode === original.parent ? original.next : null);
                for (const [name, value] of [['style', original.style], ['aria-label', original.label], ['role', original.role], ['tabindex', original.tabindex]]) {
                    if (value === null) button.removeAttribute(name);
                    else button.setAttribute(name, value);
                }
            });
        }
    }

    protected openMenu(anchor: HTMLElement): void {
        this.closePopup?.();
        const popup = document.createElement('div');
        popup.dataset.akariBottomPanelMenu = 'true';
        popup.setAttribute('role', 'menu');
        // timeline-context-menu.ts と同型の DOM popup。拡張間 import は避け、
        // 閉じた際に document リスナーも解放して反復利用時の残留を防ぐ。
        Object.assign(popup.style, {
            position: 'fixed', zIndex: '10000', display: 'flex', flexDirection: 'column',
            minWidth: '156px', padding: '4px', borderRadius: '4px',
            border: '1px solid var(--theia-widget-border)', background: 'var(--theia-menu-background)',
            boxShadow: '0 3px 12px rgba(0,0,0,.35)'
        });
        const close = (): void => {
            popup.remove();
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', keyboard, true);
            this.closePopup = undefined;
        };
        const outside = (event: PointerEvent): void => {
            if (!popup.contains(event.target as Node)) close();
        };
        const keyboard = (event: KeyboardEvent): void => {
            if (event.key === 'Escape' || event.key === 'Tab') {
                close();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    anchor.focus();
                }
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const buttons = Array.from(popup.querySelectorAll('button'));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
                event.preventDefault();
                event.stopPropagation();
            }
        };
        for (const item of BOTTOM_PANEL_MENU_ITEMS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-button secondary';
            button.setAttribute('role', 'menuitem');
            button.textContent = item.label;
            button.style.justifyContent = 'flex-start';
            button.addEventListener('click', () => {
                close();
                void this.selectItem(item.id).catch(error => console.error('[akari-shell-strip] bottom panel open failed:', error));
            });
            popup.appendChild(button);
        }
        popup.addEventListener('contextmenu', event => event.preventDefault());
        document.body.appendChild(popup);
        const rect = anchor.getBoundingClientRect();
        popup.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - popup.offsetWidth))}px`;
        popup.style.top = `${Math.max(0, rect.bottom + popup.offsetHeight <= window.innerHeight ? rect.bottom : rect.top - popup.offsetHeight)}px`;
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', keyboard, true);
        this.closePopup = close;
        popup.querySelector('button')?.focus();
    }

    protected async selectItem(id: BottomPanelMenuItemId): Promise<void> {
        const shell = this.shell;
        if (!shell) return;
        if (id === 'timeline') {
            // 再表示・前面化・作成の振り分けは annotations 側の openOrCreateTimeline() に一本化する（司令塔裁定 6）。
            // 1 本目が自動アタッチ済みでも「+」から作成ポップアップへ到達できるようにする。
            await this.commands.executeCommand(OPEN_TIMELINE_COMMAND);
            return;
        }
        if (this.creatingTerminal) return;
        this.creatingTerminal = true;
        const existing = new Set(this.terminals.all);
        try {
            await this.commands.executeCommand(TerminalCommands.NEW.id);
            // terminal:new は戻り値がなく、直前の端末を ref にする。main の端末を
            // 使った後でも、この操作で新設した端末だけを bottom へ配置し直す。
            await shell.pendingUpdates;
            for (const terminal of this.terminals.all) {
                if (existing.has(terminal) || terminal.kind === PARTNER_TERMINAL_KIND || terminal.isDisposed) continue;
                if (shell.getAreaFor(terminal) !== 'bottom') await shell.addWidget(terminal, { area: 'bottom' });
                await shell.activateWidget(terminal.id);
            }
        } finally {
            this.creatingTerminal = false;
        }
    }

    onStop(): void {
        this.closePopup?.();
        this.toDispose.dispose();
        for (const dispose of this.tabBars.values()) dispose();
        this.tabBars.clear();
    }
}
