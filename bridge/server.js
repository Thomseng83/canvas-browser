'use strict';

/**
 * Canvas Browser Bridge Server
 *
 * HTTP  :3000  ← Claude Code / externe Apps senden Befehle
 * WS    :3001  ← Extension verbindet sich dauerhaft
 *
 * Befehl-Format (POST /command):
 *   { "cmd": "openPanel", "payload": { "url": "https://example.com" } }
 *
 * Verfügbare Befehle:
 *   getPanels          → Liste aller Panels
 *   openPanel          → Neues Panel öffnen  { url }
 *   navigate           → Panel navigieren    { id, url }
 *   closePanel         → Panel schließen     { id }
 *   setLive            → Live toggle         { id, live }
 *   screenshot         → Canvas-Screenshot   {}
 *   tileAll            → Alle kacheln        {}
 *   tilePanels         → Auswahl kacheln     { ids: [1,2,3] }
 *   fullscreen         → Vollbild            { id }
 *   status             → Bridge-Status       {}
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const HTTP_PORT = 3000;
const WS_PORT   = 3001;

// Verbundene Extension (immer nur eine)
let extSocket = null;

// Offene HTTP-Anfragen warten auf Antwort der Extension
const pending = new Map();

// ── WebSocket-Server (Extension verbindet sich hier) ──────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', ws => {
  extSocket = ws;
  log('✅ Extension verbunden');

  ws.on('message', raw => {
    try {
      const { id, result } = JSON.parse(raw);
      const req = pending.get(id);
      if (!req) return;
      clearTimeout(req.timeout);
      pending.delete(id);
      respond(req.res, 200, result);
    } catch (e) {
      log('WS parse error:', e.message);
    }
  });

  ws.on('close', () => {
    extSocket = null;
    log('⚠️  Extension getrennt');
  });
});

log(`🔌 WebSocket-Server läuft auf ws://localhost:${WS_PORT}`);

// ── HTTP-Server (Claude Code / Apps senden hier Befehle) ──────────────────────

const httpServer = http.createServer((req, res) => {
  // CORS für lokale Web-Apps
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

  // GET /status
  if (req.method === 'GET' && url.pathname === '/status') {
    respond(res, 200, {
      bridge: 'online',
      extension: extSocket ? 'connected' : 'disconnected',
      pending: pending.size,
    });
    return;
  }

  // GET /panels (Kurzform)
  if (req.method === 'GET' && url.pathname === '/panels') {
    return forward(res, 'getPanels', {});
  }

  // POST /command
  if (req.method === 'POST' && url.pathname === '/command') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { cmd, payload = {} } = JSON.parse(body);
        if (!cmd) return respond(res, 400, { error: 'cmd fehlt' });
        forward(res, cmd, payload);
      } catch {
        respond(res, 400, { error: 'Ungültiges JSON' });
      }
    });
    return;
  }

  respond(res, 404, { error: 'Nicht gefunden' });
});

httpServer.listen(HTTP_PORT, () => {
  log(`🌐 HTTP-Server läuft auf http://localhost:${HTTP_PORT}`);
  log('');
  log('── Beispiele ─────────────────────────────────────────────');
  log('  Status:      GET  http://localhost:3000/status');
  log('  Panels:      GET  http://localhost:3000/panels');
  log('  URL öffnen:  POST http://localhost:3000/command');
  log('               Body: {"cmd":"openPanel","payload":{"url":"https://google.de"}}');
  log('  Screenshot:  POST http://localhost:3000/command');
  log('               Body: {"cmd":"screenshot"}');
  log('──────────────────────────────────────────────────────────');
  log('');
  log('Warte auf Extension-Verbindung …');
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function forward(res, cmd, payload) {
  if (!extSocket || extSocket.readyState !== WebSocket.OPEN) {
    return respond(res, 503, { error: 'Extension nicht verbunden. Ist der Canvas Browser offen?' });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const timeout = setTimeout(() => {
    pending.delete(id);
    respond(res, 504, { error: 'Timeout – Extension hat nicht geantwortet' });
  }, 15_000);

  pending.set(id, { res, timeout });
  extSocket.send(JSON.stringify({ id, cmd, payload }));
  log(`→ ${cmd}`, Object.keys(payload).length ? JSON.stringify(payload) : '');
}

function respond(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function log(...args) {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`[${time}]`, ...args);
}
