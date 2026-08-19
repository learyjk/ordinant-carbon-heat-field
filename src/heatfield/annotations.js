// Annotations are built once as a plain display list, then rendered either to
// SVG (live DOM) or to Canvas2D (video export). Two renderers over one list
// keeps the exported frames identical to what is on screen.

import { ringSpin } from './nodes.js';

export function buildAnnotations(nodes, labelIdx, P, W, H, t, loop) {
  if (!labelIdx.length) return { rings: [], lines: [], marks: [] };

  // labels are ~130px of monospace each; thin them with the panel width
  const room = W < 420 ? 2 : W < 620 ? 3 : labelIdx.length;
  const pts = labelIdx.slice(0, room).map((i, k) => {
    const n = nodes[i], x = n._sx * W, y = n._sy * H;
    // ring breathes with the node's live pulsing radius
    let r = n._sr * H * (P.ringWide || 1.45);
    // Framed panels may let the ring run off and be cropped — that reads as a
    // cut-off technical diagram. Frameless panels must stay inside, or a
    // clipped ring just looks broken.
    if (P.ringClamp) r = Math.min(r, Math.min(x, W - x, y, H - y) - 6);
    r = Math.max(r, 10);
    const spinK = (k % 2 ? -1 : 1) * (0.6 + ((n.pp / 6.2832) % 1) * 0.8);
    return { x, y, r, k, spinK };
  });

  const rings = [], lines = [], marks = [];
  const nLines = P.connect === true ? 1 : (P.connect | 0);
  const PAIRSETS = [[], [[2, 3]], [[0, 2], [3, 4]], [[0, 2], [3, 4], [1, 3]]];
  for (const [ia, ib] of PAIRSETS[Math.min(nLines, 3)] || []) {
    const a = pts[ia], b = pts[ib];
    if (a && b) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  for (const p of pts) {
    if (P.ring !== false) {
      // Dash period scales with the radius so the dash COUNT stays constant.
      // With a fixed dasharray, dashes pop in and out at the path start
      // (angle 0) every time the ring breathes.
      const per = (2 * Math.PI * p.r) / (P.dashes || 46);
      const on = per * (P.dash ? 0.26 : 0.45);
      // offset is r*omega*t, not omega*t: dashoffset is in path-length units,
      // so the r factor is what holds the ANGULAR rate steady while it breathes
      const off = -p.r * ringSpin(P.spin ?? 0.075, p.spinK, loop) * t;
      rings.push({ x: p.x, y: p.y, r: p.r, on, off: per - on, dashOffset: off,
                   color: P.dash || '#1a1917' });
    }
    marks.push({ x: p.x, y: p.y, label: `Asset ${1120 + p.k * 37}.${(34 + p.k * 11) % 100}` });
  }
  return { rings, lines, marks };
}

export function toSVG({ rings, lines, marks }) {
  let s = '';
  for (const l of lines) {
    s += `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="#1a1917" stroke-width="1" opacity=".62"/>`
       + `<circle cx="${l.x1.toFixed(1)}" cy="${l.y1.toFixed(1)}" r="2.2" fill="#1a1917"/>`
       + `<circle cx="${l.x2.toFixed(1)}" cy="${l.y2.toFixed(1)}" r="2.2" fill="#1a1917"/>`;
  }
  for (const r of rings) {
    s += `<circle cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${r.r.toFixed(1)}" fill="none" stroke="${r.color}" stroke-width="1" stroke-dasharray="${r.on.toFixed(2)} ${r.off.toFixed(2)}" stroke-dashoffset="${r.dashOffset.toFixed(2)}" opacity=".72"/>`;
  }
  for (const m of marks) {
    s += `<polygon points="${(m.x - 5).toFixed(1)},${(m.y + 4).toFixed(1)} ${(m.x + 5).toFixed(1)},${(m.y + 4).toFixed(1)} ${m.x.toFixed(1)},${(m.y - 5).toFixed(1)}" fill="#1a1917"/>`
       + `<text x="${(m.x + 11).toFixed(1)}" y="${(m.y + 4).toFixed(1)}">${m.label}</text>`;
  }
  return s;
}

export function toCanvas(ctx, { rings, lines, marks }, dpr = 1) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1a1917';
  ctx.fillStyle = '#1a1917';

  ctx.globalAlpha = 0.62;
  for (const l of lines) {
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const l of lines) {
    for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.2832); ctx.fill();
    }
  }

  ctx.globalAlpha = 0.72;
  for (const r of rings) {
    ctx.strokeStyle = r.color;
    ctx.setLineDash([r.on, r.off]);
    ctx.lineDashOffset = r.dashOffset;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.2832); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1a1917';

  ctx.font = '300 10px "Spline Sans Mono", ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  for (const m of marks) {
    ctx.beginPath();
    ctx.moveTo(m.x - 5, m.y + 4); ctx.lineTo(m.x + 5, m.y + 4); ctx.lineTo(m.x, m.y - 5);
    ctx.closePath(); ctx.fill();
    ctx.fillText(m.label.toUpperCase(), m.x + 11, m.y + 4);
  }
  ctx.restore();
}
