import { videoTarget } from '../exec-support/look_fx_brightness_look.mjs';
import { applyAdjust } from '../exec-support/look_fx_brightness_look.mjs';
import { withoutColor } from '../exec-support/look_fx_brightness_look.mjs';
import { candidatesByChoice } from '../exec-support/look_fx_brightness_look.mjs';
import { catalogIssues } from '../exec-support/look_fx_brightness_look.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { publicRepo } from '../exec-support/look_fx_brightness_look.mjs';
import { colorSections } from '../exec-support/look_fx_brightness_look.mjs';
export default { id: 'look_fx_brightness_look', apply(env, d) {
        const item = videoTarget(env, d);
        if (!item) return;
        const choice = d.w15_look_preset;
        if (choice === 'reset') {
            applyAdjust(env, item, withoutColor(item.adjust), '色味 reset');
            return;
        }
        const row = candidatesByChoice.get(choice);
        if (!row) {
            env.log.push(`look ${choice ?? '未指定'} → 未適用（プリセット候補なし${catalogIssues.length ? ': ' + catalogIssues.join('／') : ''}）`);
            return;
        }
        if (row.directory === 'luts') {
            applyAdjust(env, item, { ...item.adjust, lut: { lut: row.id, intensity: 1 },
                sections: { ...item.adjust?.sections, lut: true } }, `LUT ${row.id}`);
            return;
        }
        try {
            const preset = JSON.parse(fs.readFileSync(path.join(publicRepo, 'presets', 'looks', `${row.id}.json`), 'utf8'));
            if (preset.id !== row.id || !preset.adjust || typeof preset.adjust !== 'object' || Array.isArray(preset.adjust)
                || Object.keys(preset.adjust).some(key => !colorSections.includes(key) && key !== 'sections')
                || Object.keys(preset.adjust.sections ?? {}).some(key => !colorSections.includes(key))) {
                throw new Error('色調整専用 adjust として確認できない');
            }
            const preserved = withoutColor(item.adjust);
            const adjust = { ...preserved, ...structuredClone(preset.adjust) };
            if (preserved.sections || preset.adjust.sections) adjust.sections = { ...preserved.sections, ...preset.adjust.sections };
            applyAdjust(env, item, adjust, `look ${row.id}`);
        } catch (error) {
            env.log.push(`look ${row.id} → 未適用（プリセット読込: ${error.code ?? error.message}）`);
        }
    } };
