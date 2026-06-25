/* MagicMirror² Module: MMM-KlydoPi
 * A Klydoclock-style animated clock: SVG analog hands + swinging pendulum
 * drawn over a looping, changing background. Backgrounds can be images OR
 * short looping videos, sourced from a local folder and/or AI generation
 * (Pollinations.ai). The module switches between image and video backgrounds.
 *
 * The Pollinations API key lives in node_helper (backend) and is never sent
 * to the browser. The front-end asks node_helper to generate media and
 * receives a local URL to display.
 *
 * MIT licensed. Personal project inspired by the Klydoclock; no shared code/art.
 */
Module.register("MMM-KlydoPi", {

  defaults: {
    // background rotation
    changeEveryMinutes: 15,
    source: "both",            // "local" | "ai" | "both"

    // media type preference: "image", "video", or "mixed" (randomly pick)
    mediaType: "mixed",
    videoRatio: 0.5,           // when "mixed": chance of choosing video (0..1)

    // appearance
    faceSize: "70vmin",
    handColor: "#f5f3ec",
    secondColor: "#e8b04b",
    tickColor: "rgba(245,243,236,0.55)",
    smoothSeconds: true,
    showPendulum: true,
    fullscreen: true,

    // local backgrounds (images and videos read from backgrounds/)
    localEnabled: true,

    // ---- AI generation (Pollinations) ----
    aiEnabled: true,
    apiKey: "",                // Pollinations API key (sk_... or pk_...). Stays server-side.
    apiBase: "https://gen.pollinations.ai",
    aiModel: "flux",           // image model
    aiVideoModel: "veo",       // video model
    aiWidth: 1280,
    aiHeight: 800,
    aiCacheKeep: 12,           // how many generated files to keep in cache/
    aiPrompts: [
      "calm abstract flowing waves, deep teal and gold, minimal, soft gradient",
      "misty forest at dawn, painterly, muted greens, atmospheric",
      "slow drifting clouds over mountains, golden hour, cinematic",
      "northern lights over a quiet lake, deep blues and greens",
      "soft bokeh lights, warm tones, dreamy abstract",
      "japanese ink wash landscape, mountains and fog, minimal"
    ],
    // separate prompts for video (motion-focused); falls back to aiPrompts
    aiVideoPrompts: [
      "gently drifting clouds, slow motion, cinematic loop",
      "calm ocean waves rolling slowly, seamless loop",
      "softly falling snow over a quiet forest, slow loop",
      "flowing northern lights, slow shimmer, seamless loop"
    ]
  },

  getStyles() {
    return [this.file("MMM-KlydoPi.css")];
  },

  start() {
    this.localImages = [];
    this.localVideos = [];
    this.front = 0;
    this.pendingAI = false;
    if (this.config.localEnabled) {
      this.sendSocketNotification("KLYDO_GET_LOCAL", this.identifier);
    }
  },

  socketNotificationReceived(notification, payload) {
    if (payload && payload.id && payload.id !== this.identifier) return;
    if (notification === "KLYDO_LOCAL_LIST") {
      this.localImages = payload.images || [];
      this.localVideos = payload.videos || [];
    } else if (notification === "KLYDO_AI_READY") {
      this.pendingAI = false;
      this._display(payload.url, payload.isVideo);
    } else if (notification === "KLYDO_AI_FAILED") {
      this.pendingAI = false;
      this._setStatus("AI failed: " + (payload.error || "unknown") + " — using local");
      this._showLocalFallback();
    }
  },

  /* ---- DOM ---- */
  getDom() {
    const root = document.createElement("div");
    root.className = "klydo-root" + (this.config.fullscreen ? " klydo-fullscreen" : "");
    root.style.setProperty("--klydo-face", this.config.faceSize);
    root.style.setProperty("--klydo-hand", this.config.handColor);
    root.style.setProperty("--klydo-second", this.config.secondColor);
    root.style.setProperty("--klydo-tick", this.config.tickColor);

    root.innerHTML = `
      <div class="klydo-bg" data-layer="0"></div>
      <div class="klydo-bg" data-layer="1"></div>
      <video class="klydo-video" data-layer="v0" muted loop playsinline></video>
      <video class="klydo-video" data-layer="v1" muted loop playsinline></video>
      <div class="klydo-vignette"></div>
      <div class="klydo-clock">
        <svg class="klydo-dial" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
          <g class="klydo-ticks"></g>
          <line class="klydo-hand klydo-hour"   x1="200" y1="200" x2="200" y2="120"/>
          <line class="klydo-hand klydo-minute" x1="200" y1="200" x2="200" y2="70"/>
          <line class="klydo-hand klydo-second" x1="200" y1="220" x2="200" y2="55"/>
          <circle class="klydo-cap" cx="200" cy="200" r="7"/>
        </svg>
      </div>
      ${this.config.showPendulum ? `
      <div class="klydo-pendulum">
        <svg viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg">
          <g class="klydo-swing">
            <line class="klydo-rod" x1="60" y1="0" x2="60" y2="150"/>
            <circle class="klydo-bob" cx="60" cy="155" r="18"/>
          </g>
        </svg>
      </div>` : ``}
      <div class="klydo-status"></div>
    `;

    setTimeout(() => this._init(root), 0);
    return root;
  },

  /* ---- animation + background engine ---- */
  _init(root) {
    if (this._started && this._root === root) return;
    this._root = root;
    this._started = true;

    const q = (s) => root.querySelector(s);
    const NS = "http://www.w3.org/2000/svg";

    // dial ticks
    const ticks = q(".klydo-ticks");
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const a = (i / 60) * Math.PI * 2;
      const r1 = major ? 165 : 172, r2 = 182;
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", 200 + r1 * Math.sin(a));
      ln.setAttribute("y1", 200 - r1 * Math.cos(a));
      ln.setAttribute("x2", 200 + r2 * Math.sin(a));
      ln.setAttribute("y2", 200 - r2 * Math.cos(a));
      ln.setAttribute("class", "klydo-tick " + (major ? "major" : "minor"));
      ticks.appendChild(ln);
    }

    // hands
    const hour = q(".klydo-hour"), min = q(".klydo-minute"), sec = q(".klydo-second");
    const smooth = this.config.smoothSeconds;
    const tick = () => {
      const now = new Date();
      const s = now.getSeconds() + (smooth ? now.getMilliseconds() / 1000 : 0);
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;
      sec.style.transform = `rotate(${s * 6}deg)`;
      min.style.transform = `rotate(${m * 6}deg)`;
      hour.style.transform = `rotate(${h * 30}deg)`;
      this._raf1 = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf1);
    this._raf1 = requestAnimationFrame(tick);

    // pendulum
    const swing = q(".klydo-swing");
    if (swing) {
      const period = 1000, amp = 18;
      const sw = (t) => {
        swing.style.transform = `rotate(${amp * Math.sin((t / period) * Math.PI)}deg)`;
        this._raf2 = requestAnimationFrame(sw);
      };
      cancelAnimationFrame(this._raf2);
      this._raf2 = requestAnimationFrame(sw);
    }

    // background layers (two image, two video, cross-faded)
    this.imgLayers = [q('.klydo-bg[data-layer="0"]'), q('.klydo-bg[data-layer="1"]')];
    this.vidLayers = [q('.klydo-video[data-layer="v0"]'), q('.klydo-video[data-layer="v1"]')];
    this.status = q(".klydo-status");
    this.front = 0;
    this.frontIsVideo = false;

    this._nextBackground();
    clearInterval(this._bgTimer);
    this._bgTimer = setInterval(() => {
      if (this.config.localEnabled) {
        this.sendSocketNotification("KLYDO_GET_LOCAL", this.identifier);
      }
      this._nextBackground();
    }, Math.max(1, this.config.changeEveryMinutes) * 60 * 1000);
  },

  _setStatus(t) { if (this.status) this.status.textContent = t || ""; },

  /* ---- decide source + media type, then act ---- */
  _pickSource() {
    const c = this.config;
    const hasLocal = c.localEnabled && (this.localImages.length || this.localVideos.length);
    const wantLocal = (c.source === "local" || c.source === "both") && hasLocal;
    const wantAI = (c.source === "ai" || c.source === "both") && c.aiEnabled;
    if (wantLocal && wantAI) return Math.random() < 0.5 ? "local" : "ai";
    if (wantLocal) return "local";
    if (wantAI) return "ai";
    return null;
  },

  _pickKind(forLocal) {
    const c = this.config;
    if (c.mediaType === "image") return "image";
    if (c.mediaType === "video") return "video";
    // mixed: respect availability for local; for AI both are available
    if (forLocal) {
      const haveImg = this.localImages.length, haveVid = this.localVideos.length;
      if (haveImg && haveVid) return Math.random() < c.videoRatio ? "video" : "image";
      return haveVid ? "video" : "image";
    }
    return Math.random() < c.videoRatio ? "video" : "image";
  },

  _nextBackground() {
    if (this.pendingAI) return; // don't stack AI requests
    const src = this._pickSource();
    if (!src) { this._setStatus("no background source configured"); return; }

    if (src === "local") {
      const kind = this._pickKind(true);
      if (kind === "video" && this.localVideos.length) {
        const f = this.localVideos[Math.floor(Math.random() * this.localVideos.length)];
        this._display(this.file("backgrounds/" + encodeURIComponent(f)), true);
      } else if (this.localImages.length) {
        const f = this.localImages[Math.floor(Math.random() * this.localImages.length)];
        this._display(this.file("backgrounds/" + encodeURIComponent(f)), false);
      }
      return;
    }

    // AI: ask the backend (it holds the key) to generate + cache the media
    const kind = this._pickKind(false);
    this.pendingAI = true;
    this._setStatus("generating " + kind + "…");
    this.sendSocketNotification("KLYDO_GENERATE_AI", {
      id: this.identifier,
      kind,
      config: this.config
    });
  },

  _showLocalFallback() {
    if (this.localImages.length) {
      const f = this.localImages[Math.floor(Math.random() * this.localImages.length)];
      this._display(this.file("backgrounds/" + encodeURIComponent(f)), false);
    } else if (this.localVideos.length) {
      const f = this.localVideos[Math.floor(Math.random() * this.localVideos.length)];
      this._display(this.file("backgrounds/" + encodeURIComponent(f)), true);
    }
  },

  /* ---- switch the visible background to a new image or video ---- */
  _display(url, isVideo) {
    if (isVideo) this._showVideo(url);
    else this._showImage(url);
  },

  _showImage(url) {
    const img = new Image();
    img.onload = () => {
      const next = this.imgLayers[1 - this.front];
      next.style.backgroundImage = `url("${url}")`;
      next.classList.add("show");
      // hide whichever layer was in front
      this.imgLayers[this.front].classList.remove("show");
      this.vidLayers.forEach((v) => { v.classList.remove("show"); try { v.pause(); } catch (e) {} });
      this.front = 1 - this.front;
      this.frontIsVideo = false;
      this._setStatus("");
    };
    img.onerror = () => { this._setStatus("image failed"); };
    img.src = url;
  },

  _showVideo(url) {
    const next = this.vidLayers[1 - this.front];
    next.src = url;
    next.classList.add("show");
    const play = () => { next.play().catch(() => {}); };
    if (next.readyState >= 2) play();
    else next.addEventListener("loadeddata", play, { once: true });
    next.onerror = () => { this._setStatus("video failed"); this._showLocalFallback(); };
    // hide the previously visible layers
    this.imgLayers.forEach((i) => i.classList.remove("show"));
    const prevVid = this.vidLayers[this.front];
    if (prevVid !== next) {
      setTimeout(() => { prevVid.classList.remove("show"); try { prevVid.pause(); } catch (e) {} }, 1600);
    }
    this.front = 1 - this.front;
    this.frontIsVideo = true;
    this._setStatus("");
  }
});
