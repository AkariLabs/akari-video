import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labPublicRepo } from './resources-root.mjs';
const require = createRequire(import.meta.url);
const labRepo = labPublicRepo();
const library = [
    process.env.AKARI_EDIT_STORE_LIB,
    fileURLToPath(new URL('../../edit-store/lib/index.js', import.meta.url)),
    process.env.AKARI_PUBLIC_REPO && path.join(process.env.AKARI_PUBLIC_REPO, 'packages/edit-store/lib/index.js'),
    labRepo && path.join(labRepo, 'packages/edit-store/lib/index.js'),
].find(file => file && fs.existsSync(file));
if (!library) throw new Error('edit-store が見つかりません（AKARI_EDIT_STORE_LIB または AKARI_PUBLIC_REPO を設定してください）');
export const editStore = require(library);
export const declaredIntentByContext = new WeakMap();
export const geometryTargetByEdit = new WeakMap();
export const declaredKnobIntentFor = (context, target) => declaredIntentByContext.get(context)?.get(target) ?? null;
export const geometryTargetFor = edit => geometryTargetByEdit.get(edit) ?? null;

export const keyOf = (id) => id.replace('#', '__').replace(/[:\-]/g, '_'); // item:bag#part-id → item_bag__part_id

export function cutIndexAt(segments, T) {
    const hit = segments.find((s) => T >= s.at && T < s.end);
    return hit ? hit.index : segments.length - 1;
}
