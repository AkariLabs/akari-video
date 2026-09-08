/** DOM に依存せず、主ボタンの外側 mousedown / click の対だけを受け付ける。 */
export function dialogOutsideClick(
    armed: boolean, phase: 'mousedown' | 'click', target: unknown, overlay: unknown, button: number
): { armed: boolean; close: boolean } {
    const outside = target === overlay && button === 0;
    return phase === 'mousedown'
        ? { armed: outside, close: false }
        : { armed: false, close: armed && outside };
}
