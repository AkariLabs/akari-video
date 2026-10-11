import { t } from '@akari-video/i18n';
import { resolveTrackRippleMode, setTrackRippleMode } from '@akari-video/edit-store';
import type { EditV2, RippleMode, TrackV2 } from '@akari-video/edit-store';

export type RippleTagKind = 'track' | 'caption';
export type RippleTagPresentation = {
    kind: 'tag' | 'follow'; mode?: RippleMode; label: string; icon: string;
    title: string; compact: boolean; placement: 'inline' | 'second'; disabled: boolean;
};

const LABELS: Record<RippleMode, { label: string; icon: string; detail: string }> = {
    cut: { label: t('annotationscommon.trackRippleTag.label.cut'), icon: 'codicon-fold', detail: t('annotationscommon.trackRippleTag.detail.removeContentsRangePackBack') },
    shift: { label: t('annotationscommon.trackRippleTag.label.shift'), icon: 'codicon-arrow-left', detail: t('annotationscommon.trackRippleTag.detail.keepContentShiftFollowingClips') },
    fixed: { label: t('annotationscommon.trackRippleTag.label.fixed'), icon: 'codicon-pin', detail: t('annotationscommon.trackRippleTag.detail.noChangePosition') }
};

export function rippleTagPresentation(mode: RippleMode, locked: boolean, kind: RippleTagKind, height: number): RippleTagPresentation {
    const compact = height < 40;
    const placement = compact ? 'inline' : 'second';
    if (kind === 'caption') return {
        kind: 'follow', label: t('annotationscommon.trackRippleTag.label.moveSection'), icon: 'codicon-type-hierarchy-sub', title: t('annotationscommon.trackRippleTag.label.moveSection'),
        compact, placement, disabled: true
    };
    const shown = locked ? 'fixed' : mode;
    const copy = LABELS[shown];
    return {
        kind: 'tag', mode: shown, label: copy.label, icon: copy.icon,
        title: t('annotationscommon.trackRippleTag.title.whenClosingGapsTrack', {
            label: copy.label, detail: copy.detail, locked: locked ? t('annotationscommon.trackRippleTag.hint.locking') : ''
        }),
        compact, placement, disabled: locked
    };
}

export function nextRippleMode(mode: RippleMode): RippleMode {
    return mode === 'cut' ? 'shift' : mode === 'shift' ? 'fixed' : 'cut';
}

export function cycleTrackRippleMode(edit: EditV2, trackId: string): EditV2 {
    const track = edit.tracks.find(candidate => candidate.id === trackId);
    if (!track) throw new Error(t('annotationscommon.trackRippleTag.error.trackNotFound', { trackId: String(trackId) }));
    return setTrackRippleMode(edit, trackId, nextRippleMode(resolveTrackRippleMode(track)));
}

export function setTrackRippleSwitch(edit: EditV2, trackId: string, field: 'target' | 'sync', value: boolean): EditV2 {
    const result = structuredClone(edit);
    const track = result.tracks.find(candidate => candidate.id === trackId);
    if (!track) throw new Error(t('annotationscommon.trackRippleTag.error.trackNotFound', { trackId: String(trackId) }));
    const current = rippleSwitchValues(track);
    track.target = current.target;
    track.sync = current.sync;
    track[field] = value;
    return result;
}

export type RipplePreset = 'defaults' | 'all-cut' | 'selected-cut';

export function isFollowingCaptionTrack(track: TrackV2): boolean {
    return 'content' in track || ('items' in track && track.items.length > 0
        && track.items.every(item => item.source.kind === 'captions'));
}

/** 1 回の履歴に載せるため、すべての変更をひとつの新しい edit にまとめる。 */
export function applyTrackRipplePreset(edit: EditV2, preset: RipplePreset, selectedTrackIds: readonly string[] = []): EditV2 {
    if (preset === 'selected-cut' && selectedTrackIds.length === 0) throw new Error(t('annotationscommon.trackRippleTag.error.noTracksForCut'));
    let result = structuredClone(edit);
    const selected = new Set(selectedTrackIds);
    for (const track of edit.tracks) {
        if (isFollowingCaptionTrack(track)) continue;
        if (preset === 'defaults') {
            const copy = result.tracks.find(candidate => candidate.id === track.id)!;
            delete copy.target;
            delete copy.sync;
        } else {
            result = setTrackRippleMode(result, track.id, preset === 'all-cut' || selected.has(track.id) ? 'cut' : 'fixed');
        }
    }
    return result;
}

export function rippleSwitchValues(track: TrackV2): { target: boolean; sync: boolean } {
    const mode = resolveTrackRippleMode(track);
    return { target: track.target ?? mode === 'cut', sync: track.sync ?? mode !== 'fixed' };
}
