// Palette read off the reference stills. Order = cold -> hot.
export const RAMP = ['#EAF7F2', '#BCEFE5', '#DCEEB0', '#F2E48A', '#F9C531', '#F79A1E', '#F4701A'];
export const CREAM = '#F3EFE6';   // Pistachio/300 — the page ground
export const PAPER = '#FAF7F0';   // Pistachio/100

const base = {
  bands: 8, contour: 0.92, gain: 1.1, curve: 0.8, floorT: 0.085, falloff: 2.6,
  grain: 0.02, aniso: 1.05, warp: 0.075, warpFreq: 2.8, warpOrbit: 0.35,
  speed: 1.05, pulse: 0.42, travel: 0.18, spin: 0.075,
  back: CREAM, ring: true, ringWide: 1.45, dashes: 46,
};

export const PRESETS = {
  // default — a single wide organism that bleeds top and bottom
  organism: { ...base,
    count: 34, layout: 'cluster', rmin: 0.085, rmax: 0.185, seed: 20260819,
    spreadX: 1.3, spreadY: 2.05, labels: 5, connect: 2 },

  // metaballs pinned to fixed column centres; round blobs, not stretched
  columns: { ...base,
    bands: 9, contour: 0.88, gain: 1.05, curve: 0.78, floorT: 0.075, falloff: 2.6,
    grain: 0.018, aniso: 1.1, warp: 0.042, warpFreq: 2.2, speed: 0.85, pulse: 0.36,
    travel: 0.07, count: 35, cols: 5, layout: 'lockedColumns', lockX: true,
    rmin: 0.07, rmax: 0.115, seed: 4055, labels: 4, connect: 1 },

  // mirror of columns — pinned rows, drifting horizontally
  rows: { ...base,
    bands: 9, contour: 0.88, gain: 1.05, curve: 0.78, floorT: 0.075, falloff: 2.6,
    grain: 0.018, aniso: 0.95, warp: 0.042, warpFreq: 2.2, speed: 0.85, pulse: 0.36,
    travel: 0.07, count: 44, rows: 4, layout: 'lockedRows', lockY: true,
    rmin: 0.075, rmax: 0.125, seed: 7311, labels: 4, connect: 1 },

  // regular lattice; both axes pinned so cells breathe in place (travel is a
  // no-op here by design)
  grid: { ...base,
    bands: 7, contour: 0.9, gain: 1.05, curve: 0.8, floorT: 0.08, falloff: 2.8,
    grain: 0.02, aniso: 1, warp: 0.03, warpFreq: 2.4, speed: 0.9, pulse: 0.5,
    travel: 0, count: 28, layout: 'lockedGrid', lockX: true, lockY: true,
    rmin: 0.06, rmax: 0.105, seed: 9042, labels: 3, connect: 1 },

  dense: { ...base,
    bands: 7, gain: 1.15, floorT: 0.07, falloff: 2.4, aniso: 1, warp: 0.055,
    warpFreq: 2.6, speed: 1, pulse: 0.3, travel: 0.09, count: 60, layout: 'grid',
    rmin: 0.075, rmax: 0.13, seed: 4070, labels: 0, bleed: 0.14, back: PAPER },

  banner: { ...base,
    bands: 9, contour: 0.88, gain: 1.05, curve: 0.78, floorT: 0.075, falloff: 3,
    grain: 0.018, aniso: 3, warp: 0.05, warpFreq: 2, speed: 0.85, pulse: 0.34,
    travel: 0.06, count: 34, layout: 'columns', rmin: 0.05, rmax: 0.085, seed: 4055,
    labels: 4, connect: 1, bleed: 0.12, back: PAPER },

  // frameless: blobs die out before the edge, ring stays inside
  contained: { ...base,
    count: 22, layout: 'cluster', rmin: 0.045, rmax: 0.115, seed: 4055343,
    labels: 1, ringWide: 2, ringClamp: true, dashes: 64, dash: '#8a6a3a',
    containX: 0.2, containY: 0.2 },
};

export const PRESET_NAMES = Object.keys(PRESETS);
export const DEFAULT_PRESET = 'organism';
