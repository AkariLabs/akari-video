import { catalog } from '../exec-support/skill_dispatch.mjs';
export default { id: 'skill_dispatch', apply(env, d) {
        const reason = catalog.error ?? (!catalog.skills.has(d.skill_name) ? 'skill_name が選択肢にない' : null);
        if (reason) { env.log.push(`skill_dispatch → 未適用（${reason}）`); return; }
        const text = d.skill_dispatch_text ?? d.text;
        if (typeof text !== 'string' || !text.trim()) {
            env.log.push('skill_dispatch → 未適用（発話テキストが無い）'); return;
        }
        env.log.push(`skill_dispatch 起動票: ${JSON.stringify({ skill_name: d.skill_name, target: d.target ?? 'none', text })}`);
        // Logging only. applyDecision validates the unchanged source with readEditV2.
    } };
