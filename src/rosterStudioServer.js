const http = require('http');
const { spawn } = require('child_process');

const rosterStudio = require('./rosterStudioBackend');
const { rosterStudioHtml } = require('./rosterStudioPage');

function sendJson(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString('utf8'));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function openBrowser(url) {
  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    : process.platform === 'darwin'
      ? spawn('open', [url], { detached: true, stdio: 'ignore' })
      : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function startRosterStudioServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 0);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/roster-studio')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(rosterStudioHtml());
      } else if (req.method === 'POST' && url.pathname === '/api/roster/open') {
        const body = await readBody(req);
        sendJson(res, 200, await rosterStudio.openRosterStudio(body.rosterPath, body.assetRoot));
      } else if (req.method === 'POST' && url.pathname === '/api/browse') {
        sendJson(res, 501, { error: 'Browse dialogs are available in the main GUI. Paste paths in this standalone Roster Studio page.' });
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      sendJson(res, 500, { error: err.stack || err.message || String(err) });
    }
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}/`;
  console.log(`CH2K8 Roster Studio running at ${url}`);
  if (options.open !== false) openBrowser(url);
  return { server, url };
}

if (require.main === module) {
  startRosterStudioServer({ open: true }).catch((err) => {
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { startRosterStudioServer };
