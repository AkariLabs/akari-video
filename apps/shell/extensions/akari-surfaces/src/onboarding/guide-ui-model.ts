import { t } from '@akari-video/i18n';
import { AiAnswer, OnboardingStep } from './model';

export function guideShowsChat(step: OnboardingStep): boolean {
    return step.startsWith('tour') || ['prompt', 'work', 'play', 'caption'].includes(step);
}

/** Only steps targeting the chat raise and frame it. */
export function guideTargetsChat(step: OnboardingStep, sub: number): boolean {
    return (step === 'tour3' && sub === 0) || step === 'prompt' || step === 'work';
}

export function guideNeedsPartner(step: OnboardingStep): boolean {
    return step.startsWith('tour') || ['ask', 'prompt', 'work', 'play', 'caption'].includes(step);
}

export function guideRequiredPanels(targets: readonly string[]): Array<'left' | 'bottom'> {
    const panels: Array<'left' | 'bottom'> = [];
    if (targets.some(target => ['assets', 'sample-card', 'export-result'].includes(target))) panels.push('left');
    if (targets.includes('timeline')) panels.push('bottom');
    return panels;
}

export function askHighlightTarget(answer: AiAnswer | undefined): string {
    return ({ claude: 'partner-claude', chatgpt: 'partner-codex', google: 'partner-antigravity',
        none: 'partner', other: 'partner' } as Record<AiAnswer, string>)[answer ?? 'none'];
}

export function askConnectionCopy(answer: AiAnswer | undefined): string {
    return ({
        claude: t('surfaces.onboarding.askConnectionCopyClaudesProMaxConnectionClaudeCodeCli.message'),
        chatgpt: t('surfaces.onboarding.askConnectionCopyChatgptConnectionCodexCliHighlightedPartAlso.message'),
        google: t('surfaces.onboarding.googleConnectionInstruction.description'),
        none: t('surfaces.onboarding.askConnectionCopyEvenConnectedAiSeeFlowExample.message'),
        other: t('surfaces.onboarding.askConnectionCopyConnectAiLaterList.message')
    } as Record<AiAnswer, string>)[answer ?? 'none'];
}

/** A new entry always reveals the real panel, including a return to the same step. */
export function shouldRevealPartner(step: OnboardingStep, entrySerial: number, revealedSerial: number): boolean {
    return guideNeedsPartner(step) && entrySerial !== revealedSerial;
}

export interface GuideRect { x: number; y: number; width: number; height: number }

export interface GuideCoachHold<Element> { element: Element; basis: string; top: number }

/** A typed prompt may reuse its top only when the same coach and placement inputs remain. */
export function heldGuideCoachTop<Element>(hold: GuideCoachHold<Element> | undefined, element: Element,
    basis: string, step: OnboardingStep, sub: number): number | undefined {
    return step === 'prompt' && sub === 0 && hold?.element === element && hold.basis === basis ? hold.top : undefined;
}

/** Clamp the measured outer coach rectangle; reserve room below it for the guide chrome. */
export function guideCoachBounds(viewport: { width: number; height: number },
    coach: { width: number; height: number; actionsHeight?: number; actionsBottomInset?: number }, preferred: { x: number; y: number },
    previousTop?: number): { left: number; top: number; maxHeight: number; height: number;
        actionsHeight: number; actionsBottomInset: number } {
    const maxHeight = Math.max(0, viewport.height - 40);
    const height = Math.min(coach.height, maxHeight);
    const left = Math.max(8, Math.min(preferred.x, viewport.width - coach.width - 8));
    // Preserve the typing start position while the measured coach still fits in the viewport.
    const top = previousTop !== undefined && Number.isFinite(previousTop) && previousTop >= 8
        && previousTop + height <= viewport.height
        ? previousTop : Math.max(8, Math.min(preferred.y, viewport.height - height - 32));
    return { left, top, maxHeight, height,
        actionsHeight: coach.actionsHeight ?? 0, actionsBottomInset: coach.actionsBottomInset ?? 0 };
}

