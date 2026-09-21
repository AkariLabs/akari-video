import { videoTarget } from '../exec-support/look_fx_brightness_look.mjs';
export default { id: 'look_fx_brightness_fx', apply(env, d) {
        if (!videoTarget(env, d)) return;
        const reason = {
            glitch: '公開 main の fx index は空、adjust.fx と layerFilter に glitch の受け口がない',
            invert: 'filter source の invert は存在するが、対象 item だけに合成範囲を限定する配置は未確認。全画面反転には置換しない',
        }[d.w15_fx_kind] ?? '画面効果が未指定・未対応';
        env.log.push(`fx ${d.w15_fx_kind ?? '未指定'} → 未適用（${reason}）`);
    } };
