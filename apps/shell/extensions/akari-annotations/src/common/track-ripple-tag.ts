import { resolveTrackRippleMode, setTrackRippleMode } from '@akari-video/edit-store';
import type { EditV2, RippleMode, TrackV2 } from '@akari-video/edit-store';

export type RippleTagKind = 'track' | 'caption';
export type RippleTagPresentation = {
    kind: 'tag' | 'follow'; mode?: RippleMode; label: string; icon: string;
    title: string; compact: boolean; placement: 'inline' | 'second'; disabled: boolean;
};

const LABELS: Record<RippleMode, { label: string; icon: string; detail: string }> = {
    cut: { label: '切る', icon: 'codicon-trash', detail: '範囲の中身を消して後ろを詰める' },
    shift: { label: 'ずらす', icon: 'codicon-arrow-left', detail: '中身を残して後ろを一緒に寄せる' },
    fixed: { label: '固定', icon: 'codicon-pin', detail: '中身も位置も変えない' }
};

export function rippleTagPresentation(mode: RippleMode, locked: boolean, kind: RippleTagKind, height: number): RippleTagPresentation {
    const compact = height < 40;
    const placement = compact ? 'inline' : 'second';
    if (kind === 'caption') return {
        kind: 'follow', label: '本編について動く', icon: 'codicon-type-hierarchy-sub', title: '本編について動く',
        compact, placement, disabled: true
    };
    const shown = locked ? 'fixed' : mode;
    const copy = LABELS[shown];
    return {
        kind: 'tag', mode: shown, label: copy.label, icon: copy.icon,
        title: `詰める操作でこのトラックは: ${copy.label} — ${copy.detail}${locked ? '（ロック中）' : ''}`,
        compact, placement, disabled: locked
    };
}

export function nextRippleMode(mode: RippleMode): RippleMode {
    return mode === 'cut' ? 'shift' : mode === 'shift' ? 'fixed' : 'cut';
}

export function cycleTrackRippleMode(edit: EditV2, trackId: string): EditV2 {
    const track = edit.tracks.find(candidate => candidate.id === trackId);
    if (!track) throw new Error(`トラックが見つかりません: ${trackId}`);
    return setTrackRippleMode(edit, trackId, nextRippleMode(resolveTrackRippleMode(track)));
}

export function setTrackRippleSwitch(edit: EditV2, trackId: string, field: 'target' | 'sync', value: boolean): EditV2 {
    const result = structuredClone(edit);
    const track = result.tracks.find(candidate => candidate.id === trackId);
    if (!track) throw new Error(`トラックが見つかりません: ${trackId}`);
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
    if (preset === 'selected-cut' && selectedTrackIds.length === 0) throw new Error('切るトラックがありません');
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
