// Node model. The field is a sum of Gaussian kernels, one per node — that is
// what makes "some cells travel, some pulse, some bloom and die" directable
// rather than emergent, and it keeps positions CPU-side so annotations can
// track them without a GPU readback.

export const MAX_NODES = 512;

export const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function buildNodes(P) {
  const rnd = mulberry32(P.seed);
  const n = Math.min(P.count, MAX_NODES);
  const homes = [], colScale = [], colOf = [];

  if (P.layout === 'lockedColumns') {
    // x is the exact column centre and never drifts (see lockX in stepNodes),
    // so each column reads as one vertical ribbon. y runs past [0,1] so the
    // ribbons bleed off the top and bottom.
    const cols = P.cols || 5, per = Math.max(1, Math.round(n / cols));
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) / cols;
      colScale.push(0.55 + rnd() * 0.85);          // per-column heat
      for (let k = 0; k < per; k++) {
        homes.push([cx, -0.15 + ((k + 0.5) / per + (rnd() - 0.5) * 0.16) * 1.3]);
        colOf.push(c);
      }
    }
  } else if (P.layout === 'columns') {
    const cols = Math.max(3, Math.round(n / 4));
    for (let i = 0; i < n; i++) homes.push([(i % cols + 0.5) / cols + (rnd() - 0.5) * 0.05, rnd()]);
  } else if (P.layout === 'grid') {
    const cols = Math.max(2, Math.round(Math.sqrt(n * 2.6)));
    const rows = Math.max(2, Math.ceil(n / cols));
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = (i / cols) | 0;
      homes.push([(c + 0.5) / cols + (rnd() - 0.5) * 0.09,
                  (r + 0.5) / rows + (rnd() - 0.5) * 0.13]);
    }
  } else { // cluster
    const sx = P.spreadX || 1.15, sy = P.spreadY || 1;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.2832, rr = Math.pow(rnd(), 0.62) * 0.3;
      homes.push([0.5 + Math.cos(a) * rr * sx, 0.5 + Math.sin(a) * rr * sy]);
    }
  }

  // push homes past [0,1] so the field bleeds off the panel edges. Locked
  // columns manage their own vertical bleed; remapping would move the columns.
  const b = P.layout === 'lockedColumns' ? 0 : (P.bleed || 0);
  if (b) for (const h of homes) { h[0] = -b + h[0] * (1 + 2 * b); h[1] = -b + h[1] * (1 + 2 * b); }

  const nodes = [];
  for (let i = 0; i < homes.length; i++) {
    const persistent = rnd() < 0.55;
    const traveler = !persistent && rnd() < 0.4;
    const driftS = 0.1 + rnd() * 0.3;
    nodes.push({
      hx: homes[i][0], hy: homes[i][1],
      r0: P.rmin + rnd() * (P.rmax - P.rmin),
      i0: 0.55 + rnd() * 0.55,
      pf: 0.18 + rnd() * 0.55, pp: rnd() * 6.2832,
      driftA: 0.012 + rnd() * 0.045,
      // three independent angular frequencies rather than one scaled three
      // ways, so each can be quantised to the loop on its own
      w1: driftS, w2: driftS * 0.61, w3: driftS * 0.83,
      p1: rnd() * 6.2832, p2: rnd() * 6.2832, p3: rnd() * 6.2832,
      lifeF: persistent ? 0 : 0.012 + rnd() * 0.05, lifeP: rnd(),
      traveler, vx: (rnd() - 0.5) * 0.03, vy: (rnd() - 0.5) * 0.018,
      asset: false, iScale: colOf.length ? colScale[colOf[i]] : 1,
    });
  }
  return { nodes, labelIdx: pickAssets(nodes, P) };
}

// Farthest-point sampling: repeatedly take the candidate furthest from every
// node already labelled. A min-distance threshold plus a fallback does not work
// — when the pool is tight the fallback re-introduces the crowding it avoided.
function pickAssets(nodes, P) {
  const want = P.labels | 0;
  if (!want) return [];
  let cands = nodes.filter((d) =>
    d.lifeF === 0 && !d.traveler && d.hx > 0.18 && d.hx < 0.8 && d.hy > 0.1 && d.hy < 0.9);
  if (cands.length < want) cands = nodes.filter((d) => d.lifeF === 0);
  if (!cands.length) return [];
  cands.sort((a, b) => a.hx - b.hx);
  const sep = (a, b) => Math.hypot(a.hx - b.hx, (a.hy - b.hy) * 0.7);
  const picked = [cands[Math.floor(cands.length / 2)]];
  while (picked.length < Math.min(want, cands.length)) {
    let best = null, bestD = -1;
    for (const d of cands) {
      if (picked.includes(d)) continue;
      let dd = Infinity;
      for (const q of picked) dd = Math.min(dd, sep(q, d));
      if (dd > bestD) { bestD = dd; best = d; }
    }
    if (!best) break;
    picked.push(best);
  }
  picked.forEach((d) => { d.asset = true; });
  return nodes.map((d, i) => (d.asset ? i : -1)).filter((i) => i >= 0);
}

