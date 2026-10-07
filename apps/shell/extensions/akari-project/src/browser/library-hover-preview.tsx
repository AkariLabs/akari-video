import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import { hoverPopupPosition } from '../common/material-card-hover';
import { LIBRARY_HOVER_DELAY_MS, LIBRARY_HOVER_DESCRIPTION_ID, libraryHoverPreview, LibraryHoverSpec } from '../common/library-hover-preview';

const CSS = `
@keyframes akari-library-preview-strip { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }
[data-akari-library-hover-preview][data-kind="transition"] { background-size: 500% 100%; background-repeat: no-repeat; animation: akari-library-preview-strip .9s steps(4, end) infinite; }
@media (prefers-reduced-motion: reduce) {
    [data-akari-library-hover-preview][data-kind="transition"] { animation: none; background-position: 50% 50%; }
}
`;

/** One delegated listener set and one popup for the entire library surface. */
export function LibraryHoverPreview(props: { root: HTMLElement; enabled: boolean; blocked: boolean; pageKey: string }): React.ReactElement | null {
    const [active, setActive] = React.useState<{ card: HTMLElement; spec: LibraryHoverSpec; label: string } | undefined>();
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>();
    const dragging = React.useRef(false);

    React.useEffect(() => {
        const root = props.root;
        const close = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = undefined;
            setActive(undefined);
        };
        close();
        if (!props.enabled || props.blocked) return close;
        const cardFor = (target: EventTarget | null): HTMLElement | null =>
            target instanceof Element ? target.closest<HTMLElement>('[data-akari-hover-preview-src], [data-akari-hover-preview-kind="font"]') : null;
        const openLater = (card: HTMLElement | null) => {
            close();
            if (!card || dragging.current || !root.contains(card)
                || card.querySelector('[data-akari-library-dots][aria-expanded="true"]')) return;
            const spec = libraryHoverPreview(card.dataset.akariHoverPreviewKind ?? '',
                card.dataset.akariHoverPreviewSrc, card.dataset.akariHoverPreviewStrip,
                card.dataset.akariHoverPreviewSource);
            if (!spec) return;
            timer.current = setTimeout(() => {
                timer.current = undefined;
                if (root.contains(card) && !dragging.current && !card.querySelector('[data-akari-library-dots][aria-expanded="true"]')) {
                    setActive({ card, spec, label: card.dataset.akariHoverPreviewLabel ?? card.title ?? '見本' });
                }
            }, LIBRARY_HOVER_DELAY_MS);
        };
        const enter = (event: Event) => {
            const card = cardFor(event.target);
            if (card && !card.contains((event as MouseEvent).relatedTarget as Node | null)) openLater(card);
        };
        const leave = (event: Event) => {
            const card = cardFor(event.target);
            if (card && !card.contains((event as MouseEvent).relatedTarget as Node | null)) close();
        };
        const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        const dragstart = () => { dragging.current = true; close(); };
        const dragend = () => { dragging.current = false; close(); };
        root.addEventListener('pointerover', enter);
        root.addEventListener('pointerout', leave);
        root.addEventListener('focusin', enter);
        root.addEventListener('focusout', leave);
        root.addEventListener('akari-library-hide', close);
        document.addEventListener('keydown', keydown);
        document.addEventListener('scroll', close, true);
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('contextmenu', close, true);
        document.addEventListener('dragstart', dragstart, true);
        document.addEventListener('dragend', dragend, true);
        window.addEventListener('resize', close);
        return () => {
            close();
            root.removeEventListener('pointerover', enter);
            root.removeEventListener('pointerout', leave);
            root.removeEventListener('focusin', enter);
            root.removeEventListener('focusout', leave);
            root.removeEventListener('akari-library-hide', close);
            document.removeEventListener('keydown', keydown);
            document.removeEventListener('scroll', close, true);
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('contextmenu', close, true);
            document.removeEventListener('dragstart', dragstart, true);
            document.removeEventListener('dragend', dragend, true);
            window.removeEventListener('resize', close);
        };
    }, [props.root, props.enabled, props.blocked, props.pageKey]);

    if (!active || !props.enabled || props.blocked || !active.card.isConnected) return null;
    const rect = active.card.getBoundingClientRect();
    const position = hoverPopupPosition(rect, { width: window.innerWidth, height: window.innerHeight }, active.spec);
    return createPortal(<>
        <style data-akari-library-hover-css>{CSS}</style>
        <div id={LIBRARY_HOVER_DESCRIPTION_ID} role='tooltip' data-akari-library-hover-preview data-kind={active.spec.kind}
            aria-label={`${active.label} の見本`}
            style={{ position: 'fixed', left: position.left, top: position.top, width: active.spec.width,
                height: active.spec.height, zIndex: 10000, pointerEvents: 'none', overflow: 'hidden',
                borderRadius: '8px', backgroundColor: 'var(--akari-card, var(--theia-editor-background))',
                color: 'var(--akari-ink, var(--theia-foreground))', border: '1px solid var(--akari-border, #777)',
                boxShadow: '0 10px 30px #0008',
                ...(active.spec.kind === 'transition' ? { backgroundImage: `url("${active.spec.src}")` } : {}) }}>
            {active.spec.kind === 'font' ? active.spec.src
                ? <span data-akari-font-hover-sample style={{ display: 'block', width: '100%', height: '100%',
                    backgroundColor: 'currentColor', mask: `url("${active.spec.src}") center / contain no-repeat`,
                    WebkitMask: `url("${active.spec.src}") center / contain no-repeat` }} />
                : <div style={{ padding: '22px', fontSize: '13px' }}>この書体は入手後に見本を表示します
                    {active.spec.source && <div style={{ marginTop: '12px', overflowWrap: 'anywhere', opacity: 0.7 }}>
                        入手先: {active.spec.source}</div>}</div>
                : <img src={active.spec.src} alt='' loading='lazy' decoding='async' draggable={false}
                    width={active.spec.width} height={active.spec.height}
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain',
                        opacity: active.spec.kind === 'transition' ? 0 : 1 }} />}
        </div>
    </>, document.body);
}
