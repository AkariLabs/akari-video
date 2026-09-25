export interface MotionItem {
  at?: number;
  duration?: number;
  fps?: number;
  keyframeUnit?: 'frames' | 'seconds';
  transform?: { x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; rotate?: number };
  opacity?: number;
  keyframes?: readonly { t: number; transform?: MotionItem['transform']; opacity?: number; easing?: unknown }[];
  motion?: { in?: { preset: string; duration: number; ease?: string; amount?: number };
    out?: { preset: string; duration: number; ease?: string; amount?: number };
    loop?: { preset: string; period: number; ease?: string; amount?: number } };
}
export interface EvaluatedMotion { x: number; y: number; scale: number; scaleX: number; scaleY: number;
  rotate: number; opacity: number; reveal?: { x: number; y: number; w: number; h: number } }
export function evaluateItemMotion(item: MotionItem, t: number, parentChain?: readonly MotionItem[]): EvaluatedMotion;
export function evaluateOverlayMotion(record: MotionItem & { start?: number; motionSource?: MotionItem;
  motionParents?: readonly MotionItem[] }, t: number, fps: number): EvaluatedMotion;
export function motionRevealCss(state: EvaluatedMotion): string;
export function invertItemMotionPosition(item: MotionItem, t: number, parentChain: readonly MotionItem[], finalX: number, finalY: number): { x: number; y: number };
export function dragItemMotionPosition(item: MotionItem, t: number, parentChain: readonly MotionItem[],
  visibleStart: { x: number; y: number }, dx: number, dy: number): {
  visible: { x: number; y: number }; base: { x: number; y: number } };
declare const itemMotion: { evaluateItemMotion: typeof evaluateItemMotion;
  evaluateOverlayMotion: typeof evaluateOverlayMotion;
  motionRevealCss: typeof motionRevealCss;
  invertItemMotionPosition: typeof invertItemMotionPosition;
  dragItemMotionPosition: typeof dragItemMotionPosition };
export default itemMotion;
