import { TRANSITION_VOCABULARY, isTransitionType, type TransitionType } from '@akari-video/edit-store';
import type { InspectorWriteRequest, TimelineCutSelection } from '../timeline-selection-model';

export function transitionOptionLabel(id: string | undefined): string {
    return id === undefined ? 'なし' : TRANSITION_VOCABULARY.find(entry => entry.id === id)?.labelJa ?? id;
}

export function transitionTypeForLabel(label: string): TransitionType | null | undefined {
    return label === 'なし' ? null : TRANSITION_VOCABULARY.find(entry => entry.labelJa === label)?.id;
}

export function createCutTransitionWriteRequest(
    snapshot: Pick<TimelineCutSelection, 'index' | 'transitionOut' | 'transitionOutBlocked'>,
    row: 'transition-type' | 'transition-duration',
    input: string | number | null
): Extract<InspectorWriteRequest, { kind: 'cut-transition-out' }> {
    if (snapshot.transitionOutBlocked !== undefined) throw new Error(snapshot.transitionOutBlocked);
    const type = row === 'transition-type' ? transitionTypeForLabel(String(input)) : snapshot.transitionOut?.type;
    if (type === null) return { kind: 'cut-transition-out', index: snapshot.index, value: null };
    if (!isTransitionType(type)) {
        throw new Error('対応するトランジションを選んでください。');
    }
    const duration = row === 'transition-type'
        ? snapshot.transitionOut?.duration ?? 0.5 : input === null ? 0.5 : Number(input);
    if (!Number.isFinite(duration) || duration < 0.1 || duration > 3) {
        throw new Error('トランジション尺は 0.1〜3 秒の範囲で入力してください。');
    }
    return { kind: 'cut-transition-out', index: snapshot.index, value: { type, duration } };
}
