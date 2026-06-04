const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, headers, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function resolveRequest(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0] || '/');
  const relative = cleanPath === '/' ? 'app.html' : cleanPath.replace(/^\/+/, '');
  const fullPath = path.resolve(root, relative);
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequest(req.url || '/');
  if (!filePath) {
    send(res, 403, { 'Content-Type': 'text/plain; charset=UTF-8' }, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=UTF-8' }, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, { 'Content-Type': types[ext] || 'application/octet-stream' }, data);
  });
});

server.listen(port, host, () => {
  console.log(`Gordi local: http://${host}:${port}/app.html`);
});
