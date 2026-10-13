import { transitionTypeOf, type TransitionDirection, type TransitionFamilyDefinition } from '@akari-video/edit-store';

export interface PickerAnchorRect { left: number; right: number; top: number; bottom: number }

export function transitionPickerLayout(
    anchor: PickerAnchorRect, viewportWidth: number, viewportHeight: number, desiredHeight: number, desiredWidth = 520
): { left: number; top: number; width: number; height: number; arrowLeft: number } {
    const margin = 8;
    const arrowGap = 9;
    const width = Math.max(0, Math.min(desiredWidth, viewportWidth - margin * 2));
    const center = (anchor.left + anchor.right) / 2;
    const left = Math.max(margin, Math.min(center - width / 2, viewportWidth - width - margin));
    const available = Math.max(0, Math.min(anchor.top, viewportHeight) - margin - arrowGap);
    const height = Math.min(desiredHeight, Math.max(180, available));
    const top = Math.max(margin, anchor.top - arrowGap - height);
    const arrowLeft = Math.max(9, Math.min(width - 9, center - left));
    return { left, top, width, height, arrowLeft };
}

export function rememberedTransitionType(
    definition: TransitionFamilyDefinition, remembered?: TransitionDirection
): ReturnType<typeof transitionTypeOf> {
    const direction = definition.directions.includes(remembered as TransitionDirection)
        ? remembered : definition.directions[0];
    return transitionTypeOf(definition.family, direction);
}