/** Compute the coach's preferred position from its anchor before clamping the measured rectangle. */
export function guideCoachPlacement(viewport: { width: number; height: number },
    coach: { width: number; height: number; actionsHeight?: number; actionsBottomInset?: number }, anchor: GuideRect | undefined,
    options: { minimal?: boolean; noDim?: boolean; place?: 'left' | 'right' | 'top' | 'bottom';
        step?: OnboardingStep; sub?: number; previousTop?: number; captionPosition?: { x: number; y: number } } = {}) {
    const { width, height } = coach;
    let x = anchor ? anchor.x + anchor.width + 14 : (viewport.width - width) / 2;
    let y = anchor ? anchor.y + (anchor.height - height) / 2 : (viewport.height - height) / 2;
    if (options.minimal) {
        x = (viewport.width - width) / 2;
        y = viewport.height * (options.noDim ? .66 : .42) - height / 2;
    } else if (options.place === 'left') x = (anchor?.x ?? viewport.width / 2) - width - 14;
    else if (options.place === 'top') {
        x = (anchor?.x ?? viewport.width / 2) + ((anchor?.width ?? 0) - width) / 2;
        y = (anchor?.y ?? viewport.height / 2) - height - 14;
    } else if (options.place === 'bottom') {
        x = (anchor?.x ?? viewport.width / 2) + ((anchor?.width ?? 0) - width) / 2;
        y = (anchor ? anchor.y + anchor.height : viewport.height / 2) + 14;
    }
    if (x + width > viewport.width - 12 && anchor) x = anchor.x - width - 14;
    if (x < 8 && anchor && !options.minimal) x = anchor.x + anchor.width + 14;
    if (options.step === 'work') { x = 20; y = viewport.height * .53; }
    if (options.step === 'drag') { x = (anchor ? anchor.x + anchor.width : 240) + 14; y = viewport.height - height - 24; }
    if (options.step === 'daihon' && (options.sub ?? 0) > 0) { x = 12; y = 66; }
    if (options.step === 'caption' && (options.sub ?? 0) > 0 && options.captionPosition) ({ x, y } = options.captionPosition);
    return guideCoachBounds(viewport, coach, { x, y }, options.previousTop);
}

/** The play control shifts horizontally in a narrow preview, so frame the full transport row. */
export function materialPreviewTransportRect(frame: GuideRect): GuideRect {
    const height = Math.min(42, frame.height); // 34px controls and 8px seek/spacing above them.
    return { x: frame.x, y: frame.y + frame.height - height, width: frame.width, height };
}

/** The webview is cross-origin. Cover one or two caption lines in its 16:9 video area. */
export function outputCaptionBandRect(frame: GuideRect): GuideRect {
    const inset = Math.min(16, frame.width * .03);
    const availableWidth = Math.max(0, frame.width - inset * 2);
    const availableHeight = Math.max(0, frame.height - 58);
    const videoWidth = Math.min(availableWidth, availableHeight * 16 / 9);
    const videoHeight = videoWidth * 9 / 16;
    const videoX = frame.x + (frame.width - videoWidth) / 2;
    const videoY = frame.y + (availableHeight - videoHeight) / 2;
    return { x: videoX + videoWidth * .15, y: videoY + videoHeight * .62,
        width: videoWidth * .7, height: videoHeight * .34 };
}

