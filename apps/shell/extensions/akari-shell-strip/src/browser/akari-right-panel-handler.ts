import { inject, injectable } from '@theia/core/shared/inversify';
import { DockLayout, DockPanel, TabBar, Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { Drag } from '@theia/core/shared/@lumino/dragdrop';
import { MimeData } from '@theia/core/shared/@lumino/coreutils';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { SidePanelHandler, SidePanel } from '@theia/core/lib/browser/shell/side-panel-handler';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import { DockPanelRendererFactory } from '@theia/core/lib/browser/shell/application-shell';
import { SideTabBar, TabBarRenderer } from '@theia/core/lib/browser/shell/tab-bars';
import {
    clickRightRail, cloneRightRailState, closeRightRailPane, defaultRightRailState, dropOnRightRail, normalizeRightRail,
    readRightRailState, rightRailGroupOf, rightRailOrder, rightRailPaneOf, RightRailSlot, RightRailState, RightRailZone, saveRightRailState, settleRightRailRatio
} from './right-rail-state';
import { installRightRailStyle, RIGHT_RAIL_CLOSE_ICON_SVG } from './right-rail-style';
import { installRightRailIconStyle } from './right-rail-icons';
import { RightRailTooltip } from './right-rail-tooltip';
import { trackDragGesture } from './right-rail-drag-gesture';

type RailLayoutData = SidePanel.LayoutData & { akariRail?: unknown };
type PanelMover = (widget: Widget, area: 'main' | 'bottom' | 'right') => Promise<void>;

/** レール・パネル見出しから始めたドラッグの MIME（Theia / Lumino の widget ドラッグと同じ）。 */
export const RIGHT_RAIL_WIDGET_MIME = 'application/vnd.lumino.widget-factory';

const RAIL_CLASS_PREFIX = 'akari-rail-';

/**
 * 右パネル（task 2026-09-22-right-rail-regroup）。見た目と動きの正は内部リポの試作
 * planning/notes-2026-09-22-right-rail-prototype.html（2 版）。
 *
 * - レールは 1 本（Theia の縦バーのまま）。縦の真ん中に区切り線、線の上 = エージェント、線の下 = それ以外
 * - 右パネルは既定で 1 面（Theia 既定どおり、押したものが出る / 出ているものを押すと畳む）
 * - パネルを右の上半分 / 下半分へ置いたときだけ 2 段。2 段の規則 = 区切り線どおり
 * - レールのホバーは遅れなしで名前だけ（Theia の遅延ツールチップはレールでは出さない）
 *
 * 方式は見送った task/2026-09-22-right-panel-split（6ba840e1）の (b) を再利用する: shell が参照する
 * Theia の dock は 1 枚のまま、Lumino のレイアウトだけを「1 つのタブ領域（帯は隠す）」か
 * 「縦 split の 2 つのタブ領域」に組み直す。widget の発見・activate / reveal・幅・畳む / 開く・
 * 進め方メニュー（bottom menu）・widget のシリアライズは SidePanelHandler の既存実装のまま動く。
 */
@injectable()
export class AkariRightPanelHandler extends SidePanelHandler {
    @inject(DockPanelRendererFactory)
    protected readonly railRendererFactory!: DockPanelRendererFactory;

    protected rail: RightRailState = defaultRightRailState();
    protected rebuilding = false;
    protected restoring = false;
    protected handleDragging = false;
    protected tooltip: RightRailTooltip | undefined;
    protected separatorFrame = 0;
    protected readonly paneTabBars = new Set<TabBar<Widget>>();
    protected readonly decoratedPaneTabBars = new WeakSet<TabBar<Widget>>();

    protected readonly onDidStartPanelDragEmitter = new Emitter<Widget>();
    /** レール・右パネルの見出しからパネルを持ち上げたとき（置き場所の表示は AkariRightRailDnd が出す）。 */
    readonly onDidStartPanelDrag: Event<Widget> = this.onDidStartPanelDragEmitter.event;

    override create(side: 'left' | 'right', options: SidePanel.Options): void {
        super.create(side, options);
        if (side !== 'right') {
            return;
        }
        installRightRailStyle();
        installRightRailIconStyle();
        this.container.addClass('akari-right-rail');
        // レールのクリックとドラッグは installRailPointer が受け持つ（Lumino の並べ替えは使わない）。
        this.tabBar.tabsMovable = false;
        this.suppressDelayedHover();
        this.tooltip = new RightRailTooltip(this.tabBar);
        this.installRailPointer();
        this.installToolbarDrag();
        this.installPaneFocusTracking();
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => this.scheduleSeparator()).observe(this.tabBar.node);
        }
        this.rebuild();
    }

    // ───────────────────────── dock ─────────────────────────

    protected override createSidePanel(): TheiaDockPanel {
        if (this.side !== 'right') {
            return super.createSidePanel();
        }
        const renderer = this.railRendererFactory();
        renderer.tabBarClasses.push('theia-app-centers');
        const panel = this.dockPanelFactory({
            mode: 'multiple-document', spacing: 6, disableDragAndDrop: true,
            renderer: {
                createHandle: () => renderer.createHandle(),
                createTabBar: () => {
                    const bar = renderer.createTabBar();
                    const tabRenderer = bar.renderer as TabBarRenderer;
                    const createTabId = tabRenderer.createTabId.bind(tabRenderer);
                    // レールと段の見出しは同じ widget.title を描くので DOM ID を分ける（レールの selector を壊さない）。
                    tabRenderer.createTabId = (title, hidden) => `${createTabId(title, hidden)}-akari-right-pane`;
                    this.paneTabBars.add(bar);
                    return bar;
                }
            }
        });
        panel.id = 'theia-right-side-panel';
        panel.addClass('theia-side-panel');
        panel.addClass('akari-right-rail-dock');
        panel.widgetActivated.connect((_, widget) => {
            this.tabBar.currentTitle = widget.title;
        });
        panel.widgetAdded.connect(this.onWidgetAdded, this);
        panel.widgetRemoved.connect(this.onWidgetRemoved, this);
        panel.layoutModified.connect(() => this.onDockLayoutModified());
        return panel;
    }

    /** 右のレールにいまある id（レールの並び順）。 */
    railIds(): string[] {
        return this.tabBar.titles.filter(title => !title.owner.isDisposed).map(title => title.owner.id);
    }

    /** レールの住人か、レールからメイン / 下へ出した住人か（置き場所の表示を出す対象）。 */
    isRailPanel(widget: Widget): boolean {
        return this.railIds().includes(widget.id) || widget.id in this.rail.displaced;
    }

    /** レールの所属（akari-annotations の並び直しもこれに従う）。 */
    railGroupOf(id: string): 'agent' | 'lower' {
        return rightRailGroupOf(this.rail, id);
    }

    /** 復元後の並び直しも利用者の順へ揃える。 */
    railOrder(ids: readonly string[]): string[] {
        return rightRailOrder(this.rail, ids);
    }

    /** 現在の状態の写し（L1・テスト用）。 */
    railState(): RightRailState {
        return cloneRightRailState(this.rail);
    }

    protected rebuild(): void {
        if (this.side !== 'right' || this.rebuilding || this.restoring) {
            return;
        }
        this.rebuilding = true;
        let keep: string | null | undefined;
        try {
            const titles = this.tabBar.titles.filter(title => !title.owner.isDisposed);
            const byId = new Map(titles.map(title => [title.owner.id, title]));
            const ordered = this.railOrder(titles.map(title => title.owner.id));
            ordered.forEach((id, index) => {
                if (this.tabBar.titles[index] !== byId.get(id)) {
                    this.tabBar.insertTab(index, byId.get(id)!);
                }
            });
            keep = normalizeRightRail(this.rail, ordered);
            const owners = (ids: string[]) => ids.map(id => byId.get(id)!.owner);
            let main: DockLayout.AreaConfig | null = null;
            if (this.rail.split) {
                const agentIds = ordered.filter(id => rightRailGroupOf(this.rail, id) === 'agent');
                const lowerIds = ordered.filter(id => rightRailGroupOf(this.rail, id) === 'lower');
                main = {
                    type: 'split-area', orientation: 'vertical', sizes: [this.rail.ratio, 1 - this.rail.ratio],
                    children: [
                        { type: 'tab-area', widgets: owners(agentIds), currentIndex: Math.max(0, agentIds.indexOf(this.rail.top!)) },
                        { type: 'tab-area', widgets: owners(lowerIds), currentIndex: Math.max(0, lowerIds.indexOf(this.rail.bottom!)) }
                    ]
                };
            } else if (ordered.length) {
                const current = keep !== undefined ? keep : this.tabBar.currentTitle?.owner.id;
                main = { type: 'tab-area', widgets: owners(ordered), currentIndex: Math.max(0, ordered.indexOf(current ?? '')) };
            }
            const previousBars = Array.from(this.paneTabBars);
            try {
                this.dockPanel.restoreLayout({ main });
            } finally {
                this.disposeObsoletePaneTabBars(previousBars);
            }
            for (const bar of this.dockPanel.tabBars()) {
                this.decoratePaneTabBar(bar);
                bar.setHidden(!this.rail.split);
            }
            this.dockPanel.toggleClass('akari-right-split', this.rail.split);
            // 1 面のときは Theia の見出し帯（名前 + widget のツールバー）、2 段のときは各段の見出しを使う。
            this.toolBar.setHidden(this.rail.split);
        } finally {
            this.rebuilding = false;
        }
        if (keep !== undefined && this.tabBar.currentTitle) {
            this.tabBar.currentTitle = keep ? this.titleOf(keep) ?? null : null;
        } else if (this.rail.split && this.tabBar.currentTitle) {
            const focused = this.titleOf(this.rail[this.rail.focus]!);
            if (focused && focused !== this.tabBar.currentTitle) {
                this.tabBar.currentTitle = focused;
            }
        }
        this.updateRailClasses();
    }

    protected titleOf(id: string): Title<Widget> | undefined {
        return this.tabBar.titles.find(title => title.owner.id === id);
    }

    /** restoreLayout で置き換わった古い段の見出しを Lumino の親子関係ごと閉じる（6ba840e1 r2 の知見）。 */
    protected disposeObsoletePaneTabBars(previousBars: readonly TabBar<Widget>[]): void {
        const activeBars = new Set(this.dockPanel.tabBars());
        for (const bar of new Set([...previousBars, ...this.paneTabBars])) {
            if (activeBars.has(bar)) {
                continue;
            }
            bar.parent = null;
            bar.dispose();
            if (bar.node.parentNode === this.dockPanel.node) {
                bar.node.remove();
            }
            this.paneTabBars.delete(bar);
        }
    }

    /** 段の見出し: × で段を閉じる / 見出しを持ってドラッグ / 選択の変化を縦バーへ伝える。1 本につき 1 回だけ。 */
    protected decoratePaneTabBar(bar: TabBar<Widget>): void {
        this.paneTabBars.add(bar);
        bar.tabsMovable = false;
        if (this.decoratedPaneTabBars.has(bar)) {
            return;
        }
        this.decoratedPaneTabBars.add(bar);
        bar.addClass('akari-rail-pane-header');
        bar.currentChanged.connect((_, { currentTitle }) => {
            if (!this.rebuilding && !this.restoring && currentTitle && this.rail.split) {
                this.tabBar.currentTitle = currentTitle;
            }
        });
        const close = document.createElement('div');
        close.className = 'akari-rail-pane-close';
        close.title = 'この段を閉じて 1 面に戻す';
        close.setAttribute('role', 'button');
        close.innerHTML = RIGHT_RAIL_CLOSE_ICON_SVG;
        close.addEventListener('pointerdown', event => event.stopPropagation());
        close.addEventListener('click', event => {
            event.stopPropagation();
            const slot = this.slotOfPaneBar(bar);
            if (slot) {
                this.closePane(slot);
            }
        });
        bar.node.appendChild(close);
        trackDragGesture(bar.contentNode, {
            onStart: (x, y) => {
                const widget = bar.currentTitle?.owner;
                if (widget) {
                    bar.releaseMouse();
                    void this.startPanelDrag(widget, x, y);
                }
            }
        });
    }

    protected slotOfPaneBar(bar: TabBar<Widget>): RightRailSlot | undefined {
        if (!this.rail.split) {
            return undefined;
        }
        const ids = bar.titles.map(title => title.owner.id);
        return this.rail.top && ids.includes(this.rail.top) ? 'top' : this.rail.bottom && ids.includes(this.rail.bottom) ? 'bottom' : undefined;
    }

    // ───────────────────────── 1 面 / 2 段 ─────────────────────────

    /** 段の見出しの ×。パネル自体はレールに残る。 */
    closePane(slot: RightRailSlot): void {
        const kept = closeRightRailPane(this.rail, slot);
        this.rebuild();
        if (kept && this.tabBar.currentTitle) {
            this.tabBar.currentTitle = this.titleOf(kept) ?? this.tabBar.currentTitle;
        }
        this.updateRailClasses();
    }

    protected onDockLayoutModified(): void {
        if (this.rebuilding || this.restoring || !this.rail.split) {
            return;
        }
        const ratio = this.currentRatio();
        if (ratio === undefined) {
            return;
        }
        if (!this.handleDragging) {
            this.rail.ratio = Math.min(Math.max(ratio, 0.12), 0.88);
            return;
        }
        this.handleDragging = false;
        const kept = settleRightRailRatio(this.rail, ratio);
        if (kept !== undefined) {
            // 境目を端まで寄せた → 寄せられた側の段が消えて 1 面に戻る（そのパネルはレールに残る）。
            this.rebuild();
            if (kept && this.tabBar.currentTitle) {
                this.tabBar.currentTitle = this.titleOf(kept) ?? this.tabBar.currentTitle;
            }
            this.updateRailClasses();
        }
    }

    protected currentRatio(): number | undefined {
        const main = this.dockPanel.saveLayout().main;
        if (main?.type === 'split-area' && main.orientation === 'vertical' && main.children.length === 2) {
            const total = main.sizes[0] + main.sizes[1];
            return total > 0 ? main.sizes[0] / total : undefined;
        }
        return undefined;
    }

    /** 2 段のとき、段の中をクリックしたらフォーカスをその段へ。境目のドラッグ開始も記録する。 */
    protected installPaneFocusTracking(): void {
        this.dockPanel.node.addEventListener('pointerdown', event => {
            const target = event.target as HTMLElement | null;
            if (!target || !this.rail.split) {
                return;
            }
            if (target.classList.contains('lm-DockPanel-handle')) {
                this.handleDragging = true;
                return;
            }
            for (const slot of ['top', 'bottom'] as const) {
                const id = this.rail[slot];
                const title = id ? this.titleOf(id) : undefined;
                const bar = [...this.dockPanel.tabBars()].find(candidate => candidate.titles.some(t => t.owner.id === id));
                if (title && (title.owner.node.contains(target) || bar?.node.contains(target))) {
                    if (this.rail.focus !== slot || this.tabBar.currentTitle !== title) {
                        this.rail.focus = slot;
                        this.tabBar.currentTitle = title;
                        this.updateRailClasses();
                    }
                    return;
                }
            }
        }, true);
    }

    /**
     * パネルを置いたとき（置き場所の表示は AkariRightRailDnd）。状態を試作の drop(k, where) で進め、
     * 実際の移動は mover（ApplicationShell.addWidget）に任せる。
     */
    async dropPanel(widget: Widget, zone: RightRailZone, mover: PanelMover, beforeId?: string | null): Promise<void> {
        const current = this.tabBar.currentTitle?.owner.id ?? null;
        const result = dropOnRightRail(this.rail, widget.id, zone, { railIds: this.railIds(), current }, beforeId);
        if (result.moveTo) {
            await mover(widget, result.moveTo);
        }
        this.rebuild();
        if (result.current !== undefined) {
            if (result.current === null) {
                this.collapse();
            } else {
                const title = this.titleOf(result.current);
                if (title && (this.tabBar.currentTitle || zone === 'rtop' || zone === 'rbottom' || result.moveTo === 'right')) {
                    this.tabBar.currentTitle = title;
                }
            }
        }
        this.updateRailClasses();
    }

    // ───────────────────────── レール ─────────────────────────

    /** レールのホバーでは Theia の遅延ツールチップ（caption の長い説明）を出さない。名前は RightRailTooltip が即時に出す。 */
    protected suppressDelayedHover(): void {
        const renderer = this.tabBar.renderer as TabBarRenderer & { handleMouseEnterEvent?: (event: MouseEvent) => void };
        renderer.handleMouseEnterEvent = () => undefined;
        this.tabBar.update();
    }

    /**
     * レールのクリックとドラッグ。Lumino は押した瞬間に切り替えるが、ドラッグで持ち上げたときに
     * 中身が切り替わらないよう、離した時点でクリックとして解釈する（試作と同じ）。
     */
    protected installRailPointer(): void {
        const tabAt = (x: number, y: number): Title<Widget> | undefined => {
            const tabs = Array.from(this.tabBar.contentNode.children) as HTMLElement[];
            const index = tabs.findIndex(tab => {
                const box = tab.getBoundingClientRect();
                return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
            });
            return index >= 0 ? this.tabBar.titles[index] : undefined;
        };
        trackDragGesture(this.tabBar.node, {
            capture: true,
            accept: event => event.button === 0 && !!tabAt(event.clientX, event.clientY),
            onPress: event => {
                event.preventDefault();
                event.stopImmediatePropagation();
            },
            onClick: (x, y) => {
                const title = tabAt(x, y);
                if (title) {
                    this.clickRail(title);
                }
            },
            onStart: (x, y, pressX, pressY) => {
                const title = tabAt(pressX, pressY);
                if (title) {
                    void this.startPanelDrag(title.owner, x, y);
                }
            }
        });
    }

    protected clickRail(title: Title<Widget>): void {
        this.tooltip?.hide();
        if (this.rail.split) {
            clickRightRail(this.rail, title.owner.id);
            if (this.tabBar.currentTitle !== title) {
                this.tabBar.currentTitle = title;
            } else {
                this.refresh();
            }
            this.rebuildPaneSelection();
            title.owner.activate();
            this.updateRailClasses();
            return;
        }
        if (this.tabBar.currentTitle === title) {
            void this.collapse();
            return;
        }
        this.tabBar.currentTitle = title;
        title.owner.activate();
    }

    /** 2 段で段の中身だけを差し替える（タブ領域の選択を合わせる）。 */
    protected rebuildPaneSelection(): void {
        for (const slot of ['top', 'bottom'] as const) {
            const id = this.rail[slot];
            if (!id) {
                continue;
            }
            const title = this.titleOf(id);
            const bar = [...this.dockPanel.tabBars()].find(candidate => candidate.titles.includes(title!));
            if (title && bar && bar.currentTitle !== title) {
                bar.currentTitle = title;
            }
        }
    }

    /** 1 面のとき、Theia の見出し帯（パネル名）を持ってドラッグすると出ているパネルを持ち上げる。 */
    protected installToolbarDrag(): void {
        trackDragGesture(this.toolBar.node, {
            accept: event => event.button === 0 && !!(event.target as HTMLElement | null)?.closest('.theia-sidepanel-title'),
            onStart: (x, y) => {
                const widget = this.tabBar.currentTitle?.owner;
                if (widget) {
                    void this.startPanelDrag(widget, x, y);
                }
            }
        });
    }

    /** Lumino の widget ドラッグを始める（Theia の SidePanelHandler.onTabDetachRequested と同じ MIME）。 */
    async startPanelDrag(widget: Widget, clientX: number, clientY: number): Promise<void> {
        this.tooltip?.hide();
        const image = document.createElement('div');
        image.className = 'akari-rail-drag-image';
        const icon = document.createElement('span');
        icon.className = widget.title.iconClass;
        const label = document.createElement('span');
        label.textContent = widget.title.label;
        image.append(icon, label);
        const mimeData = new MimeData();
        mimeData.setData(RIGHT_RAIL_WIDGET_MIME, () => widget);
        const drag = new Drag({ mimeData, dragImage: image, proposedAction: 'move', supportedActions: 'move', source: this });
        this.tabBar.addClass('akari-rail-dragging');
        this.onDidStartPanelDragEmitter.fire(widget);
        try {
            await drag.start(clientX, clientY);
        } finally {
            this.tabBar.removeClass('akari-rail-dragging');
        }
    }

    /** 所属・出ているもの・フォーカスをレールと段の見出しの class に反映し、区切り線の位置を測り直す。 */
    protected updateRailClasses(): void {
        if (this.side !== 'right') {
            return;
        }
        const open = !!this.tabBar.currentTitle;
        let firstLower = true;
        for (const title of this.tabBar.titles) {
            const id = title.owner.id;
            const group = rightRailGroupOf(this.rail, id);
            const classes = title.className.split(/\s+/).filter(name => name && !name.startsWith(RAIL_CLASS_PREFIX));
            classes.push(`${RAIL_CLASS_PREFIX}${group}`);
            if (group === 'lower' && firstLower) {
                classes.push(`${RAIL_CLASS_PREFIX}lower-start`);
                firstLower = false;
            }
            if (open && rightRailPaneOf(this.rail, id)) {
                classes.push(`${RAIL_CLASS_PREFIX}shown`);
            }
            const next = classes.join(' ');
            if (title.className !== next) {
                title.className = next;
            }
        }
        for (const bar of this.dockPanel.tabBars()) {
            bar.toggleClass('akari-rail-pane-focus', this.rail.split && this.slotOfPaneBar(bar) === this.rail.focus);
        }
        this.scheduleSeparator();
    }

    /**
     * 区切り線はレール（縦バー）の縦の真ん中。線の下の最初のアイコンを線の直下へ下げる。
     * 上の区画が真ん中を越えるほど多いときは線をその直下へ（crowded）。
     */
    protected scheduleSeparator(): void {
        if (this.separatorFrame) {
            cancelAnimationFrame(this.separatorFrame);
        }
        // SideTabBar.updateTabs は 1 フレーム後に描くので、2 フレーム待ってから測る。
        this.separatorFrame = requestAnimationFrame(() => {
            this.separatorFrame = requestAnimationFrame(() => {
                this.separatorFrame = 0;
                this.layoutSeparator();
            });
        });
    }

    protected layoutSeparator(): void {
        const node = this.tabBar.node;
        const height = node.clientHeight;
        if (!height) {
            return;
        }
        const tabs = Array.from(this.tabBar.contentNode.children) as HTMLElement[];
        const agents = tabs.filter(tab => tab.classList.contains(`${RAIL_CLASS_PREFIX}agent`));
        const start = tabs.find(tab => tab.classList.contains(`${RAIL_CLASS_PREFIX}lower-start`));
        const gap = 4;
        const middle = Math.round(height / 2);
        const agentBottom = agents.length ? Math.max(...agents.map(tab => tab.offsetTop + tab.offsetHeight)) : 0;
        const crowded = agentBottom + gap > middle - 6;
        node.classList.toggle(`${RAIL_CLASS_PREFIX}crowded`, crowded);
        node.style.setProperty('--akari-rail-middle', `${middle}px`);
        if (!start) {
            return;
        }
        const desiredTop = crowded ? agentBottom + 13 : middle + 7;
        const naturalTop = agentBottom + gap;
        node.style.setProperty('--akari-rail-lower-offset', `${Math.max(desiredTop - naturalTop, 9)}px`);
    }

    // ───────────────────────── Theia の hook ─────────────────────────

    protected override onCurrentTabChanged(sender: SideTabBar, args: TabBar.ICurrentChangedArgs<Widget>): void {
        if (this.side === 'right' && args.currentTitle && !this.rebuilding && !this.restoring && this.rail.split) {
            // activate / reveal（注釈を開く・インスペクターを前面に等）もクリックと同じく区切り線どおりの段へ。
            clickRightRail(this.rail, args.currentTitle.owner.id);
        }
        super.onCurrentTabChanged(sender, args);
        if (this.side === 'right') {
            if (this.rail.split && args.currentTitle) {
                this.rebuildPaneSelection();
            }
            this.updateRailClasses();
        }
    }

    protected override onWidgetAdded(sender: DockPanel, widget: Widget): void {
        super.onWidgetAdded(sender, widget);
        if (this.side === 'right' && !this.rebuilding) {
            if (!this.restoring) {
                delete this.rail.displaced[widget.id];
            }
            this.rebuild();
        }
    }

    protected override onWidgetRemoved(sender: DockPanel, widget: Widget): void {
        if (this.side !== 'right') {
            super.onWidgetRemoved(sender, widget);
            return;
        }
        if (this.rebuilding || !this.tabBar.titles.some(title => title.owner === widget)) {
            return;
        }
        const pane = rightRailPaneOf(this.rail, widget.id);
        let keep: string | null | undefined;
        if (pane) {
            keep = closeRightRailPane(this.rail, pane);
        }
        const wasCurrent = this.tabBar.currentTitle === widget.title;
        super.onWidgetRemoved(sender, widget);
        this.rebuild();
        if (keep && wasCurrent) {
            this.tabBar.currentTitle = this.titleOf(keep) ?? this.tabBar.currentTitle;
        }
        this.updateRailClasses();
    }

    override getLayoutData(): RailLayoutData {
        const layout = super.getLayoutData();
        if (this.side !== 'right') {
            return layout;
        }
        if (this.rail.split) {
            const ratio = this.currentRatio();
            if (ratio !== undefined) {
                this.rail.ratio = Math.min(Math.max(ratio, 0.12), 0.88);
            }
        }
        return { ...layout, akariRail: saveRightRailState(this.rail) };
    }

    override setLayoutData(layout: RailLayoutData): void {
        if (this.side !== 'right') {
            super.setLayoutData(layout);
            return;
        }
        this.restoring = true;
        this.rail = readRightRailState(layout?.akariRail);
        try {
            super.setLayoutData(layout);
        } catch (error) {
            console.error('[akari-shell-strip] invalid right panel layout; restoring the default right rail.', error);
            this.rail = defaultRightRailState();
        } finally {
            this.restoring = false;
            this.rebuild();
            this.refresh();
        }
    }

    /** アプリ側の復元フェイルセーフ（タイムアウト・false・例外）から呼ぶ。1 面・既定の所属へ。 */
    resetRailLayout(): void {
        if (this.side === 'right') {
            this.rail = defaultRightRailState();
            this.rebuild();
            this.refresh();
        }
    }
}
