import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine, Panel } from './heatfield/engine.js';
import { DEFAULT_PRESET, PRESETS } from './heatfield/presets.js';
import './HeatField.css';

export const HEAT_FIELD_DEFAULTS = {
  preset: DEFAULT_PRESET,
  usePresetDefaults: true,
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

function resolvePreset(componentProps) {
  const base = PRESETS[componentProps.preset] || PRESETS[DEFAULT_PRESET];
  if (componentProps.usePresetDefaults) return base;

  return {
    ...base,
    bands: componentProps.bands,
    contour: componentProps.contour,
    gain: componentProps.gain,
    curve: componentProps.curve,
    floorT: componentProps.outerGlow,
    falloff: componentProps.falloff,
    grain: componentProps.grain,
    aniso: componentProps.anisotropy,
    speed: componentProps.speed,
    pulse: componentProps.pulse,
    travel: componentProps.travel,
    warp: componentProps.warp,
    warpFreq: componentProps.warpFreq,
    count: componentProps.nodes,
    labels: componentProps.labels,
    connect: componentProps.connectors,
    ring: componentProps.rings,
    ringWide: componentProps.ringSize,
    spin: componentProps.spin,
  };
}

export function HeatField(incomingProps) {
  const componentProps = { ...HEAT_FIELD_DEFAULTS, ...incomingProps };
  const { height, fieldScale, loopLength, onPanelReady, onStatusChange, renderScale, seamless, showStatus } = componentProps;
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const stageRef = useRef(null);
  const panelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Starting…');
  const preset = useMemo(
    () => resolvePreset(componentProps),
    [
      componentProps.preset,
      componentProps.usePresetDefaults,
      componentProps.bands,
      componentProps.contour,
      componentProps.gain,
      componentProps.curve,
      componentProps.outerGlow,
      componentProps.falloff,
      componentProps.grain,
      componentProps.anisotropy,
      componentProps.speed,
      componentProps.pulse,
      componentProps.travel,
      componentProps.warp,
      componentProps.warpFreq,
      componentProps.nodes,
      componentProps.labels,
      componentProps.connectors,
      componentProps.rings,
      componentProps.ringSize,
      componentProps.spin,
    ],
  );

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

      const panel = new Panel(engine, canvasRef.current, svgRef.current, preset, { seamless, length: loopLength });
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

    const topologyKeys = ['count', 'layout', 'seed', 'rmin', 'rmax', 'labels', 'cols', 'rows', 'spreadX', 'spreadY', 'bleed'];
    const topologyChanged = topologyKeys.some((key) => panel.P[key] !== preset[key]);
    if (topologyChanged) panel.setPreset(preset);
    else panel.P = preset;

    panel.loop.seamless = seamless;
    panel.loop.length = loopLength;
    panel.rscale = renderScale;
    if (panel.fscale !== fieldScale) {
      panel.fscale = fieldScale;
      panel.makeField();
    }

    const bounds = stageRef.current?.getBoundingClientRect();
    if (bounds) panel.resize(bounds.width, bounds.height);
  }, [fieldScale, loopLength, preset, ready, renderScale, seamless]);

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
