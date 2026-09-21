import { byId } from '../exec-support/insert_from_library_search.mjs';
import { candidateContext } from '../exec-support/candidates.mjs';
export default { id: 'insert_from_library_search', apply(env,d) {
        const selected = byId.get(d.w11_asset);
        if (!selected) { env.lastCandidates = candidateContext('library', []); env.log.push('insert_from_library_search → 候補 []（該当なし、または候補を一意に選べない）。ライブラリタブ表示 → 未適用（UI受け口なし）'); return; }
        const pool = (d.w11_candidates ?? [selected.id]).filter(id => byId.has(id));
        const ids = [selected.id,...pool.filter(id=>id!==selected.id)];
        env.lastCandidates = candidateContext('library', ids.map(id => byId.get(id)));
        env.log.push(`insert_from_library_search → 候補 ${JSON.stringify(ids)}。ライブラリタブ表示 → 未適用（UI受け口なし。候補列を次の ctx.libraryCandidates に渡す）`);
    } };
