import { t } from '@akari-video/i18n';
import { TRANSITION_FAMILIES, transitionFamilyLabelKey, transitionFamilyOf,
    type TransitionDirection, type TransitionFamily, type TransitionType } from '@akari-video/edit-store';
import { rememberedTransitionType, transitionPickerLayout } from '../common/transition-picker-layout';
import { transitionPickerShieldRects, type PickerFrameRect } from '../common/transition-picker-shield';

export interface TransitionPreviewUrls { preview?: string; strip?: string }
export interface TransitionPickerCurrent { type: string; duration: number }

export interface TransitionPickerOptions {
    anchor: () => HTMLElement | undefined;
    fallbackFocus: () => HTMLElement;
    current: () => TransitionPickerCurrent | undefined;
    blockedReason?: string;
    previews: Readonly<Record<string, TransitionPreviewUrls>>;
    rememberedDirection: (family: TransitionFamily) => TransitionDirection | undefined;
    apply: (type: TransitionType) => Promise<boolean>;
    remove: () => Promise<boolean>;
    reveal: () => void;
    closed: () => void;
}

export interface TransitionPicker {
    element: HTMLDivElement;
    update: () => void;
    reposition: () => void;
    close: () => void;
}

export function initialTransitionPickerFocusFamily(
    currentFamily: TransitionFamily | undefined,
    availableFamilies: readonly TransitionFamily[]
): TransitionFamily | undefined {
    return currentFamily && availableFamilies.includes(currentFamily) ? currentFamily : undefined;
}

function visibleFrameRect(frame: Element): PickerFrameRect | undefined {
    const bounds = frame.getBoundingClientRect();
    const rect = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    for (let parent: Element | null = frame; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return undefined;
        if (parent === frame) continue;
        const clip = parent.getBoundingClientRect();
        if (/^(auto|hidden|scroll|clip|overlay)$/.test(style.overflowX)) {
            rect.left = Math.max(rect.left, clip.left);
            rect.right = Math.min(rect.right, clip.right);
        }
        if (/^(auto|hidden|scroll|clip|overlay)$/.test(style.overflowY)) {
            rect.top = Math.max(rect.top, clip.top);
            rect.bottom = Math.min(rect.bottom, clip.bottom);
        }
    }
    return rect;
}

