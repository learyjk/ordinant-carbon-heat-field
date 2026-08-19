import { useEffect, useRef, useState, useCallback } from 'react';
import { useDialKit } from 'dialkit';
import { Engine, Panel } from './heatfield/engine.js';
import { PRESETS, PRESET_NAMES, DEFAULT_PRESET } from './heatfield/presets.js';
import { recordLoop, download, exportSupported } from './export/recordLoop.js';

export default function App() {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const panelRef = useRef(null);
  const [status, setStatus] = useState('starting…');
  const [busy, setBusy] = useState(null);
  const actionRef = useRef(() => {});

  const p = useDialKit('Heat field', {
    preset: { type: 'select', options: PRESET_NAMES, default: DEFAULT_PRESET },

    look: {
      bands: [8, 2, 20, 1],
      contour: [0.92, 0, 1, 0.01],
      gain: [1.1, 0.3, 2.5, 0.01],
      curve: [0.8, 0.3, 1.6, 0.02],
      outerGlow: [0.085, 0.01, 0.4, 0.005],
      falloff: [2.6, 0.8, 5, 0.05],
      grain: [0.02, 0, 0.09, 0.002],
      anisotropy: [1.05, 0.4, 4, 0.05],
    },
    motion: {
      speed: [1.05, 0, 2.5, 0.02],
      pulse: [0.42, 0, 0.9, 0.01],
      travel: [0.18, 0, 0.6, 0.01],
      warp: [0.075, 0, 0.25, 0.005],
      warpFreq: [2.8, 0.5, 6, 0.1],
      nodes: [34, 4, 320, 1],
    },
    annotations: {
      labels: [5, 0, 6, 1],
      connectors: [2, 0, 3, 1],
      rings: true,
      ringSize: [1.45, 0.6, 3, 0.05],
      spin: [0.075, 0, 0.4, 0.005],
    },
    loop: {
      seamless: true,
      length: [20, 4, 60, 1],
    },
    cost: {
      _collapsed: true,
      renderScale: [1, 0.35, 1, 0.05],
      fieldScale: [0.5, 0.2, 1, 0.05],
    },
    exportClip: {
      mode: { type: 'select', options: ['seamless', 'pingpong'], default: 'seamless' },
      container: { type: 'select', options: ['mp4', 'webm'], default: 'mp4' },
      fps: { type: 'select', options: ['24', '30', '60'], default: '30' },
      width: [1280, 480, 1920, 16],
      height: [720, 270, 1080, 16],
      record: { type: 'action', label: 'Export loop' },
    },
  }, {
    id: 'heatfield',
    persist: true,
    onAction: (path) => actionRef.current(path),
  });

  // ── boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0, stop = false, ro = null;
    (async () => {
      const engine = await Engine.create();
      if (stop) return;
      if (!engine) { setStatus('WebGPU unavailable — try Chrome, Edge, or Safari 26+'); return; }
      const panel = new Panel(engine, canvasRef.current, svgRef.current,
        { ...PRESETS[DEFAULT_PRESET] }, { seamless: true, length: 20 });
      panelRef.current = panel;

      const fit = () => {
        const r = stageRef.current.getBoundingClientRect();
        panel.resize(r.width, r.height);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(stageRef.current);

      let last = performance.now(), acc = 0, n = 0;
      const tick = (now) => {
        if (stop) return;
        const dt = Math.min((now - last) / 1000, 0.05); last = now;
        acc += dt; n++;
        if (acc > 0.5) { setStatus(`${(n / acc).toFixed(0)} fps · ${panel.nodes.length} nodes`); acc = 0; n = 0; }
        if (!panelRef.current.paused) {
          panel.t += dt * panel.P.speed;
          // keep t inside one loop so the phase never loses float precision
          if (panel.t > panel.loop.length) panel.t -= panel.loop.length;
        }
        panel.render();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      // Escape hatch for headless/hidden contexts, where rAF and
      // ResizeObserver are both throttled to a stop, and for grabbing a
      // deterministic frame at an exact time.
      window.__hf = {
        panel,
        fit,
        at(time) { panel.t = time; fit(); panel.render(); return time; },
        pause(v = true) { panel.paused = v; },
      };
    })();
    return () => { stop = true; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, []);

  // ── push dial values into the engine ────────────────────────────────────
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const base = PRESETS[p.preset] || PRESETS[DEFAULT_PRESET];
    const next = {
      ...base,
      bands: p.look.bands, contour: p.look.contour, gain: p.look.gain,
      curve: p.look.curve, floorT: p.look.outerGlow, falloff: p.look.falloff,
      grain: p.look.grain, aniso: p.look.anisotropy,
      speed: p.motion.speed, pulse: p.motion.pulse, travel: p.motion.travel,
      warp: p.motion.warp, warpFreq: p.motion.warpFreq, count: p.motion.nodes,
      labels: p.annotations.labels, connect: p.annotations.connectors,
      ring: p.annotations.rings, ringWide: p.annotations.ringSize,
      spin: p.annotations.spin,
    };
    // rebuilding nodes is only needed when the layout/topology changes
    const topo = ['count', 'layout', 'seed', 'rmin', 'rmax', 'labels', 'cols',
                  'spreadX', 'spreadY', 'bleed'];
    const changed = !panel.P || topo.some((k) => panel.P[k] !== next[k]);
    if (changed) panel.setPreset(next); else panel.P = next;
    panel.loop.seamless = p.loop.seamless;
    panel.loop.length = p.loop.length;
    panel.rscale = p.cost.renderScale;
    if (panel.fscale !== p.cost.fieldScale) { panel.fscale = p.cost.fieldScale; panel.makeField(); }
    const r = stageRef.current.getBoundingClientRect();
    panel.resize(r.width, r.height);
  }, [p]);

  // ── export ──────────────────────────────────────────────────────────────
  const doExport = useCallback(async () => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!exportSupported()) { setStatus('WebCodecs unavailable — cannot encode here'); return; }
    panel.paused = true;
    setBusy(0);
    try {
      const res = await recordLoop(panel, {
        mode: p.exportClip.mode,
        container: p.exportClip.container,
        fps: Number(p.exportClip.fps),
        seconds: p.loop.length,
        width: p.exportClip.width,
        height: p.exportClip.height,
        onProgress: setBusy,
      });
      download(res.blob, `heatfield-${p.preset}-${p.exportClip.mode}.${p.exportClip.container}`);
      setStatus(`exported ${res.frames} frames · ${res.duration.toFixed(1)}s · ${(res.blob.size / 1048576).toFixed(1)} MB`);
    } catch (err) {
      console.error(err);
      setStatus('export failed: ' + err.message);
    } finally {
      setBusy(null);
      panel.paused = false;
      const r = stageRef.current.getBoundingClientRect();
      panel.resize(r.width, r.height);
    }
  }, [p]);

  useEffect(() => {
    actionRef.current = (path) => { if (path.endsWith('record')) doExport(); };
  }, [doExport]);

  return (
    <div className="app">
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} />
        <svg className="ann" ref={svgRef} />
        <div className="hud">
          <span>{status}</span>
          {busy !== null && <span className="bar"><i style={{ width: `${busy * 100}%` }} /></span>}
        </div>
      </div>
    </div>
  );
}
