/* Overlay renderer — draws name tags & images onto any 2D canvas context.
 * All layer geometry lives in a fixed 1280×720 "design space" that maps 1:1
 * onto Zoom's default camera-mode render target.
 */
(function (global) {
  const DESIGN_W = 1280;
  const DESIGN_H = 720;

  const FONTS = {
    sans: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    rounded: '"Nunito", "Arial Rounded MT Bold", "Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    condensed: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
    impact: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    mono: '"SF Mono", Consolas, "Courier New", monospace',
    trebuchet: '"Trebuchet MS", "Lucida Grande", sans-serif',
  };

  const SHAPES = [
    { id: 'rect', label: 'Rectangle' },
    { id: 'rounded', label: 'Rounded' },
    { id: 'pill', label: 'Pill' },
    { id: 'lowerthird', label: 'Lower third' },
    { id: 'slant', label: 'Slanted' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'hexagon', label: 'Hexagon' },
    { id: 'ribbon', label: 'Ribbon' },
    { id: 'tab', label: 'Tab' },
    { id: 'bubble', label: 'Speech bubble' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'underline', label: 'Underline' },
    { id: 'none', label: 'Text only' },
  ];

  // ---------- geometry helpers ----------
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function poly(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  /** Builds the outline path of a name-tag shape inside the box (x,y,w,h). */
  function shapePath(ctx, shape, x, y, w, h, r) {
    ctx.beginPath();
    switch (shape) {
      case 'rect':
      case 'lowerthird':
      case 'underline':
      case 'none':
        ctx.rect(x, y, w, h);
        break;
      case 'rounded':
        roundRectPath(ctx, x, y, w, h, r);
        break;
      case 'pill':
        roundRectPath(ctx, x, y, w, h, h / 2);
        break;
      case 'ellipse':
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        break;
      case 'slant': {
        const s = Math.min(h * 0.4, w * 0.2);
        poly(ctx, [[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]);
        break;
      }
      case 'arrow': {
        const s = Math.min(h * 0.5, w * 0.25);
        poly(ctx, [[x, y], [x + w - s, y], [x + w, y + h / 2], [x + w - s, y + h], [x, y + h]]);
        break;
      }
      case 'hexagon': {
        const s = Math.min(h * 0.45, w * 0.22);
        poly(ctx, [[x + s, y], [x + w - s, y], [x + w, y + h / 2], [x + w - s, y + h], [x + s, y + h], [x, y + h / 2]]);
        break;
      }
      case 'ribbon': {
        const n = Math.min(h * 0.35, w * 0.12);
        poly(ctx, [[x, y], [x + w, y], [x + w - n, y + h / 2], [x + w, y + h], [x, y + h], [x + n, y + h / 2]]);
        break;
      }
      case 'tab': {
        const rr = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + rr);
        ctx.arcTo(x, y, x + rr, y, rr);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y, x + w, y + rr, rr);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        break;
      }
      case 'bubble': {
        const bh = h * 0.78;
        const rr = Math.max(0, Math.min(r, w / 2, bh / 2));
        const t1 = x + Math.max(rr, w * 0.1);
        const t2 = t1 + Math.min(w * 0.12, 60);
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.arcTo(x + w, y, x + w, y + rr, rr);
        ctx.lineTo(x + w, y + bh - rr);
        ctx.arcTo(x + w, y + bh, x + w - rr, y + bh, rr);
        ctx.lineTo(t2, y + bh);
        ctx.lineTo(t1 - (t2 - t1) * 0.3, y + h);
        ctx.lineTo(t1, y + bh);
        ctx.lineTo(x + rr, y + bh);
        ctx.arcTo(x, y + bh, x, y + bh - rr, rr);
        ctx.lineTo(x, y + rr);
        ctx.arcTo(x, y, x + rr, y, rr);
        ctx.closePath();
        break;
      }
      default:
        ctx.rect(x, y, w, h);
    }
  }

  /** Extra insets so text stays inside non-rectangular shapes. */
  function shapeInsets(L) {
    const { w, h } = L;
    const z = { l: 0, r: 0, t: 0, b: 0 };
    switch (L.shape) {
      case 'pill': z.l = z.r = h * 0.28; break;
      case 'ellipse': z.l = z.r = w * 0.15; z.t = z.b = h * 0.15; break;
      case 'slant': { const s = Math.min(h * 0.4, w * 0.2); z.l = z.r = s * 0.75; break; }
      case 'arrow': z.r = Math.min(h * 0.5, w * 0.25) * 0.85; break;
      case 'hexagon': { const s = Math.min(h * 0.45, w * 0.22); z.l = z.r = s * 0.8; break; }
      case 'ribbon': { const n = Math.min(h * 0.35, w * 0.12); z.l = z.r = n; break; }
      case 'bubble': z.b = h * 0.22; break;
      case 'lowerthird': z.l = accentWidth(L); break;
      case 'underline': z.b = Math.max(4, h * 0.1) + 6; break;
    }
    return z;
  }

  function accentWidth(L) {
    return Math.max(6, Math.min(L.h * 0.09, 18));
  }

  function hexToRgba(hex, a) {
    const m = String(hex || '#000').replace('#', '');
    const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.padEnd(6, '0');
    const n = parseInt(full.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function fontString(weight, size, family, italic) {
    return `${italic ? 'italic ' : ''}${weight} ${Math.max(1, size).toFixed(1)}px ${FONTS[family] || FONTS.sans}`;
  }

  /** Shadows are specified in device pixels, so scale them with the current transform. */
  function devScale(ctx) {
    const t = ctx.getTransform();
    return Math.max(0.1, Math.hypot(t.a, t.b));
  }

  function setSpacing(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px || 0}px`;
  }

  // ---------- name tag ----------
  function drawNameTag(ctx, L) {
    const { x, y, w, h } = L;
    const radius = L.radius ?? 16;
    const shape = L.shape || 'rounded';
    const filled = shape !== 'underline' && shape !== 'none';
    const k = devScale(ctx);

    ctx.save();

    if (filled) {
      // Fill (with optional gradient + drop shadow)
      shapePath(ctx, shape, x, y, w, h, radius);
      if (L.gradient) {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, hexToRgba(L.fill, L.fillOpacity ?? 1));
        g.addColorStop(1, hexToRgba(L.fill2 || L.fill, L.fillOpacity ?? 1));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hexToRgba(L.fill, L.fillOpacity ?? 1);
      }
      if (L.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 18 * k;
        ctx.shadowOffsetY = 5 * k;
      }
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Accent stripe (lower third)
      if (shape === 'lowerthird') {
        ctx.save();
        shapePath(ctx, shape, x, y, w, h, radius);
        ctx.clip();
        ctx.fillStyle = L.accent || '#2d8cff';
        ctx.fillRect(x, y, accentWidth(L), h);
        ctx.restore();
      }

      // Border, kept *inside* the bounding box
      if ((L.borderWidth || 0) > 0) {
        ctx.save();
        shapePath(ctx, shape, x, y, w, h, radius);
        ctx.clip();
        ctx.lineWidth = L.borderWidth * 2;
        ctx.strokeStyle = L.borderColor || '#ffffff';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }

    // ----- text layout -----
    const pad = L.padding ?? 16;
    const ins = shapeInsets(L);
    const ix = x + pad + ins.l;
    const iy = y + pad * 0.6 + ins.t;
    const iw = Math.max(4, w - pad * 2 - ins.l - ins.r);
    const ih = Math.max(4, h - pad * 1.2 - ins.t - ins.b);

    const name = L.uppercase ? (L.name || '').toUpperCase() : (L.name || '');
    const titleText = L.uppercase ? (L.title || '').toUpperCase() : (L.title || '');
    const showTitle = L.showTitle && titleText.trim().length > 0;
    const ratio = Math.max(0.2, Math.min(1, L.titleRatio ?? 0.55));
    const gapK = 0.14;

    // Largest size that fits the box height
    let ns = L.autoFit ? ih / (showTitle ? 1 + gapK + ratio : 1) : (L.nameSize || 40);
    ns = Math.min(ns, ih / (showTitle ? 1 + gapK + ratio : 1));
    let ts = showTitle ? (L.autoFit ? ns * ratio : Math.min(L.titleSize || 22, ns)) : 0;

    // Shrink to fit width
    ctx.font = fontString(L.weight || 700, ns, L.font, L.italic);
    setSpacing(ctx, L.letterSpacing);
    const nw = ctx.measureText(name).width;
    if (nw > iw && nw > 0) {
      const k = iw / nw;
      ns *= k;
      if (L.autoFit) ts *= k;
    }
    if (showTitle) {
      ctx.font = fontString(L.titleWeight || 500, ts, L.font, false);
      const tw = ctx.measureText(titleText).width;
      if (tw > iw && tw > 0) ts *= iw / tw;
    }

    const gap = showTitle ? ns * gapK : 0;
    const blockH = ns + gap + ts;
    let top;
    if (L.valign === 'top') top = iy;
    else if (L.valign === 'bottom') top = iy + ih - blockH;
    else top = iy + (ih - blockH) / 2;

    const align = L.align || 'left';
    const tx = align === 'center' ? ix + iw / 2 : align === 'right' ? ix + iw : ix;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';

    if (L.textShadow || !filled) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = Math.max(4, ns * 0.18) * k;
      ctx.shadowOffsetY = Math.max(1, ns * 0.04) * k;
    }

    // clip text to the bounding box so it never escapes the shape
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.font = fontString(L.weight || 700, ns, L.font, L.italic);
    setSpacing(ctx, L.letterSpacing);
    ctx.fillStyle = L.nameColor || '#ffffff';
    ctx.fillText(name, tx, top + ns * 0.52);
    const nameW = ctx.measureText(name).width;

    let titleW = 0;
    if (showTitle) {
      ctx.font = fontString(L.titleWeight || 500, ts, L.font, false);
      setSpacing(ctx, (L.letterSpacing || 0) * 0.6);
      ctx.fillStyle = L.titleColor || '#d0d6e0';
      ctx.fillText(titleText, tx, top + ns + gap + ts * 0.52);
      titleW = ctx.measureText(titleText).width;
    }
    ctx.restore();
    ctx.shadowColor = 'transparent';

    // Underline accent
    if (shape === 'underline') {
      const lw = Math.max(nameW, titleW);
      const lh = Math.max(4, h * 0.08);
      const lx = align === 'center' ? tx - lw / 2 : align === 'right' ? tx - lw : tx;
      const ly = Math.min(y + h - lh, top + blockH + 6);
      ctx.fillStyle = L.accent || '#ffcc00';
      if (L.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6 * k; }
      ctx.fillRect(lx, ly, lw, lh);
    }

    ctx.restore();
  }

  // ---------- image ----------
  function maskPath(ctx, L, x, y, w, h) {
    ctx.beginPath();
    if (L.mask === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (L.mask === 'rounded') roundRectPath(ctx, x, y, w, h, L.radius ?? 24);
    else ctx.rect(x, y, w, h);
  }

  function drawImageLayer(ctx, L, img) {
    const { x, y, w, h } = L;
    // Render the masked image off-screen at the current device scale, then
    // composite it with an (alpha-aware) drop shadow.
    const t = ctx.getTransform();
    const k = Math.max(0.25, Math.min(4, Math.hypot(t.a, t.b)));
    const ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
    const off = document.createElement('canvas');
    off.width = ow; off.height = oh;
    const o = off.getContext('2d');
    o.scale(ow / w, oh / h);
    o.save();
    maskPath(o, L, 0, 0, w, h);
    o.clip();
    if (img && img.complete && img.naturalWidth) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const fit = L.fit || 'fill';
      if (fit === 'fill') {
        o.drawImage(img, 0, 0, w, h);
      } else {
        const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
        const dw = iw * s, dh = ih * s;
        o.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    } else {
      o.fillStyle = 'rgba(255,255,255,0.12)';
      o.fillRect(0, 0, w, h);
    }
    if ((L.borderWidth || 0) > 0) {
      maskPath(o, L, 0, 0, w, h);
      o.lineWidth = L.borderWidth * 2; // half is clipped => border stays inside the box
      o.strokeStyle = L.borderColor || '#ffffff';
      o.stroke();
    }
    o.restore();

    ctx.save();
    ctx.globalAlpha = L.opacity ?? 1;
    if (L.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20 * k;
      ctx.shadowOffsetY = 6 * k;
    }
    ctx.drawImage(off, x, y, w, h);
    ctx.restore();
  }

  /** Draws one layer (applying rotation around its center). */
  function drawLayer(ctx, L, images) {
    ctx.save();
    if (L.rotation) {
      const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((L.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    if (L.type === 'name') drawNameTag(ctx, L);
    else if (L.type === 'image') drawImageLayer(ctx, L, images && images.get(L.assetId));
    ctx.restore();
  }

  /** Axis-aligned bounds of a (possibly rotated) layer, padded for shadows. */
  function layerBounds(L, pad = 0) {
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    const a = ((L.rotation || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const bw = L.w * c + L.h * s, bh = L.w * s + L.h * c;
    return { x: cx - bw / 2 - pad, y: cy - bh / 2 - pad, w: bw + pad * 2, h: bh + pad * 2 };
  }

  /**
   * Renders a single layer into its own tightly-cropped canvas for Zoom's drawImage().
   * Returns { canvas, x, y } in render-target pixels, or null if fully off-screen.
   */
  function renderLayerForOutput(L, images, target, flip) {
    const sx = target.width / DESIGN_W, sy = target.height / DESIGN_H;
    const b = layerBounds(L, 32);
    let x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    let x1 = Math.min(DESIGN_W, b.x + b.w), y1 = Math.min(DESIGN_H, b.y + b.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;

    const px = Math.floor(x0 * sx), py = Math.floor(y0 * sy);
    const pw = Math.ceil(x1 * sx) - px, ph = Math.ceil(y1 * sy) - py;
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (flip) {
      ctx.translate(pw, 0);
      ctx.scale(-1, 1);
    }
    ctx.translate(-px, -py);
    ctx.scale(sx, sy);
    drawLayer(ctx, L, images);
    const outX = flip ? target.width - px - pw : px;
    return { canvas, x: outX, y: py, width: pw, height: ph };
  }

  /** Renders the full composite (used for the preview + clean output). */
  function renderAll(ctx, layers, images, opts = {}) {
    for (const L of layers) {
      if (!L.visible) continue;
      ctx.save();
      if (opts.dimmed) ctx.globalAlpha = 0.25;
      drawLayer(ctx, L, images);
      ctx.restore();
    }
  }

  /** Small thumbnail of a shape (for the shape picker). */
  function shapeThumb(shape, fill = '#2d8cff', accent = '#ffcc00') {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    c.width = 64 * dpr; c.height = 36 * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const L = { x: 4, y: 7, w: 56, h: 22, radius: 6 };
    if (shape === 'underline' || shape === 'none') {
      ctx.fillStyle = '#e8ecf3';
      ctx.fillRect(10, 13, 34, 4);
      ctx.fillRect(10, 20, 22, 3);
      if (shape === 'underline') { ctx.fillStyle = accent; ctx.fillRect(10, 26, 34, 3); }
      return c;
    }
    shapePath(ctx, shape, L.x, L.y, L.w, shape === 'bubble' ? 26 : L.h, L.radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (shape === 'lowerthird') { ctx.fillStyle = accent; ctx.fillRect(L.x, L.y, 4, L.h); }
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(18, 14, 26, 3);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillRect(18, 20, 16, 2);
    return c;
  }

  global.OverlayRenderer = {
    DESIGN_W, DESIGN_H, FONTS, SHAPES,
    drawLayer, renderAll, renderLayerForOutput, layerBounds, shapeThumb, shapePath,
  };
})(window);