export function createTransitionPicker(options: TransitionPickerOptions): TransitionPicker {
    const element = document.createElement('div');
    element.className = 'akari-transition-picker';
    element.dataset.akariTransitionPicker = options.blockedReason ? 'dead' : 'families';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', t('transition.picker.heading.choose'));
    element.tabIndex = -1;
    const arrow = document.createElement('span');
    arrow.className = 'akari-transition-picker-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'akari-transition-picker-body';
    element.append(body, arrow);
    let closed = false;
    let frame = 0;
    let lastRect = '';
    const shields: HTMLDivElement[] = [];
    const close = (restoreFocus = true): void => {
        if (closed) return;
        closed = true;
        cancelAnimationFrame(frame);
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', keydown, true);
        window.removeEventListener('blur', blurred);
        shields.forEach(shield => shield.remove());
        shields.length = 0;
        element.remove();
        if (restoreFocus) {
            const anchor = options.anchor();
            const rect = anchor?.getBoundingClientRect();
            const focusTarget = anchor && rect && rect.right > 0 && rect.left < window.innerWidth
                && rect.bottom > 0 && rect.top < window.innerHeight ? anchor : options.fallbackFocus();
            if (!focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1;
            focusTarget.focus();
        }
        options.closed();
    };
    const blurred = (): void => close(false);
    const outside = (event: PointerEvent): void => {
        if ((event.target as Element)?.closest?.('[data-akari-transition-picker-shield]')) return;
        if ((event.target as Element)?.closest?.('[data-akari-library-transition]')) return;
        if (!element.contains(event.target as Node) && !options.anchor()?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            close();
        }
    };
    const reposition = (): void => {
        const anchor = options.anchor();
        if (!anchor || !anchor.isConnected) { close(); return; }
        const rect = anchor.getBoundingClientRect();
        if (rect.right <= 0 || rect.left >= window.innerWidth || rect.bottom <= 0 || rect.top >= window.innerHeight) {
            close(); return;
        }
        const signature = `${rect.left}:${rect.right}:${rect.top}:${rect.bottom}:${window.innerWidth}:${window.innerHeight}`;
        if (signature === lastRect) return;
        lastRect = signature;
        const layout = transitionPickerLayout(rect, window.innerWidth, window.innerHeight,
            options.blockedReason ? 112 : 270, options.blockedReason ? 360 : 520);
        element.style.left = `${layout.left}px`;
        element.style.top = `${layout.top}px`;
        element.style.width = `${layout.width}px`;
        element.style.height = `${layout.height}px`;
        arrow.style.left = `${layout.arrowLeft}px`;
        element.dataset.akariPickerColumns = window.innerWidth < 560 ? '3' : '5';
    };
    const syncShields = (): void => {
        const frames = Array.from(document.querySelectorAll('iframe, webview'))
            .map(visibleFrameRect).filter((rect): rect is PickerFrameRect => !!rect);
        const rects = transitionPickerShieldRects(frames, window.innerWidth, window.innerHeight);
        while (shields.length > rects.length) shields.pop()?.remove();
        for (let index = 0; index < rects.length; index++) {
            let shield = shields[index];
            if (!shield) {
                shield = document.createElement('div');
                shield.className = 'akari-transition-picker-shield';
                shield.dataset.akariTransitionPickerShield = 'true';
                shield.addEventListener('pointerdown', () => close());
                document.body.appendChild(shield);
                shields.push(shield);
            }
            const rect = rects[index];
            shield.style.left = `${rect.left}px`;
            shield.style.top = `${rect.top}px`;
            shield.style.width = `${rect.width}px`;
            shield.style.height = `${rect.height}px`;
        }
    };
    const follow = (): void => {
        if (closed) return;
        reposition();
        if (closed) return;
        syncShields();
        frame = requestAnimationFrame(follow);
    };
    const update = (): void => {
        body.replaceChildren();
        if (options.blockedReason) {
            const reason = document.createElement('p');
            reason.className = 'akari-transition-picker-reason';
            reason.textContent = options.blockedReason;
            body.appendChild(reason);
        } else {
            const heading = document.createElement('div');
            heading.className = 'akari-transition-picker-heading';
            heading.textContent = t('transition.picker.heading.choose');
            body.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'akari-transition-picker-grid';
            grid.dataset.akariTransitionPickerGrid = 'true';
            grid.tabIndex = -1;
            grid.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>('button'));
                if (cards.length === 0) return;
                const current = cards.indexOf(document.activeElement as HTMLButtonElement);
                const columns = Number(element.dataset.akariPickerColumns) || 5;
                const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1
                    : event.key === 'ArrowUp' ? -columns : columns;
                const next = current < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, current + step));
                event.preventDefault();
                cards[next].focus();
                cards[next].scrollIntoView({ block: 'nearest' });
            });
            const currentFamily = transitionFamilyOf(options.current()?.type)?.family;
            const focusFamily = initialTransitionPickerFocusFamily(currentFamily,
                TRANSITION_FAMILIES.map(definition => definition.family));
            let selected: HTMLButtonElement | undefined;
            for (const definition of TRANSITION_FAMILIES) {
                const type = rememberedTransitionType(definition, options.rememberedDirection(definition.family));
                if (!type) continue;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'akari-transition-picker-card';
                card.dataset.akariTransitionFamily = definition.family;
                card.dataset.akariTransitionType = type;
                const chosen = currentFamily === definition.family;
                card.dataset.akariSelected = String(chosen);
                if (focusFamily === definition.family) selected = card;
                const sample = document.createElement('span');
                sample.className = 'akari-transition-picker-sample';
                const preview = options.previews[type];
                if (preview?.preview) sample.style.backgroundImage = `url("${preview.preview}")`;
                const strip = document.createElement('span');
                strip.className = 'akari-transition-picker-strip';
                if (preview?.strip) strip.style.backgroundImage = `url("${preview.strip}")`;
                sample.appendChild(strip);
                const name = document.createElement('span');
                name.className = 'akari-transition-picker-name';
                name.textContent = t(transitionFamilyLabelKey(definition.family));
                card.append(sample, name);
                card.addEventListener('click', () => void options.apply(type).then(ok => { if (ok) close(); }));
                grid.appendChild(card);
            }
            body.appendChild(grid);
            const focusTarget = selected ?? grid;
            requestAnimationFrame(() => {
                if (!closed) {
                    focusTarget.focus();
                    if (selected) selected.scrollIntoView({ block: 'nearest' });
                }
            });
        }
        const footer = document.createElement('div');
        footer.className = 'akari-transition-picker-footer';
        if (options.current()) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'theia-button secondary';
            remove.dataset.akariTransitionPickerRemove = 'true';
            remove.textContent = t('transition.picker.action.remove');
            remove.addEventListener('click', () => void options.remove().then(ok => { if (ok) close(); }));
            footer.appendChild(remove);
            if (!options.blockedReason) {
                const reveal = document.createElement('button');
                reveal.type = 'button';
                reveal.className = 'theia-button secondary';
                reveal.dataset.akariTransitionPickerReveal = 'true';
                reveal.textContent = t('transition.picker.action.details');
                reveal.addEventListener('click', () => { close(); options.reveal(); });
                footer.appendChild(reveal);
            }
        } else {
            footer.textContent = t('transition.picker.hint.defaultDuration');
        }
        body.appendChild(footer);
    };
    update();
    document.body.appendChild(element);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', blurred);
    reposition();
    if (!closed) syncShields();
    frame = requestAnimationFrame(follow);
    if (options.blockedReason) element.focus();
    return { element, update, reposition, close };
}
