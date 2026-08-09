// Run2 検証専用: 「リモート遮断解除」を模す最小 HTTP サーバー。
// 起動前は AKARI_ASSETS_CATALOG が指すポートに何も listen していないため resolver の
// fetch が ECONNREFUSED で失敗する（= 遮断状態）。このサーバーを起動すると同じ URL が
// 200 を返すようになる（= 遮断解除）。依存追加なし（Node 組み込み http のみ）。
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const [, , portArg, catalogJsonPath] = process.argv;
const port = Number(portArg);

const server = http.createServer(async (req, res) => {
  if (req.url === '/catalog.json') {
    try {
      const body = await readFile(catalogJsonPath, 'utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`LISTENING ${port}`);
});
