import { editStore } from './edit-store.mjs';
import { itemForKey } from './v2/model.mjs';
// 場所として挙げた素材があればそれ、無ければ編集の対象そのもの
export const placeOf = (d) => (d.place_item && d.place_item !== 'none' ? d.place_item : d.target);

export function rangeOfTarget(target, { edit, segments, captions = [] }) {
    if (!target || target === 'none') return null;
    const n=Number(target.match(/^cut_(\d+)$/)?.[1]);
    if(n) { const s=segments.find(s=>s.index+1===n);return s ? [s.at,s.end] : null; }
    const item=itemForKey(edit,target);
    if(item) { const start=editStore.absoluteAt(editStore.locate(edit,item.id))/edit.output.fps;return [start,start+item.duration/edit.output.fps]; }
    const c=captions.find(c=>`caption_${c.id.replaceAll('-','_')}`===target);return c ? [c.start,c.end] : null;
}
export const timeOfTarget = (target, where) => rangeOfTarget(target,where)?.[0] ?? null;

// 発話が要素を指したら、それを選択状態にする（壊さない操作なので移動と同じ扱い）
export function selectionOfTarget(target, edit = null) {
    if (edit && target?.startsWith('item_')) {
        const item = itemForKey(edit,target);
        return item ? `item:${item.id}` : null;
    }
    const m = target?.match(/^(item|cut|caption)_(.+)$/);
    if (!m) return null;
    return m[1] === 'cut' ? `cut:${m[2]}` : `${m[1]}:${m[2].replace(/_/g, '-')}`;
}
