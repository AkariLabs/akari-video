// Snapshot of the left panel (segment + first card keys) and the inspector (tab labels, section headers, swap row), for "selection alone changes nothing".
import { writeFileSync } from 'node:fs';
import { connectMain, evalMain } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const snap = await evalMain(cdp, `(() => {
  const left = document.getElementById('akari-role-buckets-widget');
  const seg = [...(left?.querySelectorAll('button') || [])].filter(b => /^(プロジェクト|ライブラリ)$/.test(b.textContent.trim())).map(b => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' || b.className.includes('active') || getComputedStyle(b).borderColor !== 'rgba(0, 0, 0, 0)' ? '*' : ''));
  const leftText = left ? left.innerText.slice(0, 400) : null;
  const insp = document.getElementById('akari-inspector-widget');
  const rows = insp ? [...insp.querySelectorAll('[data-akari-material-swap]')].length : 0;
  const tabs = insp ? [...insp.querySelectorAll('button,[role=tab]')].map(b => b.textContent.trim()).filter(t => /^(動画|調整|音声|情報|テキスト|画像|映像)$/.test(t)) : [];
  const text = insp ? insp.innerText : '';
  return { swapShelf: !!document.querySelector('[data-akari-swap-shelf]'), leftText, inspectorTabs: tabs, inspectorSwapRows: rows, inspectorLines: text.split('\\n').filter(Boolean).length, inspectorText: text.slice(0, 600) };
})()`, 30000);
writeFileSync(process.argv[2], JSON.stringify(snap, null, 1)); console.log(JSON.stringify({ swapShelf: snap.swapShelf, inspectorTabs: snap.inspectorTabs, inspectorSwapRows: snap.inspectorSwapRows, inspectorLines: snap.inspectorLines, leftHead: snap.leftText?.slice(0, 80) })); process.exit(0);
