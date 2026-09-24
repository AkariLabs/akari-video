// プレビューと書き出しで同じ時刻を撮るための一覧（l1.mjs / export.mjs / compare.mjs が共有する）。
// 各字幕 3 秒・in / out 0.6 秒（既定）・loop 周期 1.6 秒（既定）。
//   in  = 登場の途中（+0.3 秒 = in の半分）
//   loop = ループの途中（+1.5 秒。in は終わり、out はまだ）
//   out = 退場の途中（終わり −0.3 秒 = out の半分）
// 時刻はすべて 1/30 秒の整数倍（書き出しのフレームと一致させる）。
import { ROWS, STEP, CUE_SECONDS } from './gen-fixture.mjs';

const at = (index, offset) => Math.round((index * STEP + offset) * 1000) / 1000;
export const PHASES = [['in', 0.3], ['loop', 1.5], ['out', CUE_SECONDS - 0.3]];
export const CAPTURES = ROWS.flatMap(([id, , anim, loop], index) => PHASES.map(([phase, offset]) => ({
    id, name: `${id}-${phase}`, phase, anim, loop, t: at(index, offset)
})));
