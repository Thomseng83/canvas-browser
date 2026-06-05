'use strict';

const CANVAS_W  = 8000;
const CANVAS_H  = 6000;
const PANEL_W   = 820;
const PANEL_H   = 580;
const ZOOM_MIN  = 0.1;
const ZOOM_MAX  = 3.0;
const ZOOM_STEP = 1.15;

// ── Kamera-Zustand ────────────────────────────────────────────────────────────
const cam = { tx: 0, ty: 0, scale: 1 };
let viewportEl, canvasEl;

function applyTransform() {
  canvasEl.style.transform = `translate(${cam.tx}px,${cam.ty}px) scale(${cam.scale})`;
  document.getElementById('btn-zoom-reset').textContent = Math.round(cam.scale * 100) + '%';
}

function zoomAt(vx, vy, factor) {
  const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.scale * factor));
  const f = newScale / cam.scale;
  cam.tx = vx - (vx - cam.tx) * f;
  cam.ty = vy - (vy - cam.ty) * f;
  cam.scale = newScale;
  applyTransform();
}

function zoomCenter(factor) {
  zoomAt(viewportEl.clientWidth / 2, viewportEl.clientHeight / 2, factor);
}

// ── Smooth-Kamera-Animation ───────────────────────────────────────────────────
let _animFrame = null;

function animateCam(targetTx, targetTy, targetScale, duration = 420) {
  if (_animFrame) cancelAnimationFrame(_animFrame);
  const startTx = cam.tx, startTy = cam.ty, startScale = cam.scale;
  const t0 = performance.now();
  const ease = t => t < .5 ? 2*t*t : -1 + (4 - 2*t)*t;

  function step(now) {
    const t = Math.min(1, (now - t0) / duration);
    const e = ease(t);
    cam.tx    = startTx    + (targetTx    - startTx)    * e;
    cam.ty    = startTy    + (targetTy    - startTy)    * e;
    cam.scale = startScale + (targetScale - startScale) * e;
    applyTransform();
    if (t < 1) _animFrame = requestAnimationFrame(step);
    else _animFrame = null;
  }
  _animFrame = requestAnimationFrame(step);
}

// Kamera auf ein Rechteck (canvas-Koordinaten) zentrieren
function flyToRect(x, y, w, h, pad = 0.08) {
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  const targetScale = Math.min(
    (vw * (1 - pad)) / w,
    (vh * (1 - pad)) / h,
    2.0
  );
  const targetTx = vw / 2 - (x + w / 2) * targetScale;
  const targetTy = vh / 2 - (y + h / 2) * targetScale;
  animateCam(targetTx, targetTy, targetScale);
}

// Kamera zentriert auf Panel fliegen (füllt Viewport)
function flyToPanel(panel, saveState = false) {
  if (saveState) panel._savedCam = { tx: cam.tx, ty: cam.ty, scale: cam.scale };
  flyToRect(panel.x, panel.y, panel.w, panel.h);
}

// Optimale Spalten/Zeilen für N Panels (passend zum Viewport-Seitenverhältnis)
function calcGrid(n) {
  const aspect = viewportEl.clientWidth / viewportEl.clientHeight;
  let bestCols = 1, bestScore = Infinity;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const score = Math.abs(Math.log((c / r) / aspect));
    if (score < bestScore) { bestScore = score; bestCols = c; }
  }
  return { cols: bestCols, rows: Math.ceil(n / bestCols) };
}

// Gespeicherter Kachel-Zustand (für ESC-Wiederherstellung)
let _tiledState = null;

// Kachel-Modus beenden – Panels auf ursprüngliche Positionen zurücksetzen
function exitTileMode() {
  if (!_tiledState) return;
  const { items, savedCam, mgr } = _tiledState;
  _tiledState = null;

  document.getElementById('tile-badge').classList.add('tile-badge-hidden');

  items.forEach(({ panel, x, y, w, h }) => {
    panel.x = x; panel.y = y;
    panel.w = w; panel.h = h;
    panel._applyGeometry();
  });

  animateCam(savedCam.tx, savedCam.ty, savedCam.scale);
  mgr.save();
  mgr.nav.refresh();
}

