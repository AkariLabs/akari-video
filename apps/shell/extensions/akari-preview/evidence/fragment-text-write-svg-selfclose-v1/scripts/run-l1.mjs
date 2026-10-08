#!/usr/bin/env node
// 同梱サンプルの HTML 断片 9 本で「文字をダブルクリック → 1 文字足す → Enter」を実機（シェル）で行い、
// 保存できたか・出たメッセージ・webview が送った html と元ファイルのタグの並びの最初の違いを記録する。
// before = 記録だけ / after = 文字を持つ断片が全部保存でき、断片ファイルの差分が足した 1 文字の 1 行だけ
//（ミラー層 data-mirror="text" を持つ断片は、同じ 1 文字が入ったミラー層の行も）であることを検査する。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { compareTags } from './tag-ruler.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = process.env.AKARI_REPO_DIR ? path.resolve(process.env.AKARI_REPO_DIR) : path.resolve(here, '../../../../../../..');
const { CDP, evalOn, realClick, keyPress } = await import(pathToFileURL(path.join(repo,
  'apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs')).href);

const [, , portArg, workspaceArg, outArg, modeArg, startupArg] = process.argv;
const mode = modeArg ?? 'after';
if (!workspaceArg || !outArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <out> <before|after> [--startup-failed]');
}
const port = Number(portArg);
const project = path.join(path.resolve(workspaceArg), 'project');
const out = path.resolve(outArg);
const variant = process.env.AKARI_FTW_VARIANT ?? 'plain';
const logPath = path.join(out, `run-log-${mode}-${variant}.json`);
const ONLY = (process.env.AKARI_FTW_ONLY ?? '').split(',').map(value => value.trim()).filter(Boolean);
const INSERTED = 'Q';
const STRUCTURE_ITEM = 'demo-title';
const REFUSAL = '断片の構造が変わったため、元ソースの文字だけを安全に保存できません';
const records = [];
const connections = [];
// 記録に残すパスはリポジトリからの相対（node_modules/electron/… = worktree の Electron = tier 2）
const relativeToRepo = value => value ? path.relative(repo, path.resolve(value)) : null;
const log = { mode, variant, startedAt: new Date().toISOString(), status: 'FAIL',
  shell_dir: relativeToRepo(process.env.AKARI_SHELL_DIR), electron: relativeToRepo(process.env.ELECTRON_BIN), records };
let main, preview, previewContext;
const save = async () => writeFile(logPath, JSON.stringify(log, null, 2) + '\n');
const waitFor = async (label, action, timeout = 60000) => {
  const until = Date.now() + timeout;
  let error;
  while (Date.now() < until) {
    try { const value = await action(); if (value) return value; }
    catch (caught) { error = caught; }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}${error ? ': ' + error.message : ''}`);
};
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`,
  { signal: AbortSignal.timeout(5000) })).json());
const connect = async target => {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.push(cdp);
  await cdp.connect();
  return cdp;
};
const withTimeout = (promise, label, ms = 20000) => Promise.race([promise,
  sleep(ms, undefined, { ref: false }).then(() => { throw new Error(`CDP timeout: ${label}`); })]);
