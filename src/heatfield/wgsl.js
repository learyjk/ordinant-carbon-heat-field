// Two-pass heat field.
//   pass 1  accumulates a scalar field (sum of Gaussian kernels, one per node)
//           into a low-res r16float target — the field is smooth and
//           low-frequency, so this costs a fraction of full resolution.
//   pass 2  samples it, quantises to contour bands with derivative AA, and
//           maps the result through a colour ramp.
//
// Loop safety: the domain warp and the grain are driven by `loopPhase`
// (0..2pi over one loop) rather than raw time, so both are exactly periodic.
// A time-scrolling warp can never loop.

export const WGSL = /* wgsl */ `
struct U {
  res      : vec2f,
  fieldRes : vec2f,
  time     : f32,
  bands    : f32,
  contour  : f32,
  gain     : f32,
  warp     : f32,
  grain    : f32,
  aniso    : f32,
  falloff  : f32,
  nodeCount: u32,
  stopCount: u32,
  warpFreq : f32,
  floorT   : f32,
  extra    : vec4f,   // x = ramp curve, y = loopPhase (rad), z = warp orbit
  colorBack: vec4f,
  colors   : array<vec4f, 8>,
};
struct Node { pos: vec2f, radius: f32, intensity: f32 };

@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var<storage, read> nodes : array<Node>;
@group(1) @binding(0) var samp     : sampler;
@group(1) @binding(1) var fieldTex : texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  var p = array<vec2f,3>(vec2f(-1.,-1.), vec2f(3.,-1.), vec2f(-1.,3.));
  return vec4f(p[i], 0., 1.);
}

fn hash21(p : vec2f) -> f32 {
  var q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p : vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let w = f * f * (3. - 2. * f);
  return mix(mix(hash21(i),                hash21(i + vec2f(1.,0.)), w.x),
             mix(hash21(i + vec2f(0.,1.)), hash21(i + vec2f(1.,1.)), w.x), w.y);
}
fn fbm(p : vec2f) -> f32 {
  var v = 0.; var a = .5; var q = p;
  for (var i = 0; i < 4; i++) { v += a * vnoise(q); q *= 2.02; a *= .5; }
  return v;
}

@fragment fn fsField(@builtin(position) fc : vec4f) -> @location(0) vec4f {
  let uv     = fc.xy / u.fieldRes;
  let aspect = u.res.x / max(u.res.y, 1.);
  var p      = vec2f(uv.x * aspect, uv.y);

  if (u.warp > 0.) {
    // orbit the sample point through noise space instead of scrolling it, so
    // the warp returns exactly to its start after one loop
    let ph = u.extra.y;
    let c  = vec2f(cos(ph), sin(ph)) * u.extra.z;
    let wx = fbm(p * u.warpFreq + c);
    let wy = fbm(p * u.warpFreq + vec2f(5.2, 1.3) + c);
    p += (vec2f(wx, wy) - .5) * u.warp;
  }

  var s = 0.;
  for (var i = 0u; i < u.nodeCount; i++) {
    let n = nodes[i];
    var d = p - n.pos;
    d.y /= max(u.aniso, .01);
    let q = dot(d, d) / (n.radius * n.radius);
    if (q < 9.) { s += n.intensity * exp(-q * u.falloff); }
  }
  return vec4f(s, 0., 0., 1.);
}

fn ramp(t : f32) -> vec3f {
  let last = u.stopCount - 1u;
  let x = clamp(t, 0., 1.) * f32(last);
  let i = min(u32(floor(x)), last);
  let j = min(i + 1u, last);
  return mix(u.colors[i].rgb, u.colors[j].rgb, x - floor(x));
}

@fragment fn fsColor(@builtin(position) fc : vec4f) -> @location(0) vec4f {
  let uv = fc.xy / u.res;
  let v  = textureSample(fieldTex, samp, uv).r * u.gain;
  // gamma < 1 hands more of the ramp (and more band area) to the cool low end
  let t  = pow(clamp(v, 0., 1.), max(u.extra.x, .05));

  // Quantise to contour bands, anti-aliased with screen-space derivatives.
  // WGSL has no fwidth(); without this term the bands crawl and moire.
  let bf = t * u.bands;
  let bi = floor(bf);
  let fr = bf - bi;
  let w  = clamp((abs(dpdx(bf)) + abs(dpdy(bf))) * .5, 1e-4, .5);
  let stepped = (bi + smoothstep(.5 - w, .5 + w, fr)) / u.bands;

  var col = ramp(mix(t, stepped, u.contour));
  col = mix(u.colorBack.rgb, col, smoothstep(0., u.floorT, v));
  // dither to break up 8-bit banding (distinct from the contour banding above)
  let gp = vec2f(cos(u.extra.y), sin(u.extra.y)) * 41.;
  col += vec3f((hash21(fc.xy + gp) - .5) * u.grain);
  return vec4f(col, 1.);
}`;
