import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function sampleWav(period = 20) {
  const sampleRate = 8000, samples = sampleRate * 3;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.sin(i * Math.PI / period) * 12000, 44 + i * 2);
  return data;
}

export async function startFixtureSite(catalogRoot) {
  const wav = sampleWav(), subscriptionWav = sampleWav(17), requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/sound.wav' || path === '/subscription/sound.wav') {
      response.writeHead(200, { 'content-type': 'audio/wav',
        ...(request.headers['sec-fetch-dest'] === 'document' || request.url.includes('download=1')
          ? { 'content-disposition': 'attachment; filename="sound.wav"' } : {}) });
      response.end(path.startsWith('/subscription/') ? subscriptionWav : wav); return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (path === '/item' || path === '/subscription/item') {
      const prefix = path.startsWith('/subscription/') ? '/subscription' : '';
      response.end(`<!doctype html><html><title>個別ページ</title><h1>個別ページ</h1>
        <audio controls src="${prefix}/sound.wav"></audio>
        <a href="${prefix}/sound.wav?download=1" download="sound.wav">sound.wav をダウンロード</a>
        <button id="permission" onclick="navigator.geolocation.getCurrentPosition(()=>{})">権限要求</button>
        <button id="popup" onclick="window.open('https://outside.invalid/')">window.open</button>
        <a id="outside" href="https://outside.invalid/">hosts 外</a>
        <a id="file" href="file:///etc/passwd">file:</a></html>`); return;
    }
    if (path === '/missing') { response.end('<!doctype html><h1>該当なし</h1><a href="/other.wav">other.wav</a>'); return; }
    response.end(`<!doctype html><title>検索ページ</title><h1>検索ページ</h1>
      <input aria-label="検索" placeholder="検索"><a href="${path.startsWith('/subscription') ? '/subscription' : ''}/item">個別ページ</a>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  await mkdir(join(catalogRoot, 'sites'), { recursive: true });
  await mkdir(join(catalogRoot, 'audio'), { recursive: true });
  const site = (id, name, entry, price, ref) => ({ id, name, tab: 'audio', entry_url: base + entry,
    hosts: ['127.0.0.1'], download_hosts: [], price,
    terms: { summary_ja: '疑似サイト検証用', source_url: base + '/', checked_at: '2026-09-23' },
    attribution: id === 'fixture-free' ? { required: true, text: 'テスト提供' } : { required: false, text: '' },
    direct_fetch_allowed: false, recommendations: [ref] });
  for (const [id, name, entry, price, ref] of [
    ['fixture-free', '疑似無料サイト', '/', 'free', 'audio/candidates/fixture-free-item'],
    ['fixture-subscription', '疑似サブスクサイト', '/subscription/', 'subscription', 'audio/candidates/fixture-subscription-item']
  ]) await writeFile(join(catalogRoot, 'sites', `${id}.json`), JSON.stringify(site(id, name, entry, price, ref)));
  const item = (id, url) => ({ id, title_ja: 'テスト音声', download_page_url: base + url,
    expected_filenames: ['sound.wav'], filename_patterns: [] });
  await writeFile(join(catalogRoot, 'audio', 'candidates.json'), JSON.stringify({ categories: [{
    items: [item('fixture-free-item', '/item'), item('fixture-subscription-item', '/subscription/item')]
  }] }));
  return { server, base, requests };
}
