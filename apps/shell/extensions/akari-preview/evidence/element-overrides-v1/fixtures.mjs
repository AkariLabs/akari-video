import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeRgbaPng } from '../../../../../../packages/osr-export/src/png.mjs';

export const CASES = ['bars-base', 'bars', 'card-base', 'card', 'bag-base', 'bag', 'bag-child', 'bag-lazy', 'paths-base', 'paths', 'missing', 'legacy'];
export const FRAMES = [15];
const background = '<div class="bg"></div>';
const bgCss = '.bg{position:absolute;inset:0;background:#fff}';
const barCss = `<style>${bgCss}.chart{position:absolute;left:80px;bottom:25px;display:flex;gap:25px;align-items:flex-end;font:20px/25px Arial}.col{width:75px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}.val{height:25px;line-height:25px;color:#111}.bar{width:60px;background:#22a780}</style>`;
const bars = `${barCss}${background}<div class="chart">${[70,90,100,120,80].map((height, i) => `<div class="col"><span class="val">${height}</span><div class="bar" style="height:${height}px"></div></div>`).join('')}</div>`;
const card = `<style>${bgCss}.card{position:absolute;left:150px;top:100px;width:320px;padding:20px;border:3px solid #333;font:22px/28px Arial}.heading{margin:0;width:250px;height:50px;background:#22a780;color:#fff;font-size:32px;line-height:50px}.body{margin:0;padding-top:20px;font-size:22px;line-height:28px}</style>${background}<div class="card"><h1 class="heading">TITLE</h1><p class="body">Body stays here</p></div>`;
const bag = `<style>${bgCss}[data-akari-part-mask] .bg{display:none}.part{position:absolute;top:50px;width:100px;height:80px;background:#ddd}.a{left:50px}.b{left:250px}.free{position:absolute;left:50px;top:180px;width:100px;height:50px;background:#22a780}</style>${background}<div class="part a" data-akari-part="A"></div><div class="part b" data-akari-part="B"></div><div class="free"></div>`;
const paths = `<style>${bgCss}.tile{position:absolute;left:70px;top:80px;width:120px;height:90px;background-image:url(./y.png);background-size:cover}.photo{position:absolute;left:220px;top:80px;width:100px;height:100px}</style>${background}<div class="tile"></div><img class="photo" src="./x.png">`;
const element = (address, style) => ({ [address]: { style } });

function document(caseName) {
  const source = { kind: 'html', path: 'fragment.html' };
  if (caseName === 'bars') source.elements = element('.bar[2]', { height: '260px', 'box-sizing': 'border-box', flex: '0 0 auto' });
  if (caseName === 'card') source.elements = element('.heading[0]', { translate: '40px -20px', rotate: '8deg' });
  if (caseName === 'paths') source.elements = element('.tile[0]', { width: '160px' });
  if (caseName === 'missing') source.elements = {
    '.nope[0]': { style: { width: '200px' } }, '.bar[99]': { style: { height: '250px' } },
  };
  if (['bag', 'bag-child', 'bag-lazy'].includes(caseName)) {
    source.elements = element('.free[0]', { width: '180px' });
  }
  const item = { id: 'leaf', at: 0, duration: 60, source };
  if (caseName.startsWith('bag')) {
    item.id = 'bag';
    if (caseName !== 'bag-lazy') item.items = [{ id: 'bag.A', at: 0, duration: 60,
      source: { kind: 'html', path: 'fragment.html', part: 'A',
        ...(caseName === 'bag-child' ? { elements: element('.free[0]', { width: '220px' }) } : {}) } }];
  }
  return { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'visual', lane: 'visual', items: [item] }] };
}

export async function createFixtures(root) {
  const pathsByCase = {};
  for (const name of CASES) {
    const folder = join(root, name);
    await mkdir(folder, { recursive: true });
    const markup = name.startsWith('bars') || name === 'missing' || name === 'legacy' ? bars
      : name.startsWith('card') ? card : name.startsWith('bag') ? bag : paths;
    await writeFile(join(folder, 'fragment.html'), markup);
    await writeFile(join(folder, 'edit.json'), JSON.stringify(document(name), null, 2) + '\n');
    if (name.startsWith('paths')) {
      for (const [file, rgb] of [['x.png', [220, 30, 50]], ['y.png', [30, 70, 220]]]) {
        const pixels = Buffer.alloc(16 * 16 * 4);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
        await writeFile(join(folder, file), encodeRgbaPng(pixels, 16, 16));
      }
    }
    pathsByCase[name] = folder;
  }
  return pathsByCase;
}
