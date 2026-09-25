export interface MotionDrawFinishState {
    pointerId: number | null;
    claimed: boolean;
}

export interface MotionDrawFinishEvent {
    type: 'pointerup' | 'lostpointercapture' | 'pointermove' | 'mousemove' | 'mouseup';
    pointerId?: number;
    buttons?: number;
    button?: number;
}

/** Decide and claim a single finish without changing the input state. */
export function motionDrawFinishTransition(
    state: MotionDrawFinishState, event: MotionDrawFinishEvent
): { finish: boolean; state: MotionDrawFinishState } {
    if (state.pointerId === null || state.claimed) return { finish: false, state };
    const samePointer = event.pointerId === state.pointerId;
    const leftReleased = typeof event.buttons === 'number' && (event.buttons & 1) === 0;
    const finish = event.type === 'pointerup' || event.type === 'lostpointercapture'
        ? samePointer
        : event.type === 'pointermove' ? samePointer && leftReleased
            : event.type === 'mousemove' ? leftReleased
                : event.type === 'mouseup' ? leftReleased || (event.buttons === undefined && event.button === 0)
                    : false;
    return finish ? { finish: true, state: { pointerId: state.pointerId, claimed: true } }
        : { finish: false, state };
}
