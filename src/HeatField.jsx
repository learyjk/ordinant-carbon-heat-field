import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Panel } from './heatfield/engine.js';
import { DEFAULT_PRESET, PRESETS } from './heatfield/presets.js';
import './HeatField.css';

export const HEAT_FIELD_DEFAULTS = {
  preset: DEFAULT_PRESET,
  height: 600,
  bands: 8,
  contour: 0.92,
  gain: 1.1,
  curve: 0.8,
  outerGlow: 0.085,
  falloff: 2.6,
  grain: 0.02,
  anisotropy: 1.05,
  speed: 1.05,
  pulse: 0.42,
  travel: 0.18,
  warp: 0.075,
  warpFreq: 2.8,
  nodes: 34,
  labels: 5,
  connectors: 2,
  rings: true,
  ringSize: 1.45,
  spin: 0.075,
  seamless: true,
  loopLength: 20,
  renderScale: 1,
  fieldScale: 0.5,
  showStatus: false,
};

// The preset supplies only what has no control of its own: layout, seed, radii,
// spread, axis locking, bleed, edge containment and the ground colour. Every
// field that IS exposed comes from the prop, so a control never sits there
// looking editable while the preset quietly overrules it.
function resolveConfig(p) {
  const base = PRESETS[p.preset] || PRESETS[DEFAULT_PRESET];
  return {
    ...base,
    bands: p.bands,
    contour: p.contour,
    gain: p.gain,
    curve: p.curve,
    floorT: p.outerGlow,
    falloff: p.falloff,
    grain: p.grain,
    aniso: p.anisotropy,
    speed: p.speed,
    pulse: p.pulse,
    travel: p.travel,
    warp: p.warp,
    warpFreq: p.warpFreq,
    count: p.nodes,
    labels: p.labels,
    connect: p.connectors,
    ring: p.rings,
    ringWide: p.ringSize,
    spin: p.spin,
  };
}

export function HeatField(incomingProps) {
  const {
    preset, height, bands, contour, gain, curve, outerGlow, falloff, grain, anisotropy,
    speed, pulse, travel, warp, warpFreq, nodes, labels, connectors, rings, ringSize, spin,
    seamless, loopLength, renderScale, fieldScale, showStatus, onPanelReady, onStatusChange,
  } = { ...HEAT_FIELD_DEFAULTS, ...incomingProps };

  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const panelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Starting…');

  const config = useMemo(() => resolveConfig({
    preset, bands, contour, gain, curve, outerGlow, falloff, grain, anisotropy,
    speed, pulse, travel, warp, warpFreq, nodes, labels, connectors, rings, ringSize, spin,
  }), [preset, bands, contour, gain, curve, outerGlow, falloff, grain, anisotropy,
       speed, pulse, travel, warp, warpFreq, nodes, labels, connectors, rings, ringSize, spin]);

  // The engine boots async, so the first Panel must be built from whatever the
  // props say at that moment — not from the values captured on first render.
  const latest = useRef({ config, seamless, loopLength, fieldScale, renderScale });
  latest.current = { config, seamless, loopLength, fieldScale, renderScale };

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let resizeObserver = null;

    (async () => {
      const engine = await Engine.create();
      if (stopped) return;
      if (!engine) {
        setStatus('WebGPU unavailable — try Chrome, Edge, or Safari 26+');
        return;
      }

      const boot = latest.current;
      const panel = new Panel(engine, canvasRef.current, svgRef.current, boot.config,
        { seamless: boot.seamless, length: boot.loopLength });
      panel.rscale = boot.renderScale;
      panel.fscale = boot.fieldScale;
      panelRef.current = panel;
      onPanelReady?.(panel);
      setReady(true);

      const fit = () => {
        const bounds = stageRef.current?.getBoundingClientRect();
        if (bounds) panel.resize(bounds.width, bounds.height);
      };
      fit();
      resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(stageRef.current);

      let last = performance.now();
      let elapsed = 0;
      let frames = 0;
      const tick = (now) => {
        if (stopped) return;
        const delta = Math.min((now - last) / 1000, 0.05);
        last = now;
        elapsed += delta;
        frames += 1;
        if (elapsed > 0.5) {
          setStatus(`${(frames / elapsed).toFixed(0)} fps · ${panel.nodes.length} nodes`);
          elapsed = 0;
          frames = 0;
        }
        if (!panel.paused) {
          panel.t += delta * panel.P.speed;
          if (panel.t > panel.loop.length) panel.t -= panel.loop.length;
        }
        panel.render();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      onPanelReady?.(null);
      panelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !ready) return;

    // Rebuilding nodes is only needed when the layout or topology changes.
    // `rows` matters as much as `cols` here — the lockedRows preset derives its
    // ribbon count from it, so omitting it leaves stale nodes on a preset swap.
    const topo = ['count', 'layout', 'seed', 'rmin', 'rmax', 'labels', 'cols', 'rows',
                  'spreadX', 'spreadY', 'bleed'];
    if (topo.some((k) => panel.P[k] !== config[k])) panel.setPreset(config);
    else panel.P = config;

    panel.loop.seamless = seamless;
    panel.loop.length = loopLength;
    panel.rscale = renderScale;
    if (panel.fscale !== fieldScale) { panel.fscale = fieldScale; panel.makeField(); }

    const bounds = stageRef.current?.getBoundingClientRect();
    if (bounds) panel.resize(bounds.width, bounds.height);
  }, [config, fieldScale, loopLength, ready, renderScale, seamless]);

  const unavailable = status.startsWith('WebGPU unavailable');
  const resolvedHeight = typeof height === 'number' ? `${height}px` : height;

  return (
    <div className="heat-field" ref={stageRef} style={{ height: resolvedHeight }}>
      <canvas className="heat-field__canvas" ref={canvasRef} />
      <svg className="heat-field__annotations" ref={svgRef} aria-hidden="true" />
      {(showStatus || unavailable) && <div className="heat-field__status">{status}</div>}
    </div>
  );
}

export default HeatField;
