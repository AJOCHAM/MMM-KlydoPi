# MMM-KlydoPi

A [MagicMirror²](https://magicmirror.builders/) module inspired by the
Klydoclock: analog clock hands and a swinging pendulum drawn in SVG over a
looping, changing background. Backgrounds can be **images or short looping
videos**, sourced from a **local folder** and from **AI generation**
(Pollinations.ai). The module switches between image and video backgrounds.

The Pollinations API key is held by the module's `node_helper` (the backend)
and is **never sent to the browser** — required, since secret (`sk_`) keys
must not appear in client-side code. Local backgrounds work offline; AI
generation needs internet and an API key.

---

## Install

From your MagicMirror `modules/` folder:

```bash
cd ~/MagicMirror/modules
git clone <your-repo-url> MMM-KlydoPi
# or just copy this MMM-KlydoPi folder into modules/
```

There are no npm dependencies to install — the module uses only Node's
built-in modules and MagicMirror's own framework.

### Get a Pollinations API key

AI generation requires a key. Sign in at
[enter.pollinations.ai](https://enter.pollinations.ai) and create one. Two
types exist: secret keys (`sk_`, no rate limit, server-side only) and
publishable keys (`pk_`, rate-limited). Since this module keeps the key on
the backend (`node_helper`), a secret `sk_` key is appropriate and never
reaches the browser. Paste it into `apiKey` in the config below.

If you leave `apiKey` empty, set `aiEnabled: false` and use only local
backgrounds.

---

## Configure

Add an entry to the `modules` array in `~/MagicMirror/config/config.js`.

Because this is a full-screen ambient background, use the special
`fullscreen_below` region so it sits behind your other modules:

```js
{
  module: "MMM-KlydoPi",
  position: "fullscreen_below",
  config: {
    changeEveryMinutes: 15,
    source: "both",          // "local" | "ai" | "both"

    // image vs video
    mediaType: "mixed",      // "image" | "video" | "mixed"
    videoRatio: 0.5,         // when mixed: chance of picking video

    smoothSeconds: true,
    showPendulum: true,

    // appearance
    faceSize: "70vmin",
    handColor: "#f5f3ec",
    secondColor: "#e8b04b",

    // AI (Pollinations) — key stays on the backend
    aiEnabled: true,
    apiKey: "sk_your_key_here",
    aiModel: "flux",         // image model
    aiVideoModel: "veo",     // video model
    aiWidth: 1280,
    aiHeight: 800,
    aiPrompts: [
      "calm abstract flowing waves, deep teal and gold, minimal",
      "misty forest at dawn, painterly, muted greens, atmospheric"
    ],
    aiVideoPrompts: [
      "gently drifting clouds, slow motion, cinematic loop",
      "calm ocean waves rolling slowly, seamless loop"
    ]
  }
}
```

If you put it in a normal region (e.g. `"middle_center"`) instead, set
`fullscreen: false` in the config so it doesn't cover the screen.

---

## Options

| Option | Default | Description |
|---|---|---|
| `changeEveryMinutes` | `15` | How often the background swaps |
| `source` | `"both"` | `"local"`, `"ai"`, or `"both"` |
| `mediaType` | `"mixed"` | `"image"`, `"video"`, or `"mixed"` |
| `videoRatio` | `0.5` | In `"mixed"` mode, chance (0–1) of picking video |
| `smoothSeconds` | `true` | Sweeping vs ticking second hand |
| `showPendulum` | `true` | Show the swinging pendulum |
| `fullscreen` | `true` | Cover the whole mirror (use with `fullscreen_below`) |
| `faceSize` | `"70vmin"` | Clock diameter (any CSS length) |
| `handColor` | `"#f5f3ec"` | Hour/minute hand color |
| `secondColor` | `"#e8b04b"` | Second hand, pendulum bob, center cap |
| `tickColor` | `rgba(245,243,236,0.55)` | Dial tick marks |
| `localEnabled` | `true` | Use images/videos from `backgrounds/` |
| `aiEnabled` | `true` | Use Pollinations generation |
| `apiKey` | `""` | Pollinations API key (`sk_…`); stays on the backend |
| `apiBase` | `gen.pollinations.ai` | Pollinations base URL |
| `aiModel` | `"flux"` | Image model |
| `aiVideoModel` | `"veo"` | Video model |
| `aiWidth` / `aiHeight` | `1280` / `800` | AI media size |
| `aiCacheKeep` | `12` | How many generated files to keep in `cache/` |
| `aiPrompts` | (6 presets) | Random prompts for AI images |
| `aiVideoPrompts` | (4 presets) | Random prompts for AI videos (falls back to `aiPrompts`) |

---

## Local backgrounds

Drop image files (`.jpg .jpeg .png .gif .webp`) **or video files**
(`.mp4 .webm .ogg .mov`) into this module's `backgrounds/` folder. The
`node_helper` lists them and MagicMirror serves them statically, so they
enter the rotation automatically — refreshed each time the background
changes, so you can add files without restarting. Videos loop, muted.

---

## How it works

- `MMM-KlydoPi.js` — front-end module: draws the dial, hands, and pendulum in
  SVG, and cross-fades between two image layers and two video layers. It
  decides image-vs-video per swap, and asks the backend for AI media (it
  never sees the API key).
- `node_helper.js` — lists local files, and on request generates an AI image
  or video from Pollinations using the API key, downloads it to `cache/`, and
  returns a local URL. Old cache files are pruned automatically.
- Generated media is cached under `cache/` and served locally, so the key
  and the Pollinations URLs never reach the browser.

---

## Notes

- This is a personal, non-commercial module inspired by the Klydoclock; it
  shares none of its code or artwork.
- **Video model availability:** Pollinations' video models and their names
  change over time, and video generation is slower and costs more Pollen than
  images. If `aiVideoModel` returns an error, check the current model list at
  enter.pollinations.ai and update the config; the module falls back to local
  backgrounds when generation fails.
- **Keep the key private:** put a real key only in your local `config.js`. The
  module keeps it server-side, but don't commit `config.js` (or this README
  with a key pasted in) to a public repo.
- If AI media doesn't appear, the mirror likely has no internet, the key is
  missing/invalid, or generation is slow; local backgrounds keep rotating and
  the small status text at the bottom-left shows the error.

## License

MIT
