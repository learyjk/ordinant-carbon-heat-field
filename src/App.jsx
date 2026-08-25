import { useEffect, useRef, useState, useCallback } from 'react';
import { useDialKitController } from 'dialkit';
import { HeatField } from './HeatField.jsx';
import { PRESETS, PRESET_NAMES, DEFAULT_PRESET } from './heatfield/presets.js';
import { recordLoop, download, exportSupported } from './export/recordLoop.js';

export default function App() {
  const panelRef = useRef(null);
  const [status, setStatus] = useState('starting…');
  const [busy, setBusy] = useState(null);
  // Engine boots async. Without this the dial-sync effect below runs once with
  // panelRef still null and never re-runs, so persisted values are silently
  // ignored until the user nudges a control.
  const [ready, setReady] = useState(false);
  const actionRef = useRef(() => {});

  const dial = useDialKitController('Heat field', {
    preset: { type: 'select', options: PRESET_NAMES, default: DEFAULT_PRESET },
    reset: { type: 'action', label: 'Reset to defaults' },

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
      // dialkit snaps to min + k*step, so min/max/step must be chosen to put the
      // standard sizes exactly on the grid. 720 with min 270 step 16 lands on
      // 718 ((720-270)/16 = 28.125).
      width: [1280, 320, 1920, 8],    // reaches 640 / 960 / 1080 / 1280 / 1600 / 1920
      height: [720, 240, 1080, 4],    // reaches 360 / 540 / 600 / 720 / 1080
      record: { type: 'action', label: 'Export loop' },
    },
  }, {
    id: 'heatfield',
    persist: true,
    onAction: (path) => actionRef.current(path),
  });
  const p = dial.values;

  const handlePanelReady = useCallback((panel) => {
    panelRef.current = panel;
    setReady(Boolean(panel));
    if (!panel) {
      delete window.__hf;
      return;
    }
    const fit = () => panel.resize(panel.cssW, panel.cssH);
    window.__hf = {
      panel,
      fit,
      at(time) { panel.t = time; fit(); panel.render(); return time; },
      pause(value = true) { panel.paused = value; },
    };
  }, []);

  // ── choosing a preset pushes its values into the dials ──────────────────
  // Dial values override the preset when merging, so without this a preset
  // only changed the fields that have no dial (layout, radii, seed) — picking
  // "dense" kept whatever node count was already on the slider.
  const appliedPreset = useRef(null);
  useEffect(() => {
    if (!ready) return;
    if (appliedPreset.current === p.preset) return;
    const first = appliedPreset.current === null;
    appliedPreset.current = p.preset;
    if (first) return;                     // respect persisted values on load
    const B = PRESETS[p.preset];
    if (!B) return;
    dial.setValues({
      look: { bands: B.bands, contour: B.contour, gain: B.gain, curve: B.curve,
              outerGlow: B.floorT, falloff: B.falloff, grain: B.grain,
              anisotropy: B.aniso },
      motion: { speed: B.speed, pulse: B.pulse, travel: B.travel, warp: B.warp,
                warpFreq: B.warpFreq, nodes: B.count },
      annotations: { labels: B.labels ?? 0,
                     connectors: typeof B.connect === 'boolean' ? (B.connect ? 1 : 0) : (B.connect ?? 0),
                     rings: B.ring !== false, ringSize: B.ringWide ?? 1.45,
                     spin: B.spin ?? 0.075 },
    });
  }, [p.preset, ready]);

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
      panel.resize(panel.cssW, panel.cssH);
    }
  }, [p]);

  const resetRef = useRef(() => {});
  useEffect(() => {
    resetRef.current = () => {
      dial.resetValues();          // restores config defaults, clears any preset
      setStatus('reset to defaults');
    };
  });

  useEffect(() => {
    actionRef.current = (path) => {
      switch (path.split('.').pop()) {
        case 'record': doExport(); break;
        case 'reset': resetRef.current(); break;
      }
    };
  }, [doExport]);

  return (
    <div className="app">
      <HeatField
        preset={p.preset}
        usePresetDefaults={false}
        height="100%"
        bands={p.look.bands}
        contour={p.look.contour}
        gain={p.look.gain}
        curve={p.look.curve}
        outerGlow={p.look.outerGlow}
        falloff={p.look.falloff}
        grain={p.look.grain}
        anisotropy={p.look.anisotropy}
        speed={p.motion.speed}
        pulse={p.motion.pulse}
        travel={p.motion.travel}
        warp={p.motion.warp}
        warpFreq={p.motion.warpFreq}
        nodes={p.motion.nodes}
        labels={p.annotations.labels}
        connectors={p.annotations.connectors}
        rings={p.annotations.rings}
        ringSize={p.annotations.ringSize}
        spin={p.annotations.spin}
        seamless={p.loop.seamless}
        loopLength={p.loop.length}
        renderScale={p.cost.renderScale}
        fieldScale={p.cost.fieldScale}
        onPanelReady={handlePanelReady}
        onStatusChange={setStatus}
      />
      <div className="hud">
        <span>{status}</span>
        {busy !== null && (
          <span className="bar">
            <i style={{ width: `${busy * 100}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}
