# LuckiVault 3D Viewer — Optimization Plan

**Target file:** `vinyl_viewer new maybeev8.html`
**Goal:** Run smooth on phone and desktop (60fps, fast first paint, no crashes).
**Status:** Plan approved — not yet executed.
**Last updated:** 2026-04-18

---

## 1. What this codebase is

- Shopify theme export for luckivault.com
- The shipping shop page is `sections/page-shop.liquid` — uses `<img>` tags, no 3D
- `vinyl_viewer new maybeev8.html` is a standalone prototype (1881 lines) that will replace the static grid with interactive 3D models
- 10 products: 9 vinyl + 1 CD

**Folders that ship to Shopify:**
- `assets/` (29MB) — fonts, images, small GLBs (chain/paper/rust/stake)
- `sections/`, `snippets/`, `templates/`, `layout/`, `config/`, `locales/`

**Folders that do NOT ship (bloat in export only):**
- `BACKUP_ORIGINAL/` — 758MB
- `luckivault-shop/` — 364MB (Vite app + node_modules)
- `VINYL SLEEVES/` — 119MB (source artwork)
- `COVERS (FONT AND BACK)/` — 105MB (source artwork)
- `screencapture-*.png` — 5.1MB
- `newest theme version/` — 29MB (duplicate)

---

## 2. Measured asset cost

### `vinyl_animation.glb` — 9.6 MB
- Geometry/animation: 0.64 MB ✅
- Embedded textures: 8.93 MB (93% of file)
- Largest textures: 2× 2048×2048 PNGs (1.5MB each), 2× 1024×1024 cover PNGs (~2MB each)
- 4 animations, 12 channels, 10 meshes, 13 primitives, 11 materials, 18 textures

### `DRB CD ONE (Setup) - ANIMATION.glb` — **90 MB** ⚠️
- Geometry/animation: **42.25 MB** (likely uncompressed high-poly mesh)
- Two 3000×3000 PNG covers: **38.7 MB** combined
- Used by 1 of 10 products but downloaded for every visitor
- 3 animations, 9 channels, 7 meshes, 12 primitives, 10 materials, 7 textures

---

## 3. Runtime architecture (current)

**Per-card cost** (executed 10×):
- `new THREE.WebGLRenderer({antialias:true, alpha:true})` — own context
- Own Scene, Camera (PerspectiveCamera fov 39.6)
- Own light rig: 1 RectAreaLight + 8 PointLights + 1 AmbientLight
- `gltf.scene.clone(true)` — full deep clone of model tree
- Own animation track map

**Loading:**
- Both GLBs fetched in parallel at page load (lines 848-853)
- ArrayBuffers retained forever as `vinylGLB`/`cdGLB` globals (~100MB JS heap)

**Render loop** (lines 1209-1299):
- ✅ Has `dirty` + `visible` flags (skips off-screen and idle cards)
- ❌ No frame throttling on weak hardware
- ❌ Modal renderer at `pixelRatio: min(devicePixelRatio, 2)` — heavy on retina

**External requests at first paint (blocking):**
1. `unpkg.com/three@0.128.0/build/three.min.js` (~600KB, 2021 build — **5 years old, latest is r184**)
2. `unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js`
3. `unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js`
4. `fonts.googleapis.com` — Roboto with 6 weights
5. `db.onlinewebfonts.com` — Dot Matrix font (third-party, slow)

**Note on r128:** not pinned for any technical reason. r128 was the last popular version of the "drop in 3 script tags, use globals" pattern. r150 (March 2023) deleted the `examples/js/` directory and made all addons ESM-only — anyone wanting to keep the no-build setup had to stay on a pre-r150 version. r128 specifically is just what most "Getting Started" tutorials and copy-paste examples used. Migration is workflow effort, not technical risk.

No `<link rel="preload">`, `<link rel="preconnect">`, or async/defer.

---

## 4. Why this breaks on mobile (current state)

