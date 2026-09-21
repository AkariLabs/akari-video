import { applyRepeatedTimes } from './repeat.mjs';
import { targets } from '../ops/_helpers.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
import { clampNudgedTransform } from '../ops/_knobs.mjs';
import { textPosition } from '../ops/_helpers.mjs';
import { positionTransform } from '../ops/_knobs.mjs';
export const DIRECTIONS = {
    left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
    top_left: [-1, -1], top_right: [1, -1], bottom_left: [-1, 1], bottom_right: [1, 1],
};
export const NUDGE_RATIOS = [0.015, 0.03, 0.08];
export const DEFAULT_ITEM_BOX = [.2, .78, .6, .14];
