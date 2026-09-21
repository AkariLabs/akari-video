import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
export const properties = ['transform.x', 'transform.y', 'transform.scale', 'transform.rotate', 'opacity', 'crop', 'perspective'];
export const valueAt = (point, property) => property.startsWith('transform.')
    ? point.transform?.[property.slice(10)] : point[property];
export const directions = { left: ['x', -1], right: ['x', 1], up: ['y', -1], down: ['y', 1] };