| Issue | Consequence |
|---|---|
| 10 cards × 1 WebGL context each (+ 1 modal = 11) | Mobile Safari/Chrome cap is ~8. Older contexts get killed → blank canvases, GPU process crash on iOS |
| 100MB total GLB download | 4G mobile = 80–160s to first paint. 3G = timeout |
| 21MB PNG decode + 42MB GLTF parse on main thread | 3–8s frozen UI on midrange Android |
| 9 cloned vinyl scenes × 18 textures | ~150–200MB VRAM — iPhone shared-memory throttle/kill |
| RectAreaLight + 8 PointLights × 9 cards | iPhone 12 drops to ~30fps |

**Realistic current performance estimate (no measurements taken yet):**
| Device | Load time | Runtime |
|---|---|---|
| Desktop fiber, M1 Mac | 5–8s | 60fps |
| Mid laptop, home wifi | 12–20s | 30–60fps, jank |
| iPhone 14, 5G | 25–40s | may render OK at 30fps |
| iPhone 12, 4G | 45–90s | likely drops contexts, very janky |
| Mid Android, 4G | likely crashes/blank | n/a |

---

## 5. Bottlenecks ranked by ROI

| # | Issue | Impact | Difficulty |
|---|---|---|---|
| 1 | 90 MB CD GLB downloaded for everyone | huge | easy |
| 2 | 42 MB raw mesh in CD GLB | huge | medium |
| 3 | Two 3000×3000 PNGs in CD GLB | huge | easy |
| 4 | 10 separate WebGL contexts | breaks mobile | hard |
| 5 | 9× scene clone for vinyl | high VRAM | medium |
| 6 | Three.js from unpkg | high TTFB | easy |
| 7 | External Dot Matrix font | render block | easy |
| 8 | RectAreaLight + 8 PointLights | high GPU/frame | easy |
| 9 | 100MB ArrayBuffers retained in JS | high RAM | trivial |
| 10 | Modal renderer at pixelRatio 2 | high on retina | trivial |
| 11 | No preload/preconnect hints | seconds of TTFB | trivial |

---

## 6. Phased execution plan

### Phase 0 — File hygiene (5 min)
- Delete `screencapture-*.png` from root
- Verify `assets/cover-front.png` (6.3MB) and `assets/cover-back.png` (6.5MB) are actually used; delete if not
- Confirm `BACKUP_ORIGINAL/`, `VINYL SLEEVES/`, `COVERS/`, `luckivault-shop/node_modules` excluded from Shopify upload

### Phase 1 — GLB compression (biggest single win)
**Tool:** `gltfpack` (or `gltf-transform`) — needs Node/npm
**Approach:** work on copies (`cd.v2.glb`, `vinyl.v2.glb`), originals untouched

Conservative first pass (no mesh decimation):
```
gltfpack -i "DRB CD ONE.glb" -o cd.v2.glb -cc -tc -tq 8
gltfpack -i vinyl_animation.glb -o vinyl.v2.glb -cc -tc -tq 8
```

If visual quality holds, aggressive pass:
```
gltfpack -i "DRB CD ONE.glb" -o cd.v3.glb -cc -tc -tq 8 -si 0.5
```

**Code change:** add MeshoptDecoder + KTX2Loader to GLTFLoader

**Expected:**
- vinyl: 9.6 MB → ~1.5 MB
- CD: 90 MB → ~5 MB (assuming mesh simplifies cleanly)

### Phase 2 — Lazy load + memory hygiene (1 hr)
- Load vinyl GLB immediately (used by 9 cards)
- Load CD GLB only when CD card enters viewport (extend existing IntersectionObserver)
- Drop `vinylGLB`/`cdGLB` ArrayBuffers after parse
- Keep Blob URL for modal re-parse fallback

Add to `<head>`:
```html
<link rel="preload" as="fetch" href="vinyl.v2.glb" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com">
```

### Phase 3 — Self-host + modernize Three.js (2-3 hrs)

**Current version:** r128 (April 2021) — **5 years and 56 releases behind latest (r184).**
**Target version:** r170 (recent enough for KTX2/Meshopt maturity, stable enough to avoid bleeding-edge bugs, well-documented).

