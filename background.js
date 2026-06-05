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

      // ── Alle anderen Befehle → an Canvas-Seite weiterleiten ─────────────────
      case 'getPanels':
      case 'openPanel':
      case 'navigate':
      case 'closePanel':
      case 'setLive':
      case 'tileAll':
      case 'tilePanels':
      case 'fullscreen':
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
