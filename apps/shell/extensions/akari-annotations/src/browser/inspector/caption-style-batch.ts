import { updateCaptionTextStyleInSource } from '@akari-video/edit-store';
import type { CaptionTextStylePatch } from '../../common/caption-store';

export function applyCaptionStyleBatch(source: string,
    styles: ReadonlyArray<{ id: string; style: CaptionTextStylePatch }>): string {
    return styles.reduce((current, entry) => updateCaptionTextStyleInSource(current, entry.id, entry.style), source);
}

export async function commitCaptionStyleBatch(
    styles: ReadonlyArray<{ id: string; style: CaptionTextStylePatch }>,
    source: string | undefined,
    read: () => Promise<string>,
    write: (nextSource: string) => Promise<unknown>
): Promise<void> {
    await write(applyCaptionStyleBatch(source ?? await read(), styles));
}
