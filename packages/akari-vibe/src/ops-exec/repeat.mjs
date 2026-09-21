import { applyRepeatedTimes } from '../exec-support/repeat.mjs';
export default { id: 'repeat', apply(env, d) {
        if (applyRepeatedTimes(env, d)) return;
        // Live shell owns history/repeat; preserve the batch no-op.
    } };
