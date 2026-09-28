import URI from '@theia/core/lib/common/uri';
import { isTimelineEditFileName, timelineCaptionsFileName, timelineSlugFromEditFileName } from '../common/timeline-files';

const activeTimelineKey = Symbol.for('akari.activeTimelineEditUri');
const activeTimelineListenersKey = Symbol.for('akari.activeTimelineEditUri.listeners');
type ActiveTimelineListener = (uri: URI | undefined) => void;
const activeTimelineState = globalThis as unknown as Record<symbol, unknown>;

function activeTimelineListeners(): Set<ActiveTimelineListener> {
    const existing = activeTimelineState[activeTimelineListenersKey];
    if (existing instanceof Set) return existing as Set<ActiveTimelineListener>;
    const listeners = new Set<ActiveTimelineListener>();
    activeTimelineState[activeTimelineListenersKey] = listeners;
    return listeners;
}

export function editUriForVisibleTimeline(widget: { isVisible: boolean; timelineLocation?: { editUri?: URI } }): URI | undefined {
    return widget.isVisible ? widget.timelineLocation?.editUri : undefined;
}

/** The timeline selected in the editor tabs. A missing selection uses the legacy file. */
export function setActiveTimelineEditUri(uri: URI | undefined): void {
    const previous = activeTimelineState[activeTimelineKey] as URI | undefined;
    if (previous?.toString() === uri?.toString()) return;
    activeTimelineState[activeTimelineKey] = uri;
    for (const listener of [...activeTimelineListeners()]) listener(uri);
}

export function onActiveTimelineEditUriChange(listener: ActiveTimelineListener): { dispose(): void } {
    const listeners = activeTimelineListeners();
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
}

export function currentTimelineEditUri(root: URI): URI {
    const selected = activeTimelineState[activeTimelineKey] as URI | undefined;
    return selected && isTimelineEditFileName(selected.path.base) && root.isEqualOrParent(selected)
        ? selected : root.resolve('edit.json');
}

export function currentTimelineCaptionsUri(root: URI): URI {
    const edit = currentTimelineEditUri(root);
    return edit.parent.resolve(timelineCaptionsFileName(timelineSlugFromEditFileName(edit.path.base)));
}
