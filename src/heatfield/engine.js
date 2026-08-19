import { WGSL } from './wgsl.js';
import { RAMP } from './presets.js';
import { MAX_NODES, buildNodes, stepNodes } from './nodes.js';
import { buildAnnotations, toSVG, toCanvas } from './annotations.js';

const hex2rgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** One GPU device + pipelines, shared by every panel. */
export class Engine {
  static async create() {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const e = new Engine();
    e.device = await adapter.requestDevice();
    e.format = navigator.gpu.getPreferredCanvasFormat();
    e.bglA = e.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }] });
    e.bglB = e.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
    const mod = e.device.createShaderModule({ code: WGSL });
    const info = await mod.getCompilationInfo?.();
    info?.messages?.forEach((m) => m.type === 'error'
      && console.error(`WGSL ${m.lineNum}:${m.linePos} ${m.message}`));
    e.pipeField = e.device.createRenderPipeline({
      layout: e.device.createPipelineLayout({ bindGroupLayouts: [e.bglA] }),
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fsField', targets: [{ format: 'r16float' }] } });
    e.pipeColor = e.device.createRenderPipeline({
      layout: e.device.createPipelineLayout({ bindGroupLayouts: [e.bglA, e.bglB] }),
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fsColor', targets: [{ format: e.format }] } });
    e.sampler = e.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    return e;
  }
}

export class Panel {
  constructor(engine, canvas, svg, P, loop) {
    this.e = engine; this.canvas = canvas; this.svg = svg;
    this.loop = loop || { seamless: true, length: 20 };
    this.rscale = 1; this.fscale = 0.5; this.t = 0;
    this.data = new Float32Array(MAX_NODES * 4);
    const d = engine.device;
    this.ctx = canvas.getContext('webgpu');
    this.ctx.configure({ device: d, format: engine.format, alphaMode: 'opaque' });
    this.UF = new Float32Array(56); this.UU = new Uint32Array(this.UF.buffer);
    this.uBuf = d.createBuffer({ size: 224, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.nBuf = d.createBuffer({ size: MAX_NODES * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bgA = d.createBindGroup({ layout: engine.bglA, entries: [
      { binding: 0, resource: { buffer: this.uBuf } },
      { binding: 1, resource: { buffer: this.nBuf } }] });
    RAMP.forEach((h, i) => this.UF.set([...hex2rgb(h), 1], 24 + i * 4));
    this.UU[13] = RAMP.length;
    this.setPreset(P);
  }

  setPreset(P) {
    this.P = P;
    const { nodes, labelIdx } = buildNodes(P);
    this.nodes = nodes; this.labelIdx = labelIdx;
    this.UF.set([...hex2rgb(P.back), 1], 20);
  }

  /** Size the drawing buffer. `override` forces an exact pixel size for export. */
  resize(cssW, cssH, override) {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.rscale;
    const w = override ? override[0] : Math.max(2, Math.floor(this.cssW * dpr));
    const h = override ? override[1] : Math.max(2, Math.floor(this.cssH * dpr));
    // `this.tex` must be checked too: a second Panel over an already-sized
    // canvas (StrictMode remount) would otherwise skip makeField() entirely
    if (w === this.canvas.width && h === this.canvas.height && this.tex) return;
    this.canvas.width = w; this.canvas.height = h;
    this.makeField();
  }

  makeField() {
    const d = this.e.device;
    const fw = Math.max(2, Math.floor(this.canvas.width * this.fscale));
    const fh = Math.max(2, Math.floor(this.canvas.height * this.fscale));
    this.tex?.destroy?.();
    this.tex = d.createTexture({ size: [fw, fh], format: 'r16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.bgB = d.createBindGroup({ layout: this.e.bglB, entries: [
      { binding: 0, resource: this.e.sampler },
      { binding: 1, resource: this.tex.createView() }] });
  }

  annotations() {
    return buildAnnotations(this.nodes, this.labelIdx, this.P,
      this.cssW, this.cssH, this.t, this.loop);
  }

  render() {
    const d = this.e.device, P = this.P;
    const aspect = this.canvas.width / this.canvas.height;
    stepNodes(this.nodes, P, this.t, aspect, this.data, this.loop);
    d.queue.writeBuffer(this.nBuf, 0, this.data, 0, this.nodes.length * 4);

    const F = this.UF, U = this.UU;
    F[0] = this.canvas.width; F[1] = this.canvas.height;
    F[2] = Math.floor(this.canvas.width * this.fscale);
    F[3] = Math.floor(this.canvas.height * this.fscale);
    F[4] = this.t; F[5] = P.bands; F[6] = P.contour; F[7] = P.gain;
    F[8] = P.warp; F[9] = P.grain; F[10] = P.aniso; F[11] = P.falloff;
    U[12] = this.nodes.length;
    F[14] = P.warpFreq; F[15] = P.floorT;
    F[16] = P.curve;
    // loop phase: 0..2pi across one loop, drives warp + grain periodically
    F[17] = ((this.t / this.loop.length) % 1) * Math.PI * 2;
    F[18] = P.warpOrbit ?? 0.35;
    d.queue.writeBuffer(this.uBuf, 0, F);

    const enc = d.createCommandEncoder();
    let p = enc.beginRenderPass({ colorAttachments: [{ view: this.tex.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.e.pipeField); p.setBindGroup(0, this.bgA); p.draw(3); p.end();
    p = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.e.pipeColor); p.setBindGroup(0, this.bgA); p.setBindGroup(1, this.bgB);
    p.draw(3); p.end();
    d.queue.submit([enc.finish()]);

    if (this.svg) this.svg.innerHTML = toSVG(this.annotations());
  }

  /** Composite GPU output + annotations into a 2D canvas for frame capture. */
  async captureInto(ctx2d, w, h) {
    this.render();
    await this.e.device.queue.onSubmittedWorkDone();
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.drawImage(this.canvas, 0, 0, w, h);
    toCanvas(ctx2d, this.annotations(), w / this.cssW);
  }
}
