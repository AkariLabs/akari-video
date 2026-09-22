import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';

type HorizontalBounds = Readonly<{ left: number; right: number }>;

/**
 * 2px を超えて見切れたら表示、0.5px 以下に戻ったら非表示。
 * 中間域では前回値を維持し、サブピクセル丸め・ホバー時の微小な幅変化で往復しない。
 * 判定するのは退避ボタンを重ねる前のスクローラー全幅（ボタンの幅を差し引かない）。
 */
export function shouldShowHomeTabAnchor(
    visible: boolean, bounds: HorizontalBounds, tab: HorizontalBounds | undefined
): boolean {
    if (!tab || ![bounds.left, bounds.right, tab.left, tab.right].every(Number.isFinite)
        || bounds.right <= bounds.left || tab.right <= tab.left) {
        return false;
    }
    const clippedBy = Math.max(bounds.left - tab.left, tab.right - bounds.right);
    return clippedBy > (visible ? 0.5 : 2);
}

/** 標準タブがスクロールで隠れたときだけ、スクロール領域にホームを重ねる。 */
export function installHomeTabAnchor(shell: ApplicationShell, home: Widget): Disposable {
    const mounted = new Map<HTMLElement, Disposable>();
    const refreshBars = (): void => {
        const live = new Set<HTMLElement>();
        for (const bar of shell.mainAreaTabBars) {
            if (!bar.titles.includes(home.title)) { continue; }
            live.add(bar.node);
            if (mounted.has(bar.node)) { continue; }
            const scroller = bar.contentNode.parentElement;
            if (!scroller || scroller === bar.node) { continue; }
            const row = scroller.parentElement;
            if (!row) { continue; }
            const previousPosition = row.style.position;
            row.style.position = 'relative';
            // Theia のタブは current ? タブ数 : タブ数-index-1、PS レールは 1000。
            // relative な content-container（tabs.css）を z=0 の stacking context にし、
            // 子の z-index をここに閉じ込める。退避ボタンの z=1 がタブより上になり、
            // 同じ行の toolbar（z=1001）や外側のホバー・メニューの層は越えない。
            const previousScrollerZIndex = scroller.style.zIndex;
            scroller.style.zIndex = '0';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-home-tab-anchor codicon codicon-home';
            button.setAttribute('aria-label', 'ホーム');
            button.title = 'ホーム';
            button.hidden = true;
            Object.assign(button.style, {
                // flex 項目にすると表示のたびにスクローラーが 36px 縮み、判定へ戻ってしまう。
                position: 'absolute', left: '0', top: '0', bottom: '0', zIndex: '1',
                display: 'none', alignItems: 'center', justifyContent: 'center', width: '36px', boxSizing: 'border-box', border: '0', borderRight: '1px solid var(--theia-widget-border)',
                color: 'var(--theia-foreground)', background: 'var(--theia-editor-background)', cursor: 'pointer'
            });
            button.addEventListener('click', () => { void shell.activateWidget(home.id); });
            scroller.before(button);
            let frame = 0;
            const update = (): void => {
                frame = 0;
                const index = bar.titles.indexOf(home.title);
                const tab = bar.contentNode.children[index] as HTMLElement | undefined;
                const bounds = scroller.getBoundingClientRect();
                const rect = tab?.getBoundingClientRect();
                const visible = shouldShowHomeTabAnchor(!button.hidden, bounds, rect);
                if (button.hidden === visible) {
                    button.hidden = !visible;
                    button.style.display = visible ? 'inline-flex' : 'none';
                }
                button.setAttribute('aria-pressed', String(bar.currentTitle === home.title));
            };
            const schedule = (): void => { if (!frame) { frame = requestAnimationFrame(update); } };
            const resize = new ResizeObserver(schedule);
            resize.observe(scroller);
            const mutations = new MutationObserver(schedule);
            mutations.observe(bar.contentNode, { childList: true, subtree: true, attributes: true });
            scroller.addEventListener('scroll', schedule, { passive: true });
            schedule();
            mounted.set(bar.node, Disposable.create(() => {
                cancelAnimationFrame(frame);
                resize.disconnect();
                mutations.disconnect();
                scroller.removeEventListener('scroll', schedule);
                button.remove();
                row.style.position = previousPosition;
                scroller.style.zIndex = previousScrollerZIndex;
            }));
        }
        for (const [node, binding] of mounted) {
            if (!live.has(node)) { binding.dispose(); mounted.delete(node); }
        }
    };
    shell.mainPanel.layoutModified.connect(refreshBars);
    refreshBars();
    return Disposable.create(() => {
        shell.mainPanel.layoutModified.disconnect(refreshBars);
        mounted.forEach(binding => binding.dispose());
        mounted.clear();
    });
}
