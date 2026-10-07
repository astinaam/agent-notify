import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { messageStore } from './store.js';
import { channelStore } from './channel_store.js';
import {
  relayChannelMessage,
  relayChannelDeleted,
  relayHistoryArchived,
  relayHistoryCleared,
} from './channel_relay.js';
import { getNetworkAddresses } from './network.js';
import { resolveConfig, getConfigDir, getHumanName } from './config.js';
import { getSystemMetrics, startMonitorService } from './monitor.js';
import { startBotListener, stopBotListener } from './bot_listener.js';
import { metricsStore } from './metrics_store.js';
import type { NetworkAddresses } from './types.js';
import { MAIN_CHANNEL_CODE } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getWebDir(): string {
  const distWeb = path.join(__dirname, 'web');
  if (fs.existsSync(distWeb)) return distWeb;

  const srcWeb = path.join(__dirname, '..', 'src', 'web');
  if (fs.existsSync(srcWeb)) return srcWeb;

  return distWeb;
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export function createServer(): http.Server {
  const webDir = getWebDir();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Static Assets
    if (pathname === '/' || pathname.startsWith('/m/')) {
      const htmlPath = path.join(webDir, 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath));
        return;
      }
    }

    if (pathname === '/app.css') {
      const cssPath = path.join(webDir, 'app.css');
      if (fs.existsSync(cssPath)) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(cssPath));
        return;
      }
    }

    if (pathname === '/app.js') {
      const jsPath = path.join(webDir, 'app.js');
      if (fs.existsSync(jsPath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(fs.readFileSync(jsPath));
        return;
      }
    }

    // API: GET /api/messages
    if (pathname === '/api/messages' && req.method === 'GET') {
      const agent = parsedUrl.searchParams.get('agent') || undefined;
      const level = parsedUrl.searchParams.get('level') || undefined;
      const type = parsedUrl.searchParams.get('type') || undefined;
      const search = parsedUrl.searchParams.get('search') || undefined;
      const limit = Number.parseInt(parsedUrl.searchParams.get('limit') || '100', 10);
      const offset = Number.parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

      const result = messageStore.getMessages({ agent, level, type, search, limit, offset });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // API: GET /api/messages/:id
    if (pathname.startsWith('/api/messages/') && !pathname.endsWith('/respond') && req.method === 'GET') {
      const id = pathname.replace('/api/messages/', '');
      const msg = messageStore.getMessage(id);
      if (!msg) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
      return;
    }

    // API: POST /api/messages/:id/respond
    if (pathname.startsWith('/api/messages/') && pathname.endsWith('/respond') && req.method === 'POST') {
      const id = pathname.replace('/api/messages/', '').replace('/respond', '');
      try {
        const body = await parseJsonBody(req);
        if (!body.response || typeof body.response !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "response" field in request body' }));
          return;
        }

        const answeredBy = body.answeredBy || 'Web Dashboard';
        const updated = messageStore.respondToQuestion(id, body.response, answeredBy);

        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Message not found or not an approval question' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: updated }));
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: GET /api/agents
    if (pathname === '/api/agents' && req.method === 'GET') {
      const agents = messageStore.getAgents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agents));
      return;
    }

    // API: GET /api/stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      const stats = messageStore.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    // API: GET /api/network
    if (pathname === '/api/network' && req.method === 'GET') {
      const config = resolveConfig();
      const addresses = getNetworkAddresses(config.serverPort, config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(addresses));
      return;
    }

    // API: GET /api/system (Real-time system health metrics)
    if (pathname === '/api/system' && req.method === 'GET') {
      const config = resolveConfig();
      const metrics = getSystemMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        metrics,
        monitor: config.monitor || { enabled: false },
      }));
      return;
    }

    // API: GET /api/system/history (7-day rolling time-series)
    if (pathname === '/api/system/history' && req.method === 'GET') {
      const range = (parsedUrl.searchParams.get('range') || '24h') as '1h' | '6h' | '24h' | '7d';
      const history = metricsStore.getHistory(range);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }

    // API: GET /api/files/:id
    if (pathname.startsWith('/api/files/') && req.method === 'GET') {
      const id = pathname.replace('/api/files/', '');
      const msg = messageStore.getMessage(id);
      if (!msg || !msg.filePath || !fs.existsSync(msg.filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      const filename = msg.fileName || path.basename(msg.filePath);
      const stat = fs.statSync(msg.filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `inline; filename="${filename}"`,
      });
      fs.createReadStream(msg.filePath).pipe(res);
      return;
    }

    // API: GET /api/channel?code=main — snapshot for one channel (+ channel list)
    if (pathname === '/api/channel' && req.method === 'GET') {
      channelStore.ensureMain();
      const code = (parsedUrl.searchParams.get('code') || MAIN_CHANNEL_CODE).trim() || MAIN_CHANNEL_CODE;
      const snapshot = channelStore.getSnapshot(code);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    // API: GET /api/channels — list all channels
    if (pathname === '/api/channels' && req.method === 'GET') {
      channelStore.ensureMain();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channels: channelStore.listChannels(), humanName: getHumanName() }));
      return;
    }

    // API: GET /api/channel/archives?code= (optional) — all archives or per-channel
    if (pathname === '/api/channel/archives' && req.method === 'GET') {
      const code = parsedUrl.searchParams.get('code') || undefined;
      const archives = channelStore.listArchives(code || undefined);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ archives, humanName: getHumanName() }));
      return;
    }

    // API: GET /api/channel/archives/:filename?code=
    if (pathname.startsWith('/api/channel/archives/') && req.method === 'GET') {
      const filename = decodeURIComponent(pathname.replace('/api/channel/archives/', ''));
      const code = parsedUrl.searchParams.get('code') || MAIN_CHANNEL_CODE;
      try {
        const archive = channelStore.getArchive(filename, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(archive));
        return;
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: DELETE /api/channel/archives/:filename?code=
    if (pathname.startsWith('/api/channel/archives/') && req.method === 'DELETE') {
      const filename = decodeURIComponent(pathname.replace('/api/channel/archives/', ''));
      const code =
        parsedUrl.searchParams.get('code') ||
        MAIN_CHANNEL_CODE;
      try {
        const result = channelStore.deleteArchive(filename, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            ...result,
            archives: channelStore.listArchives(),
            snapshot: channelStore.getSnapshot(code),
          })
        );
        return;
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: POST /api/channel/archive — snapshot without clearing
    if (pathname === '/api/channel/archive' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const code =
          (typeof body.code === 'string' && body.code.trim()) || MAIN_CHANNEL_CODE;
        if (!channelStore.exists(code)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No channel #${code}` }));
          return;
        }
        const result = channelStore.archive(
          code,
          typeof body.label === 'string' ? body.label : undefined
        );
        await relayHistoryArchived(result.archivePath, result.messageCount, result.agentCount, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result, snapshot: channelStore.getSnapshot(code) }));
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: POST /api/channel/clear — archive then empty live history
    if (pathname === '/api/channel/clear' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const code =
          (typeof body.code === 'string' && body.code.trim()) || MAIN_CHANNEL_CODE;
        if (!channelStore.exists(code)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No channel #${code}` }));
          return;
        }
        const result = channelStore.clear(
          code,
          typeof body.label === 'string' ? body.label : undefined
        );
        await relayHistoryCleared(result.archivePath, result.messageCount, result.agentCount, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result, snapshot: channelStore.getSnapshot(code) }));
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: POST /api/channel/say — human compose from Portal
    if (pathname === '/api/channel/say' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const code =
          (typeof body.code === 'string' && body.code.trim()) || MAIN_CHANNEL_CODE;
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "text" field' }));
          return;
        }
        if (!channelStore.exists(code)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No channel #${code}` }));
          return;
        }
        const msg = channelStore.postMessage(code, {
          from: getHumanName(),
          body: text,
          kind: 'say',
          requireRegistered: false,
        });
        await relayChannelMessage(msg, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: msg, snapshot: channelStore.getSnapshot(code) }));
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // API: DELETE /api/channel?code= — delete a non-main channel (archives first)
    if (pathname === '/api/channel' && req.method === 'DELETE') {
      try {
        const queryCode = parsedUrl.searchParams.get('code');
        let body: any = {};
        if (!queryCode) {
          body = await parseJsonBody(req).catch(() => ({}));
        }
        const code = (queryCode || body.code || '').trim();
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing channel code' }));
          return;
        }
        if (code === MAIN_CHANNEL_CODE) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Channel "main" cannot be deleted.' }));
          return;
        }
        if (!channelStore.exists(code)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Channel #${code} not found` }));
          return;
        }
        const result = channelStore.deleteChannel(code);
        await relayChannelDeleted(result.code, result.archivePath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            ...result,
            snapshot: channelStore.getSnapshot(MAIN_CHANNEL_CODE),
          })
        );
        return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // SSE: GET /api/events (Real-Time Live Updates)
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': heartbeat\n\n');

      const onAdded = (msg: any) => {
        res.write(`event: message_added\ndata: ${JSON.stringify(msg)}\n\n`);
      };

      const onUpdated = (msg: any) => {
        res.write(`event: message_updated\ndata: ${JSON.stringify(msg)}\n\n`);
      };

      const onDeleted = (id: string) => {
        res.write(`event: message_deleted\ndata: ${JSON.stringify({ id })}\n\n`);
      };

      const onChannelChanged = () => {
        res.write(
          `event: channel_changed\ndata: ${JSON.stringify({
            channels: channelStore.listChannels(),
            humanName: getHumanName(),
          })}\n\n`
        );
      };

      messageStore.on('message_added', onAdded);
      messageStore.on('message_updated', onUpdated);
      messageStore.on('message_deleted', onDeleted);
      channelStore.on('channel_changed', onChannelChanged);

      const timer = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(timer);
        messageStore.off('message_added', onAdded);
        messageStore.off('message_updated', onUpdated);
        messageStore.off('message_deleted', onDeleted);
        channelStore.off('channel_changed', onChannelChanged);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

