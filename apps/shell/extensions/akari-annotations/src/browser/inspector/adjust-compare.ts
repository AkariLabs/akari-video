import type { LivePreviewTarget } from '../timeline-selection-model';

export interface AdjustCompareState { target: LivePreviewTarget; enabled: boolean; }

export function nextAdjustCompareState(
    current: AdjustCompareState | undefined,
    next: { target?: LivePreviewTarget; activeTab: string }
): { state: AdjustCompareState | undefined; release?: LivePreviewTarget } {
    const same = current && next.target && current.target.kind === next.target.kind
        && (current.target.kind === 'cut' && next.target.kind === 'cut'
            ? current.target.index === next.target.index
            : 'id' in current.target && 'id' in next.target && current.target.id === next.target.id);
    if (current && (!same || next.activeTab !== 'adjust')) {
        return { state: undefined, ...(current.enabled ? { release: current.target } : {}) };
    }
    return { state: current };
}
