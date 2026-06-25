/* MMM-KlydoPi node_helper
 *
 * Two jobs, both kept on the backend so the secret API key never reaches
 * the browser:
 *   1. List local background files (images and videos) in backgrounds/.
 *   2. Generate AI backgrounds from Pollinations (image OR video), using the
 *      API key, download them to cache/, and return a local URL the
 *      front-end can load.
 *
 * Secret keys (sk_) must never be exposed client-side, so all authenticated
 * requests happen here.
 */
const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const VIDEO_EXT = [".mp4", ".webm", ".ogg", ".mov"];

module.exports = NodeHelper.create({
  start() {
    this.bgDir = path.join(__dirname, "backgrounds");
    this.cacheDir = path.join(__dirname, "cache");
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch (e) { /* ignore */ }
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "KLYDO_GET_LOCAL") {
      this._sendLocalList(payload); // payload = identifier
    } else if (notification === "KLYDO_GENERATE_AI") {
      this._generateAI(payload);    // payload = { id, config, kind }
    }
  },

  /* ---- local file listing ---- */
  _sendLocalList(id) {
    let images = [], videos = [];
    try {
      const all = fs.readdirSync(this.bgDir);
      images = all.filter((f) => IMAGE_EXT.includes(path.extname(f).toLowerCase())).sort();
      videos = all.filter((f) => VIDEO_EXT.includes(path.extname(f).toLowerCase())).sort();
    } catch (e) { /* folder missing -> empty */ }
    this.sendSocketNotification("KLYDO_LOCAL_LIST", { id, images, videos });
  },

  /* ---- AI generation ---- */
  _generateAI(payload) {
    const { id, config, kind } = payload; // kind: "image" | "video"
    const c = config;
    const prompts = kind === "video" ? (c.aiVideoPrompts || c.aiPrompts) : c.aiPrompts;
    if (!prompts || !prompts.length) {
      return this._fail(id, "no prompts configured");
    }
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
    const seed = Math.floor(Math.random() * 1e6);

    // Build the generation URL. Pollinations serves generation under
    // gen.pollinations.ai; the model name selects image vs video.
    const base = (c.apiBase || "https://gen.pollinations.ai").replace(/\/+$/, "");
    const model = kind === "video"
      ? (c.aiVideoModel || "veo")
      : (c.aiModel || "flux");
    const url = `${base}/image/${encodeURIComponent(prompt)}`
      + `?model=${encodeURIComponent(model)}&seed=${seed}`
      + `&width=${c.aiWidth}&height=${c.aiHeight}&nologo=true`;

    const headers = {};
    if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;

    this._download(url, headers, kind, (err, filePath, isVideo) => {
      if (err) return this._fail(id, "generation failed: " + err);
      const fname = path.basename(filePath);
      this.sendSocketNotification("KLYDO_AI_READY", {
        id,
        url: this.cacheUrlBase + fname,
        isVideo
      });
      this._pruneCache(c.aiCacheKeep || 12);
    });
  },

  // MagicMirror serves module files statically; cache/ is reachable here.
  get cacheUrlBase() { return "/modules/MMM-KlydoPi/cache/"; },

  _download(url, headers, kind, cb, redirects) {
    redirects = redirects || 0;
    if (redirects > 5) return cb("too many redirects");
    const lib = url.startsWith("http://") ? http : https;
    const req = lib.get(url, { headers, timeout: 120000 }, (res) => {
      // follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return this._download(next, headers, kind, cb, redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return cb("HTTP " + res.statusCode);
      }
      // decide extension from content-type, fall back to kind
      const ct = (res.headers["content-type"] || "").toLowerCase();
      const isVideo = ct.startsWith("video/") || (kind === "video" && !ct.startsWith("image/"));
      let ext = ".jpg";
      if (ct.includes("png")) ext = ".png";
      else if (ct.includes("webp")) ext = ".webp";
      else if (ct.includes("gif")) ext = ".gif";
      else if (ct.includes("mp4")) ext = ".mp4";
      else if (ct.includes("webm")) ext = ".webm";
      else if (isVideo) ext = ".mp4";

      const fname = "ai_" + Date.now() + "_" + Math.floor(Math.random() * 1e4) + ext;
      const dest = path.join(this.cacheDir, fname);
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => cb(null, dest, isVideo)));
      out.on("error", (e) => cb(String(e)));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => cb(String(e)));
  },

  _pruneCache(keep) {
    try {
      const files = fs.readdirSync(this.cacheDir)
        .filter((f) => f.startsWith("ai_"))
        .map((f) => ({ f, t: fs.statSync(path.join(this.cacheDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      files.slice(keep).forEach((x) => {
        try { fs.unlinkSync(path.join(this.cacheDir, x.f)); } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  },

  _fail(id, msg) {
    this.sendSocketNotification("KLYDO_AI_FAILED", { id, error: msg });
  }
});