const me = (expression, ms) => withTimeout(evalOn(main, expression), 'main evaluate', ms);
const pe = (expression, ms) => withTimeout(evalOn(preview, expression, previewContext), 'preview evaluate', ms);
const command = (id, argument) => me(`(async () => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
  if(!key)throw new Error('CommandRegistry unavailable');
  await c.get(key).executeCommand(${JSON.stringify(id)},${JSON.stringify(argument)});
  return true;
})()`, 120000);
const attachedTargets = new Map();
const attach = async root => {
  const uri = pathToFileURL(path.join(root, 'edit.json')).href;
  await command('akari.annotations.open', { editUri: uri });
  await command('akari.preview.ensureVisible', { editUri: uri });
  await waitFor(`preview ${uri}`, async () => {
    for (const target of (await targets()).filter(value => value.type === 'iframe')) {
      if (!attachedTargets.has(target.id)) {
        const cdp = await connect(target);
        const contexts = new Map();
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
        attachedTargets.set(target.id, { cdp, contexts });
      }
      const { cdp, contexts } = attachedTargets.get(target.id);
      for (const context of contexts.values()) {
        try {
          const ready = await withTimeout(evalOn(cdp, `Boolean(window.akari?.state?.editPath===${JSON.stringify(uri)}
            && document.getElementById('overlay-stage') && window.akari?.engine?.overlayWrite)`, context.id), 'preview probe', 5000);
          if (ready) { preview = cdp; previewContext = context.id; return true; }
        } catch { /* another frame context */ }
      }
    }
    return false;
  }, 600000);
  return uri;
};
const seek = async seconds => {
  await pe(`(() => { const e=document.getElementById('seek'); if(!e) throw new Error('seek input unavailable');
    e.value=${JSON.stringify(String(seconds))}; e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await sleep(900);
};
// webview が実際にホストへ送る書き込みを記録する（ページ側の engine.overlayWrite を包むだけ。製品コードは変えない）。
const installWriteRecorder = () => pe(`(() => {
  const engine=window.akari.engine;
  if(!engine.__ftwRecorder){
    const original=engine.overlayWrite;
    window.__ftwWrites=[];
    engine.overlayWrite=(editPath,overlayId,patch)=>{
      const record={overlayId,keys:Object.keys(patch??{}),html:typeof patch?.html==='string'?patch.html:null,
        params:patch?.params??null,text:patch?.text??null,state:'pending',message:null};
      window.__ftwWrites.push(record);
      const promise=original(editPath,overlayId,patch);
      promise.then(()=>{record.state='ok';},error=>{record.state='error';record.message=String(error?.message??error);});
      return promise;
    };
    engine.__ftwRecorder=true;
  }
  return window.__ftwWrites.length;
})()`);
const writes = () => pe(`(window.__ftwWrites??[]).map(w=>({...w}))`);
const banner = () => pe(`(() => { const b=document.getElementById('write-error-banner');
  return b&&!b.hidden?(document.getElementById('write-error-message')?.textContent??''):''; })()`);
const dismissBanner = () => pe(`(() => { document.getElementById('write-error-dismiss')?.click(); return true; })()`);
const probe = id => pe(`(() => {
  const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .find(element=>element.dataset.overlayId===${JSON.stringify(id)});
  if(!container)return {mounted:false};
  const root=[...container.children].find(element=>!element.hasAttribute('data-akari-interaction'));
  if(!root)return {mounted:true,root:false};
  const stage=document.getElementById('overlay-stage').getBoundingClientRect();
  const SKIP=new Set(['STYLE','SCRIPT','TEMPLATE','NOSCRIPT','TEXTAREA','INPUT']);
  const candidates=[];
  [root,...root.querySelectorAll('*')].forEach((element,index)=>{
    const direct=[...element.childNodes].some(node=>node.nodeType===3&&node.nodeValue.trim());
    if(!direct||SKIP.has(element.tagName.toUpperCase()))return;
    const r=element.getBoundingClientRect();
    let opacity=1,hidden=false;
    for(let node=element;node&&node!==container.parentElement;node=node.parentElement){
      const style=getComputedStyle(node); opacity*=Number(style.opacity);
      if(style.visibility==='hidden'||style.display==='none')hidden=true;
    }
    const cx=r.left+r.width/2,cy=r.top+r.height/2;
    candidates.push({index,tag:element.tagName,html:element instanceof HTMLElement,className:element.getAttribute('class'),
      text:(element.textContent??'').slice(0,60),
      slot:element.closest('[data-akari-slot]')?.getAttribute('data-akari-slot')??null,
      mirror:element.closest('[data-mirror]')?.getAttribute('data-mirror')??null,
      rect:{left:r.left,top:r.top,width:r.width,height:r.height,cx,cy},opacity,hidden,
      visible:!hidden&&opacity>0.5&&r.width>2&&r.height>1&&cx>stage.left&&cx<stage.right&&cy>stage.top&&cy<stage.bottom});
  });
  return {mounted:true,root:true,rootTag:root.tagName,rootClass:root.getAttribute('class'),
    elements:root.querySelectorAll('*').length,svg:root.querySelectorAll('svg').length,candidates};
})()`);
const editing = id => pe(`(() => {
  const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
    .find(element=>element.dataset.overlayId===${JSON.stringify(id)});
  const active=document.activeElement;
  return {editable:active?.isContentEditable===true,inContainer:Boolean(container&&active&&container.contains(active)),
    tag:active?.tagName??null,className:active?.getAttribute?.('class')??null,text:(active?.textContent??'').slice(0,120),
    slot:active?.closest?.('[data-akari-slot]')?.getAttribute('data-akari-slot')??null};
})()`);
const hitAt = (x, y) => pe(`(() => {
  const element=document.elementFromPoint(${JSON.stringify(x)},${JSON.stringify(y)});
  const overlay=element?.closest?.('#overlay-stage > [data-overlay-id]');
  return {tag:element?.tagName??null,className:element?.getAttribute?.('class')??null,id:element?.id??null,
    overlayId:overlay?.dataset?.overlayId??null,interaction:element?.closest?.('[data-akari-interaction]')?.getAttribute('data-akari-interaction')??null};
})()`);
const breadcrumb = () => pe(`(nav=>nav&&!nav.hidden?nav.textContent.replace(/\\s+/g,' ').trim():'')(document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]'))`);
const press = async (key, code) => {
  await keyPress(preview, { key, code: key, windowsVirtualKeyCode: code });
  await sleep(250);
};
const clip = (value, length = 200) => typeof value === 'string' && value.length > length ? value.slice(0, length) + '…' : value;

async function editOnce(item, fps, kind, tamper = false) {
  const file = path.join(project, item.source.path);
  const original = await readFile(file, 'utf8');
  const editBefore = await readFile(path.join(project, 'edit.json'), 'utf8');
  const entry = { kind, sourceLength: original.length };
  const fractions = [0.6, 0.8, 0.45, 0.9, 0.3, 0.97];
  let counted = null, opened = null, chosen = null, sawWanted = false;
  const attempts = [];
  await installWriteRecorder();
  const writesBefore = (await writes()).length;
  for (const fraction of fractions) {
    const seconds = Math.round((item.at + item.duration * fraction)) / fps;
    await seek(seconds);
    const state = await probe(item.id);
    if (!state.mounted || !state.root) { entry.mount = state; continue; }
    counted = { textElements: state.candidates.length, htmlTextElements: state.candidates.filter(c => c.html).length,
      slotTextElements: state.candidates.filter(c => c.slot !== null).length,
      mirrorTextElements: state.candidates.filter(c => c.mirror !== null).length,
      svgTextElements: state.candidates.filter(c => !c.html).length, elements: state.elements, svg: state.svg };
    const wanted = state.candidates.filter(c => c.html && c.mirror === null && (kind === 'slot' ? c.slot !== null : c.slot === null));
    if (!wanted.length) break;
    sawWanted = true;
    const visible = wanted.filter(c => c.visible);
    if (!visible.length) {
      entry.hiddenAt = { seconds, candidates: wanted.slice(0, 4).map(c => ({ tag: c.tag, className: c.className,
        text: clip(c.text, 30), opacity: c.opacity, hidden: c.hidden, rect: c.rect })) };
      continue;
    }
    for (const candidate of visible.slice(0, 4)) {
      if (attempts.length >= 8) break;
      await dismissBanner();
      const hit = await hitAt(candidate.rect.cx, candidate.rect.cy);
      await realClick(preview, candidate.rect.cx, candidate.rect.cy, { clickCount: 2 });
      await sleep(600);
      const now = await editing(item.id);
      if (now.editable && now.inContainer) { opened = now; chosen = { seconds, candidate }; break; }
      attempts.push({ seconds, tag: candidate.tag, className: candidate.className, text: clip(candidate.text, 30),
        rect: candidate.rect, hit, hitAfter: await hitAt(candidate.rect.cx, candidate.rect.cy),
        active: { tag: now.tag, className: now.className }, breadcrumb: await breadcrumb() });
      await press('Escape', 27); await press('Escape', 27); await press('Escape', 27);
    }
    if (opened || attempts.length >= 8) break;
  }
  Object.assign(entry, counted ?? {});
  if (attempts.length) entry.failedAttempts = attempts;
  if (!chosen) {
    entry.result = !sawWanted ? 'no-target' : attempts.length ? 'edit-did-not-open' : 'not-visible';
    return entry;
  }
  entry.seekSeconds = chosen.seconds;
  entry.target = { tag: chosen.candidate.tag, className: chosen.candidate.className, text: chosen.candidate.text,
    slot: chosen.candidate.slot, rect: chosen.candidate.rect };
  entry.opened = opened;
  await preview.send('Input.insertText', { text: INSERTED });
  await sleep(200);
  entry.typed = (await editing(item.id)).text;
  if (tamper) {
    // 本当の構造変化: 確定の直前に、断片の中の最初の SVG へ要素を 1 つ足す
    entry.tampered = await pe(`(() => {
      const container=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
        .find(element=>element.dataset.overlayId===${JSON.stringify(item.id)});
      const svg=container?.querySelector('svg');
      if(!svg)return false;
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg','circle'));
      return true;
    })()`);
  }
  await press('Enter', 13);
  let write = null;
  try {
    write = await waitFor('write settles', async () => {
      const all = await writes();
      const mine = all.slice(writesBefore).find(candidate => candidate.overlayId === item.id);
      return mine && mine.state !== 'pending' ? mine : null;
    }, 20000);
  } catch (error) { entry.writeTimeout = String(error.message); }
  await sleep(1200);
  entry.banner = await banner();
  const current = await readFile(file, 'utf8');
  const editAfter = await readFile(path.join(project, 'edit.json'), 'utf8');
  entry.fragmentChanged = current !== original;
  entry.editJsonChanged = editAfter !== editBefore;
  if (write) {
    entry.route = write.keys;
    entry.writeState = write.state;
    entry.message = write.message;
    if (write.html !== null) {
      const dumpName = `${mode}-${variant}-${item.id}.sent.html`;
      await writeFile(path.join(out, dumpName), write.html);
      entry.sent = { file: dumpName, length: write.html.length };
      entry.tagCompare = compareTags(original, write.html);
    }
    if (write.params !== null) entry.params = write.params;
    if (item.source.elements && write.html !== null) {
      // 上書きの inline style はプレビューの DOM（= 送られた html）にだけあり、断片ファイルへは入らない
      const declarations = Object.values(item.source.elements)
        .flatMap(override => Object.entries(override.style ?? {}).map(([name, value]) => `${name}: ${value}`));
      entry.overrideInSentHtml = declarations.every(declaration => write.html.includes(declaration));
      entry.overrideInFragmentFile = declarations.some(declaration => current.includes(declaration));
    }
  }
  if (entry.fragmentChanged) {
    // 行ごとに比べる。変わった行はどれも「元の行に足した 1 文字が入っただけ」であること。
    // 編集した行のほかに変わってよいのは、同じ文字を写すミラー層（data-mirror="text"）の行だけ。
    const before = original.split('\n'), after = current.split('\n');
    const sameLineCount = before.length === after.length;
    const changed = sameLineCount ? before.map((line, index) => index).filter(index => before[index] !== after[index]) : [];
    const insertedOnly = index => {
      for (let at = 0; at < after[index].length; at++) {
        if (after[index][at] === INSERTED && after[index].slice(0, at) + after[index].slice(at + 1) === before[index]) return true;
      }
      return false;
    };
    const mirror = changed.filter(index => before[index].includes('data-mirror="text"'));
    entry.fragmentDiff = { sameLineCount, changedLines: changed.length, mirrorLines: mirror.length,
      editedLines: changed.length - mirror.length,
      onlyInsertedCharacter: sameLineCount && changed.length > 0 && changed.every(insertedOnly),
      lines: changed.map(index => ({ line: index + 1, removed: clip(before[index]), added: clip(after[index]) })) };
  }
  entry.result = !write ? 'no-write' : write.state === 'ok' ? 'saved' : 'refused';
  await press('Escape', 27); await press('Escape', 27);
  await dismissBanner();
  return entry;
}

async function run() {
  const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  const fps = edit.output.fps;
  const items = edit.tracks.flatMap(track => track.items ?? []).filter(item => item.source?.kind === 'html')
    .filter(item => !ONLY.length || ONLY.includes(item.id))
    // elements = 要素の上書き（source.elements）を持つアイテムだけを対象にする
    .filter(item => variant !== 'elements' || item.source.elements).sort((a, b) => a.source.path.localeCompare(b.source.path));
  log.fps = fps;
  for (const item of items) {
    const record = { id: item.id, path: item.source.path, at: item.at, duration: item.duration,
      elements: item.source.elements ?? null, status: 'ng' };
    records.push(record);
    try {
      record.text = await editOnce(item, fps, 'text');
      if ((record.text.slotTextElements ?? 0) > 0) record.slot = await editOnce(item, fps, 'slot');
      const primary = record.text;
      if (mode === 'before') record.status = 'recorded';
      else if (primary.result === 'no-target') record.status = 'ok';
      else {
        const diff = primary.fragmentDiff;
        const good = primary.result === 'saved' && primary.route?.includes('html') && primary.banner === ''
          && diff && diff.editedLines === 1 && diff.mirrorLines <= (primary.mirrorTextElements ?? 0)
          && diff.onlyInsertedCharacter === true;
        record.status = good ? 'ok' : 'ng';
      }
      if (item.source.elements) {
        const now = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
        const same = now.tracks.flatMap(track => track.items ?? []).find(candidate => candidate.id === item.id);
        record.elementsAfter = same?.source?.elements ?? null;
        record.elementsPreserved = JSON.stringify(record.elementsAfter) === JSON.stringify(item.source.elements);
        if (mode === 'after' && !(record.elementsPreserved && record.text.overrideInSentHtml === true
          && record.text.overrideInFragmentFile === false)) record.status = 'ng';
      }
    } catch (error) { record.error = String(error?.stack ?? error); }
    await save();
  }
  // 文字のほかに構造も変わった編集は、修正後も拒否される（メッセージに最初の違いが出て、断片は書き換わらない）。
  // 足した要素はプレビューの DOM に残るので、全部の断片を終えたあと最後に行う。
  const structureItem = items.find(item => item.id === STRUCTURE_ITEM);
  if (variant === 'plain' && structureItem) {
    try {
      const entry = await editOnce(structureItem, fps, 'text', true);
      const refusedWithDetail = entry.tampered === true && entry.result === 'refused' && entry.fragmentChanged === false
        && (entry.message ?? '').startsWith(REFUSAL) && entry.banner === entry.message;
      log.structureChange = { id: structureItem.id, ...entry,
        status: mode === 'before' ? 'recorded' : refusedWithDetail && entry.message.includes('最初の違い') ? 'ok' : 'ng' };
    } catch (error) { log.structureChange = { id: structureItem.id, status: 'ng', error: String(error?.stack ?? error) }; }
    await save();
  }
  return items.length;
}

await mkdir(out, { recursive: true });
await save();
let expected = 0;
try {
  if (startupArg === '--startup-failed') throw new Error('Electron shell did not reach ready state');
  const target = await waitFor('Theia page target', async () => {
    const list = await targets();
    return list.find(value => value.type === 'page' && /localhost/u.test(value.url))
      ?? list.find(value => value.type === 'page');
  }, 600000);
  main = await connect(target);
  await main.send('Page.enable'); await main.send('Runtime.enable');
  await waitFor('Theia frontend', () => me('Boolean(window.theia?.container)'), 600000);
  await attach(project);
  expected = await run();
} catch (error) { log.fatalError = String(error?.stack ?? error); }
finally {
  log.finishedAt = new Date().toISOString();
  const refused = records.filter(record => record.text?.result === 'refused').length;
  const saved = records.filter(record => record.text?.result === 'saved').length;
  const noTarget = records.filter(record => record.text?.result === 'no-target').length;
  log.summary = { fragments: records.length, saved, refused, noTarget,
    other: records.length - saved - refused - noTarget,
    refusalMessageCount: records.filter(record => (record.text?.message ?? '').startsWith(REFUSAL)).length };
  log.status = log.fatalError || !expected || records.length !== expected ? 'FAIL'
    : mode === 'before' ? (records.every(record => record.status === 'recorded') ? 'RECORDED' : 'FAIL')
      : records.every(record => record.status === 'ok')
        && (!log.structureChange || log.structureChange.status === 'ok') ? 'PASS' : 'FAIL';
  await save();
  for (const connection of connections) { try { connection.close(); } catch { /* disposed */ } }
}
console.log(`${mode}/${variant}: ${log.status} ${JSON.stringify(log.summary)} ${logPath}`);
process.exitCode = log.status === 'FAIL' ? 1 : 0;