/** Keep the caption coach clear of the style bar, open popover and subtitle band. */
export function captionCoachPosition(viewport: { width: number; height: number },
    coach: { width: number; height: number }, output: GuideRect, obstacles: readonly GuideRect[]): { x: number; y: number } {
    const maxX = Math.max(8, viewport.width - coach.width - 8);
    const maxY = Math.max(8, viewport.height - coach.height - 32);
    const clampY = (value: number): number => Math.max(8, Math.min(value, maxY));
    const centerY = clampY(output.y + Math.min(72, output.height * .2));
    const candidates = [
        { x: output.x + output.width + 14, y: centerY },
        { x: maxX, y: centerY },
        { x: output.x - coach.width - 14, y: centerY },
        { x: maxX, y: 8 },
        { x: maxX, y: maxY },
        { x: Math.max(8, Math.min(output.x, maxX)), y: clampY(output.y + output.height + 14) },
        { x: Math.max(8, Math.min(output.x, maxX)), y: clampY(output.y - coach.height - 14) }
    ];
    const overlap = (at: { x: number; y: number }, rect: GuideRect): number =>
        Math.max(0, Math.min(at.x + coach.width, rect.x + rect.width) - Math.max(at.x, rect.x))
        * Math.max(0, Math.min(at.y + coach.height, rect.y + rect.height) - Math.max(at.y, rect.y));
    return candidates.map((candidate, index) => ({ candidate, score:
        (candidate.x < 8 || candidate.x > maxX ? 1e9 : 0)
        + obstacles.reduce((sum, rect) => sum + overlap(candidate, rect), 0) * 100
        + overlap(candidate, output) * .01 + index * .1
    })).sort((left, right) => left.score - right.score)[0].candidate;
}

export function needsCaptionStyleSelection(step: OnboardingStep, sub: number, colorControlVisible: boolean): boolean {
    return step === 'caption' && sub === 1 && !colorControlVisible;
}

/** Exactly the coach's holes, clear openings and rings receive input. */
export function guideInputCutouts(holes: GuideRect[], clear: GuideRect[], rings: GuideRect[]): GuideRect[] {
    return [...holes, ...clear, ...rings].filter(rect => rect.width > 0 && rect.height > 0);
}

export function pointInGuideCutouts(x: number, y: number, cutouts: GuideRect[]): boolean {
    return cutouts.some(rect => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
}

/** Partition the viewport at every cutout edge, then merge blocked cells across each row. */
export function guideBlockedRects(width: number, height: number, cutouts: GuideRect[]): GuideRect[] {
    const clipped = cutouts.map(rect => ({
        left: Math.max(0, Math.min(width, rect.x)),
        top: Math.max(0, Math.min(height, rect.y)),
        right: Math.max(0, Math.min(width, rect.x + rect.width)),
        bottom: Math.max(0, Math.min(height, rect.y + rect.height))
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
    const xs = [...new Set([0, width, ...clipped.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b);
    const ys = [...new Set([0, height, ...clipped.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b);
    const blocked: GuideRect[] = [];
    for (let row = 0; row < ys.length - 1; row++) {
        let start: number | undefined;
        for (let column = 0; column < xs.length - 1; column++) {
            const centerX = (xs[column] + xs[column + 1]) / 2;
            const centerY = (ys[row] + ys[row + 1]) / 2;
            const open = clipped.some(rect => centerX >= rect.left && centerX <= rect.right
                && centerY >= rect.top && centerY <= rect.bottom);
            if (!open && start === undefined) start = xs[column];
            if (open && start !== undefined) {
                blocked.push({ x: start, y: ys[row], width: xs[column] - start, height: ys[row + 1] - ys[row] });
                start = undefined;
            }
        }
        if (start !== undefined) blocked.push({ x: start, y: ys[row], width: width - start, height: ys[row + 1] - ys[row] });
    }
    return blocked.filter(rect => rect.width > 0 && rect.height > 0);
}

export function guideBlockerClipPath(width: number, height: number, cutouts: GuideRect[]): string {
    const rectangle = (x: number, y: number, w: number, h: number): string =>
        `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    const blocked = guideBlockedRects(width, height, cutouts);
    if (!blocked.length) return 'inset(100%)';
    return `path("${blocked.map(rect => rectangle(rect.x, rect.y, rect.width, rect.height)).join('')}")`;
}

/** Synthetic clicks from assistStep have no pointer coordinates and must reach their target. */
export function shouldBlockGuidePointer(isTrusted: boolean, x: number, y: number, cutouts: GuideRect[]): boolean {
    return isTrusted && !pointInGuideCutouts(x, y, cutouts);
}

export function partnerFallbackReady(attempts: number, lastAttemptAt: number, now: number): boolean {
    return attempts >= 4 && now - lastAttemptAt >= 700;
}
