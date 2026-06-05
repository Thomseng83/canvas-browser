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
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'keepAlive') return;
  if (!ws || ws.readyState === WebSocket.CLOSED) connectBridge();
  chrome.storage.local.get('_ping');
});

// ── Hilfsfunktion: Frame eines Panels ermitteln ───────────────────────────────

async function getPanelFrame(tabId, panelId) {
  const panelsResult = await chrome.tabs.sendMessage(tabId, { cmd: 'getPanels', payload: {} });
  const panel = panelsResult?.panels?.find(p => p.id === panelId);
  if (!panel)     throw new Error('Panel nicht gefunden');
  if (!panel.url) throw new Error('Panel hat keine URL');

  const frames  = await chrome.webNavigation.getAllFrames({ tabId });
  const baseUrl = panel.url.split('?')[0];
  const frame   = frames.find(f =>
    !f.url.startsWith('chrome-extension://') &&
    (f.url === panel.url || f.url.startsWith(baseUrl))
  );
  if (!frame) throw new Error('Frame nicht gefunden');
  return { panel, frame };
}

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

      // ── Scrollen ─────────────────────────────────────────────────────────────
      case 'scrollPanel': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: (sx, sy) => window.scrollTo(sx, sy),
          args: [payload.x ?? 0, payload.y ?? 0],
        });
        return { ok: true };
      }

      // ── Klicken ──────────────────────────────────────────────────────────────
      case 'clickPanel': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: (selector, x, y) => {
            let el;
            if (selector) {
              el = document.querySelector(selector);
            } else if (x !== null && y !== null) {
              el = document.elementFromPoint(x, y);
            }
            if (!el) return { error: 'Element nicht gefunden' };
            el.focus();
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
            el.click();
            return { ok: true, tag: el.tagName, text: el.textContent?.trim().slice(0, 80) };
          },
          args: [payload.selector ?? null, payload.x ?? null, payload.y ?? null],
        });
        return res.result;
      }

      // ── Text eingeben ────────────────────────────────────────────────────────
      case 'typePanel': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: (selector, text, clear, submit) => {
            const el = document.querySelector(selector);
            if (!el) return { error: 'Element nicht gefunden' };
            el.focus();
            if (clear) {
              // React-kompatibler Wert-Reset
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              )?.set;
              if (setter) setter.call(el, '');
              else el.value = '';
              el.dispatchEvent(new Event('input',  { bubbles: true }));
            }
            for (const char of text) {
              el.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
              el.value += char;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (submit) {
              el.dispatchEvent(new KeyboardEvent('keydown',
                { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              el.form?.submit();
            }
            return { ok: true, value: el.value };
          },
          args: [payload.selector, payload.text, payload.clear ?? true, payload.submit ?? false],
        });
        return res.result;
      }

      // ── Seitentext lesen ─────────────────────────────────────────────────────
      case 'getPageText': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: (selector) => {
            const el = selector ? document.querySelector(selector) : document.body;
            return el ? el.innerText : '';
          },
          args: [payload.selector ?? null],
        });
        return { ok: true, text: res.result };
      }

      // ── Auf Element warten ───────────────────────────────────────────────────
      case 'waitForSelector': {
        const tab     = await ensureCanvas();
        const timeout = payload.timeout ?? 10000;
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
          try {
            const { frame } = await getPanelFrame(tab.id, payload.id);
            const [res] = await chrome.scripting.executeScript({
              target: { tabId: tab.id, frameIds: [frame.frameId] },
              func: (sel) => !!document.querySelector(sel),
              args: [payload.selector],
            });
            if (res.result) return { ok: true };
          } catch { /* Frame noch nicht bereit */ }
          await delay(500);
        }
        return { error: `Timeout: "${payload.selector}" nicht gefunden` };
      }

      // ── Aktuelle URL des Panels lesen ────────────────────────────────────────
      case 'getPageUrl': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: () => location.href,
          args: [],
        });
        return { ok: true, url: res.result };
      }

      // ── Browser-Historie ─────────────────────────────────────────────────────
      case 'goBack': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: () => history.back(),
        });
        return { ok: true };
      }

      case 'goForward': {
        const tab = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: () => history.forward(),
        });
        return { ok: true };
      }

      // ── Seite durchscrollen und Screenshots sammeln ──────────────────────────
      case 'scrollAndCapture': {
        const tab      = await ensureCanvas();
        const { frame } = await getPanelFrame(tab.id, payload.id);
        const step      = payload.step      ?? 700;
        const maxScrolls = payload.maxScrolls ?? 8;

        // Gesamthöhe der Seite ermitteln
        const [heightRes] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: () => document.body.scrollHeight,
        });
        const totalHeight = heightRes.result;

        await chrome.tabs.update(tab.id, { active: true });
        const screenshots = [];
        let y = 0;

        while (y < totalHeight && screenshots.length < maxScrolls) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [frame.frameId] },
            func: (sy) => window.scrollTo(0, sy),
            args: [y],
          });
          await delay(400);
          const dataUrl = await chrome.tabs.captureVisibleTab(
            tab.windowId, { format: 'jpeg', quality: 75 }
          );
          screenshots.push({ y, dataUrl });
          y += step;
        }

        // Zurück nach oben scrollen
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frame.frameId] },
          func: () => window.scrollTo(0, 0),
        });

        return { ok: true, count: screenshots.length, totalHeight, screenshots };
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
      case 'setCamera':
      case 'addText':
      case 'addImage':
      case 'addFile':
      case 'getWidgets':
      case 'removeWidget':
      case 'updateWidget':
      case 'clearWidgets': {
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
  const tab = await chrome.tabs.create({ url: CANVAS_URL });
  await delay(1200);
  return tab;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
