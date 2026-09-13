import { scheduleCaptionFragments } from '@akari-video/edit-store';

export interface DaihonActiveFragment {
    index: number;
    from: number;
    to: number;
}

/** 再生時刻を表示断片と、その本文上の半開区間へ写像する。 */
export function activeDaihonFragment(
    text: string,
    fragments: readonly string[] | undefined,
    start: number | null,
    end: number | null,
    time: number,
    minimumSeconds: number
): DaihonActiveFragment | null {
    if (start === null || end === null || !fragments || fragments.length < 2
        || fragments.join('') !== text || time < start || time >= end) return null;
    const scheduled = scheduleCaptionFragments(start, end, [...fragments], minimumSeconds);
    const index = scheduled.findIndex(fragment => fragment.start <= time && time < fragment.end);
    if (index < 0) return null;
    const from = fragments.slice(0, index).reduce((sum, fragment) => sum + fragment.length, 0);
    return { index, from, to: from + fragments[index].length };
}
