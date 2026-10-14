import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import { HOST_OVERLAY_SELECTORS, shouldHide } from '../common/browser-host-guard';

export const BROWSER_HOST_GUARD_EVENT = 'akari.browser.hostGuard';
export const BROWSER_HOST_GUARD_QUERY_EVENT = 'akari.browser.hostGuardQuery';

@injectable()
export class BrowserHostGuardContribution implements FrontendApplicationContribution {
    private observer?: MutationObserver;
    private timer?: ReturnType<typeof setTimeout>;
    private hidden = false;
    private readonly answerQuery = (): void => {
        if (this.hidden) window.dispatchEvent(new CustomEvent(BROWSER_HOST_GUARD_EVENT, { detail: { hide: true } }));
    };

    onStart(): void {
        if (this.observer) return;
        this.observer = new MutationObserver(records => {
            const selector = HOST_OVERLAY_SELECTORS.join(',');
            const relevant = records.some(record => {
                if (record.type === 'attributes') {
                    const target = record.target;
                    return target instanceof Element && (target.matches(selector) || !!target.querySelector(selector));
                }
                return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node =>
                    node instanceof Element && (node.matches(selector) || !!node.querySelector(selector)));
            });
            if (relevant) this.schedule();
        });
        this.observer.observe(document.body, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style'] });
        window.addEventListener(BROWSER_HOST_GUARD_QUERY_EVENT, this.answerQuery);
        this.schedule();
    }

    onStop(): void {
        this.observer?.disconnect(); this.observer = undefined;
        window.removeEventListener(BROWSER_HOST_GUARD_QUERY_EVENT, this.answerQuery);
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private schedule(): void {
        if (this.timer !== undefined) return;
        this.timer = setTimeout(() => { this.timer = undefined; this.check(); }, 100);
    }

    private check(): void {
        const matches = HOST_OVERLAY_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector))
            .map(element => { const rect = element.getBoundingClientRect(); return { selector,
                display: getComputedStyle(element).display, rect: { w: rect.width, h: rect.height } }; }));
        const hide = shouldHide(matches);
        if (hide === this.hidden) return;
        this.hidden = hide;
        window.dispatchEvent(new CustomEvent(BROWSER_HOST_GUARD_EVENT, { detail: { hide } }));
    }
}
