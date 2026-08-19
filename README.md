# Heat Field

WebGPU contour-banded thermal heat field — an organic metaball shader with
annotation overlays and loop-safe video export.

Extracted from the Ordinant Carbon landing page build. Every behaviour tuned
during that work is carried over: column-locked layouts, per-axis edge
containment, breathing annotation rings with a constant dash count, and the
two-pass low-res field accumulation.

```bash
npm install
npm run dev      # http://localhost:5178
```

Requires WebGPU (Chrome, Edge, Safari 26+). Video export additionally needs
WebCodecs.

## How it works

The field is a sum of Gaussian kernels, one per node. That is what makes "some
cells travel, some pulse, some bloom and die" **directable** rather than
emergent — every node exposes position, radius and intensity — and it keeps node
positions on the CPU so the SVG annotations can track them without a GPU
readback.

Rendering is two passes:

1. **Field** — accumulate the scalar field into a low-res `r16float` target. The
   field is smooth and low-frequency, so half resolution costs a quarter as much
   and looks the same. This is the dominant cost: *field pixels × nodes*.
2. **Colour** — sample it, quantise to contour bands with derivative AA, map
   through the ramp, dither.

WGSL has no `fwidth()`, so band AA uses `abs(dpdx(v)) + abs(dpdy(v))`. Without
it the bands crawl and moiré as the field moves.

Measured on an M-series Mac at 1770×1399: 0.37 ms/frame at 72 nodes and half
field scale; 2.92 ms at 900 nodes. **None of this needs WebGPU** — it is one
fragment shader plus a small JS loop, and would run comparably in WebGL2.
WebGPU only starts paying for itself with a grid simulation or thousands of
agents.

## Presets

`organism` is the default — one wide cluster that bleeds off the top and bottom.

| preset | what it is |
|---|---|
| `organism` | single connected cluster, round lobes, bleeds vertically |
| `columns` | metaballs pinned to fixed column centres (`lockX`), round not stretched |
| `dense` | jittered grid of separated cells |
| `banner` | anisotropic vertical smear |
| `contained` | frameless: blobs die out before the edge, ring stays inside |

Columns come from the **locked layout**, not from anisotropy — which is why
`columns` can keep `aniso ≈ 1.1` and still read as vertical chains.

## Looping video export

Two ways to guarantee a loop, both in the UI:

**`seamless` (default, recommended).** Every animated frequency — node pulse,
the three drift oscillators, bloom lifecycles, traveller speeds, ring spin — is
snapped to a whole number of cycles per loop, and the domain warp and grain are
driven by a `loopPhase` that orbits through noise space instead of scrolling
through it. A time-scrolling warp can never loop. The result is that frame N is
bit-identical to frame 0, so one pass is a perfect loop with no reversal.

Verified, not assumed: rendering `t=0` and `t=L` and comparing pixels gives a
maximum channel difference of **0**, while the same comparison with quantisation
off differs by 219, and `t=0` vs `t=L/2` differs by 213 (so the zero is loop
closure, not a still image).

A seamless clip must be exactly one period, so the export forces its duration to
the loop length and warns if you asked for something else.

**`pingpong`.** Records one pass then appends it reversed with both endpoints
dropped (`2N−2` frames). Works with un-quantised motion, but playback visibly
runs backwards for half the clip. Use it if you want the free-running motion
timing preserved.

Frames are authored at exact timestamps rather than sampled from a clock, so
output is deterministic and independent of render speed. The GPU canvas and the
annotation overlay are composited into a 2D canvas per frame — the annotations
are DOM SVG and would otherwise be missing from the video.

## Layout

```
src/
  heatfield/
    wgsl.js          shader source (both passes)
    nodes.js         node model, stepping, loop quantisation
    annotations.js   display list + SVG and Canvas2D renderers
    presets.js       palette + presets
    engine.js        Engine (device/pipelines) and Panel (one canvas)
  export/
    recordLoop.js    mediabunny + WebCodecs, seamless and ping-pong
  App.jsx            dialkit UI wiring
```

`Engine` owns one device and the pipelines; each `Panel` owns a canvas, its
uniform/storage buffers and its field texture, so one device can drive many
panels.

## Notes

- `window.__hf` exposes `{ panel, at(t), fit(), pause() }` — `at(t)` forces a
  render at an exact time. Needed in headless or hidden contexts, where `rAF`
  and `ResizeObserver` are both throttled to a stop.
- Dial values persist to `localStorage` under `dialkit:heatfield`.
- H.264 requires even dimensions; the exporter rounds for you.
