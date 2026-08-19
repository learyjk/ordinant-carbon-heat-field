
// Two ways to guarantee a loop:
//
//  seamless  — every animated frequency is snapped to a whole number of cycles
//              per loop (see nodes.js / wgsl.js), so frame N is bit-for-bit the
//              state of frame 0. We record exactly one period, once. No
//              reversal, so the motion keeps its natural direction.
//
//  pingpong  — record one pass, then append it reversed with both endpoints
//              dropped. Works with un-quantised motion, but the playback
//              visibly runs backwards for half the clip.
//
// Frame timestamps are authored, not sampled from a clock, so the output is
// deterministic and independent of render speed.

export const EXPORT_MODES = ['seamless', 'pingpong'];

export function exportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);   // H.264 needs even dims

export async function recordLoop(panel, opts = {}) {
  const {
    mode = 'seamless', fps = 30, seconds = panel.loop.length,
    width = 1280, height = 720, container = 'mp4',
    quality = 'high', onProgress = () => {},
  } = opts;

  if (!exportSupported()) throw new Error('WebCodecs unavailable in this browser');

  // mediabunny is ~450 kB and only needed once someone actually exports, so it
  // stays out of the initial bundle
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, Quality } =
    await import('mediabunny');

  const W = even(width), H = even(height);
  // A seamless clip must be exactly ONE loop period. Any other duration is a
  // fraction of a cycle and will jump on repeat, so the panel's loop length
  // wins over whatever was requested. Ping-pong has no such constraint.
  const secs = mode === 'seamless' ? panel.loop.length : seconds;
  if (mode === 'seamless' && Math.abs(secs - seconds) > 1e-6) {
    console.warn(`[heatfield] seamless export: duration forced to the loop length (${secs}s), requested ${seconds}s`);
  }
  const forward = Math.max(2, Math.round(fps * secs));

  // capture target: GPU output + annotations composited in 2D
  const cap = document.createElement('canvas');
  cap.width = W; cap.height = H;
  const ctx = cap.getContext('2d', { alpha: false, willReadFrequently: false });

  // render at the export resolution for the duration of the capture
  const prev = { w: panel.canvas.width, h: panel.canvas.height, t: panel.t,
                 cssW: panel.cssW, cssH: panel.cssH };
  panel.resize(W, H, [W, H]);

  const output = new Output({
    format: container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const src = new CanvasSource(cap, {
    codec: container === 'webm' ? 'vp9' : 'avc',
    bitrate: new Quality(quality),
  });
  output.addVideoTrack(src);
  await output.start();

  const dt = 1 / fps;
  // seamless: t in [0, L). pingpong: forward pass then reversed interior.
  const order = [];
  for (let i = 0; i < forward; i++) order.push(i);
  if (mode === 'pingpong') for (let i = forward - 2; i >= 1; i--) order.push(i);

  try {
    for (let f = 0; f < order.length; f++) {
      panel.t = (order[f] * secs) / forward;
      await panel.captureInto(ctx, W, H);
      await src.add(f * dt, dt, { keyFrame: f % (fps * 2) === 0 });
      if (f % 5 === 0 || f === order.length - 1) onProgress((f + 1) / order.length);
    }
    src.close();
    await output.finalize();
  } finally {
    panel.t = prev.t;
    panel.canvas.width = prev.w; panel.canvas.height = prev.h;
    panel.cssW = prev.cssW; panel.cssH = prev.cssH;
    panel.makeField();
  }

  const type = container === 'webm' ? 'video/webm' : 'video/mp4';
  return {
    blob: new Blob([output.target.buffer], { type }),
    frames: order.length,
    duration: order.length * dt,
    loopSeconds: secs,
    mode,
    width: W, height: H,
  };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
