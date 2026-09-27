// 検証専用（ラッパー作成）: run.mjs の <label>.json を切り分け表の 1 行ずつに畳む。
// 使い方: node summarize.mjs <label>.json [--json]
import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
const rows = [];
const px = v => (v == null ? null : Number.parseFloat(v));
const center = m => (m?.line && m?.stage ? +((m.line.rect.l - m.stage.l + m.line.rect.w / 2) / m.stage.w).toFixed(3) : null);
for (const [key, v] of Object.entries(report.results ?? {})) {
  if (v.error) { rows.push({ key, error: v.error.slice(0, 300) }); continue; }
  const s = v.selected;
  const corners = s.handles.filter(h => ['nw', 'ne', 'sw', 'se'].includes(h.h));
  const edges = s.handles.filter(h => h.h === 'e' || h.h === 'w');
  const row = {
    key, boxH: s.selectBox?.h ?? null, lines0: s.lineCount,
    // (1) つまみ
    edgeHandles: edges.map(h => `${h.h}:${h.visible ? 'vis' : 'hidden'}:${h.hit}:${h.rect.w}x${h.rect.h}:bar=${(h.afterSize ?? []).join('x')}`).join(' ') || 'なし',
    cornersCovered: corners.filter(h => h.hit !== 'self').map(h => `${h.h}<${h.hit}`).join(' ') || '0',
    drag: v.drag ? {
      written: v.drag.written, wrap: v.drag.after?.wrap_width_pct ?? null,
      plateWidth: `${s.plate?.width} → ${v.drag.measure?.plate?.width}`, lines: `${s.lineCount} → ${v.drag.measure?.lineCount}`,
      liveWrapLeft: v.drag.written ? null : v.drag.measure?.plate?.wrapVar || null,
      pointer: v.dragPointer?.join(' '), bodyAfter: v.dragBodyClasses?.join(' '),
      releaseLost: v.dragReleaseLost ? { retryWritten: v.dragReleaseLost.retryWritten, host: v.dragReleaseLost.hostPointer?.join(' ') } : null,
    } : 'つまみ無し',
    undo: v.undo ? { changed: v.undo.changed, restored: v.undo.restored, lines: v.undo.measure?.lineCount } : null,
    // (2) 折り返し幅の欄
    wrapField: {
      written: v.wrapField?.written, wrap: v.wrapField?.after?.wrap_width_pct ?? null,
      plateWidth: `${v.wrapField?.pre?.plate?.width} → ${v.wrapField?.post?.plate?.width}`,
      lines: `${v.wrapField?.pre?.lineCount} → ${v.wrapField?.post?.lineCount}`,
      inkWidth: `${v.wrapField?.pre?.inkWidth} → ${v.wrapField?.post?.inkWidth}`,
      // 行の中心の横位置（ステージの幅に対する割合）。折り返し幅を付けても揃えが変わらないかを見る
      lineCenterX: `${center(v.wrapField?.pre)} → ${center(v.wrapField?.post)}`,
    },
    // (3) 字間
    lsNumber: {
      written: v.lsNumber?.written, em: v.lsNumber?.after?.letter_spacing_em ?? null,
      letterSpacing: `${v.lsNumber?.pre?.line?.letterSpacing} → ${v.lsNumber?.post?.line?.letterSpacing}`,
      inkWidth: `${v.lsNumber?.pre?.inkWidth} → ${v.lsNumber?.post?.inkWidth}`,
    },
    lsSlider: v.lsSlider?.error ? v.lsSlider.error : {
      written: v.lsSlider?.written, em: v.lsSlider?.after?.letter_spacing_em ?? null,
      letterSpacing: `${v.lsSlider?.pre?.line?.letterSpacing} → ${v.lsSlider?.post?.line?.letterSpacing}`,
    },
    spacingPopup: v.spacing ? {
      written: v.spacing.written, em: v.spacing.after?.letter_spacing_em ?? null,
      letterSpacing: `${v.spacing.pre?.line?.letterSpacing} → ${v.spacing.post?.line?.letterSpacing}`,
      inkWidth: `${v.spacing.pre?.inkWidth} → ${v.spacing.post?.inkWidth}`,
    } : (typeof v.spacingPopup === 'string' ? v.spacingPopup : 'ポップアップに文字間隔なし'),
  };
  // 効いたかの判定（数値の変化）
  row.ok = {
    edgeVisible: edges.length === 2 && edges.every(h => h.visible && h.hit === 'self'),
    cornersFree: corners.every(h => h.hit === 'self'),
    dragWrites: !!v.drag?.written && typeof v.drag?.after?.wrap_width_pct === 'number',
    dragChangesWidth: !!v.drag && px(v.drag.measure?.plate?.width) !== px(s.plate?.width),
    undoOnce: !!v.undo?.restored,
    wrapFieldChangesWidth: !!v.wrapField && px(v.wrapField.post?.plate?.width) !== px(v.wrapField.pre?.plate?.width),
    lsNumberWrites: !!v.lsNumber?.written && v.lsNumber?.after?.letter_spacing_em === 0.3,
    lsNumberApplies: !!v.lsNumber && v.lsNumber.post?.line?.letterSpacing !== v.lsNumber.pre?.line?.letterSpacing,
    lsSliderApplies: !!v.lsSlider?.written && v.lsSlider.post?.line?.letterSpacing !== v.lsSlider.pre?.line?.letterSpacing,
    spacingPopupApplies: !!v.spacing?.written && v.spacing.post?.line?.letterSpacing !== v.spacing.pre?.line?.letterSpacing,
  };
  rows.push(row);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) {
  console.log(`== ${r.key}${r.error ? ' ERROR ' + r.error : ''}`);
  if (r.error) continue;
  console.log(`  ok: ${Object.entries(r.ok).map(([k, b]) => `${k}=${b ? 'Y' : 'N'}`).join(' ')}`);
  console.log(`  boxH=${r.boxH} lines=${r.lines0} edge=[${r.edgeHandles}] cornersCovered=[${r.cornersCovered}]`);
  console.log(`  drag=${JSON.stringify(r.drag)} undo=${JSON.stringify(r.undo)}`);
  console.log(`  wrapField=${JSON.stringify(r.wrapField)}`);
  console.log(`  lsNumber=${JSON.stringify(r.lsNumber)} lsSlider=${JSON.stringify(r.lsSlider)}`);
  console.log(`  spacingPopup=${JSON.stringify(r.spacingPopup)}`);
}
if (!process.argv.includes('--json')) console.log('console:', JSON.stringify((report.console ?? []).slice(-20), null, 1));