// Ausgewählte Panels als Kacheln im sichtbaren Bereich anordnen
function tileSelected(panels) {
  const n = panels.length;
  if (n < 2) return;

  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  const { cols, rows } = calcGrid(n);

  const GAP = 8;
  const PAD = 20;
  const panelW = Math.round((vw - 2 * PAD - (cols - 1) * GAP) / cols);
  const panelH = Math.round((vh - 2 * PAD - (rows - 1) * GAP) / rows);

  // Zustand vor dem Kacheln speichern
  _tiledState = {
    items:    panels.map(p => ({ panel: p, x: p.x, y: p.y, w: p.w, h: p.h })),
    savedCam: { ...cam },
    mgr:      panels[0].mgr,
  };

  panels.forEach((panel, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    panel.x = PAD + col * (panelW + GAP);
    panel.y = PAD + row * (panelH + GAP);
    panel.w = Math.max(280, panelW);
    panel.h = Math.max(180, panelH);
    panel._applyGeometry();
    if (!panel.live) panel.setLive(true);
  });

  cam.tx = 0; cam.ty = 0; cam.scale = 1;
  applyTransform();

  document.getElementById('tile-badge').classList.remove('tile-badge-hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// Vollbild-Overlay (single & multi)
// ─────────────────────────────────────────────────────────────────────────────

function openFsOverlay(panels, ownerPanel = null) {
  const overlay   = document.getElementById('fs-overlay');
  const content   = document.getElementById('fs-content');
  const titleEl   = document.getElementById('fs-title');

  const n = panels.filter(p => p.url).length;
  if (n === 0) return;

  const validPanels = panels.filter(p => p.url);
  const { cols, rows } = calcGrid(validPanels.length);

  content.innerHTML = '';
  content.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  content.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

  validPanels.forEach(p => {
    const iframe = document.createElement('iframe');
    iframe.src = p.url;
    iframe.allowFullscreen = true;
    content.appendChild(iframe);
  });

  if (validPanels.length === 1) {
    let label = validPanels[0].url;
    try { label = new URL(validPanels[0].url).hostname; } catch {}
    titleEl.textContent = '⛶  ' + label;
  } else {
    titleEl.textContent = `⛶  ${validPanels.length} Panels`;
  }

  overlay._ownerPanel = ownerPanel;
  overlay.classList.remove('fs-hidden');
}

function closeFsOverlay() {
  const overlay = document.getElementById('fs-overlay');
  if (overlay.classList.contains('fs-hidden')) return;

  const content = document.getElementById('fs-content');
  overlay.classList.add('fs-hidden');
  content.innerHTML = '';      // alle iframes stoppen

  const owner = overlay._ownerPanel;
  overlay._ownerPanel = null;

  // Panel-Zustand zurücksetzen (nur wenn noch als fullscreen markiert)
  if (owner && owner.isFullscreen) {
    owner.isFullscreen = false;
    owner._updateFsBtn();
    owner.mgr?.nav?.refresh();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

class Panel {
  constructor({ id, x, y, w = PANEL_W, h = PANEL_H, url = '', live = false }, mgr) {
    this.id   = id;
    this.x    = x;
    this.y    = y;
    this.w    = w;
    this.h    = h;
    this.url  = url;
    this.live = live;
    this.mgr  = mgr;

    this.screenshot   = null;
    this.isFullscreen = false;
    this._savedCam    = null;

    this.el = this._build();
    this._applyGeometry();

    // Initialzustand
    if (this.live && this.url) this._showIframe();
    else this._showStatic();
    this._updateLiveBtn();
    this._updateFsBtn();
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <div class="ph">
        <span class="ph-drag-icon">&#8801;</span>
        <button class="ph-btn btn-live"   title="Live-Ansicht ein/aus">&#9654;</button>
        <input  class="url-bar" type="text" spellcheck="false"
                placeholder="z.B. https://example.com" value="${this._esc(this.url)}">
        <button class="ph-btn btn-reload" title="Neu laden">&#8635;</button>
        <button class="ph-btn btn-fs"     title="Vollbild">&#9974;</button>
        <button class="ph-btn btn-close"  title="Schlie&#223;en">&#215;</button>
      </div>
      <div class="pc"></div>
      <div class="rh rh-se"></div>
      <div class="rh rh-s"></div>
      <div class="rh rh-e"></div>`;

    this._pcEl    = el.querySelector('.pc');
    this._urlEl   = el.querySelector('.url-bar');
    this._liveBtn = el.querySelector('.btn-live');
    this._fsBtn   = el.querySelector('.btn-fs');

    // Live-Toggle
    this._liveBtn.addEventListener('click', e => { e.stopPropagation(); this.toggleLive(); });

    // Vollbild
    this._fsBtn.addEventListener('click', e => { e.stopPropagation(); this.toggleFullscreen(); });

    // URL-Eingabe
    this._urlEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      let v = this._urlEl.value.trim();
      if (!v) return;
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      this.navigate(v);
    });
    this._urlEl.addEventListener('click',  e => e.stopPropagation());
    this._urlEl.addEventListener('focus',  () => this._urlEl.select());

    // Reload & Close
    el.querySelector('.btn-reload').addEventListener('click', e => {
      e.stopPropagation(); if (this.url) this.navigate(this.url);
    });
    el.querySelector('.btn-close').addEventListener('click', e => {
      e.stopPropagation(); this.mgr.remove(this.id);
    });

    // Header-Drag (gesamter Header außer Input/Buttons)
    el.querySelector('.ph').addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      this.mgr.bringToFront(this);
      this._dragStart(e);
    });

    // Klick auf statischen Inhalt → live schalten
    this._pcEl.addEventListener('click', () => { if (!this.live) this.setLive(true); });

    // Resize
    el.querySelectorAll('.rh').forEach(h =>
      h.addEventListener('mousedown', e => this._resizeStart(e, h)));

    return el;
  }

  // ── Live-Toggle ──────────────────────────────────────────────────────────────

  async toggleLive() { await this.setLive(!this.live); }

  async setLive(wantLive) {
    if (wantLive === this.live) return;
    if (wantLive) {
      this.live = true;
      this._showIframe();
    } else {
      if (this.url) await this._captureScreenshot();
      this.live = false;
      this._showStatic();
    }
    this._updateLiveBtn();
    this.mgr.nav.refresh();
    this.mgr.save();
  }

  _updateLiveBtn() {
    if (this.live) {
      this._liveBtn.textContent = '⏸';
      this._liveBtn.title = 'Live aktiv – Klicken zum Pausieren';
      this._liveBtn.classList.add('live');
    } else {
      this._liveBtn.textContent = '▶';
      this._liveBtn.title = 'Statisch – Klicken für Live-Ansicht';
      this._liveBtn.classList.remove('live');
    }
    this.el.classList.toggle('is-live', this.live);
  }

  // ── Vollbild ─────────────────────────────────────────────────────────────────

  toggleFullscreen() {
    this.isFullscreen ? this.exitFullscreen() : this.enterFullscreen();
  }

  enterFullscreen() {
    if (this.isFullscreen || !this.url) return;
    this.isFullscreen = true;
    this._updateFsBtn();
    this.mgr.nav.refresh();
    openFsOverlay([this], this);
  }

  exitFullscreen() {
    if (!this.isFullscreen) return;
    this.isFullscreen = false;
    this._updateFsBtn();
    this.mgr.nav.refresh();
    closeFsOverlay();
  }

  _updateFsBtn() {
    if (this.isFullscreen) {
      this._fsBtn.textContent = '⊡';
      this._fsBtn.title = 'Vollbild beenden (Esc)';
      this._fsBtn.classList.add('is-fs');
    } else {
      this._fsBtn.textContent = '⛶';
      this._fsBtn.title = 'Vollbild';
      this._fsBtn.classList.remove('is-fs');
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  navigate(url) {
    this.url = url;
    this._urlEl.value = url;
    this.live = true;
    this._showIframe();
    this._updateLiveBtn();
    this.mgr.nav.refresh();
    this.mgr.save();
  }

  // ── Inhalt-Rendering ─────────────────────────────────────────────────────────

  _showIframe() {
    this._pcEl.innerHTML = '';
    if (!this.url) { this._renderPlaceholder('🌐', 'URL eingeben und Enter drücken'); return; }
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    this._pcEl.appendChild(bar);
    const iframe = document.createElement('iframe');
    iframe.src = this.url;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.addEventListener('load', () => bar.remove());
    this._pcEl.appendChild(iframe);
  }

  _showStatic() {
    this._pcEl.innerHTML = '';
    if (this.screenshot) {
      const img = document.createElement('img');
      img.src = this.screenshot; img.draggable = false;
      const ov = document.createElement('div');
      ov.className = 'sc-overlay';
      const hint = document.createElement('span');
      hint.className = 'sc-hint'; hint.textContent = '▶ Live schalten';
      ov.appendChild(hint);
      this._pcEl.appendChild(img); this._pcEl.appendChild(ov);
    } else if (this.url) {
      let host = this.url;
      try { host = new URL(this.url).hostname; } catch {}
      this._renderPlaceholder('🔗', host, '▶ Klicken für Live-Ansicht');
    } else {
      this._renderPlaceholder('🌐', 'URL eingeben und Enter drücken');
    }
  }

  _renderPlaceholder(icon, text, hint = '') {
    const d = document.createElement('div');
    d.className = 'placeholder';
    const iconEl = document.createElement('span'); iconEl.className = 'ph-icon'; iconEl.textContent = icon;
    const textEl = document.createElement('span'); textEl.className = 'ph-text'; textEl.textContent = text;
    d.appendChild(iconEl); d.appendChild(textEl);
    if (hint) {
      const h = document.createElement('span'); h.className = 'ph-hint'; h.textContent = hint;
      d.appendChild(h);
    }
    this._pcEl.appendChild(d);
  }

  // ── Screenshot ───────────────────────────────────────────────────────────────

  async _captureScreenshot() {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 72 });
      const rect = this._pcEl.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;
      const img  = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const cv = document.createElement('canvas');
      cv.width  = Math.max(1, Math.round(rect.width  * dpr));
      cv.height = Math.max(1, Math.round(rect.height * dpr));
      cv.getContext('2d').drawImage(img, -rect.left * dpr, -rect.top * dpr);
      this.screenshot = cv.toDataURL('image/jpeg', 0.72);
    } catch (err) {
      console.warn('[Canvas Browser] Screenshot:', err.message);
    }
  }

  // ── Drag & Resize ────────────────────────────────────────────────────────────

  _dragStart(e) {
    const spX = this.x, spY = this.y, sMX = e.clientX, sMY = e.clientY;
    const onMove = mv => {
      this.x = Math.max(0, spX + (mv.clientX - sMX) / cam.scale);
      this.y = Math.max(0, spY + (mv.clientY - sMY) / cam.scale);
      this._applyGeometry();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      this.mgr.nav.refresh();
      this.mgr.save();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _resizeStart(e, handle) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, sw = this.w, sh = this.h;
    const isE = handle.classList.contains('rh-e')  || handle.classList.contains('rh-se');
    const isS = handle.classList.contains('rh-s')  || handle.classList.contains('rh-se');
    const onMove = mv => {
      if (isE) this.w = Math.max(300, sw + (mv.clientX - sx) / cam.scale);
      if (isS) this.h = Math.max(200, sh + (mv.clientY - sy) / cam.scale);
      this._applyGeometry();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      this.mgr.save();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _applyGeometry() {
    Object.assign(this.el.style, {
      left: this.x + 'px', top: this.y + 'px',
      width: this.w + 'px', height: this.h + 'px',
    });
  }

  _esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  toJSON() {
    return { id: this.id, x: this.x, y: this.y, w: this.w, h: this.h, url: this.url, live: this.live };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigator
// ─────────────────────────────────────────────────────────────────────────────

class Navigator {
  constructor(mgr) {
    this.mgr      = mgr;
    this.visible  = false;
    this.selected = new Set();   // Panel-IDs der markierten Panels
    this._anchor  = null;        // Anker für Shift-Bereichsauswahl

    this.el        = document.getElementById('navigator');
    this.listEl    = document.getElementById('nav-list');
    this.actionsEl = document.getElementById('nav-actions');
    this.tileBtnEl = document.getElementById('nav-tile-btn');

    document.getElementById('nav-close').addEventListener('click', () => this.hide());
    document.getElementById('btn-navigator').addEventListener('click', () => this.toggle());

    this.tileBtnEl.addEventListener('click', () => {
      const panels = [...this.selected]
        .map(id => this.mgr.panels.get(id))
        .filter(Boolean);
      tileSelected(panels);
      this.mgr.save();
      this.mgr.nav.refresh();
      this.clearSelection();
    });

    document.getElementById('nav-fs-multi-btn').addEventListener('click', () => {
      const panels = [...this.selected]
        .map(id => this.mgr.panels.get(id))
        .filter(p => p && p.url);
      if (panels.length) openFsOverlay(panels, null);
    });

    document.getElementById('nav-deselect-btn').addEventListener('click', () => {
      this.clearSelection();
    });
  }

  toggle() { this.visible ? this.hide() : this.show(); }

  show() {
    this.visible = true;
    this.el.classList.remove('nav-hidden');
    document.getElementById('btn-navigator').classList.add('active');
    viewportEl.classList.add('nav-open');
    this.refresh();
  }

  hide() {
    this.visible = false;
    this.el.classList.add('nav-hidden');
    document.getElementById('btn-navigator').classList.remove('active');
    viewportEl.classList.remove('nav-open');
  }

  // ── Auswahl-Logik ──────────────────────────────────────────────────────────

  _onCardClick(panel, e) {
    const panelIds = [...this.mgr.panels.keys()];

    if (e.shiftKey && this._anchor != null) {
      // Shift+Click → Bereich vom Anker bis hier markieren
      const aIdx = panelIds.indexOf(this._anchor);
      const cIdx = panelIds.indexOf(panel.id);
      if (aIdx !== -1 && cIdx !== -1) {
        const [from, to] = aIdx <= cIdx ? [aIdx, cIdx] : [cIdx, aIdx];
        for (let i = from; i <= to; i++) this.selected.add(panelIds[i]);
      }
      this._updateActionBar();
      this.refresh();

    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click → einzeln zur Auswahl hinzufügen / entfernen
      if (this.selected.has(panel.id)) {
        this.selected.delete(panel.id);
      } else {
        this.selected.add(panel.id);
        this._anchor = panel.id;
      }
      this._updateActionBar();
      this.refresh();

    } else {
      // Normaler Klick → Auswahl aufheben, dieses Panel als Anker, navigieren
      this.selected.clear();
      this.selected.add(panel.id);
      this._anchor = panel.id;
      this._updateActionBar();
      this.refresh();
      flyToPanel(panel);
    }
  }

  clearSelection() {
    this.selected.clear();
    this._anchor = null;
    this._updateActionBar();
    this.refresh();
  }

  _updateActionBar() {
    const n = this.selected.size;
    if (n >= 2) {
      this.actionsEl.classList.remove('nav-actions-hidden');
      this.tileBtnEl.textContent = `⊞ Kacheln (${n})`;
      document.getElementById('nav-fs-multi-btn').textContent = `⛶ Vollbild (${n})`;
    } else {
      this.actionsEl.classList.add('nav-actions-hidden');
    }
  }

  refresh() {
    if (!this.visible) return;
    // Gelöschte Panels aus Selektion entfernen
    this.selected.forEach(id => { if (!this.mgr.panels.has(id)) this.selected.delete(id); });
    this._updateActionBar();

    this.listEl.innerHTML = '';
    if (this.mgr.panels.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'nav-empty';
      empty.textContent = 'Keine Panels vorhanden.';
      this.listEl.appendChild(empty);
      return;
    }
    this.mgr.panels.forEach(panel => this.listEl.appendChild(this._createCard(panel)));
  }

  // ── Karte rendern ──────────────────────────────────────────────────────────

  _createCard(panel) {
    const isSelected = this.selected.has(panel.id);
    const isAnchor   = this._anchor === panel.id;

    const card = document.createElement('div');
    card.className = [
      'nav-card',
      panel.live ? 'nav-live'     : '',
      isSelected  ? 'nav-selected' : '',
      isAnchor    ? 'nav-anchor'   : '',
    ].filter(Boolean).join(' ');

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'nav-thumb';
    if (panel.screenshot) {
      const img = document.createElement('img');
      img.src = panel.screenshot;
      thumb.appendChild(img);
    } else {
      thumb.textContent = panel.url ? '🔗' : '🌐';
    }

    // Auswahl-Indikator (oben-links, kein Klick nötig – kommt via Ctrl/Shift)
    if (isSelected) {
      const badge = document.createElement('div');
      badge.className = 'nav-sel-badge';
      badge.textContent = '✓';
      thumb.appendChild(badge);
    }

    // Info-Zeile
    const info = document.createElement('div');
    info.className = 'nav-info';

    const dot = document.createElement('span');
    dot.className = 'nav-dot' + (panel.live ? ' live' : '');
    dot.title = panel.live ? 'Live' : 'Statisch';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'nav-url';
    let label = 'Leeres Panel';
    if (panel.url) {
      try { label = new URL(panel.url).hostname; } catch { label = panel.url; }
    }
    urlSpan.textContent = label;
    urlSpan.title = panel.url || '';

    const fsBtn = document.createElement('button');
    fsBtn.className = 'nav-fs-btn';
    fsBtn.title = panel.isFullscreen ? 'Vollbild beenden' : 'Vollbild';
    fsBtn.textContent = panel.isFullscreen ? '⊡' : '⛶';
    fsBtn.addEventListener('click', e => {
      e.stopPropagation();
      panel.toggleFullscreen();
      this.refresh();
    });

    info.appendChild(dot);
    info.appendChild(urlSpan);
    info.appendChild(fsBtn);

    card.appendChild(thumb);
    card.appendChild(info);

    // Klick-Handler (Ctrl / Shift / normal)
    card.addEventListener('click', e => this._onCardClick(panel, e));

    return card;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PanelManager
// ─────────────────────────────────────────────────────────────────────────────

class PanelManager {
  constructor(el) {
    this.canvasEl = el;
    this.panels   = new Map();
    this.nextId   = 1;
    this._zTop    = 10;
    this.nav      = null; // wird nach Navigator-Erstellung gesetzt
  }

  add(opts = {}) {
    const id = opts.id ?? this.nextId;
    if (id >= this.nextId) this.nextId = id + 1;
    const panel = new Panel({ ...opts, id }, this);
    this.panels.set(id, panel);
    this.canvasEl.appendChild(panel.el);
    this._updateCount();
    this.nav?.refresh();
    return panel;
  }

  remove(id) {
    const p = this.panels.get(id);
    if (!p) return;
    p.el.remove();
    this.panels.delete(id);
    this._updateCount();
    this.nav?.refresh();
    this.save();
  }

  removeAll() {
    this.panels.forEach(p => p.el.remove());
    this.panels.clear();
    this._updateCount();
    this.nav?.refresh();
    this.save();
  }

  bringToFront(panel) {
    this._zTop += 1;
    panel.el.style.zIndex = this._zTop;
  }

  _updateCount() {
    const n    = this.panels.size;
    const live = [...this.panels.values()].filter(p => p.live).length;
    let text   = n === 0 ? '0 Panels' : n === 1 ? '1 Panel' : n + ' Panels';
    if (live > 0) text += ` (${live} live)`;
    document.getElementById('panel-count').textContent = text;
  }

  save() {
    chrome.storage.local.set({
      canvasState: {
        panels: [...this.panels.values()].map(p => p.toJSON()),
        cam:    { ...cam },
      }
    });
  }

  async load() {
    return new Promise(resolve => {
      chrome.storage.local.get('canvasState', ({ canvasState }) => {
        if (canvasState?.cam) {
          cam.tx = canvasState.cam.tx ?? 0;
          cam.ty = canvasState.cam.ty ?? 0;
          cam.scale = canvasState.cam.scale ?? 1;
          applyTransform();
        }
        if (canvasState?.panels?.length) {
          canvasState.panels.forEach(s => this.add(s));
        } else {
          this.add({ x: 40, y: 40 });
        }
        resolve();
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  viewportEl = document.getElementById('viewport');
  canvasEl   = document.getElementById('canvas-area');
  canvasEl.style.width  = CANVAS_W + 'px';
  canvasEl.style.height = CANVAS_H + 'px';
  applyTransform();

  const mgr = new PanelManager(canvasEl);
  const nav = new Navigator(mgr);
  mgr.nav = nav;

  await mgr.load();

  // ── Bridge-Status-Indikator ───────────────────────────────────────────────
  const bridgeStatusEl = document.getElementById('bridge-status');
  const bridgeDotEl    = document.getElementById('bridge-dot');
  const bridgeLabelEl  = document.getElementById('bridge-label');

  async function checkBridgeStatus() {
    try {
      const r = await fetch('http://localhost:3000/status',
        { signal: AbortSignal.timeout(2500) });
      const data = await r.json();
      const online = data.bridge === 'online' && data.extension === 'connected';
      bridgeDotEl.className    = online ? 'online' : 'offline';
      bridgeStatusEl.className = online ? 'online' : 'offline';
      bridgeStatusEl.title     = online
        ? 'Bridge verbunden ✓'
        : `Bridge: ${data.bridge} | Extension: ${data.extension}`;
    } catch {
      bridgeDotEl.className    = 'offline';
      bridgeStatusEl.className = 'offline';
      bridgeStatusEl.title     = 'Bridge nicht erreichbar';
    }
  }

  checkBridgeStatus();
  setInterval(checkBridgeStatus, 5000);

  // ── Pan-Modus ──────────────────────────────────────────────────────────────

  let isPanMode = false, spaceHeld = false, isPanning = false;

  function panReady() { return isPanMode || spaceHeld; }
  function updateCursor() {
    viewportEl.classList.toggle('pan-ready',  panReady() && !isPanning);
    viewportEl.classList.toggle('pan-active', isPanning);
    if (!panReady() && !isPanning) {
      viewportEl.classList.remove('pan-ready', 'pan-active');
    }
  }

  viewportEl.addEventListener('mousedown', e => {
    if (e.button !== 0 || !panReady() || e.target.closest('.panel')) return;
    e.preventDefault();
    isPanning = true; updateCursor();
    const startTx = cam.tx, startTy = cam.ty;
    const startMX = e.clientX, startMY = e.clientY;
    const onMove = mv => {
      cam.tx = startTx + mv.clientX - startMX;
      cam.ty = startTy + mv.clientY - startMY;
      applyTransform();
    };
    const onUp = () => {
      isPanning = false; updateCursor(); mgr.save();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Zoom per Mausrad ────────────────────────────────────────────────────────

  viewportEl.addEventListener('wheel', e => {
    e.preventDefault();
    const rect   = viewportEl.getBoundingClientRect();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    mgr.save();
  }, { passive: false });

  // ── Toolbar ─────────────────────────────────────────────────────────────────

  document.getElementById('btn-pan').addEventListener('click', () => {
    isPanMode = !isPanMode;
    document.getElementById('btn-pan').classList.toggle('active', isPanMode);
    updateCursor();
  });
  document.getElementById('btn-zoom-in').addEventListener('click',  () => { zoomCenter(ZOOM_STEP);       mgr.save(); });
  document.getElementById('btn-zoom-out').addEventListener('click', () => { zoomCenter(1 / ZOOM_STEP);   mgr.save(); });
  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    cam.tx = 0; cam.ty = 0; cam.scale = 1; applyTransform(); mgr.save();
  });

  const addPanel = () => {
    const vw = viewportEl.clientWidth, vh = viewportEl.clientHeight;
    const offset = (mgr.panels.size % 8) * 30;
    const cx = ((vw / 2) - cam.tx) / cam.scale - PANEL_W / 2 + offset;
    const cy = ((vh / 2) - cam.ty) / cam.scale - PANEL_H / 2 + offset;
    const p = mgr.add({ x: Math.max(10, Math.round(cx)), y: Math.max(10, Math.round(cy)) });
    mgr.save();
    p._urlEl.focus();
  };

  // Vollbild-Exit-Button
  document.getElementById('fs-exit').addEventListener('click', closeFsOverlay);

  // Kachelansicht-Badge Exit-Button
  document.getElementById('tile-exit-btn').addEventListener('click', exitTileMode);

  document.getElementById('btn-add').addEventListener('click', addPanel);
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (mgr.panels.size === 0) return;
    if (confirm(`Alle ${mgr.panels.size} Panels löschen?`)) mgr.removeAll();
  });

  // ── Tastaturkürzel ──────────────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.target.matches('input, textarea')) {
      e.preventDefault(); spaceHeld = true; updateCursor();
    }
    if (e.key === 'Escape') {
      const fsOverlay = document.getElementById('fs-overlay');
      if (!fsOverlay.classList.contains('fs-hidden')) {
        closeFsOverlay();   // Vollbild (single oder multi) schließen
      } else {
        exitTileMode();     // Canvas-Kachelansicht beenden
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); addPanel(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault(); zoomCenter(ZOOM_STEP); mgr.save();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault(); zoomCenter(1 / ZOOM_STEP); mgr.save();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault(); cam.tx = 0; cam.ty = 0; cam.scale = 1; applyTransform(); mgr.save();
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceHeld = false; updateCursor(); }
  });

  // ── Bridge: Befehle von background.js empfangen ───────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        sendResponse(await handleBridgeCmd(msg.cmd, msg.payload || {}));
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true; // async response
  });

  async function handleBridgeCmd(cmd, payload) {
    switch (cmd) {

      case 'getPanels':
        return {
          panels: [...mgr.panels.values()].map(p => ({
            id: p.id, url: p.url, live: p.live,
            x: p.x, y: p.y, w: p.w, h: p.h,
          }))
        };

      case 'openPanel': {
        const vw = viewportEl.clientWidth, vh = viewportEl.clientHeight;
        const offset = (mgr.panels.size % 8) * 30;
        const cx = ((vw / 2) - cam.tx) / cam.scale - PANEL_W / 2 + offset;
        const cy = ((vh / 2) - cam.ty) / cam.scale - PANEL_H / 2 + offset;
        const p = mgr.add({
          x: Math.max(10, Math.round(cx)),
          y: Math.max(10, Math.round(cy)),
          url: payload.url,
          live: true,
        });
        mgr.save();
        return { ok: true, id: p.id };
      }

      case 'navigate': {
        const p = mgr.panels.get(payload.id);
        if (!p) return { error: 'Panel nicht gefunden' };
        p.navigate(payload.url);
        return { ok: true };
      }

      case 'closePanel': {
        mgr.remove(payload.id);
        return { ok: true };
      }

      case 'setLive': {
        const p = mgr.panels.get(payload.id);
        if (!p) return { error: 'Panel nicht gefunden' };
        await p.setLive(payload.live);
        return { ok: true };
      }

      case 'tileAll': {
        const all = [...mgr.panels.values()];
        if (all.length < 2) return { error: 'Weniger als 2 Panels vorhanden' };
        tileSelected(all);
        mgr.save();
        return { ok: true };
      }

      case 'tilePanels': {
        const panels = (payload.ids || [])
          .map(id => mgr.panels.get(id))
          .filter(Boolean);
        if (panels.length < 2) return { error: 'Weniger als 2 gültige Panel-IDs' };
        tileSelected(panels);
        mgr.save();
        return { ok: true };
      }

      case 'fullscreen': {
        const p = mgr.panels.get(payload.id);
        if (!p) return { error: 'Panel nicht gefunden' };
        p.enterFullscreen();
        return { ok: true };
      }

      case 'closeFullscreen': {
        closeFsOverlay();
        return { ok: true };
      }

      case 'setCamera': {
        if (payload.tx    !== undefined) cam.tx    = payload.tx;
        if (payload.ty    !== undefined) cam.ty    = payload.ty;
        if (payload.scale !== undefined) cam.scale = payload.scale;
        applyTransform();
        mgr.save();
        return { ok: true };
      }

      default:
        return { error: `Unbekannter Befehl: ${cmd}` };
    }
  }
});
