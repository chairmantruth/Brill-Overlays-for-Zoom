/* Brill Overlays — editor UI, preview interactions, persistence, Zoom sync. */
(function () {
  'use strict';
  const R = window.OverlayRenderer;
  const Z = window.ZoomBridge;
  const W = R.DESIGN_W, H = R.DESIGN_H;

  // ------------------------------------------------------------------ state
  const state = {
    layers: [],
    selectedId: null,
    settings: {
      guides: true, snap: true, flip: false, mirrorCamera: false,
      mirrorPreview: false, hideAll: false, margin: 40, cleanBg: 'webcam',
    },
  };
  const assets = new Map(); // assetId -> dataURL
  const images = new Map(); // assetId -> HTMLImageElement

  const $ = (s, el = document) => el.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const selected = () => state.layers.find((l) => l.id === state.selectedId) || null;

  // ------------------------------------------------------------------ defaults & presets
  function newNameTag(over = {}) {
    const n = state.layers.filter((l) => l.type === 'name').length;
    return {
      id: uid(), type: 'name', label: n ? `Name tag ${n + 1}` : 'Name tag', visible: true,
      x: 40, y: 560, w: 520, h: 120, rotation: 0,
      name: 'Your Name', title: 'Your title · Company', showTitle: true,
      uppercase: false, italic: false,
      font: 'sans', weight: 700, titleWeight: 500,
      autoFit: true, nameSize: 44, titleSize: 24, titleRatio: 0.5,
      align: 'left', valign: 'middle', letterSpacing: 0,
      nameColor: '#ffffff', titleColor: '#9cc7ff',
      shape: 'lowerthird', radius: 16, padding: 18,
      fill: '#0b1f3a', fill2: '#2d8cff', gradient: false, fillOpacity: 0.92,
      borderColor: '#ffffff', borderWidth: 0, accent: '#2d8cff',
      shadow: true, textShadow: false,
      ...over,
    };
  }

  function newImageLayer(assetId, natW, natH, label) {
    const maxW = 340, maxH = 240;
    const s = Math.min(1, maxW / natW, maxH / natH);
    const w = Math.round(natW * s), h = Math.round(natH * s);
    const m = state.settings.margin;
    return {
      id: uid(), type: 'image', label: label || 'Image', visible: true, assetId,
      x: W - w - m, y: m, w, h, rotation: 0, natW, natH,
      opacity: 1, mask: 'none', radius: 24, fit: 'fill', lockAspect: true,
      borderColor: '#ffffff', borderWidth: 0, shadow: false,
    };
  }

  const STYLE_PRESETS = {
    broadcast: { label: 'Broadcast', swatch: '#0b1f3a', p: { shape: 'lowerthird', fill: '#0b1f3a', fillOpacity: 0.92, gradient: false, accent: '#2d8cff', nameColor: '#ffffff', titleColor: '#9cc7ff', borderWidth: 0, align: 'left', shadow: true, textShadow: false, font: 'sans', uppercase: false } },
    pill: { label: 'Clean pill', swatch: '#ffffff', p: { shape: 'pill', fill: '#ffffff', fillOpacity: 0.96, gradient: false, nameColor: '#111827', titleColor: '#4b5563', borderWidth: 0, align: 'center', shadow: true, textShadow: false, font: 'sans', uppercase: false } },
    neon: { label: 'Neon', swatch: '#ff2bd6', p: { shape: 'rounded', radius: 18, fill: '#12001f', fillOpacity: 0.85, gradient: false, borderColor: '#ff2bd6', borderWidth: 3, nameColor: '#ffffff', titleColor: '#ff9cf0', align: 'left', shadow: true, textShadow: false, font: 'sans', uppercase: false } },
    sunset: { label: 'Gradient', swatch: '#ff512f', p: { shape: 'slant', fill: '#ff512f', fill2: '#dd2476', gradient: true, fillOpacity: 1, nameColor: '#ffffff', titleColor: '#ffe3ec', borderWidth: 0, align: 'center', shadow: true, textShadow: false, font: 'sans', uppercase: true } },
    minimal: { label: 'Minimal', swatch: '#ffcc00', p: { shape: 'underline', accent: '#ffcc00', nameColor: '#ffffff', titleColor: '#f1f1f1', align: 'left', textShadow: true, font: 'sans', uppercase: false } },
    ribbon: { label: 'Ribbon', swatch: '#c62828', p: { shape: 'ribbon', fill: '#c62828', fillOpacity: 1, gradient: false, nameColor: '#ffffff', titleColor: '#ffd6d6', borderWidth: 0, align: 'center', shadow: true, textShadow: false, font: 'condensed', uppercase: true } },
    glass: { label: 'Glass', swatch: '#9fb4d6', p: { shape: 'rounded', radius: 22, fill: '#ffffff', fillOpacity: 0.16, gradient: false, borderColor: '#ffffff', borderWidth: 1.5, nameColor: '#ffffff', titleColor: '#e2e8f0', align: 'left', shadow: false, textShadow: true, font: 'sans', uppercase: false } },
    news: { label: 'News', swatch: '#ffcc00', p: { shape: 'tab', radius: 10, fill: '#ffcc00', fillOpacity: 1, gradient: false, nameColor: '#111111', titleColor: '#3a3a3a', borderWidth: 0, align: 'left', shadow: true, textShadow: false, font: 'impact', uppercase: true } },
  };

  // ------------------------------------------------------------------ DOM refs
  const stage = $('#stage');
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const video = $('#cam');
  const inspector = $('#inspector');
  const layerList = $('#layerList');

  // ------------------------------------------------------------------ toast / log
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function log(msg) {
    const el = $('#log');
    const d = document.createElement('div');
    d.textContent = msg;
    el.appendChild(d);
    while (el.children.length > 40) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
    console.log('[overlay]', msg);
  }

  // ------------------------------------------------------------------ change pipeline
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  let saveTimer, syncTimer;
  function changed({ structure = false, inspectorRebuild = false, fast = false } = {}) {
    requestRender();
    if (structure) renderLayerList();
    else updateLayerListLabels();
    if (inspectorRebuild) renderInspector();
    else syncInspectorValues();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToZoom, fast ? 60 : 140);
  }

  function zoomOpts() {
    return { flip: state.settings.flip, hideAll: state.settings.hideAll, mirrorCamera: state.settings.mirrorCamera };
  }
  function pushToZoom() {
    if (!Z.live) return;
    Z.sync(state.layers.map((l) => ({ ...l })), images, zoomOpts()).catch((e) => log('Sync error: ' + (e.message || e)));
  }

  // ------------------------------------------------------------------ preview rendering
  let view = { k: 1, dpr: 1 };
  let snapGuides = [];
  let hover = null;

  function resizeCanvas() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    view = { k: r.width / W, dpr };
    requestRender();
  }
  new ResizeObserver(resizeCanvas).observe(stage);

  function render() {
    const { k, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    R.renderAll(ctx, state.layers, images, { dimmed: state.settings.hideAll });

    const clean = document.body.classList.contains('clean');
    if (clean) return;
    const px = 1 / k; // one screen pixel in design units

    if (state.settings.guides) {
      const m = state.settings.margin;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = px;
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.stroke();
      ctx.restore();
    }

    if (state.settings.hideAll) {
      ctx.save();
      ctx.font = `600 ${14 * px}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'center';
      ctx.fillText('Overlays hidden — press H or “Show all”', W / 2, 26 * px);
      ctx.restore();
    }

    // hover outline
    if (hover && hover !== state.selectedId && !drag) {
      const L = state.layers.find((l) => l.id === hover);
      if (L) drawBoxOutline(L, 'rgba(120,170,255,0.6)', px, false);
    }
    // snap guides
    if (snapGuides.length) {
      ctx.save();
      ctx.strokeStyle = '#ff3bd4';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const g of snapGuides) {
        if (g.axis === 'x') { ctx.moveTo(g.v, 0); ctx.lineTo(g.v, H); }
        else { ctx.moveTo(0, g.v); ctx.lineTo(W, g.v); }
      }
      ctx.stroke();
      ctx.restore();
    }
    // selection
    const S = selected();
    if (S) drawBoxOutline(S, '#4d8dff', px, true);
  }

  function drawBoxOutline(L, color, px, handles) {
    ctx.save();
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((L.rotation || 0) * Math.PI) / 180);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash(handles ? [] : [4 * px, 3 * px]);
    ctx.strokeRect(-L.w / 2, -L.h / 2, L.w, L.h);
    if (handles) {
      // rotation stem
      ctx.beginPath();
      ctx.moveTo(0, -L.h / 2);
      ctx.lineTo(0, -L.h / 2 - ROT_OFFSET * px);
      ctx.stroke();
      const hs = 9 * px;
      for (const h of HANDLES) {
        const [hx, hy] = h.v;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(hx * L.w / 2 - hs / 2, hy * L.h / 2 - hs / 2, hs, hs);
        ctx.strokeRect(hx * L.w / 2 - hs / 2, hy * L.h / 2 - hs / 2, hs, hs);
      }
      ctx.beginPath();
      ctx.arc(0, -L.h / 2 - ROT_OFFSET * px, 6 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#4d8dff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      // size label
      ctx.rotate(-((L.rotation || 0) * Math.PI) / 180);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ stage interactions
  const HANDLES = [
    { id: 'nw', v: [-1, -1], cur: 'nwse-resize' }, { id: 'n', v: [0, -1], cur: 'ns-resize' },
    { id: 'ne', v: [1, -1], cur: 'nesw-resize' }, { id: 'e', v: [1, 0], cur: 'ew-resize' },
    { id: 'se', v: [1, 1], cur: 'nwse-resize' }, { id: 's', v: [0, 1], cur: 'ns-resize' },
    { id: 'sw', v: [-1, 1], cur: 'nesw-resize' }, { id: 'w', v: [-1, 0], cur: 'ew-resize' },
  ];
  const ROT_OFFSET = 26;
  const MIN_SIZE = 20;
  let drag = null;

  function toDesign(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function toLocal(L, p) {
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    const a = (-(L.rotation || 0) * Math.PI) / 180;
    const dx = p.x - cx, dy = p.y - cy;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  }
  function rotateVec(x, y, deg) {
    const a = (deg * Math.PI) / 180;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }
  function hitLayer(p) {
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const L = state.layers[i];
      if (!L.visible) continue;
      const lp = toLocal(L, p);
      if (Math.abs(lp.x) <= L.w / 2 && Math.abs(lp.y) <= L.h / 2) return L;
    }
    return null;
  }
  function hitHandle(L, p) {
    const px = 1 / view.k;
    const lp = toLocal(L, p);
    const r = 10 * px;
    if (Math.hypot(lp.x, lp.y - (-L.h / 2 - ROT_OFFSET * px)) <= r) return { id: 'rot', cur: 'grab' };
    for (const h of HANDLES) {
      if (Math.abs(lp.x - h.v[0] * L.w / 2) <= r && Math.abs(lp.y - h.v[1] * L.h / 2) <= r) return h;
    }
    return null;
  }
  function rotatedCursor(h, L) {
    if (!L.rotation || h.id === 'rot') return h.cur;
    const order = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
    const base = { n: 0, s: 0, ne: 1, sw: 1, e: 2, w: 2, nw: 3, se: 3 }[h.id];
    const steps = Math.round((((L.rotation % 180) + 180) % 180) / 45);
    return order[(base + steps) % 4];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('clean')) return;
    const p = toDesign(e);
    const S = selected();
    if (S) {
      const h = hitHandle(S, p);
      if (h) {
        drag = h.id === 'rot'
          ? { mode: 'rotate', id: S.id, orig: { ...S } }
          : { mode: 'resize', id: S.id, h, orig: { ...S } };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const L = hitLayer(p);
    if (L) {
      if (state.selectedId !== L.id) select(L.id);
      drag = { mode: 'move', id: L.id, start: p, orig: { ...L }, moved: false };
      canvas.setPointerCapture(e.pointerId);
    } else {
      select(null);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toDesign(e);
    $('#coords').textContent = `${Math.round(clamp(p.x, 0, W))}, ${Math.round(clamp(p.y, 0, H))}`;
    if (!drag) {
      const S = selected();
      const h = S && hitHandle(S, p);
      const L = hitLayer(p);
      canvas.style.cursor = h ? rotatedCursor(h, S) : L ? 'move' : 'default';
      const hv = L ? L.id : null;
      if (hv !== hover) { hover = hv; requestRender(); }
      return;
    }
    const L = state.layers.find((l) => l.id === drag.id);
    if (!L) return;
    if (drag.mode === 'move') doMove(L, p, e);
    else if (drag.mode === 'resize') doResize(L, p, e);
    else if (drag.mode === 'rotate') doRotate(L, p, e);
    changed({ fast: true });
  });

  function endDrag() {
    if (!drag) return;
    drag = null;
    snapGuides = [];
    requestRender();
    changed();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { $('#coords').textContent = ''; if (hover) { hover = null; requestRender(); } });
  canvas.addEventListener('dblclick', (e) => {
    const L = hitLayer(toDesign(e));
    if (L && L.type === 'name') {
      const input = inspector.querySelector('[data-prop="name"]');
      if (input) { input.focus(); input.select(); }
    }
  });

  function doMove(L, p, e) {
    let nx = drag.orig.x + (p.x - drag.start.x);
    let ny = drag.orig.y + (p.y - drag.start.y);
    if (e.shiftKey) { // constrain to an axis
      if (Math.abs(p.x - drag.start.x) > Math.abs(p.y - drag.start.y)) ny = drag.orig.y; else nx = drag.orig.x;
    }
    snapGuides = [];
    if (state.settings.snap && !e.altKey) {
      const b = R.layerBounds({ ...L, x: nx, y: ny });
      const thr = 7 / view.k;
      const m = state.settings.margin;
      const xs = [0, m, W / 2, W - m, W];
      const ys = [0, m, H / 2, H - m, H];
      for (const o of state.layers) {
        if (o.id === L.id || !o.visible) continue;
        const ob = R.layerBounds(o);
        xs.push(ob.x, ob.x + ob.w / 2, ob.x + ob.w);
        ys.push(ob.y, ob.y + ob.h / 2, ob.y + ob.h);
      }
      const snapAxis = (edges, targets, axis) => {
        let best = null;
        for (const ed of edges) for (const t of targets) {
          const d = t - ed;
          if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: t };
        }
        if (best) snapGuides.push({ axis, v: best.v });
        return best ? best.d : 0;
      };
      nx += snapAxis([b.x, b.x + b.w / 2, b.x + b.w], xs, 'x');
      ny += snapAxis([b.y, b.y + b.h / 2, b.y + b.h], ys, 'y');
    }
    L.x = Math.round(nx);
    L.y = Math.round(ny);
  }

  function doResize(L, p, e) {
    const o = drag.orig;
    const [hx, hy] = drag.h.v;
    const lp = toLocal(o, p);
    const fromCenter = e.altKey;
    const ax = fromCenter ? 0 : -hx * o.w / 2;
    const ay = fromCenter ? 0 : -hy * o.h / 2;
    let nw = hx ? Math.max(MIN_SIZE, (lp.x - ax) * hx * (fromCenter ? 2 : 1)) : o.w;
    let nh = hy ? Math.max(MIN_SIZE, (lp.y - ay) * hy * (fromCenter ? 2 : 1)) : o.h;

    const lock = (L.type === 'image' && L.lockAspect) !== e.shiftKey;
    if (lock) {
      const ratio = o.w / o.h;
      if (hx && hy) { if (nw / ratio > nh) nh = nw / ratio; else nw = nh * ratio; }
      else if (hx) nh = nw / ratio;
      else nw = nh * ratio;
    }
    const cxl = fromCenter || !hx ? 0 : ax + hx * nw / 2;
    const cyl = fromCenter || !hy ? 0 : ay + hy * nh / 2;
    const off = rotateVec(cxl, cyl, o.rotation || 0);
    const wcx = o.x + o.w / 2 + off.x, wcy = o.y + o.h / 2 + off.y;
    L.w = Math.round(nw);
    L.h = Math.round(nh);
    L.x = Math.round(wcx - nw / 2);
    L.y = Math.round(wcy - nh / 2);
  }

  function doRotate(L, p, e) {
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else for (const s of [0, 90, 180, 270, 360, -90]) if (Math.abs(a - s) < 3) a = s;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    L.rotation = Math.round(a);
  }

  // ------------------------------------------------------------------ selection & layer ops
  function select(id) {
    state.selectedId = id;
    renderLayerList();
    renderInspector();
    requestRender();
  }
  function addLayer(L) {
    state.layers.push(L);
    state.selectedId = L.id;
    changed({ structure: true, inspectorRebuild: true });
  }
  function removeLayer(id) {
    const i = state.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [L] = state.layers.splice(i, 1);
    if (L.type === 'image' && !state.layers.some((l) => l.assetId === L.assetId)) {
      assets.delete(L.assetId);
      images.delete(L.assetId);
    }
    if (state.selectedId === id) state.selectedId = state.layers[Math.min(i, state.layers.length - 1)]?.id || null;
    changed({ structure: true, inspectorRebuild: true });
  }
  function duplicateLayer(id) {
    const L = state.layers.find((l) => l.id === id);
    if (!L) return;
    const copy = { ...L, id: uid(), label: L.label + ' copy', x: L.x + 20, y: L.y + 20 };
    const i = state.layers.indexOf(L);
    state.layers.splice(i + 1, 0, copy);
    state.selectedId = copy.id;
    changed({ structure: true, inspectorRebuild: true });
  }
  function moveLayer(id, dir) {
    const i = state.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.layers.length) return;
    [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
    changed({ structure: true });
  }

  // ------------------------------------------------------------------ layer list
  function renderLayerList() {
    if (!state.layers.length) {
      layerList.innerHTML = '<li class="empty" style="cursor:default">No overlays yet — add a name tag or an image.</li>';
      return;
    }
    const items = [...state.layers].reverse().map((L) => {
      const thumb = L.type === 'image'
        ? `<span class="thumb"><img alt="" src="${esc(assets.get(L.assetId) || '')}"></span>`
        : `<span class="thumb" style="background:${esc(L.shape === 'underline' || L.shape === 'none' ? '#0d1018' : L.fill)};color:${esc(L.nameColor)}">Aa</span>`;
      const sub = L.type === 'image' ? `${L.w}×${L.h}` : esc(L.name);
      return `<li data-id="${L.id}" class="${L.id === state.selectedId ? 'sel' : ''} ${L.visible ? '' : 'hidden-layer'}">
        <button class="vis" data-act="vis" title="${L.visible ? 'Hide' : 'Show'}" style="background:none;border:0;cursor:pointer;font-size:14px;padding:0 2px">${L.visible ? '👁' : '🚫'}</button>
        ${thumb}
        <span class="lname"><span data-role="label">${esc(L.label)}</span><small data-role="sub">${sub}</small></span>
        <span class="acts">
          <button data-act="up" title="Bring forward">▲</button>
          <button data-act="down" title="Send backward">▼</button>
          <button data-act="dup" title="Duplicate">⧉</button>
          <button data-act="del" title="Delete">✕</button>
        </span></li>`;
    });
    layerList.innerHTML = items.join('');
  }
  function updateLayerListLabels() {
    for (const li of layerList.querySelectorAll('li[data-id]')) {
      const L = state.layers.find((l) => l.id === li.dataset.id);
      if (!L) continue;
      li.querySelector('[data-role="label"]').textContent = L.label;
      li.querySelector('[data-role="sub"]').textContent = L.type === 'image' ? `${L.w}×${L.h}` : L.name;
      const th = li.querySelector('.thumb');
      if (L.type === 'name') {
        th.style.background = L.shape === 'underline' || L.shape === 'none' ? '#0d1018' : L.fill;
        th.style.color = L.nameColor;
      }
    }
  }
  layerList.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const L = state.layers.find((l) => l.id === id);
    if (act === 'vis') { L.visible = !L.visible; changed({ structure: true }); }
    else if (act === 'up') moveLayer(id, 1);
    else if (act === 'down') moveLayer(id, -1);
    else if (act === 'dup') duplicateLayer(id);
    else if (act === 'del') removeLayer(id);
    else select(id);
  });

  // ------------------------------------------------------------------ inspector (forms)
  const num = (prop, label, opts = {}) =>
    `<label class="field numf"><b>${label}</b><input type="number" data-prop="${prop}" data-kind="num" step="${opts.step || 1}" ${opts.min != null ? `min="${opts.min}"` : ''} ${opts.max != null ? `max="${opts.max}"` : ''}></label>`;
  const range = (prop, label, min, max, step, fmt = '') =>
    `<div class="field"><span>${label}</span><div class="row"><input type="range" data-prop="${prop}" data-kind="num" min="${min}" max="${max}" step="${step}"><output data-out="${prop}" data-fmt="${fmt}"></output></div></div>`;
  const color = (prop, label) =>
    `<label class="colorf"><input type="color" data-prop="${prop}" data-kind="color"><span>${label}</span></label>`;
  const check = (prop, label) =>
    `<label class="chk"><input type="checkbox" data-prop="${prop}" data-kind="bool"> ${label}</label>`;
  const text = (prop, label, ph = '') =>
    `<label class="field"><span>${label}</span><input type="text" data-prop="${prop}" data-kind="text" placeholder="${esc(ph)}"></label>`;
  const select_ = (prop, label, options, kind = 'text') =>
    `<label class="field"><span>${label}</span><select data-prop="${prop}" data-kind="${kind}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
  const seg = (prop, options, kind = 'text') =>
    `<div class="seg" data-seg="${prop}" data-kind="${kind}">${options.map(([v, t, title]) => `<button type="button" data-value="${v}" title="${esc(title || t)}">${t}</button>`).join('')}</div>`;

  function geometrySection(L) {
    return `<details open><summary><h3>Position &amp; bounding box</h3></summary>
      <div class="field-grid">
        <div class="row" style="align-items:flex-start;gap:12px">
          <div>
            <div class="lbl" style="margin-bottom:4px">Snap to</div>
            <div class="posgrid">${['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((p) => `<button type="button" data-pos="${p}" title="${p}"></button>`).join('')}</div>
          </div>
          <div class="field-grid" style="flex:1">
            <div class="cols2">${num('x', 'X')}${num('y', 'Y')}</div>
            <div class="cols2">${num('w', 'W', { min: MIN_SIZE })}${num('h', 'H', { min: MIN_SIZE })}</div>
          </div>
        </div>
        ${range('rotation', 'Rotation', -180, 180, 1, '°')}
        ${L.type === 'name' ? `<div class="presets">
            <button type="button" data-geo="lower">Lower third</button>
            <button type="button" data-geo="compact">Compact</button>
            <button type="button" data-geo="banner">Full-width banner</button>
            <button type="button" data-geo="corner">Top corner</button>
          </div>` : `<div class="checks">${check('lockAspect', 'Lock aspect ratio')}<button type="button" class="btn sm ghost" data-act="natural">Reset ratio</button></div>`}
      </div></details>`;
  }

  function nameInspector(L) {
    return `
      <details open><summary><h3>Text</h3></summary>
        <div class="field-grid">
          ${text('name', 'Name', 'Your name')}
          ${text('title', 'Subtitle (role, company, pronouns…)', 'Optional')}
          <div class="checks">${check('showTitle', 'Show subtitle')}${check('uppercase', 'UPPERCASE')}${check('italic', 'Italic')}</div>
        </div>
      </details>
      <details open><summary><h3>Quick styles</h3></summary>
        <div class="presets">${Object.entries(STYLE_PRESETS).map(([k, v]) => `<button type="button" data-preset="${k}"><i style="background:${v.swatch}"></i>${v.label}</button>`).join('')}</div>
      </details>
      ${geometrySection(L)}
      <details open><summary><h3>Shape</h3></summary>
        <div class="field-grid">
          <div class="shapes" id="shapePicker"></div>
          <div data-show-if="shape:rounded,tab,bubble">${range('radius', 'Corner radius', 0, 80, 1, 'px')}</div>
          ${range('padding', 'Inner padding', 0, 80, 1, 'px')}
        </div>
      </details>
      <details open><summary><h3>Fill &amp; border</h3></summary>
        <div class="field-grid">
          <div data-hide-if="shape:underline,none" class="field-grid">
            <div class="row wrap" style="gap:12px">${color('fill', 'Fill')}${check('gradient', 'Gradient')}<span data-show-if="gradient:true">${color('fill2', 'to')}</span></div>
            ${range('fillOpacity', 'Fill opacity', 0, 1, 0.01, '%')}
            <div class="row" style="gap:12px">${color('borderColor', 'Border')}<div style="flex:1">${range('borderWidth', 'Border width', 0, 16, 0.5, 'px')}</div></div>
          </div>
          <div data-show-if="shape:lowerthird,underline">${color('accent', 'Accent color')}</div>
          <div class="checks">${check('shadow', 'Drop shadow')}${check('textShadow', 'Text shadow')}</div>
        </div>
      </details>
      <details open><summary><h3>Typography</h3></summary>
        <div class="field-grid">
          <div class="cols2">
            ${select_('font', 'Font', [['sans', 'Sans'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['condensed', 'Condensed'], ['impact', 'Impact'], ['trebuchet', 'Trebuchet'], ['mono', 'Mono']])}
            ${select_('weight', 'Name weight', [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']], 'num')}
          </div>
          <div class="row wrap" style="gap:12px">${color('nameColor', 'Name')}${color('titleColor', 'Subtitle')}</div>
          <div class="row wrap" style="justify-content:space-between">
            ${seg('align', [['left', '⇤', 'Align left'], ['center', '↔', 'Center'], ['right', '⇥', 'Align right']])}
            ${seg('valign', [['top', '⤒', 'Top'], ['middle', '↕', 'Middle'], ['bottom', '⤓', 'Bottom']])}
          </div>
          ${check('autoFit', 'Auto-fit text to the bounding box')}
          <div data-show-if="autoFit:true">${range('titleRatio', 'Subtitle size (relative)', 0.25, 1, 0.01, '%')}</div>
          <div data-show-if="autoFit:false" class="cols2">${num('nameSize', 'Aa', { min: 6, max: 300 })}${num('titleSize', 'aa', { min: 6, max: 200 })}</div>
          ${range('letterSpacing', 'Letter spacing', -2, 12, 0.5, 'px')}
        </div>
      </details>`;
  }

  function imageInspector(L) {
    return `
      <div class="row gap6" style="margin-bottom:10px">
        <span class="thumb" style="width:64px;height:40px;border-radius:6px;background:#0d1018;display:grid;place-items:center;overflow:hidden"><img alt="" style="max-width:100%;max-height:100%" src="${esc(assets.get(L.assetId) || '')}"></span>
        <button type="button" class="btn sm" data-act="replace">Replace image…</button>
      </div>
      ${geometrySection(L)}
      <details open><summary><h3>Appearance</h3></summary>
        <div class="field-grid">
          ${range('opacity', 'Opacity', 0, 1, 0.01, '%')}
          <div class="field"><span>Shape / mask</span>${seg('mask', [['none', 'Rectangle'], ['rounded', 'Rounded'], ['circle', 'Circle']])}</div>
          <div data-show-if="mask:rounded">${range('radius', 'Corner radius', 0, 200, 1, 'px')}</div>
          <div class="field"><span>Fit inside box</span>${seg('fit', [['fill', 'Stretch'], ['contain', 'Contain'], ['cover', 'Cover']])}</div>
          <div class="row" style="gap:12px">${color('borderColor', 'Border')}<div style="flex:1">${range('borderWidth', 'Border width', 0, 20, 0.5, 'px')}</div></div>
          ${check('shadow', 'Drop shadow')}
        </div>
      </details>`;
  }

  function renderInspector() {
    const L = selected();
    if (!L) {
      inspector.innerHTML = '<div class="muted-box">Select an overlay to edit it,<br>or add a <b>name tag</b> / <b>image</b>.</div>';
      return;
    }
    const openState = {};
    inspector.querySelectorAll('details').forEach((d) => { openState[d.querySelector('h3')?.textContent] = d.open; });
    inspector.innerHTML = `
      <div class="insp-head">
        <input type="text" data-prop="label" data-kind="text" title="Layer name">
        <button type="button" class="btn sm ghost" data-act="dup" title="Duplicate (Ctrl/Cmd+D)">⧉</button>
        <button type="button" class="btn sm ghost danger" data-act="del" title="Delete (Del)">🗑</button>
      </div>
      ${L.type === 'name' ? nameInspector(L) : imageInspector(L)}`;
    inspector.querySelectorAll('details').forEach((d) => {
      const k = d.querySelector('h3')?.textContent;
      if (k in openState) d.open = openState[k];
    });
    if (L.type === 'name') buildShapePicker(L);
    syncInspectorValues(true);
  }

  function buildShapePicker(L) {
    const host = $('#shapePicker');
    if (!host) return;
    host.innerHTML = '';
    for (const s of R.SHAPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.title = s.label;
      b.appendChild(R.shapeThumb(s.id));
      const t = document.createElement('span');
      t.textContent = s.label;
      b.appendChild(t);
      host.appendChild(b);
    }
  }

  function fmtOut(v, fmt) {
    if (fmt === '%') return Math.round(v * 100) + '%';
    return (Math.round(v * 10) / 10) + (fmt || '');
  }

  function syncInspectorValues(force = false) {
    const L = selected();
    if (!L) return;
    inspector.querySelectorAll('[data-prop]').forEach((el) => {
      if (!force && el === document.activeElement && el.type !== 'range') return;
      const v = L[el.dataset.prop];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (v !== undefined) el.value = v;
    });
    inspector.querySelectorAll('output[data-out]').forEach((o) => {
      const v = L[o.dataset.out];
      o.textContent = v === undefined ? '' : fmtOut(v, o.dataset.fmt);
    });
    inspector.querySelectorAll('[data-seg]').forEach((s) => {
      const v = String(L[s.dataset.seg]);
      s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v));
    });
    inspector.querySelectorAll('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === L.shape));
    const pos = detectPos(L);
    inspector.querySelectorAll('[data-pos]').forEach((b) => b.classList.toggle('on', b.dataset.pos === pos));
    const check = (attr, show) => inspector.querySelectorAll(`[${attr}]`).forEach((el) => {
      const [prop, vals] = el.getAttribute(attr).split(':');
      const match = vals.split(',').includes(String(L[prop]));
      el.style.display = (show ? match : !match) ? '' : 'none';
    });
    check('data-show-if', true);
    check('data-hide-if', false);
  }

  function readValue(el) {
    const kind = el.dataset.kind;
    if (kind === 'bool') return el.checked;
    if (kind === 'num') { const n = parseFloat(el.value); return Number.isFinite(n) ? n : 0; }
    return el.value;
  }

  inspector.addEventListener('input', (e) => {
    const el = e.target.closest('[data-prop]');
    const L = selected();
    if (!el || !L) return;
    const prop = el.dataset.prop;
    let v = readValue(el);
    if ((prop === 'w' || prop === 'h') && v < MIN_SIZE) return; // wait until the user finishes typing
    if (L.type === 'image' && L.lockAspect && (prop === 'w' || prop === 'h')) {
      const ratio = L.w / L.h;
      if (prop === 'w') L.h = Math.round(v / ratio); else L.w = Math.round(v * ratio);
    }
    L[prop] = v;
    changed({ structure: prop === 'visible' });
  });
  inspector.addEventListener('change', (e) => {
    const el = e.target.closest('[data-prop]');
    const L = selected();
    if (!el || !L) return;
    if ((el.dataset.prop === 'w' || el.dataset.prop === 'h')) {
      L[el.dataset.prop] = Math.max(MIN_SIZE, readValue(el));
      changed();
    }
    syncInspectorValues(true);
  });

  inspector.addEventListener('click', (e) => {
    const L = selected();
    if (!L) return;
    const t = e.target;
    const segBtn = t.closest('[data-seg] button');
    if (segBtn) {
      const segEl = segBtn.parentElement;
      L[segEl.dataset.seg] = segEl.dataset.kind === 'num' ? Number(segBtn.dataset.value) : segBtn.dataset.value;
      if (segEl.dataset.seg === 'mask' && L.mask === 'circle' && L.fit === 'fill') L.fit = 'cover';
      return changed();
    }
    const shapeBtn = t.closest('[data-shape]');
    if (shapeBtn) {
      L.shape = shapeBtn.dataset.shape;
      if ((L.shape === 'underline' || L.shape === 'none') && !L.textShadow) L.textShadow = true;
      return changed();
    }
    const posBtn = t.closest('[data-pos]');
    if (posBtn) { applyPos(L, posBtn.dataset.pos); return changed(); }
    const preset = t.closest('[data-preset]');
    if (preset) { Object.assign(L, STYLE_PRESETS[preset.dataset.preset].p); return changed(); }
    const geo = t.closest('[data-geo]');
    if (geo) { applyGeo(L, geo.dataset.geo); return changed(); }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'del') removeLayer(L.id);
    else if (act === 'dup') duplicateLayer(L.id);
    else if (act === 'replace') $('#replaceInput').click();
    else if (act === 'natural' && L.natW) {
      const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
      L.h = Math.round(L.w * (L.natH / L.natW));
      L.x = Math.round(cx - L.w / 2); L.y = Math.round(cy - L.h / 2);
      changed();
    }
  });

  // position presets (9-grid), based on the rotated bounds
  function applyPos(L, pos) {
    const m = state.settings.margin;
    const b = R.layerBounds(L);
    const dx = L.x - b.x, dy = L.y - b.y;
    const col = pos[1], row = pos[0];
    const bx = col === 'l' ? m : col === 'c' ? (W - b.w) / 2 : W - b.w - m;
    const by = row === 't' ? m : row === 'm' ? (H - b.h) / 2 : H - b.h - m;
    L.x = Math.round(bx + dx);
    L.y = Math.round(by + dy);
  }
  function detectPos(L) {
    const m = state.settings.margin;
    const b = R.layerBounds(L);
    const near = (a, c) => Math.abs(a - c) < 1.5;
    const col = near(b.x, m) ? 'l' : near(b.x + b.w / 2, W / 2) ? 'c' : near(b.x + b.w, W - m) ? 'r' : null;
    const row = near(b.y, m) ? 't' : near(b.y + b.h / 2, H / 2) ? 'm' : near(b.y + b.h, H - m) ? 'b' : null;
    return col && row ? row + col : null;
  }
  function applyGeo(L, g) {
    const m = state.settings.margin;
    L.rotation = 0;
    if (g === 'lower') Object.assign(L, { w: 540, h: 120, x: m, y: H - 120 - m * 1.5 });
    if (g === 'compact') Object.assign(L, { w: 340, h: 76, x: m, y: H - 76 - m });
    if (g === 'banner') Object.assign(L, { w: W, h: 110, x: 0, y: H - 110 - m });
    if (g === 'corner') Object.assign(L, { w: 380, h: 96, x: W - 380 - m, y: m });
    L.y = Math.round(L.y);
  }

  // ------------------------------------------------------------------ images (import)
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not load image'));
      img.src = src;
    });
  }
  function readFile(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }
  /** Normalises an imported image: caps size at 1600px and converts to PNG/JPEG data URL. */
  async function normalizeImage(file) {
    const raw = await readFile(file);
    const img = await loadImage(raw);
    const max = 1600;
    let w = img.naturalWidth || 512, h = img.naturalHeight || 512;
    const s = Math.min(1, max / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    try {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const isJpeg = /jpe?g/i.test(file.type);
      const url = c.toDataURL(isJpeg ? 'image/jpeg' : 'image/png', 0.92);
      return { url, w, h };
    } catch (_) {
      return { url: raw, w, h };
    }
  }
  async function registerAsset(url, id = uid()) {
    assets.set(id, url);
    const img = await loadImage(url);
    images.set(id, img);
    return { id, img };
  }
  async function importFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    for (const f of list) {
      try {
        const { url, w, h } = await normalizeImage(f);
        const { id } = await registerAsset(url);
        const label = f.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Image';
        addLayer(newImageLayer(id, w, h, label));
      } catch (e) {
        toast(`Couldn't import ${f.name}: ${e.message}`);
      }
    }
    toast(list.length > 1 ? `Added ${list.length} images` : 'Image added');
  }

  $('#btnAddImage').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
  $('#replaceInput').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    const L = selected();
    if (!f || !L || L.type !== 'image') return;
    const { url, w, h } = await normalizeImage(f);
    const { id } = await registerAsset(url);
    const old = L.assetId;
    L.assetId = id; L.natW = w; L.natH = h;
    if (L.lockAspect) L.h = Math.round(L.w * (h / w));
    if (!state.layers.some((l) => l.assetId === old)) { assets.delete(old); images.delete(old); }
    changed({ structure: true, inspectorRebuild: true });
  };
  $('#btnAddName').onclick = () => {
    const n = state.layers.filter((l) => l.type === 'name').length;
    addLayer(newNameTag(n ? { y: Math.max(40, 560 - n * 140) } : {}));
  };

  // drag & drop + paste
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging-files'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging-files'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging-files');
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); importFiles(files); }
  });

  // ------------------------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range';
    if (e.key === 'Escape' && document.body.classList.contains('clean')) return toggleClean(false);
    if (typing) return;
    const L = selected();
    if (e.key === 'h' || e.key === 'H') { toggleHideAll(); return; }
    if (!L) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); L.x += moves[e.key][0]; L.y += moves[e.key][1]; changed(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(L.id); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayer(L.id); }
    else if (e.key === 'Escape') select(null);
  });

  // ------------------------------------------------------------------ settings & toolbar
  function bindSetting(id, key, kind = 'bool', after) {
    const el = $(id);
    const setUI = () => { if (kind === 'bool') el.checked = !!state.settings[key]; else el.value = state.settings[key]; };
    setUI();
    el.addEventListener(kind === 'bool' ? 'change' : 'input', () => {
      state.settings[key] = kind === 'bool' ? el.checked : kind === 'num' ? Number(el.value) : el.value;
      if (after) after();
      changed();
    });
    return setUI;
  }
  const settingSetters = [];
  function initSettings() {
    settingSetters.push(
      bindSetting('#optGuides', 'guides'),
      bindSetting('#optSnap', 'snap'),
      bindSetting('#optFlip', 'flip'),
      bindSetting('#optMirrorCam', 'mirrorCamera', 'bool', () => Z.setMirror(zoomOpts())),
      bindSetting('#optMirrorPreview', 'mirrorPreview', 'bool', applyPreviewMirror),
      bindSetting('#optMargin', 'margin', 'num', () => { $('#optMarginOut').textContent = state.settings.margin + 'px'; }),
      bindSetting('#optCleanBg', 'cleanBg', 'text', applyCleanBg),
    );
    $('#optMarginOut').textContent = state.settings.margin + 'px';
    applyPreviewMirror();
    applyCleanBg();
    updateHideAllBtn();
  }
  function refreshSettingsUI() { settingSetters.forEach((f) => f()); $('#optMarginOut').textContent = state.settings.margin + 'px'; applyPreviewMirror(); applyCleanBg(); updateHideAllBtn(); }
  function applyPreviewMirror() { stage.classList.toggle('mirror', !!state.settings.mirrorPreview); }
  function applyCleanBg() {
    document.body.classList.toggle('bg-green', state.settings.cleanBg === 'green');
    document.body.classList.toggle('bg-black', state.settings.cleanBg === 'black');
  }

  function toggleHideAll() {
    state.settings.hideAll = !state.settings.hideAll;
    updateHideAllBtn();
    toast(state.settings.hideAll ? 'All overlays hidden' : 'Overlays visible');
    changed({ fast: true });
  }
  function updateHideAllBtn() {
    const b = $('#btnHideAll');
    b.textContent = state.settings.hideAll ? 'Show all' : 'Hide all';
    b.classList.toggle('on', state.settings.hideAll);
  }
  $('#btnHideAll').onclick = toggleHideAll;

  function toggleClean(on) {
    document.body.classList.toggle('clean', on);
    if (on) toast('Clean output — press Esc to exit', 3000);
    setTimeout(resizeCanvas, 30);
  }
  $('#btnClean').onclick = () => toggleClean(true);

  // webcam preview
  let camStream = null;
  $('#btnCam').onclick = async () => {
    const btn = $('#btnCam');
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
      video.srcObject = null;
      stage.classList.remove('cam-on');
      btn.classList.remove('on');
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = camStream;
      stage.classList.add('cam-on');
      btn.classList.add('on');
    } catch (e) {
      toast(Z.available ? 'Webcam preview is unavailable inside Zoom (Zoom is using the camera).' : 'Could not access webcam: ' + e.message, 4000);
    }
  };

  // scene import / export / reset
  $('#btnExport').onclick = () => {
    const data = { app: 'brill-overlays', version: 1, layers: state.layers, settings: state.settings, assets: Object.fromEntries(assets) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'brill-overlays-scene.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#btnImport').onclick = () => $('#sceneInput').click();
  $('#sceneInput').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      await applyScene(data);
      toast('Scene imported');
    } catch (err) {
      toast('Invalid scene file: ' + err.message);
    }
  };
  $('#btnReset').onclick = async () => {
    if (!confirm('Remove all overlays and reset settings?')) return;
    await applyScene({ layers: [], settings: {}, assets: {} });
    addLayer(newNameTag());
  };

  async function applyScene(data) {
    assets.clear(); images.clear();
    for (const [id, url] of Object.entries(data.assets || {})) {
      try { await registerAsset(url, id); } catch (_) {}
    }
    state.layers = (data.layers || []).filter((l) => l.type === 'name' || (l.type === 'image' && assets.has(l.assetId)));
    Object.assign(state.settings, data.settings || {});
    state.settings.hideAll = false;
    state.selectedId = state.layers[state.layers.length - 1]?.id || null;
    refreshSettingsUI();
    changed({ structure: true, inspectorRebuild: true });
  }

  // ------------------------------------------------------------------ persistence (IndexedDB)
  const DB = {
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const req = indexedDB.open('overlay-studio', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => { this._db = req.result; res(req.result); };
        req.onerror = () => rej(req.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async set(key, val) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    },
  };
  let saveEnabled = false;
  async function save() {
    if (!saveEnabled) return;
    try {
      await DB.set('scene', { layers: state.layers, settings: { ...state.settings, hideAll: false }, assets: Object.fromEntries(assets) });
    } catch (e) {
      log('Could not save scene: ' + e.message);
    }
  }
  async function load() {
    try {
      const data = await DB.get('scene');
      if (data && Array.isArray(data.layers)) { await applyScene(data); return true; }
    } catch (e) {
      log('Storage unavailable — changes will not persist (' + e.message + ')');
    }
    return false;
  }

  // ------------------------------------------------------------------ Zoom wiring
  const STATUS_TEXT = {
    browser: ['Browser preview', ''],
    ready: ['Zoom · ready', 'ready'],
    'not-in-meeting': ['Open inside a meeting', 'warn'],
    starting: ['Starting camera mode…', 'warn'],
    live: ['● LIVE on your video', 'live'],
    error: ['Zoom error', 'warn'],
  };
  Z.onLog = log;
  Z.onStatus = (s) => {
    const [txt, cls] = STATUS_TEXT[s] || [s, ''];
    const el = $('#status');
    el.textContent = txt;
    el.className = 'status ' + cls;
    const btn = $('#btnLive');
    btn.classList.toggle('live', s === 'live');
    btn.textContent = s === 'live' ? 'Stop overlays' : s === 'starting' ? 'Starting…' : 'Go live in Zoom';
    btn.disabled = s === 'starting';
  };

  $('#btnLive').onclick = async () => {
    if (Z.live) {
      await Z.stop();
      toast('Overlays removed from your video');
      return;
    }
    if (!Z.canGoLive()) {
      if (Z.available) toast('Join a meeting and open Brill Overlays from the Apps panel to go live.', 4000);
      else $('#helpDialog').showModal();
      return;
    }
    try {
      await Z.start(state.layers.map((l) => ({ ...l })), images, zoomOpts());
      toast('Live! Your overlays are now on your Zoom video.');
    } catch (e) {
      log('Go live failed: ' + (e.message || e));
      Z.onStatus('ready');
      toast('Could not start camera mode: ' + (e.message || e) + ' — is your camera on?', 5000);
    }
  };
  $('#btnHelp').onclick = () => $('#helpDialog').showModal();

  // ------------------------------------------------------------------ boot
  async function boot() {
    // Build the editor right away; Zoom detection can take a moment.
    initSettings();
    const zoomReady = Z.init();
    const had = await load();
    if (!had) {
      state.layers = [newNameTag()];
      state.selectedId = state.layers[0].id;
      changed({ structure: true, inspectorRebuild: true });
    }
    resizeCanvas();
    const status = await zoomReady;
    if (status === 'camera-instance') return; // off-screen renderer copy: never write storage
    saveEnabled = true;
    save();
    if (status === 'browser') log('Browser preview mode — design your overlays here; install the Zoom App to put them on your video.');
  }
  // Fonts may load late; re-render once they're ready.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestRender);
  boot();
})();
