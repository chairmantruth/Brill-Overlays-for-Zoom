/* Zoom Apps SDK bridge — Camera Mode (Layers API).
 *
 * Flow:
 *   sidebar (runningContext "inMeeting")
 *     → runRenderingContext({ view: 'camera' })     Zoom spins up an off-screen copy of this app ("inCamera")
 *     → inCamera instance posts "camera-ready"     (and/or Zoom fires onRenderedAppOpened)
 *     → sidebar draws your own video (drawParticipant) + one drawImage() per overlay layer
 *   Each layer is cached by a content hash, so editing one overlay only re-sends that one.
 */
(function (global) {
  const CAPABILITIES = [
    'getRunningContext', 'getUserContext', 'getVideoState',
    'runRenderingContext', 'closeRenderingContext',
    'drawParticipant', 'clearParticipant',
    'drawImage', 'clearImage',
    'drawWebView', 'clearWebView',
    'postMessage', 'onMessage',
    'onMyMediaChange', 'onRenderedAppOpened',
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  async function retry(fn, tries = 5) {
    let err;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) { err = e; await sleep(200 * 2 ** i); }
    }
    throw err;
  }

  const Bridge = {
    available: false,       // true when running inside the Zoom client
    context: 'browser',     // browser | inMainClient | inMeeting | inCamera | ...
    target: { width: 1280, height: 720 },
    live: false,
    participantUUID: null,
    onStatus: () => {},
    onLog: () => {},

    _drawn: new Map(),      // layerId -> { hash, imageId }
    _participantDrawn: false,
    _readyResolve: null,
    _syncing: false,
    _pending: null,

    async init() {
      if (!global.zoomSdk) return this._setStatus('browser');
      try {
        const cfg = await withTimeout(global.zoomSdk.config({ capabilities: CAPABILITIES, version: '0.16' }), 4000);
        this.available = true;
        this.context = cfg.runningContext || 'inMeeting';
        const rt = cfg.media && cfg.media.renderTarget;
        if (rt && rt.width && rt.height) this.target = { width: rt.width, height: rt.height };
        this.onLog(`Zoom SDK ready · context=${this.context} · target=${this.target.width}×${this.target.height}`);
      } catch (e) {
        this.onLog('Not running inside Zoom — browser preview mode.');
        return this._setStatus('browser');
      }

      const sdk = global.zoomSdk;

      // ---- off-screen camera instance: stay transparent, tell the sidebar we're alive ----
      if (this.context === 'inCamera') {
        document.documentElement.classList.add('camera-instance');
        try { await sdk.postMessage({ type: 'camera-ready' }); } catch (_) {}
        return this._setStatus('camera-instance');
      }

      // ---- sidebar controller ----
      const markReady = () => { if (this._readyResolve) { this._readyResolve(); this._readyResolve = null; } };
      sdk.addEventListener('onRenderedAppOpened', () => { this.onLog('onRenderedAppOpened'); markReady(); });
      sdk.addEventListener('onMessage', (evt) => {
        let msg = evt && (evt.payload ?? evt);
        if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (_) {} }
        if (msg && msg.type === 'camera-ready') { this.onLog('Camera instance ready'); markReady(); }
      });
      sdk.addEventListener('onMyMediaChange', async (evt) => {
        const v = evt && evt.media && evt.media.video;
        if (!v || !this.live) return;
        if (v.state === false) {
          this.onLog('Camera turned off — overlays will return when it is back on.');
        } else if (v.state === true) {
          this.onLog('Camera back on — re-applying overlays');
          await this._restart();
        }
      });

      try {
        const uc = await sdk.getUserContext();
        this.participantUUID = uc.participantUUID || null;
      } catch (_) {}

      this._setStatus(this.context === 'inMeeting' ? 'ready' : 'not-in-meeting');
    },

    _setStatus(s) {
      this.status = s;
      this.onStatus(s);
      return s;
    },

    canGoLive() {
      return this.available && this.context === 'inMeeting';
    },

    async start(layers, images, opts) {
      if (!this.canGoLive()) throw new Error('Open this app from the Apps panel inside a Zoom meeting to go live.');
      const sdk = global.zoomSdk;
      this._setStatus('starting');
      const ready = new Promise((r) => { this._readyResolve = r; });
      try {
        await sdk.runRenderingContext({ view: 'camera' });
      } catch (e) {
        // A previous session may still be active — close it and try again.
        this.onLog('runRenderingContext failed, retrying: ' + (e.message || e));
        try { await sdk.closeRenderingContext(); } catch (_) {}
        await sleep(400);
        await sdk.runRenderingContext({ view: 'camera' });
      }
      await Promise.race([ready, sleep(3500)]);
      this.live = true;
      this._drawn.clear();
      this._participantDrawn = false;
      await this._drawSelf(opts);
      await this.sync(layers, images, opts);
      this._setStatus('live');
    },

    async _restart() {
      if (!this._last) return;
      const { layers, images, opts } = this._last;
      this.live = false;
      try { await global.zoomSdk.closeRenderingContext(); } catch (_) {}
      await sleep(500);
      try { await this.start(layers, images, opts); } catch (e) { this.onLog('Restart failed: ' + (e.message || e)); this._setStatus('error'); }
    },

    async _drawSelf(opts) {
      if (!this.participantUUID) return;
      try {
        await retry(() => global.zoomSdk.drawParticipant({
          participantUUID: this.participantUUID,
          x: 0, y: 0, width: this.target.width, height: this.target.height,
          zIndex: 1,
          cameraModeMirroring: !!(opts && opts.mirrorCamera),
        }), 4);
        this._participantDrawn = true;
      } catch (e) {
        this.onLog('drawParticipant skipped: ' + (e.message || e));
      }
    },

    async setMirror(opts) {
      if (!this.live || !this.participantUUID) return;
      try { await global.zoomSdk.clearParticipant({ participantUUID: this.participantUUID }); } catch (_) {}
      await this._drawSelf(opts);
    },

    async stop() {
      if (!this.available) return;
      this.live = false;
      try { await global.zoomSdk.closeRenderingContext(); } catch (e) { this.onLog('close: ' + (e.message || e)); }
      this._drawn.clear();
      this._setStatus('ready');
    },

    /** Brings Zoom's drawn images in line with the current layer list. Latest call wins. */
    async sync(layers, images, opts) {
      this._last = { layers, images, opts };
      if (!this.live) return;
      if (this._syncing) { this._pending = true; return; }
      this._syncing = true;
      try {
        do {
          this._pending = false;
          const { layers: Ls, images: Im, opts: O } = this._last;
          await this._syncOnce(Ls, Im, O);
        } while (this._pending && this.live);
      } finally {
        this._syncing = false;
      }
    },

    async _syncOnce(layers, images, opts) {
      const sdk = global.zoomSdk;
      const R = global.OverlayRenderer;
      const wanted = new Map();
      if (!opts.hideAll) {
        layers.forEach((L, i) => {
          if (!L.visible) return;
          const hash = JSON.stringify(L) + '|' + i + '|' + (opts.flip ? 1 : 0) + '|' + (images.get(L.assetId) ? 1 : 0);
          wanted.set(L.id, { L, z: 2 + i, hash });
        });
      }

      // draw new / changed layers first (new image goes up before the old one is cleared => no flicker)
      for (const [id, w] of wanted) {
        const prev = this._drawn.get(id);
        if (prev && prev.hash === w.hash) continue;
        const out = R.renderLayerForOutput(w.L, images, this.target, opts.flip);
        let imageId = null;
        if (out) {
          const imageData = out.canvas.getContext('2d').getImageData(0, 0, out.width, out.height);
          try {
            const res = await retry(() => sdk.drawImage({ imageData, x: out.x, y: out.y, zIndex: w.z }), 3);
            imageId = res && (res.imageId || res.imageID);
          } catch (e) {
            this.onLog(`drawImage failed for "${w.L.label}": ${e.message || e}`);
          }
        }
        if (prev && prev.imageId) { try { await sdk.clearImage({ imageId: prev.imageId }); } catch (_) {} }
        this._drawn.set(id, { hash: w.hash, imageId });
      }

      // remove layers that were deleted / hidden
      for (const [id, prev] of [...this._drawn]) {
        if (wanted.has(id)) continue;
        if (prev.imageId) { try { await sdk.clearImage({ imageId: prev.imageId }); } catch (_) {} }
        this._drawn.delete(id);
      }
    },
  };

  global.ZoomBridge = Bridge;
})(window);
