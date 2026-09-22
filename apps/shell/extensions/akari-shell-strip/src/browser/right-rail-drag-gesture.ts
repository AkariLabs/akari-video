/**
 * 押して少し動かしたらドラッグ、動かさずに離したらクリック、を見分ける小さな補助
 * （task 2026-09-22-right-rail-regroup）。レールのアイコン・右パネルの見出しで使う。
 */
export interface RightRailDragGestureOptions {
    /** 押した要素より先に受ける（Lumino の pointerdown より前に止めたいとき）。 */
    capture?: boolean;
    /** この押下を扱うか。 */
    accept?(event: PointerEvent): boolean;
    /** 押した瞬間（既定の処理を止めたいときに使う）。 */
    onPress?(event: PointerEvent): void;
    /** 動かさずに離した（座標は押した位置）。 */
    onClick?(x: number, y: number): void;
    /** しきい値を越えて動かした（x, y = いまの位置 / pressX, pressY = 押した位置）。 */
    onStart(x: number, y: number, pressX: number, pressY: number): void;
    threshold?: number;
}

export const RIGHT_RAIL_DRAG_THRESHOLD = 5;

const CAPTURE: AddEventListenerOptions = { capture: true };

export function trackDragGesture(node: HTMLElement, options: RightRailDragGestureOptions): () => void {
    const threshold = options.threshold ?? RIGHT_RAIL_DRAG_THRESHOLD;
    const nodeOptions: AddEventListenerOptions = { capture: options.capture === true };
    const onDown = (event: PointerEvent): void => {
        if (event.button !== 0 || (options.accept && !options.accept(event))) {
            return;
        }
        options.onPress?.(event);
        const pressX = event.clientX;
        const pressY = event.clientY;
        const cleanup = (): void => {
            window.removeEventListener('pointermove', onMove, CAPTURE);
            window.removeEventListener('pointerup', onUp, CAPTURE);
            window.removeEventListener('pointercancel', onCancel, CAPTURE);
        };
        const onMove = (move: PointerEvent): void => {
            if (Math.abs(move.clientX - pressX) >= threshold || Math.abs(move.clientY - pressY) >= threshold) {
                cleanup();
                options.onStart(move.clientX, move.clientY, pressX, pressY);
            }
        };
        const onUp = (): void => {
            cleanup();
            options.onClick?.(pressX, pressY);
        };
        const onCancel = (): void => cleanup();
        window.addEventListener('pointermove', onMove, CAPTURE);
        window.addEventListener('pointerup', onUp, CAPTURE);
        window.addEventListener('pointercancel', onCancel, CAPTURE);
    };
    node.addEventListener('pointerdown', onDown, nodeOptions);
    return () => node.removeEventListener('pointerdown', onDown, nodeOptions);
}
