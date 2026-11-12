import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT);
const rankingPath = resolve(ROOT, 'data', 'rankings.json');
const summaryPath = resolve(ROOT, 'data', 'summary.json');
const rankings = JSON.parse(readFileSync(rankingPath, 'utf8'));
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safeHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
}

const server = createServer((req, res) => {
  safeHeaders(res);
  let url;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return json(res, 400, { error: 'Invalid URL' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(res, 405, { error: 'Method not allowed' });
  }

  if (url.pathname === '/healthz') {
    return json(res, 200, { status: 'ok' });
  }

  if (url.pathname === '/api/summary') {
    return json(res, 200, summary);
  }

  if (url.pathname === '/api/rankings') {
    const type = url.searchParams.get('type') ?? 'batters';
    if (type !== 'batters' && type !== 'bowlers') {
      return json(res, 400, { error: 'type must be batters or bowlers' });
    }
    let rows = rankings[type];
    const search = (url.searchParams.get('search') ?? '').trim().toLocaleLowerCase();
    if (search) rows = rows.filter(row => row.player.toLocaleLowerCase().includes(search));
    const limit = url.searchParams.get('limit');
    if (limit !== null && limit !== 'all') {
      const n = Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        return json(res, 400, { error: 'limit must be an integer from 1 to 200, or all' });
      }
      rows = rows.slice(0, n);
    }
    return json(res, 200, rows);
  }

  const playerMatch = url.pathname.match(/^\/api\/players\/(\d+)$/);
  if (playerMatch) {
    const type = url.searchParams.get('type') ?? 'batters';
    if (type !== 'batters' && type !== 'bowlers') {
      return json(res, 400, { error: 'type must be batters or bowlers' });
    }
    const player = rankings[type].find(row => row.player_id === Number(playerMatch[1]));
    if (!player) return json(res, 404, { error: 'Player not found in this leaderboard' });
    return json(res, 200, player);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: 'Invalid path encoding' });
  }
  if (pathname === '/') pathname = '/index.html';
  const file = resolve(PUBLIC, `.${pathname}`);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) {
    return json(res, 403, { error: 'Forbidden' });
  }
  try {
    if (!statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
  } catch {
    return json(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, {
    'Content-Type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT || 10000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Pressure Selector listening on 0.0.0.0:${port}`);
});
