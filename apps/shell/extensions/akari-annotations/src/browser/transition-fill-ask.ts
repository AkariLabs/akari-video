import { t } from '@akari-video/i18n';
import { anchorVisibleInClips, transitionAskLayout } from '../common/transition-picker-layout';
import { transitionPickerShieldRects } from '../common/transition-picker-shield';
import { visibleFrameRect } from './transition-picker';
import { transitionAskKey } from '../common/transition-ask-key';

export interface TransitionFillAsk {
    result: Promise<boolean>;
    close: () => void;
}

export function createTransitionFillAsk(options: {
    anchor: () => HTMLElement | undefined;
    body: string;
    action: 'attach' | 'fill';
    captionConflict: boolean;
}): TransitionFillAsk {
    const element = document.createElement('div');
    element.className = 'akari-transition-fill-ask';
    element.setAttribute('role', 'alertdialog');
    const id = `akari-transition-fill-ask-${Math.random().toString(36).slice(2)}`;
    element.setAttribute('aria-labelledby', `${id}-title`);
    element.setAttribute('aria-describedby', `${id}-body`);
    const title = document.createElement('strong');
    title.id = `${id}-title`;
    title.textContent = t('transition.fill.ask.title');
    const body = document.createElement('p');
    body.id = `${id}-body`;
    body.textContent = options.body;
    const actions = document.createElement('div');
    actions.className = 'akari-transition-fill-ask-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'theia-button secondary';
    cancel.dataset.akariTransitionFillAsk = 'cancel';
    cancel.textContent = t('transition.fill.action.cancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'theia-button';
    confirm.dataset.akariTransitionFillAsk = 'confirm';
    confirm.textContent = t(`transition.fill.action.${options.action}`);
    actions.append(cancel, confirm);
    const arrow = document.createElement('span');
    arrow.className = 'akari-transition-picker-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    element.append(title, body);
    if (options.captionConflict) {
        const note = document.createElement('p');
        note.textContent = t('transition.fill.notice.captionConflict');
        element.append(note);
    }
    element.append(actions, arrow);
    let done = false;
    let frame = 0;
    const shields: HTMLDivElement[] = [];
    let resolveResult!: (confirmed: boolean) => void;
    const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
    const close = (confirmed = false): void => {
        if (done) return;
        done = true;
        cancelAnimationFrame(frame);
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('keydown', keydown, true);
        window.removeEventListener('blur', blurred);
        shields.forEach(shield => shield.remove());
        element.remove();
        options.anchor()?.focus({ preventScroll: true });
        resolveResult(confirmed);
    };
    const outside = (event: PointerEvent): void => {
        if (!element.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent): void => {
        const action = transitionAskKey(event.key);
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        if (action === 'cancel') close();
        else if (action === 'cycle') (document.activeElement === confirm ? cancel : confirm).focus();
        else if (action === 'press') (document.activeElement === cancel ? cancel : confirm).click();
    };
    const blurred = (): void => close();
    const follow = (): void => {
        if (done) return;
        const anchor = options.anchor();
        if (!anchor?.isConnected) { close(); return; }
        const rect = anchor.getBoundingClientRect();
        const clips = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
        for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
                const bounds = parent.getBoundingClientRect();
                clips.push({ left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom });
            }
        }
        if (!anchorVisibleInClips(rect, clips)) { close(); return; }
        const layout = transitionAskLayout(rect, window.innerWidth, window.innerHeight, element.offsetHeight);
        element.style.left = `${layout.left}px`;
        element.style.top = `${layout.top}px`;
        element.style.width = `${layout.width}px`;
        arrow.style.left = `${layout.arrowLeft}px`;
        const frames = Array.from(document.querySelectorAll('iframe, webview')).map(visibleFrameRect)
            .filter((entry): entry is NonNullable<typeof entry> => !!entry);
        const rects = transitionPickerShieldRects(frames, window.innerWidth, window.innerHeight);
        while (shields.length > rects.length) shields.pop()?.remove();
        for (let index = 0; index < rects.length; index++) {
            let shield = shields[index];
            if (!shield) {
                shield = document.createElement('div');
                shield.className = 'akari-transition-picker-shield';
                shield.dataset.akariTransitionPickerShield = 'true';
                shield.addEventListener('pointerdown', () => close());
                document.body.append(shield);
                shields.push(shield);
            }
            const value = rects[index];
            Object.assign(shield.style, { left: `${value.left}px`, top: `${value.top}px`,
                width: `${value.width}px`, height: `${value.height}px` });
        }
        frame = requestAnimationFrame(follow);
    };
    cancel.addEventListener('click', () => close());
    confirm.addEventListener('click', () => close(true));
    document.body.append(element);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', blurred);
    follow();
    confirm.focus({ preventScroll: true });
    return { result, close: () => close() };
}
