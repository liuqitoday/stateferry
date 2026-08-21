import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.STATEFERRY_E2E_PORT ?? 4177);
const page = await readFile(resolve('tests/e2e/test-page.html'));
const server = createServer((request, response) => {
  if (request.url === '/' || request.url === '/test-page.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(page);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`StateFerry E2E fixture: http://127.0.0.1:${port}/test-page.html`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
