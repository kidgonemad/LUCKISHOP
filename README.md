# LUCKI VAULT — 3D Shop Viewer

Local 3D product viewer for luckivault.com. Renders vinyl and CD products using Three.js with GLB animations.

## Running Locally

```
npx -y serve -p 8000
```
Open: `http://localhost:8000/vinyl_viewer%20new%20maybeev8.html`

## Files

- `vinyl_viewer new maybeev8.html` — main page (all HTML/CSS/JS in one file)
- `vinyl_animation.glb` (9.6MB) — vinyl 3D model + animation
- `DRB CD ONE (Setup) - ANIMATION.glb` (86MB) — CD 3D model + animation
- `assets/` — fonts, cursor image

## Products

10 products total (8 vinyl, 1 CD, 2 sold out):
- 3 signed vinyl variants (clear, brown, grey) — $60
- 4 standard vinyl (escape, meltdown, overdose, black) — $40
- 1 CD — $12
- 2 sold out (signed orange, orange vinyl)

## Features Added

### Model Controls (gear icon, bottom-left)
- Separate tabs for VINYL and CD
- Frame width/height, zoom, move X/Y, scale per type
- Settings saved to localStorage
- Export button copies current values for hardcoding
- Hardcoded defaults: vinyl `{fw:50,fh:100,zoom:39.5,mx:-1.1,my:0,sc:100,mxOpen:1}`, CD `{fw:50,fh:100,zoom:39.5,mx:0.1,my:-2.1,sc:68}`

### Vinyl Camera Pan
- Camera X offset animates from `mx:-1.1` (closed) to `mx:1` (open) during animation
- Smooth interpolation tied to animation progress

### Click-to-Toggle Animation
- Click a card to open/close the animation (replaced hover-to-animate)
- Sold out cards still shake on click

### Hover Tilt
- Mouse movement over a card tilts the 3D scene
- Smooth interpolation, resets on mouse leave

### Flip Button (bottom-right of each card)
- Rotates camera 180 degrees to see the back of the model
- Click again to flip back

### Reskin Panel (`` ` `` key)
- Hover a card to load its materials
- Upload textures to swap material maps
- Texture transform controls (offset X/Y, scale X/Y, rotation) — click a material name to access
- Preset save/load system stored in IndexedDB
- Export All Presets button (downloads JSON)
- 4 record textures per vinyl: `reco0002_texture.001` through `.004`

### Other
- Drag & drop GLB files to replace models
- Modal view on product click (currently disabled — click toggles animation instead)
- Loading screen with progress bar

## Known Bugs / Issues

### Critical
- **Export All Presets download not triggering** — button shows preset count in alert but the file download doesn't start. The `alert()` breaks the browser's user-gesture chain, blocking the programmatic download. Fix: remove the alert so download fires directly from click event.
- **Preset textures don't persist across reload** — preset names/structure save to IndexedDB but when clicked after reload, textures don't apply. The dataURLs (base64 images) are stored but may be too large. Need to switch to saving images as files and referencing by path.

### Visual
- **CD title/price alignment off** — after render loop camera changes, the CD card's title and price text may not align correctly with the model position
- **Tilt effect may still be too subtle or not visible** — needs testing after latest increase to 1.5 intensity

### Architecture
- **86MB CD GLB file** — massive, needs Draco compression or texture downscaling (could get to ~10-20MB)
- **Each card clones the full GLB buffer** — 9 vinyl cards each parse 9.6MB = ~86MB of buffers for vinyl alone
- **Render loop runs 60fps for all cards** — no visibility checking, no dirty-flag optimization
- **Presets store full base64 images** — should store image files separately and reference by filename
- **No original filename in presets** — when uploading a texture, the filename is discarded. Need to capture it for the export/hardcode workflow.

## TODO

- [ ] Fix preset export download (remove alert, test)
- [ ] Rework preset storage: save images as files, JSON references filenames + transforms only
- [ ] Compress CD GLB (Draco / gltf-transform)
- [ ] Optimize rendering (visibility check, dirty flag)
- [ ] Compress uploaded textures on reskin (resize to max 1024px)
- [ ] Verify tilt and flip behavior
- [ ] Hardcode presets into code once export works