#### Why we're stuck on r128 (context)

Not a technical pin — a workflow artifact.

1. **`examples/js/` was deleted in r150 (March 2023).** Before r150, you could drop `<script src="...examples/js/loaders/GLTFLoader.js">` and use `THREE.GLTFLoader()` as a global. After r150, those addons are ESM-only.
2. **r150+ requires ES modules** — `<script type="module">` + import maps, or a bundler. That's a workflow change, not just a URL bump.
3. **r128 is the version that "Getting Started" tutorials and copy-paste examples used** in 2021-2022. It's not a chosen version — it's a copy-paste artifact.

The current code does not depend on any r128-specific API. Migration is purely about doing the work.

#### Migration tasks

1. **Switch to ESM** with import map:
   ```html
   <script type="importmap">
   {
     "imports": {
       "three": "./assets/three.module.js",
       "three/addons/": "./assets/three-addons/"
     }
   }
   </script>
   <script type="module">
     import * as THREE from 'three';
     import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
     import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
     import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
     import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
   </script>
   ```

2. **Color space migration (r152 change):**
   - `renderer.outputEncoding = THREE.sRGBEncoding` → `renderer.outputColorSpace = THREE.SRGBColorSpace`
   - `tex.encoding = THREE.sRGBEncoding` → `tex.colorSpace = THREE.SRGBColorSpace`
   - `mat.normalMap.encoding = THREE.LinearEncoding` → remove (default is correct)
   - Same for `roughnessMap`, `aoMap`

3. **Light intensity recalibration (r155 change):**
   - `physicallyCorrectLights = true` → removed; physically-based is now default
   - All light intensities use candela/lux units; existing values (`intensity 6` on RectAreaLight, `0.08–60` on PointLights) will need rescaling
   - Visual A/B compare needed — colors and brightness will shift

4. **Self-host:**
   - Download `three.module.js`, `GLTFLoader.js`, `OrbitControls.js`, `MeshoptDecoder.js`, `KTX2Loader.js` and Basis transcoder files into `assets/three-addons/`
   - Self-host Dot Matrix `.woff2` to `assets/`
   - Add `font-display:swap`

#### Migration risk levels

| Change | Risk | Validation |
|---|---|---|
| ESM imports | low | runs or doesn't |
| Color space API | medium | colors look slightly different — A/B screenshot |
| Light intensity units | high | scene may look way too bright/dark — needs manual recalibration |
| KTX2 + Meshopt loader hooks | low | textures load or fail loudly |

**Mitigation:** if light recalibration is fiddly, stay on r147 (last pre-ESM version that still has `examples/js/`) for first ship, then migrate later. r147 still supports KTX2/Meshopt and gets us 90% of the modernization benefit without the API breaks.

### Phase 4 — Shared WebGL context (4–6 hrs, biggest mobile win)
**Difference between "works on phone" and "doesn't".**

Two viable patterns:
- **A** (simpler): one full-page transparent `<canvas>` `position:fixed`, scissor per card region
- **B** (cleaner): one offscreen renderer + render-to-texture + `texImage2D` to per-card 2D canvas

Cuts WebGL contexts from 10 → 1.

### Phase 5 — Cheaper rendering (1 hr)
- Replace RectAreaLight + 8 PointLights with: 1 DirectionalLight + 1 HemisphereLight (or bake env map)
- Cards: `antialias:false`, `pixelRatio: min(dPR, mobile ? 1 : 1.5)`
- Modal: `pixelRatio: min(dPR, 1.5)`
- Frame throttle when `navigator.hardwareConcurrency <= 4`

### Phase 6 — Scene sharing (2 hrs)
Stop cloning full scene 9×. Share geometry/materials, clone only what differs (variant texture overrides). Three.js shares geometry on `clone()` but not materials — fix that.

### Phase 7 — Shopify integration (4–8 hrs)
- Move viewer HTML into `sections/page-shop.liquid`
- Generate PRODUCTS array from Liquid:
  ```liquid
  const PRODUCTS = [{% for product in collections.frontpage.products %}{...}{% endfor %}];
  ```