const TAU = Math.PI * 2;
const tri = (v) => { v = ((v % 2) + 2) % 2; return v > 1 ? 2 - v : v; };

// Snap an angular frequency (rad/s) to a whole number of cycles per loop.
const qAng = (w, L) => (TAU * Math.max(1, Math.round((w * L) / TAU))) / L;
// Snap a plain frequency (cycles/s) the same way.
const qCyc = (f, L) => Math.max(1, Math.round(f * L)) / L;

export function stepNodes(nodes, P, t, aspect, out, loop) {
  const seamless = !!(loop && loop.seamless), L = (loop && loop.length) || 20;
  const ease = (s) => Math.sign(s) * Math.pow(Math.abs(s), 0.7);
  const k = P.travel / 0.1;
  const mx = P.containX || 0, my = P.containY || 0;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const w1 = seamless ? qAng(n.w1, L) : n.w1;
    const w2 = seamless ? qAng(n.w2, L) : n.w2;
    const w3 = seamless ? qAng(n.w3, L) : n.w3;
    let x, y;

    if (n.traveler) {
      const sp = 1.3;
      if (seamless) {
        // travel a whole number of cycles per loop, so it lands where it began
        const cx = Math.max(1, Math.round((Math.abs(n.vx) * k * L) / (mx ? 2 : sp))) * Math.sign(n.vx || 1);
        const cy = Math.max(1, Math.round((Math.abs(n.vy) * k * L) / (my ? 2 : sp))) * Math.sign(n.vy || 1);
        const ph = t / L;
        x = P.lockX ? n.hx
          : mx ? mx + tri(n.hx + ph * cx * 2) * (1 - 2 * mx)
               : (((n.hx + ph * cx * sp) % sp) + sp) % sp - 0.15;
        y = my ? my + tri(n.hy + ph * cy * 2) * (1 - 2 * my)
               : (((n.hy + ph * cy * sp) % sp) + sp) % sp - 0.15;
      } else {
        x = P.lockX ? n.hx
          : mx ? mx + tri(n.hx + t * n.vx * k) * (1 - 2 * mx)
               : (((n.hx + t * n.vx * k) % sp) + sp) % sp - 0.15;
        y = my ? my + tri(n.hy + t * n.vy * k) * (1 - 2 * my)
               : (((n.hy + t * n.vy * k) % sp) + sp) % sp - 0.15;
      }
    } else {
      x = P.lockX ? n.hx
        : n.hx + (Math.sin(t * w1 + n.p1) + Math.sin(t * w2 + n.p2) * 0.6) * n.driftA * k;
      y = n.hy + Math.cos(t * w3 + n.p3) * n.driftA * k;
    }

    const pf = seamless ? qAng(n.pf, L) : n.pf;
    let r = n.r0 * (1 + P.pulse * ease(Math.sin(t * pf + n.pp)) * 0.55);
    let inten = n.i0 * (n.iScale || 1);
    if (n.lifeF > 0) {
      const lf = seamless ? qCyc(n.lifeF, L) : n.lifeF;
      const ph = (t * lf + n.lifeP) % 1;
      inten *= Math.pow(Math.sin(Math.PI * ph), 1.6);
    }
    if (mx || my) {
      // shrink and fade to nothing before an edge can slice the blob
      let e = 1;
      if (mx) e = Math.min(e, Math.min(x, 1 - x) / mx);
      if (my) e = Math.min(e, Math.min(y, 1 - y) / my);
      e = Math.max(0, Math.min(1, e));
      const g = e * e * (3 - 2 * e);
      inten *= g; r *= 0.35 + 0.65 * g;
    }

    n._sx = x; n._sy = y; n._sr = r; n._si = inten;
    const o = i * 4;
    out[o] = x * aspect; out[o + 1] = y;
    out[o + 2] = Math.max(r, 1e-4); out[o + 3] = inten;
  }
}

// Ring spin, snapped so the dash pattern returns to its start after one loop.
export function ringSpin(base, spinK, loop) {
  const L = (loop && loop.length) || 20;
  const w = base * spinK;
  if (!(loop && loop.seamless)) return w;
  const m = Math.max(1, Math.round((Math.abs(w) * L) / TAU)) * Math.sign(w || 1);
  return (TAU * m) / L;
}
