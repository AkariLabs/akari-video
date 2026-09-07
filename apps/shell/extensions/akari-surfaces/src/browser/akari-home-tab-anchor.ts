import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';

/** 標準タブがスクロールで隠れたときだけ、スクロール領域の外にホームを残す。 */
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
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-home-tab-anchor codicon codicon-home';
            button.setAttribute('aria-label', 'ホーム');
            button.title = 'ホーム';
            button.hidden = true;
            Object.assign(button.style, {
                display: 'none', alignItems: 'center', justifyContent: 'center', flex: '0 0 36px', width: '36px', border: '0', borderRight: '1px solid var(--theia-widget-border)',
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
                const clipped = !!rect && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
                if (button.hidden === clipped) {
                    button.hidden = !clipped;
                    button.style.display = clipped ? 'inline-flex' : 'none';
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