- Upload GLBs as Shopify theme assets → automatic CDN, gzip, immutable cache
- Progressive enhancement: ship `<img>` first paint, layer 3D on top once loaded

---

## 7. Targets after each phase

| Device | Current | After P1-3 | After all |
|---|---|---|---|
| Desktop fiber, M1 | 5-8s, 60fps | <1s, 60fps | <1s, 60fps |
| Mid laptop, wifi | 12-20s, 30-60fps | 2-3s, 60fps | 1s, 60fps |
| iPhone 14, 5G | 25-40s, may break | 3-5s, 60fps | 1-2s, 60fps |
| iPhone 12, 4G | 45-90s, breaks | 5-8s, 30-60fps | 2-3s, 60fps |
| Mid Android, 4G | crash/blank | 6-10s, 30fps | 3-4s, 60fps |

---

## 8. Risks and mitigations

| Risk | Symptom | Mitigation built in |
|---|---|---|
| KTX2 fails on older Safari | Black/blank textures | Detect `WEBGL_compressed_texture_s3tc`, fall back to embedded JPG GLB |
| Mesh simplification mangles CD | Polygonal disc, garbled cover text | Keep original GLB committed, A/B toggle via `?legacy=1` |
| Three r128 → r170 API breaks | Wrong colors, lighting off | Pin r150 first (smaller jump), test, then advance |
| Shared WebGL context z-fighting | Cards bleed, scissor errors | Keep per-card-context fallback behind `?contexts=multi` |
| Lazy CD load too late | Blank canvas on scroll | Skeleton placeholder + spinner |
| Drop ArrayBuffer breaks modal | Modal opens empty | Keep Blob URL or re-fetch (cached) |
| Removing RectAreaLight flattens vinyl | Lost specular highlights | Bake env map (HDRI), use PMREMGenerator |
| WebGL context exhaustion | Cards blank | Listener for `webglcontextlost`, fallback to static `<img>` for that card |
| GLB cached old version after deploy | Stale 90MB file | Cache-bust filename per export (`vinyl.v2.glb`) |

---

## 9. Debug tooling to add up front

```
?debug=1          → Stats.js FPS overlay, draw-call counter, texture memory readout
?legacy=1         → loads original GLBs and old code path (A/B compare)
?contexts=multi   → forces per-card WebGL contexts (rollback for shared-context bugs)
?nolazy=1         → eager loads CD (rollback for lazy-load bugs)
console.time logs → GLB fetch ms, parse ms, first-render ms (always on)
```

Flip a query param, don't redeploy.

---

## 10. Workflow safety

- Work on copies (`vinyl.v2.glb`, `cd.v2.glb`); originals untouched until sign-off
- Edit `vinyl_viewer new maybeev8.html` in place; keep `vinyl_viewer v9-layouts.html` as known-good rollback
- Each phase is independent — if Phase 4 breaks, keep Phases 1-3, revert just that
- After each phase: open in browser, confirm visually, log new file size / load time

---

## 11. Open questions / decisions still needed

| Q | Default if no answer | When it matters |
|---|---|---|
| Have `.blend` source for CD model? | Assume no; work from GLB | Phase 1 mesh decimation |
| Modal max display size? | Assume ≤1000px | Phase 1 texture downscale (justifies 3000×3000 or not) |
| Lowest device to support? | iPhone 12+ / 2021+ Android | Phase 1 KTX2 fallback strategy |
| Acceptable to lose 8-light setup? | Yes if look holds | Phase 5 light reduction |
| Replace `page-shop.liquid` or augment? | Replace | Phase 7 architecture |
| Performance trace + HAR available? | Skip; measure by file size + visual | Validation rigor |

---

## 12. Execution order (recommended)

