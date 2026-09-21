import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
const [project, evidence] = process.argv.slice(2);
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const port = await new Promise(resolve => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const server = spawn(process.execPath, [path.join(repo,'packages/preview-server/src/server.mjs'),project,'--port',String(port),'--no-lint'], { stdio:'ignore', env: {...process.env, AKARI_HOME:'/tmp/cof-l1/home-web'} });
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i=0;i<180;i++) {
    try { if ((await fetch(url+'/api/summary')).ok) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto(url+'/?frameEngine=0',{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>{
    const seek=document.getElementById('seek');
    if(!seek || !(Number(seek.max)>0)) return false;
    seek.value='3';seek.dispatchEvent(new Event('input',{bubbles:true}));
    return document.querySelectorAll('.caption-row-plate').length===2;
  },null,{timeout:120000});
  const plates=await page.locator('.caption-row-plate').evaluateAll(rows=>rows.map(row=>({id:row.id,text:row.textContent.trim(),top:row.getBoundingClientRect().top})));
  await mkdir(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,'after-web.png')});
  await writeFile(path.join(evidence,'web-results.json'),JSON.stringify({time:3,plates,errors},null,2)+'\n');
  if(errors.length) throw new Error(errors.join('; '));
} finally { await browser?.close();server.kill('SIGTERM'); }
