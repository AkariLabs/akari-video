// docs/contract-2026-08-11-review-session-ui-events.md #2: opt-in click registration. Elements
// mark themselves with data-akari-ui="<target-id>" (+ optional data-akari-ui-label); a click
// anywhere resolves to the nearest registered ancestor (or nothing, for unregistered DOM --
// "全 DOM 追跡はしない" is the point). Implemented by hand (parentNode walk) instead of
// Element.closest() so this stays a pure function testable without a real DOM (node:test has no
// document -- see review-session-recorder.test.mjs's window/AudioContext faking pattern).

export const UI_TARGET_ATTRIBUTE = 'data-akari-ui';
export const UI_TARGET_LABEL_ATTRIBUTE = 'data-akari-ui-label';

export interface ResolvedUiTarget {
    target: string;
    label: string;
}

export interface UiEventNode {
    getAttribute?(name: string): string | null;
    parentNode?: UiEventNode | null;
}

/**
 * Walks from `start` up through parentNode looking for the nearest element carrying
 * data-akari-ui. Returns undefined when no ancestor (including start itself) is registered.
 */
export function resolveUiEventTarget(start: UiEventNode | null | undefined): ResolvedUiTarget | undefined {
    let node = start ?? null;
    while (node) {
        if (typeof node.getAttribute === 'function') {
            const target = node.getAttribute(UI_TARGET_ATTRIBUTE);
            if (target) {
                const label = node.getAttribute(UI_TARGET_LABEL_ATTRIBUTE) ?? target;
                return { target, label };
            }
        }
        node = node.parentNode ?? null;
    }
    return undefined;
}

/** #1: panel:/tab: targets report as ui.panel/ui.tab (active-panel/active-tab change); everything
 * else (timeline:cut:*, timeline:overlay:*, asset:*, future prefixes) is a plain ui.click. */
export function classifyUiEventType(target: string): 'ui.click' | 'ui.tab' | 'ui.panel' {
    if (target.startsWith('panel:')) {
        return 'ui.panel';
    }
    if (target.startsWith('tab:')) {
        return 'ui.tab';
    }
    return 'ui.click';
}
