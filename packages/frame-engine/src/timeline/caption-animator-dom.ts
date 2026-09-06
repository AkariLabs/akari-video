import { animatorParamsAt, captionAnimatorStateAt, normalizeAnimators } from './caption-animator.js';

export interface CaptionAnimatorDomDeclaration {
  /** Raw animator[] declarations (normalized declarations are also accepted). */
  animators: unknown;
  /** Item-relative integer frames, as accepted by animatorParamsAt. */
  keyframes?: unknown;
  cueLocalSeconds: number;
  cueDurationSec: number;
  fps: number;
  outputWidth: number;
  /** Cue start minus item start; keeps bag keyframes on the item's clock. */
  keyframeOffsetSeconds?: number;
  warn?: (code: string, message: string) => void;
}

const warnings = new WeakMap<Element, Set<string>>();
const opacityBases = new WeakMap<Element, { original: string; priority: string; written: string }>();
const fixed = (value: number): string => (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(6);

/**
 * Apply raw (or normalizeAnimators-resolved) declarations using inline styles only.
 * Empty declarations do not even touch style attributes. Original inline opacity
 * is retained separately; sampling it with the current CSS animation before each
 * write prevents repeated seeks from multiplying our own previous result.
 * Mixed bases compose on the finest selected descendants, not on both ancestors
 * and children: nested CSS transforms/opacity would use different algebra.
 * Hosts own cue visibility; cueDurationSec does not clamp the item keyframe clock.
 */
export function applyCaptionAnimatorDom(root: Element, declaration: CaptionAnimatorDomDeclaration): void {
  if (!Array.isArray(declaration.animators) || declaration.animators.length === 0) return;
  const warn = (code: string, message: string): void => {
    if (!declaration.warn) return;
    let codes = warnings.get(root);
    if (!codes) warnings.set(root, codes = new Set());
    if (codes.has(code)) return;
    codes.add(code);
    declaration.warn(code, message);
  };
  const animators = normalizeAnimators(declaration.animators, warn);
  if (animators.length === 0) return;
  const params = animatorParamsAt(animators, declaration.keyframes,
    declaration.cueLocalSeconds + (declaration.keyframeOffsetSeconds ?? 0), declaration.fps);
  const groups = [...new Set(animators.map(animator => animator.basis))].map(basis => {
    let selector = basis === 'chars' ? '.akari-caption__char'
      : basis === 'words' ? '.akari-caption__tok' : '.akari-caption__line';
    let units = Array.from(root.querySelectorAll(selector));
    if (basis === 'words' && units.length === 0) {
      selector = 'span.akari-caption__word, span[data-akari-word]';
      units = Array.from(root.querySelectorAll(selector));
    }
    if (basis === 'lines') {
      // Reveal groups usually contain real lines. Count a group only when it has
      // no line markup, so nested groups and lines are never counted twice.
      selector = '.akari-caption__line, .akari-caption__reveal-group';
      units = Array.from(root.querySelectorAll(selector))
        .filter(unit => unit.querySelectorAll('.akari-caption__line').length === 0);
    }
    if (units.length === 0) warn(`animator.missing-${basis}`, `caption has no ${basis} units; animator ignored`);
    const selected = animators.filter(animator => animator.basis === basis);
    return { selector, states: new Map(units.map((unit, index) =>
      [unit, captionAnimatorStateAt(selected, params, index, units.length, declaration.outputWidth)])) };
  });
  const candidates = new Set(groups.flatMap(group => [...group.states.keys()]));
  const ancestors = new Set<Element>();
  for (const unit of candidates) {
    for (let parent = unit.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (candidates.has(parent)) ancestors.add(parent);
    }
  }
  for (const unit of candidates) {
    if (ancestors.has(unit) || !('style' in unit)) continue;
    let x = 0, y = 0, scale = 1, rotate = 0, opacityDelta = 0, spacing = 0, blur = 0;
    for (const group of groups) {
      const member = unit.closest(group.selector);
      const state = member ? group.states.get(member) : undefined;
      if (!state) continue;
      x += state.translateX;
      y += state.translateY;
      scale *= state.scale;
      rotate += state.rotateDeg;
      opacityDelta += state.opacityDelta;
      spacing += state.letterSpacing;
      blur += state.blurPx;
    }
    const style = (unit as HTMLElement | SVGElement).style;
    let opacity = opacityBases.get(unit);
    if (!opacity || style.opacity !== opacity.written) {
      opacity = { original: style.opacity, priority: style.getPropertyPriority('opacity'), written: '' };
      opacityBases.set(unit, opacity);
    }
    if (opacity.original) style.setProperty('opacity', opacity.original, opacity.priority);
    else style.removeProperty('opacity');
    const value = Number.parseFloat(unit.ownerDocument?.defaultView?.getComputedStyle(unit).opacity ?? style.opacity);
    const baseOpacity = Number.isFinite(value) ? value : 1;
    // Character spans from the shared renderer have no display rule. Inline
    // spans are not transformable; make span units transformable without markup.
    if (unit.tagName.toLowerCase() === 'span') style.display = 'inline-block';
    // Important inline values also apply to units with an active CSS animation.
    style.setProperty('transform', `translate(${fixed(x)}px, ${fixed(y)}px) scale(${fixed(scale)}) rotate(${fixed(rotate)}deg)`, 'important');
    style.letterSpacing = `${fixed(spacing)}px`;
    style.filter = `blur(${fixed(Math.max(0, blur))}px)`;
    // Append opacity last when no original inline declaration existed. Restoring
    // the CSS base removes it, so this order also keeps serialized style stable.
    style.setProperty('opacity', fixed(baseOpacity * Math.max(0, Math.min(1, 1 + opacityDelta))), 'important');
    opacity.written = style.opacity;
  }
}