export async function isServerRunning(port = 4173): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stats`, {
      signal: AbortSignal.timeout(300),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getPidFile(): string {
  return path.join(getConfigDir(), 'server.pid');
}

export function getLogFile(): string {
  return path.join(getConfigDir(), 'server.log');
}

export async function ensureServerRunning(portOverride?: number): Promise<void> {
  const config = resolveConfig();
  const port = portOverride || config.serverPort || 4173;

  const running = await isServerRunning(port);
  if (running) return;

  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const logFile = getLogFile();
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  const cliPath = path.join(__dirname, 'cli.js');
  const child = spawn(process.execPath, [cliPath, 'serve', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env },
  });

  child.unref();

  if (child.pid) {
    fs.writeFileSync(getPidFile(), String(child.pid), 'utf8');
  }

  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await isServerRunning(port)) break;
  }
}

export function stopDaemon(): boolean {
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) {
    try {
      const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (pid && !Number.isNaN(pid)) {
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(pidFile);
        return true;
      }
    } catch {
      try { fs.unlinkSync(pidFile); } catch {}
    }
  }
  return false;
}

export async function startServer(
  portOverride?: number,
  hostOverride?: string
): Promise<{ server: http.Server; addresses: NetworkAddresses }> {
  const config = resolveConfig();
  const port = portOverride || config.serverPort || 4173;
  const host = hostOverride || '0.0.0.0';

  const server = createServer();
  channelStore.startWatching();

  // Start background resource monitor service if enabled
  startMonitorService();

  // Start continuous 24/7 Telegram bot listener if configured
  startBotListener(config);

  const shutdown = () => {
    stopBotListener();
    server.close();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addresses = getNetworkAddresses(port, config);
      resolve({ server, addresses });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
