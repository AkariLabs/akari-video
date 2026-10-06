#!/usr/bin/env node
// Observe the active output preview. Arguments: phase, project directory.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, screenshot } from '../../timeline-dnd-polish/scripts/cdp-lib.mjs';
import { view } from '../../timeline-dnd-polish/scripts/l1-common.mjs';

const [phase, project] = process.argv.slice(2);
if (!phase || !project) throw new Error('Usage: observe.mjs <phase> <project>');
const dir = path.resolve(import.meta.dirname, '..');
await mkdir(dir, { recursive: true });
const target = (await listTargets(9476)).find(item => item.type === 'page');
if (!target) throw new Error('Workbench target missing');
const main = new CDP(target.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
const preview = await view(9476);
const value = expression => preview.eval(expression);
const metrics = await value(`(()=>{const plate=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.textContent.includes('こんにちは'));
  const box=document.querySelector('#caption-select-box');
  const line=plate?.querySelector('.akari-caption__line');
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
  const ink=()=>{if(!line)return null;const range=document.createRange();range.selectNodeContents(line);return rect({getBoundingClientRect:()=>range.getBoundingClientRect()})};
  return{plate:rect(plate),line:rect(line),ink:ink(),box:rect(box),plateStyle:plate?.getAttribute('style'),
    background:line?{color:getComputedStyle(line).backgroundColor,padX:getComputedStyle(line).paddingLeft,
      padY:getComputedStyle(line).paddingTop,plateBg:plate.style.getPropertyValue('--plate-bg'),
      blockBg:plate.style.getPropertyValue('--plate-block-bg'),lineCount:plate.querySelectorAll('.akari-caption__line').length}:null,
    stroke:line?{width:getComputedStyle(line).webkitTextStrokeWidth,color:getComputedStyle(line).webkitTextStrokeColor,shadow:getComputedStyle(line).textShadow}:null,
    handles:[...document.querySelectorAll('#caption-select-box .akari-caption-handle')].map(e=>({kind:e.dataset.h,rect:rect(e)}))}})()`);
const inspector = await evalOn(main, `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
  return [...document.querySelectorAll('button')].filter(e=>e.closest('[class*=inspector]')&&(/位置|中央|左上|下中央/.test(e.textContent||'')||e.dataset.zone)).map(e=>({text:e.textContent.trim(),rect:rect(e),html:e.outerHTML.slice(0,300)})).slice(0,30)})()`);
const controls = await evalOn(main, `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
  return {zones:[...document.querySelectorAll('[data-akari-caption-zone]')].map(e=>({zone:e.dataset.akariCaptionZone,rect:rect(e),pressed:e.getAttribute('aria-pressed')})),
    position:[...document.querySelectorAll('[data-akari-field^="caption-position-"]')].map(e=>({field:e.dataset.akariField,range:e.querySelector('input[type=range]')?.value,number:e.querySelector('input[type=number]')?.value})),
    size:document.querySelector('[data-akari-caption-size]')?.value,
    backgroundEnabled:document.querySelector('[data-akari-field="caption-style-bg-enabled"] input[type=checkbox]')?.checked}})()`);
const captions = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
await screenshot(main, path.join(dir, `${phase}-workbench.png`));
await writeFile(path.join(dir, `results-${phase}.json`), JSON.stringify({metrics,inspector,controls,captions},null,2)+'\n');
main.close(); preview.cdp.close();
console.log(JSON.stringify({metrics,zone:controls.zones[0],position:controls.position}));