0. **Section 16** — Modal Layout 2 fix (UI bug, run first, ~45 min) ✓ done
0.5. **Section 17** — Variant texture preload (pre-flight visual bug) ✓ done
1. **Phase 0** — file hygiene (no risk)
2. **Phase 1** — gltfpack on CD GLB only, conservative pass first
3. Stop, compare visually + measure file size
4. If good → gltfpack on vinyl GLB
5. **Phase 2** — lazy load + memory drop
6. **Phase 3** — self-host Three.js + fonts
7. Re-measure baseline. If targets met for desktop and high-end mobile, ship.
8. **Phase 5** — cheap rendering (defer 4 — it's the hardest)
9. **Section 18** — Mobile UX polish + interaction parity (depends on Phase 5 frame budget)
10. **Phase 6** — scene sharing
11. **Phase 4** — shared WebGL context (only if mobile context exhaustion is still happening)
12. **Phase 7** — Shopify integration (separate work stream, can start in parallel after Phase 3)

---

## 13. Rollback plan

- Original GLBs preserved on disk
- `vinyl_viewer v9-layouts.html` is rollback target
- Each query-param flag (`?legacy=1` etc.) restores old behavior at runtime
- Git not initialized in this directory — recommend `git init` + commit before Phase 1

---

## 14. Tools needed

- **Node + npm** (for gltfpack, gltf-transform)
- **gltfpack** OR **gltf-transform** (Meshopt + KTX2 compression)
- **Modern browser** (Chrome/Edge/Firefox 90+) for testing
- **Optional:** Blender (for surgical mesh decimation if gltfpack mangles things)
- **Optional:** Real iPhone + Android device for verification (BrowserStack acceptable)

---

## 15. Success criteria

- [ ] First paint <3s on iPhone 12 over 4G
- [ ] 60fps sustained on M1 Mac, 30fps+ on iPhone 12
- [ ] Total page weight <8MB (currently ~100MB)
- [ ] No WebGL context errors on any tested device
- [ ] Visual fidelity matches original (or differences explicitly approved)
- [ ] Modal close-up still looks good (cover art legible)
- [ ] Plan rolled out one phase at a time with measurements between

---

## 16. Pre-optimization UI fix — Modal Layout 2 ("OPEN VINYL")

**Status:** identified, plan approved, not executed
**Run before Phase 1** (UI bug, blocks demoing the optimized build)

### Intent

- **Desktop default:** Layout 1 — square canvas left, text column right (side-by-side)
- **Desktop after OPEN VINYL clicked:** Layout 2 — canvas goes WIDE (vinyl spread open = horizontal), page reshapes to fit
- **Mobile:** always Layout 2 stacked (canvas top, text below); button irrelevant

### What's broken (current state, lines 1541-1552)

| Setting | Current | Problem |
|---|---|---|
| `Canvas Aspect Ratio` | `0.6` (portrait) | Wrong direction — opened vinyl is wide, should be ~1.8–2.0 |
| `Distance: 10` applied via OrbitControls | yes | Per-product camera distances differ; forcing 10 yanks camera off |
| Camera reframe on aspect change | none | Model crops/squishes when canvas reshapes |
| Layout transition vs vinyl animation | 0.9s vs 2.5s | Desynced — page snaps fast, record slides slow |
| Button shown for CD product | yes | CD has no sleeve to open; button shouldn't show |
| Mobile detection | none | Mobile gets desktop Layout 1 by default |

### Fix plan

1. **Canvas aspect:** Layout 2 → `1.8` (wide). Recompute camera distance after FOV/aspect change so model bbox fills new viewport.
2. **Transition timing:** stretch CSS transitions to ~2s to match vinyl animation duration.
3. **CD button hiding:** when modal opens, if `PRODUCTS[modalProductIdx].type === 'cd'`, hide `.modal-vinyl-btn`.
4. **Mobile = Layout 2 always:** on modal open, if `window.innerWidth <= 768`, force Layout 2 and hide button. Mobile Layout 2 needs its own values (square canvas, not 1.8 — narrow viewports waste space with wide canvas).
5. **Cleanup:** remove `Distance` from saved Layout 2 (more harm than good). Simplify `_pptunerApplyLayout` to CSS-only; handle camera reframe in render loop.

### Open decisions

| Q | Default if no answer |
|---|---|
| Desktop Layout 2 canvas aspect — exact value? | 1.8 |
| Layout 2 text placement — fully below canvas, or right column narrower? | fully below |
| Separate mobile layout values, or share with desktop? | separate (square canvas on mobile) |
| CD: remove button entirely, or show different button for CD's "Empty CDAction" animation? | remove entirely for now |

### Estimated time
~45 min total (10 min aspect/camera, 10 min timing, 5 min mobile, 2 min CD hide, 10 min cleanup, 8 min test)

---

## 17. Pre-optimization UX fix — Variant texture flash

**Status:** implemented
**Run before Phase 1** (visible visual bug on every page load)

### What's broken

On first load, every card shows the GLB's baked-in *default* textures (generic art), then after a few seconds the variant-specific textures (`VARIANT_TEXTURES[prod.variant]`) download and swap in. Visible "pop" per card, staggered across cards as their respective PNGs finish downloading.

### Root cause

1. GLB fetched + parsed → meshes render with embedded default PNGs.
2. `applyVariantTextures()` runs synchronously after parse, but each `loadCached(url, cb)` call kicks off an async texture fetch.
3. The async callback fires whenever the variant PNG arrives (10s of ms to seconds later), and only then is `mat.map` swapped.

### Fix (implemented)

Fire-and-forget preload of every variant texture URL at page init, right after `VARIANT_TEXTURES` and `loadCached` are defined:

```js
(function preloadVariantTextures(){
  const urls = new Set();
  PRODUCTS.forEach(p => {
    const tm = p.variant && VARIANT_TEXTURES[p.variant];
    if(tm) Object.values(tm).forEach(u => urls.add(u));
  });
  urls.forEach(u => loadCached(u, ()=>{}));
})();
```

`loadCached` already dedupes by URL, so subsequent `applyVariantTextures` calls hit the cache instantly — no flash.

### Why this ordering works

The preload fires in parallel with the GLB fetches. Variant PNGs are small relative to GLBs (vinyl cover 1-2MB vs 90MB CD GLB). By the time GLBs parse + `applyVariantTextures` runs, variant textures are already in `_texCache`.

### Interaction with Phase 1 / Phase 2

- After Phase 1 (GLB compression), GLBs parse *faster* — smaller window for preload to land in. Still fine: variant PNGs finish first on any realistic connection.
- After Phase 2 (lazy CD load), CD GLB is deferred — variant texture cache is independent, still preloaded at page init.
- Phase 1 / Phase 2 don't regress this fix.

### Follow-up (optional)

- Add `<link rel="preload" as="image">` hints in `<head>` for the critical above-the-fold textures (first 2 cards' variants) — tells browser to schedule these before the JS even parses. Trivial, probably 1-2s TTFB improvement on slow connections.

---

## 18. Mobile UX polish + interaction parity

**Status:** planned, not started
**Run after Phase 5** (performance wins must land first — no point polishing transitions that frame-drop)
**Parity bar:** mobile must feel seamless — indistinguishable in *feel* from desktop even if visuals differ.

### Intent

The existing plan addresses mobile *performance* (Phase 4 shared context, Phase 5 render cost, Section 16 modal layout). It does not address mobile *UX* — how the shop grid reads on a phone, how the modal behaves under a thumb, how smooth everything feels. This section covers that gap.

### Scope

Three audit tracks, each a discrete pass. Each track ends with a device test on real iPhone + real Android (BrowserStack OK if no hardware available).

#### 18A. Mobile shop grid audit (~1 hr)

Current state (lines 314-319):
- `@media(max-width:768px)`: cards go 1-column (`width:100%`), gap 15px
- Card canvas: `aspect-ratio:1`, title overlay on top
- Tilt-on-hover has no touch equivalent

Check:
- 1-col vs 2-col on phone — 1-col may feel sparse on a 6.5" screen; 2-col may crop titles. Test both.
- Tap target sizes — `#items a` whole card is the hit area, but title span has its own click handler (line 745). Verify ≥44×44pt on all devices.
- Canvas aspect on mobile — square is fine, but `aspect-ratio:1` with `width:100%` on a 375px screen = 375px canvas. Pixel ratio at 3x = 1125px backing store → expensive. Phase 5 pixelRatio throttle handles this but verify.
- Title readability — size, contrast, positioning (overlay vs below card).
- Scroll performance — 10 cards × canvas renders, even at 30fps target, scroll should feel buttery. Check for jank.
- Sold-out state visibility on mobile.
- Drop banner / reskin panel behavior on mobile — both currently desktop-only; confirm they're hidden or mobile-appropriate.

#### 18B. Mobile modal audit (~1 hr)

Current state (lines 252-258 + Section 16 additions):
- `flex-direction:column`, canvas on top, text below
- Canvas `max-height:70vh`
- Close via backdrop click only
- OPEN VINYL button hidden on mobile (Section 16)

Check:
- Scroll inside modal — is `#modal` scroll smooth? `-webkit-overflow-scrolling:touch` present? (line 215: no)
- Close gesture — backdrop tap is not obvious on mobile. Add explicit close button, or swipe-down-to-close. Test both.
- Text sizing — `font-size:20px` title on mobile (line 256). Reads OK? Features list `18px`. Price `22px`. Sanity check on real device.
- Add-to-cart button reach — thumb-zone safe? Button at top of text column means user must scroll to hit it after reading details. Consider sticky add-to-cart.
- Touch feedback on buttons (scale on tap, haptic where available).
- OrbitControls on mobile — pinch-to-zoom work? Conflicts with page zoom?
- What happens on orientation change? Does modal re-layout correctly?

#### 18C. Interaction smoothness + parity (~1 hr)

Desktop feel has: hover tilt, click-to-open modal, smooth open/close, crisp transitions. Mobile must have equivalent-feeling interactions.

Check:
- Tap latency — remove 300ms tap delay (touch-action:manipulation or viewport meta already handles it since `width=device-width,user-scalable=no` is set, verify).
- Tap feedback — every tappable element should visually acknowledge touch within 16ms. Add `:active` states on cards and buttons.
- Animation budget — Section 16's 1.75s layout transition and 2.5s vinyl open are *long*. On mobile they need to stay buttery. Verify post-Phase-5.
- Momentum scroll on iOS — body scroll should feel native. Check `overscroll-behavior`.
- Back gesture / back button on Android — should close modal, not navigate away.
- Reduced-motion preference — respect `prefers-reduced-motion: reduce` by shortening or skipping vinyl open animation.

### Success criteria

- [ ] Shop scroll sustains 60fps on iPhone 12, 30fps+ on mid Android
- [ ] Modal open-to-interactive <500ms on 4G
- [ ] Every tap gives visual feedback within 1 frame
- [ ] Modal can be closed with a gesture (button, swipe, or explicit X — not just backdrop)
- [ ] No layout jank on orientation change
- [ ] `prefers-reduced-motion` respected
- [ ] Side-by-side desktop↔mobile video: interactions feel like same product, different form factor

### Open decisions

| Q | Default if no answer |
|---|---|
| Mobile shop grid: 1-col or 2-col? | 1-col (default already); revisit on device test |
| Mobile modal close: add X button, swipe-down, or both? | both |
| Sticky add-to-cart on mobile? | yes (improves conversion, plan scope creep is worth it) |
| Respect reduced-motion? | yes (accessibility + battery) |
| Device test coverage — iPhone only, or Android too? | both; iOS Safari + Chrome Android minimum |

### Estimated time

~3-4 hrs total (1 hr per audit + ~1 hr fixes across all three). Slot after Phase 5.

### Dependencies

- Phase 5 (cheaper rendering) must land first — otherwise transitions will frame-drop no matter how polished the CSS.
- Section 17 (variant preload) landed — so mobile doesn't also see the texture flash.
- Section 16 (modal layout 2) landed — mobile modal baseline set.
