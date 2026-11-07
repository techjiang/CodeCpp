'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const store = require('./store');
const templates = require('./templates');
const routes = require('./routes');

const WEB_DIR = path.join(store.IDE_ROOT, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const DEFAULT_PORT = Number(arg('port', process.env.CODECPP_PORT || 7788)) || 7788;
const DEFAULT_HOST = arg('host', '127.0.0.1');
const NO_BROWSER = argv.includes('--no-browser');

const sseClients = new Set();
let fsWatcher = null;

function broadcast(event) {
  const payload = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}

function watchWorkspace() {
  if (fsWatcher) return;
  let timer = null;
  try {
    fsWatcher = fs.watch(paths.root(), { recursive: true }, (_event, filename) => {
      if (!filename || /[\\/](\.git|build|node_modules)[\\/]/.test(String(filename))) return;
      clearTimeout(timer);
      timer = setTimeout(() => broadcast({ type: 'fs-change', file: String(filename).replace(/\\/g, '/') }), 250);
    });
  } catch (_) {}
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  if (rel.includes('\0')) rel = '/index.html';
  let abs = path.resolve(WEB_DIR, '.' + rel);
  if (!paths.inside(abs, WEB_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('禁止访问');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) abs = path.join(WEB_DIR, 'index.html');
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  fs.createReadStream(abs).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (_) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache', Connection: 'keep-alive'
    });
    res.write('data: ' + JSON.stringify({ type: 'connected', root: paths.root() }) + '\n\n');
    sseClients.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20000);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const result = await routes.handle(req.method, pathname, url.searchParams, body);
      return sendJson(res, result.status, result.body);
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  sendJson(res, 405, { ok: false, error: '方法不被支持' });
});

function openBrowser(url) {
  const edge = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : ''
  ].find((p) => p && fs.existsSync(p));
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].find((p) => fs.existsSync(p));
  try {
    if (edge || chrome) {
      const browser = edge || chrome;
      spawn(browser, ['--app=' + url, '--window-size=1480,940', '--disable-features=msEdgeIdentityFRE'],
        { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) {}
}

function listen(port, host, attempt) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE' && port !== 0 && attempt < 12) {
        resolve(listen(port + 1, host, attempt + 1));
      } else reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

let runtime = null;

async function startServer(options) {
  if (runtime) return runtime;
  const opts = options || {};
  paths.initRoot(opts.root || arg('root', ''));
  templates.seedWorkspace();
  const host = opts.host || DEFAULT_HOST;
  const port = await listen(opts.port === undefined ? DEFAULT_PORT : Number(opts.port), host, 0);
  watchWorkspace();
  const url = 'http://' + host + ':' + port;
  if (!opts.embedded) {
    console.log('');
    console.log('  CodeCpp  ·  C 语言高级开发环境');
    console.log('  ----------------------------------------');
    console.log('  服务地址 : ' + url);
    console.log('  工作区   : ' + paths.root());
    console.log('  设置文件 : ' + path.join(store.DATA_DIR, 'settings.json'));
    console.log('  关闭服务 : Ctrl + C');
    console.log('');
    if (opts.openBrowser !== false && !NO_BROWSER) openBrowser(url);
  }
  runtime = {
    server, port, host, url, root: paths.root(),
    close() {
      for (const res of sseClients) { try { res.end(); } catch (_) {} }
      sseClients.clear();
      if (fsWatcher) { try { fsWatcher.close(); } catch (_) {} fsWatcher = null; }
      return new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    }
  };
  return runtime;
}

if (require.main === module) {
  startServer({ openBrowser: !NO_BROWSER }).catch((error) => {
    console.error('[CodeCpp] 启动失败：', error.message);
    process.exit(1);
  });
  process.on('SIGINT', () => {
    if (runtime) runtime.close().finally(() => process.exit(0));
    else process.exit(0);
  });
  process.on('uncaughtException', (error) => { console.error('[CodeCpp] 未捕获异常：', error); });
}

module.exports = { server, broadcast, startServer, WEB_DIR };
