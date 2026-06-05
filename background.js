'use strict';

const BRIDGE_WS  = 'ws://localhost:3001';
const CANVAS_URL = chrome.runtime.getURL('canvas.html');

let ws = null;

// ── Extension-Icon öffnet Canvas ──────────────────────────────────────────────

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: CANVAS_URL });
});

// ── WebSocket-Verbindung zur Bridge ───────────────────────────────────────────

function connectBridge() {
  try {
    ws = new WebSocket(BRIDGE_WS);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen  = () => console.log('[Bridge] Verbunden');
  ws.onclose = () => { ws = null; scheduleReconnect(); };
  ws.onerror = () => {};

  ws.onmessage = async ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    const result = await handleCommand(msg.cmd, msg.payload || {});
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: msg.id, result }));
    }
  };
}

function scheduleReconnect() {
  setTimeout(connectBridge, 4000);
}

connectBridge();

// ── Service Worker am Leben halten (MV3 killt ihn nach ~30s Inaktivität) ──────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // alle 24 Sek.

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'keepAlive') return;
  // WebSocket neu verbinden falls getrennt
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    connectBridge();
  }
  // Chrome API anfassen hält den Service Worker aktiv
  chrome.storage.local.get('_ping');
});

// ── Befehle ausführen ─────────────────────────────────────────────────────────

async function handleCommand(cmd, payload) {
  try {
    switch (cmd) {

      // ── Status ──────────────────────────────────────────────────────────────
      case 'status':
        return { ok: true, extension: 'connected' };

      // ── Canvas-Tab holen oder öffnen ────────────────────────────────────────
      case 'openCanvas': {
        const tab = await ensureCanvas();
        return { ok: true, tabId: tab.id };
      }

      // ── Screenshot ──────────────────────────────────────────────────────────
      case 'screenshot': {
        const tab = await ensureCanvas();
        await chrome.tabs.update(tab.id, { active: true });
        await delay(300);
        const dataUrl = await chrome.tabs.captureVisibleTab(
          tab.windowId, { format: 'jpeg', quality: 85 }
        );
        return { dataUrl };
      }

      // ── Scroll: direkt per chrome.scripting in den iframe scrollen ────────────
      case 'scrollPanel': {
        const tab = await ensureCanvas();
        // Panel-URL ermitteln
        const panelsResult = await chrome.tabs.sendMessage(tab.id, { cmd: 'getPanels', payload: {} });
        const panel = panelsResult?.panels?.find(p => p.id === payload.id);
        if (!panel)    return { error: 'Panel nicht gefunden' };
        if (!panel.url) return { error: 'Panel hat keine URL' };

        const scrollX = payload.x ?? 0;
        const scrollY = payload.y ?? 0;

        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        const baseUrl = panel.url.split('?')[0];
        const match   = frames.find(f =>
          !f.url.startsWith('chrome-extension://') &&
          (f.url === panel.url || f.url.startsWith(baseUrl))
        );
        if (!match) return { error: 'Frame nicht gefunden' };

        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [match.frameId] },
          func: (sx, sy) => window.scrollTo(sx, sy),
          args: [scrollX, scrollY],
        });

        return { ok: true };
      }

      // ── Alle anderen Befehle → an Canvas-Seite weiterleiten ─────────────────
      case 'getPanels':
      case 'openPanel':
      case 'navigate':
      case 'closePanel':
      case 'setLive':
      case 'tileAll':
      case 'tilePanels':
      case 'fullscreen':
      case 'closeFullscreen':
      case 'setCamera': {
        const tab = await ensureCanvas();
        return await chrome.tabs.sendMessage(tab.id, { cmd, payload });
      }

      default:
        return { error: `Unbekannter Befehl: ${cmd}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async function ensureCanvas() {
  const tabs = await chrome.tabs.query({ url: CANVAS_URL });
  if (tabs.length > 0) return tabs[0];

  // Canvas-Tab öffnen und auf Laden warten
  const tab = await chrome.tabs.create({ url: CANVAS_URL });
  await delay(1200);
  return tab;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
