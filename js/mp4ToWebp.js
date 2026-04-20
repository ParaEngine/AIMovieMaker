// ============ MP4 → WebP / Frame Sequence Converter ============
// Allows selecting a short's MP4 clip and converting it to:
// 1) Animated transparent WebP (with background removal pipeline)
// 2) Frame sequence (PNG/JPG) at a given FPS
//
// Modeled after convertMp4ToWebp.html but integrated into AIMovieMaker.

import { escapeHtml, $ } from './utils.js';

// ==================== libwebp WASM Encoder ====================
const JSQUASH_CDN = 'https://cdn.keepwork.com/sdk/libs/libwebp';
const defaultWebpOptions = {
    quality: 75, target_size: 0, target_PSNR: 0, method: 4,
    sns_strength: 50, filter_strength: 60, filter_sharpness: 0, filter_type: 1,
    partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0,
    autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1,
    alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0, emulate_jpeg_size: 0,
    thread_level: 0, low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0,
};

let wasmEncoder = null;
const wasmEncoderReady = (async () => {
    try {
        try {
            const mod = await import(`${JSQUASH_CDN}/webp_enc_simd.js`);
            wasmEncoder = await mod.default({ locateFile: (f) => `${JSQUASH_CDN}/${f}` });
            return true;
        } catch (_) {
            const mod = await import(`${JSQUASH_CDN}/webp_enc.js`);
            wasmEncoder = await mod.default({ locateFile: (f) => `${JSQUASH_CDN}/${f}` });
            return true;
        }
    } catch (err) {
        console.warn('⚠️ WASM encoder unavailable:', err);
        return false;
    }
})();

async function wasmEncodeFrame(imageData, quality, method) {
    const opts = { ...defaultWebpOptions, quality, method, alpha_quality: Math.min(100, quality + 20) };
    const result = wasmEncoder.encode(imageData.data, imageData.width, imageData.height, opts);
    if (!result) throw new Error('WebP WASM encode failed');
    return new Uint8Array(result).buffer;
}

// ==================== MediaPipe Segmenter ====================
let _imageSegmenter = null;
let _segmenterPromise = null;
let segTimestamp = 0;

async function getImageSegmenter() {
    if (_imageSegmenter) return _imageSegmenter;
    if (_segmenterPromise) return _segmenterPromise;
    _segmenterPromise = (async () => {
        try {
            if (!window.FilesetResolver) {
                const vision = await import('https://cdn.keepwork.com/helloworld/mediapipe/vision_bundle.mjs');
                window.FilesetResolver = vision.FilesetResolver;
                window.ImageSegmenter = vision.ImageSegmenter;
            }
            const fileset = await window.FilesetResolver.forVisionTasks('https://cdn.keepwork.com/helloworld/mediapipe/wasm');
            _imageSegmenter = await window.ImageSegmenter.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: 'https://cdn.keepwork.com/helloworld/mediapipe/selfie_segmenter.tflite', delegate: 'GPU' },
                runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true
            });
            return _imageSegmenter;
        } catch (err) {
            console.error('Segmenter init failed:', err);
            _segmenterPromise = null;
            return null;
        }
    })();
    return _segmenterPromise;
}

// ==================== ONNX Runtime ====================
const ORT_CDN_BASE = 'https://cdn.keepwork.com/keepwork/cdn/models/models/ort/';
const CDN_MODEL_BASE = 'https://cdn.keepwork.com/keepwork/cdn/models/models/';
let _ortReady = false, _ortLoadPromise = null, _ortProvider = 'wasm';

async function ensureORT() {
    if (_ortReady && window.ort) return true;
    if (_ortLoadPromise) return _ortLoadPromise;
    _ortLoadPromise = (async () => {
        try {
            const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
            if (!window.ort) {
                await loadScript(ORT_CDN_BASE + (hasWebGPU ? 'ort.all.min.js' : 'ort.min.js'));
            }
            ort.env.wasm.wasmPaths = ORT_CDN_BASE;
            const canThread = typeof SharedArrayBuffer !== 'undefined';
            ort.env.wasm.numThreads = canThread ? navigator.hardwareConcurrency || 4 : 1;
            if (hasWebGPU) {
                try { const a = await navigator.gpu.requestAdapter(); if (a) _ortProvider = 'webgpu'; } catch (_) {}
            }
            _ortReady = true;
            return true;
        } catch (err) { console.error('ORT load failed:', err); _ortLoadPromise = null; return false; }
    })();
    return _ortLoadPromise;
}

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script'); s.src = url; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

function getExecProviders() { return _ortProvider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']; }

// MODNet
let _modnetSession = null, _modnetVariant = null, _modnetPromise = null;
async function getModnetSession(variant = 'model.onnx') {
    if (_modnetSession && _modnetVariant === variant) return _modnetSession;
    if (_modnetPromise) return _modnetPromise;
    _modnetPromise = (async () => {
        try {
            await ensureORT();
            _modnetSession = await ort.InferenceSession.create(CDN_MODEL_BASE + 'modnet/' + variant, { executionProviders: getExecProviders() });
            _modnetVariant = variant;
            return _modnetSession;
        } catch (err) { console.error('MODNet load failed:', err); _modnetPromise = null; return null; }
    })();
    return _modnetPromise;
}

// RMBG
let _rmbgSession = null, _rmbgVariant = null, _rmbgPromise = null;
async function getRmbgSession(variant = 'model_quantized.onnx') {
    if (_rmbgSession && _rmbgVariant === variant) return _rmbgSession;
    if (_rmbgPromise) return _rmbgPromise;
    _rmbgPromise = (async () => {
        try {
            await ensureORT();
            _rmbgSession = await ort.InferenceSession.create(CDN_MODEL_BASE + 'rmbg/' + variant, { executionProviders: getExecProviders() });
            _rmbgVariant = variant;
            return _rmbgSession;
        } catch (err) { console.error('RMBG load failed:', err); _rmbgPromise = null; return null; }
    })();
    return _rmbgPromise;
}

async function runModnet(srcCanvas, outW, outH) {
    const sess = await getModnetSession();
    if (!sess) return null;
    const sz = 256;
    const tmp = document.createElement('canvas'); tmp.width = sz; tmp.height = sz;
    tmp.getContext('2d').drawImage(srcCanvas, 0, 0, sz, sz);
    const imgData = tmp.getContext('2d').getImageData(0, 0, sz, sz);
    const f32 = new Float32Array(3 * sz * sz);
    for (let i = 0; i < sz * sz; i++) {
        f32[i] = (imgData.data[i * 4] / 255 - 0.5) / 0.5;
        f32[sz * sz + i] = (imgData.data[i * 4 + 1] / 255 - 0.5) / 0.5;
        f32[2 * sz * sz + i] = (imgData.data[i * 4 + 2] / 255 - 0.5) / 0.5;
    }
    const results = await sess.run({ input: new ort.Tensor('float32', f32, [1, 3, sz, sz]) });
    const out = results.output.data;
    const mc = document.createElement('canvas'); mc.width = sz; mc.height = sz;
    const mCtx = mc.getContext('2d'); const mImg = mCtx.createImageData(sz, sz);
    for (let i = 0; i < sz * sz; i++) { const v = Math.round(Math.max(0, Math.min(1, out[i])) * 255); mImg.data[i * 4] = mImg.data[i * 4 + 1] = mImg.data[i * 4 + 2] = v; mImg.data[i * 4 + 3] = 255; }
    mCtx.putImageData(mImg, 0, 0);
    const oc = document.createElement('canvas'); oc.width = outW; oc.height = outH;
    oc.getContext('2d').drawImage(mc, 0, 0, outW, outH);
    const fd = oc.getContext('2d').getImageData(0, 0, outW, outH);
    const alpha = new Float32Array(outW * outH);
    for (let i = 0; i < outW * outH; i++) alpha[i] = fd.data[i * 4] / 255;
    return alpha;
}

async function runRmbg(srcCanvas, outW, outH) {
    const sess = await getRmbgSession();
    if (!sess) return null;
    const sz = 1024;
    const tmp = document.createElement('canvas'); tmp.width = sz; tmp.height = sz;
    tmp.getContext('2d').drawImage(srcCanvas, 0, 0, sz, sz);
    const imgData = tmp.getContext('2d').getImageData(0, 0, sz, sz);
    const f32 = new Float32Array(3 * sz * sz);
    for (let i = 0; i < sz * sz; i++) {
        f32[i] = imgData.data[i * 4] / 255 - 0.5;
        f32[sz * sz + i] = imgData.data[i * 4 + 1] / 255 - 0.5;
        f32[2 * sz * sz + i] = imgData.data[i * 4 + 2] / 255 - 0.5;
    }
    const results = await sess.run({ input: new ort.Tensor('float32', f32, [1, 3, sz, sz]) });
    const outKey = Object.keys(results)[0];
    const od = results[outKey].data;
    let mi = Infinity, ma = -Infinity;
    for (let i = 0; i < od.length; i++) { if (od[i] < mi) mi = od[i]; if (od[i] > ma) ma = od[i]; }
    const range = ma - mi || 1;
    const mc = document.createElement('canvas'); mc.width = sz; mc.height = sz;
    const mCtx = mc.getContext('2d'); const mImg = mCtx.createImageData(sz, sz);
    for (let i = 0; i < sz * sz; i++) { const v = Math.round(((od[i] - mi) / range) * 255); mImg.data[i * 4] = mImg.data[i * 4 + 1] = mImg.data[i * 4 + 2] = v; mImg.data[i * 4 + 3] = 255; }
    mCtx.putImageData(mImg, 0, 0);
    const oc = document.createElement('canvas'); oc.width = outW; oc.height = outH;
    oc.getContext('2d').drawImage(mc, 0, 0, outW, outH);
    const fd = oc.getContext('2d').getImageData(0, 0, outW, outH);
    const alpha = new Float32Array(outW * outH);
    for (let i = 0; i < outW * outH; i++) alpha[i] = fd.data[i * 4] / 255;
    return alpha;
}

async function runSegmentation(model, srcCanvas, outW, outH) {
    if (model === 'modnet') return await runModnet(srcCanvas, outW, outH);
    if (model === 'rmbg') return await runRmbg(srcCanvas, outW, outH);
    if (!_imageSegmenter) return null;
    segTimestamp += 16;
    const result = _imageSegmenter.segmentForVideo(srcCanvas, segTimestamp);
    if (result?.confidenceMasks?.length > 0) {
        const mask = result.confidenceMasks[0];
        const data = mask.getAsFloat32Array();
        mask.close();
        return data;
    }
    return null;
}

function applyStrengthToAlpha(maskData, pixels, strength) {
    const str = strength / 100;
    for (let j = 0; j < maskData.length; j++) {
        let conf = maskData[j];
        if (str <= 0) conf = 1;
        else if (str < 0.5) { const floor = 1 - str * 2; conf = floor + conf * (1 - floor); }
        else { const threshold = (str - 0.5) * 2 * 0.9; conf = conf < threshold ? 0 : (conf - threshold) / (1 - threshold); }
        pixels[j * 4 + 3] = Math.round(Math.min(1, Math.max(0, conf)) * 255);
    }
}

// ==================== Animated WebP Encoder ====================
function extractFramePayload(buf) {
    const view = new DataView(buf);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') throw new Error('Not a valid WebP frame');
    let off = 12;
    const validChunks = [];
    while (off + 8 <= buf.byteLength) {
        const tag = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
        const chunkLen = view.getUint32(off + 4, true);
        const paddedLen = chunkLen + (chunkLen % 2);
        if (['VP8 ', 'VP8L', 'ALPH'].includes(tag)) {
            validChunks.push(new Uint8Array(buf, off, 8 + paddedLen));
        }
        off += 8 + paddedLen;
    }
    const totalLen = validChunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of validChunks) { result.set(chunk, pos); pos += chunk.length; }
    return result;
}

function findChangedRect(prevData, currData, width, height) {
    const prev = prevData.data, curr = currData.data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (prev[i] !== curr[i] || prev[i + 1] !== curr[i + 1] || prev[i + 2] !== curr[i + 2] || prev[i + 3] !== curr[i + 3]) {
                if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    minX = Math.floor(minX / 2) * 2; minY = Math.floor(minY / 2) * 2;
    maxX = Math.min(width - 1, Math.ceil((maxX + 1) / 2) * 2 - 1);
    maxY = Math.min(height - 1, Math.ceil((maxY + 1) / 2) * 2 - 1);
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function extractSubRect(imageData, fullWidth, rect) {
    const data = new Uint8ClampedArray(rect.w * rect.h * 4);
    const src = imageData.data;
    for (let y = 0; y < rect.h; y++) {
        const srcOff = ((rect.y + y) * fullWidth + rect.x) * 4;
        data.set(src.subarray(srcOff, srcOff + rect.w * 4), y * rect.w * 4);
    }
    return new ImageData(data, rect.w, rect.h);
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

async function encodeAnimatedWebP(frames, frameDurationMs, quality, method, onProgress) {
    const canvasWidth = frames[0].width, canvasHeight = frames[0].height;
    const useWasm = await wasmEncoderReady;
    const frameDescriptors = [];
    let prevImageData = null;

    for (let i = 0; i < frames.length; i++) {
        const canvas = frames[i];
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let offsetX = 0, offsetY = 0, frameW = canvas.width, frameH = canvas.height;
        let encodeData = imageData;
        if (prevImageData && i > 0) {
            const rect = findChangedRect(prevImageData, imageData, canvas.width, canvas.height);
            if (rect && rect.w * rect.h < frameW * frameH * 0.95) {
                offsetX = rect.x; offsetY = rect.y; frameW = rect.w; frameH = rect.h;
                encodeData = extractSubRect(imageData, canvas.width, rect);
            }
        }
        let frameBuffer;
        if (useWasm) {
            frameBuffer = await wasmEncodeFrame(encodeData, quality, method);
        } else {
            const tc = document.createElement('canvas'); tc.width = frameW; tc.height = frameH;
            tc.getContext('2d').putImageData(encodeData, 0, 0);
            const blob = await new Promise((res, rej) => tc.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/webp', quality / 100));
            frameBuffer = await blob.arrayBuffer();
        }
        frameDescriptors.push({ payload: extractFramePayload(frameBuffer), offsetX, offsetY, width: frameW, height: frameH, duration: frameDurationMs });
        prevImageData = imageData;
        onProgress?.('encode', i + 1, frames.length);
    }
    return assembleAnimatedWebP(frameDescriptors, canvasWidth, canvasHeight);
}

function assembleAnimatedWebP(frameDescriptors, canvasWidth, canvasHeight) {
    const ANMF_HEADER_DATA = 16;
    let totalAnmfSize = 0;
    for (const fd of frameDescriptors) {
        const paySize = ANMF_HEADER_DATA + fd.payload.length;
        totalAnmfSize += 8 + paySize + (paySize % 2);
    }
    const vp8xChunkTotal = 18, animChunkTotal = 14;
    const filePayloadSize = 4 + vp8xChunkTotal + animChunkTotal + totalAnmfSize;
    const buffer = new ArrayBuffer(8 + filePayloadSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, filePayloadSize, true); offset += 4;
    writeString(view, offset, 'WEBP'); offset += 4;
    writeString(view, offset, 'VP8X'); offset += 4;
    view.setUint32(offset, 10, true); offset += 4;
    view.setUint8(offset, 0x02 | 0x10); offset += 4;
    const cw = canvasWidth - 1;
    view.setUint8(offset, cw & 0xFF); view.setUint8(offset + 1, (cw >> 8) & 0xFF); view.setUint8(offset + 2, (cw >> 16) & 0xFF); offset += 3;
    const ch = canvasHeight - 1;
    view.setUint8(offset, ch & 0xFF); view.setUint8(offset + 1, (ch >> 8) & 0xFF); view.setUint8(offset + 2, (ch >> 16) & 0xFF); offset += 3;
    writeString(view, offset, 'ANIM'); offset += 4;
    view.setUint32(offset, 6, true); offset += 4;
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint16(offset, 0, true); offset += 2;
    for (const fd of frameDescriptors) {
        writeString(view, offset, 'ANMF'); offset += 4;
        const paySize = ANMF_HEADER_DATA + fd.payload.length;
        view.setUint32(offset, paySize, true); offset += 4;
        view.setUint8(offset, (fd.offsetX / 2) & 0xFF); view.setUint8(offset + 1, ((fd.offsetX / 2) >> 8) & 0xFF); view.setUint8(offset + 2, ((fd.offsetX / 2) >> 16) & 0xFF); offset += 3;
        view.setUint8(offset, (fd.offsetY / 2) & 0xFF); view.setUint8(offset + 1, ((fd.offsetY / 2) >> 8) & 0xFF); view.setUint8(offset + 2, ((fd.offsetY / 2) >> 16) & 0xFF); offset += 3;
        const fw = fd.width - 1;
        view.setUint8(offset, fw & 0xFF); view.setUint8(offset + 1, (fw >> 8) & 0xFF); view.setUint8(offset + 2, (fw >> 16) & 0xFF); offset += 3;
        const fh = fd.height - 1;
        view.setUint8(offset, fh & 0xFF); view.setUint8(offset + 1, (fh >> 8) & 0xFF); view.setUint8(offset + 2, (fh >> 16) & 0xFF); offset += 3;
        view.setUint8(offset, fd.duration & 0xFF); view.setUint8(offset + 1, (fd.duration >> 8) & 0xFF); view.setUint8(offset + 2, (fd.duration >> 16) & 0xFF); offset += 3;
        view.setUint8(offset, 0x02); offset += 1;
        bytes.set(fd.payload, offset); offset += fd.payload.length;
        if (paySize % 2) { view.setUint8(offset, 0); offset += 1; }
    }
    return new Blob([buffer], { type: 'image/webp' });
}

// ==================== Mp4ToWebp Class ====================
export default class Mp4ToWebp {
    constructor({ container, shorts }) {
        this.container = container;
        this.shorts = shorts.filter(s => s.videoUrl && s.status === 'succeeded');
        this.selectedShort = null;
        this.video = null;
        this.segCanvas = null;
        this.cancelled = false;
        this.processing = false;
        this._destroyed = false;

        // Settings
        this.fps = 10;
        this.quality = 60;
        this.method = 6;
        this.scale = 1;
        this.bgRemovalStrength = 50;
        this.nnModel = 'mediapipe';
        this.enableBgRemoval = false;
        this.exportMode = 'webp'; // 'webp' | 'frames'
        this.frameFormat = 'png'; // 'png' | 'jpg'

        this._build();
    }

    destroy() {
        this._destroyed = true;
        this.cancelled = true;
        if (this.video) { this.video.pause(); this.video.src = ''; }
        this.container.innerHTML = '';
    }

    // ---- UI Build ----
    _build() {
        const shortOptions = this.shorts.map((s, i) =>
            `<option value="${i}">#${s.order} — ${escapeHtml((s.prompt || s.description || '').slice(0, 60))}</option>`
        ).join('');

        this.container.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;gap:12px">
            <!-- Top: clip selector -->
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                <label style="font-size:13px;color:var(--text-secondary);white-space:nowrap">选择片段:</label>
                <select id="m2wClipSelect" class="clipeditor-select" style="flex:1;min-width:0">
                    <option value="" disabled selected>— 请选择一个已生成的短片 —</option>
                    ${shortOptions}
                </select>
            </div>

            <!-- Main area: flex row -->
            <div style="display:flex;gap:14px;flex:1;min-height:0;overflow:hidden">

                <!-- Left: settings panel -->
                <div id="m2wSettings" style="width:280px;flex-shrink:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-right:6px">

                    <!-- Export Mode -->
                    <div class="card-flat" style="padding:12px">
                        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px">📦 导出模式</div>
                        <div style="display:flex;gap:6px">
                            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);cursor:pointer">
                                <input type="radio" name="m2wExportMode" value="webp" checked> 动画 WebP
                            </label>
                            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);cursor:pointer">
                                <input type="radio" name="m2wExportMode" value="frames"> 帧序列
                            </label>
                        </div>
                        <div id="m2wFrameOpts" style="margin-top:8px;display:none">
                            <label style="font-size:11px;color:var(--text-muted)">格式:</label>
                            <select id="m2wFrameFormat" class="clipeditor-select" style="margin-left:4px">
                                <option value="png">PNG (透明)</option>
                                <option value="jpg">JPG (无透明)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Sampling -->
                    <div class="card-flat" style="padding:12px">
                        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px">📹 采样</div>
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                            <span>帧率 (FPS)</span><span id="m2wFpsVal">10</span>
                        </div>
                        <input id="m2wFps" type="range" min="2" max="30" value="10" style="width:100%">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px">
                            <span>缩放</span><span id="m2wScaleVal">100%</span>
                        </div>
                        <div style="display:flex;gap:4px;margin-top:2px">
                            <button class="btn-secondary m2w-scale-btn" data-scale="0.25" style="padding:3px 8px;font-size:11px">25%</button>
                            <button class="btn-secondary m2w-scale-btn" data-scale="0.5" style="padding:3px 8px;font-size:11px">50%</button>
                            <button class="btn-secondary m2w-scale-btn active" data-scale="1" style="padding:3px 8px;font-size:11px;border-color:var(--accent)">100%</button>
                        </div>
                    </div>

                    <!-- BG Removal -->
                    <div class="card-flat" style="padding:12px">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                            <span style="font-size:12px;font-weight:600;color:var(--text-primary)">🧠 AI 去背景</span>
                            <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);cursor:pointer">
                                <input id="m2wBgToggle" type="checkbox"> 启用
                            </label>
                        </div>
                        <div id="m2wBgSettings" style="opacity:0.4;pointer-events:none">
                            <label style="font-size:11px;color:var(--text-muted)">模型:</label>
                            <select id="m2wNnModel" class="clipeditor-select" style="width:100%;margin-top:2px">
                                <option value="mediapipe">MediaPipe (快速)</option>
                                <option value="modnet">MODNet (平衡)</option>
                                <option value="rmbg">RMBG-1.4 (最佳)</option>
                            </select>
                            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px">
                                <span>去背景强度</span><span id="m2wBgStrVal">50%</span>
                            </div>
                            <input id="m2wBgStr" type="range" min="0" max="100" value="50" style="width:100%">
                        </div>
                    </div>

                    <!-- Quality (WebP mode) -->
                    <div id="m2wQualitySection" class="card-flat" style="padding:12px">
                        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px">🎨 WebP 质量</div>
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                            <span>质量</span><span id="m2wQualVal">60%</span>
                        </div>
                        <input id="m2wQual" type="range" min="10" max="100" value="60" style="width:100%">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-top:6px">
                            <span>压缩强度</span><span id="m2wMethodVal">6 (最佳)</span>
                        </div>
                        <input id="m2wMethod" type="range" min="0" max="6" value="6" style="width:100%">
                    </div>

                    <!-- Convert button -->
                    <button id="m2wConvertBtn" class="btn-primary" style="width:100%;justify-content:center" disabled>
                        🚀 开始转换
                    </button>
                    <button id="m2wCancelBtn" class="btn-danger" style="width:100%;text-align:center;display:none">
                        取消
                    </button>
                    <!-- Progress -->
                    <div id="m2wProgress" style="display:none">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">
                            <span id="m2wProgressLabel">准备中…</span>
                            <span id="m2wProgressPct">0%</span>
                        </div>
                        <div style="height:4px;background:var(--bg-pill);border-radius:2px;overflow:hidden;margin-top:4px">
                            <div id="m2wProgressBar" style="height:100%;width:0%;background:var(--accent);border-radius:2px;transition:width 0.15s"></div>
                        </div>
                    </div>
                </div>

                <!-- Right: preview -->
                <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
                    <!-- Video preview -->
                    <div id="m2wVideoWrap" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#000;border-radius:10px;overflow:hidden;position:relative">
                        <div id="m2wPlaceholder" style="color:var(--text-faint);font-size:14px">选择一个片段开始</div>
                        <video id="m2wVideo" style="max-width:100%;max-height:100%;display:none;border-radius:10px" muted></video>
                        <canvas id="m2wPreviewCanvas" style="max-width:100%;max-height:100%;display:none;border-radius:10px"></canvas>
                    </div>
                    <!-- Video controls -->
                    <div id="m2wVideoControls" style="display:none;align-items:center;gap:8px">
                        <span id="m2wTimeLabel" style="font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;width:50px;text-align:right">0:00.0</span>
                        <input id="m2wTimeSlider" type="range" min="0" max="100" step="0.01" value="0" style="flex:1">
                        <span id="m2wDuration" style="font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;width:50px">0:00.0</span>
                    </div>
                    <!-- Result area -->
                    <div id="m2wResult" style="display:none;text-align:center">
                        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px">
                            <span id="m2wResultInfo" style="font-size:12px;color:var(--text-muted)"></span>
                        </div>
                        <img id="m2wResultImg" style="max-width:100%;max-height:300px;border-radius:8px;background-image:linear-gradient(45deg,#334155 25%,transparent 25%),linear-gradient(-45deg,#334155 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#334155 75%),linear-gradient(-45deg,transparent 75%,#334155 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0" />
                        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">
                            <button id="m2wDownloadBtn" class="btn-primary" style="font-size:13px">💾 下载</button>
                            <button id="m2wResetBtn" class="btn-secondary" style="font-size:13px">🔄 重新转换</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;

        this._attachEvents();
    }

    _attachEvents() {
        const el = (id) => this.container.querySelector(id);

        // Clip selection
        el('#m2wClipSelect').onchange = (e) => {
            const idx = parseInt(e.target.value);
            this.selectedShort = this.shorts[idx];
            this._loadVideo(this.selectedShort.videoUrl);
            el('#m2wConvertBtn').disabled = false;
        };

        // Export mode
        this.container.querySelectorAll('input[name="m2wExportMode"]').forEach(r => {
            r.onchange = () => {
                this.exportMode = r.value;
                el('#m2wFrameOpts').style.display = r.value === 'frames' ? 'block' : 'none';
                el('#m2wQualitySection').style.display = r.value === 'webp' ? 'block' : 'none';
            };
        });

        el('#m2wFrameFormat').onchange = (e) => { this.frameFormat = e.target.value; };

        // FPS
        el('#m2wFps').oninput = (e) => { this.fps = parseInt(e.target.value); el('#m2wFpsVal').textContent = this.fps; };

        // Scale buttons
        this.container.querySelectorAll('.m2w-scale-btn').forEach(btn => {
            btn.onclick = () => {
                this.scale = parseFloat(btn.dataset.scale);
                el('#m2wScaleVal').textContent = Math.round(this.scale * 100) + '%';
                this.container.querySelectorAll('.m2w-scale-btn').forEach(b => b.style.borderColor = 'var(--border-card)');
                btn.style.borderColor = 'var(--accent)';
            };
        });

        // BG removal toggle
        el('#m2wBgToggle').onchange = (e) => {
            this.enableBgRemoval = e.target.checked;
            el('#m2wBgSettings').style.opacity = e.target.checked ? '1' : '0.4';
            el('#m2wBgSettings').style.pointerEvents = e.target.checked ? 'auto' : 'none';
        };

        el('#m2wNnModel').onchange = (e) => { this.nnModel = e.target.value; };
        el('#m2wBgStr').oninput = (e) => { this.bgRemovalStrength = parseInt(e.target.value); el('#m2wBgStrVal').textContent = this.bgRemovalStrength + '%'; };

        // Quality
        el('#m2wQual').oninput = (e) => { this.quality = parseInt(e.target.value); el('#m2wQualVal').textContent = this.quality + '%'; };
        const methodLabels = ['0 (最快)', '1', '2', '3', '4', '5', '6 (最佳)'];
        el('#m2wMethod').oninput = (e) => { this.method = parseInt(e.target.value); el('#m2wMethodVal').textContent = methodLabels[this.method]; };

        // Convert
        el('#m2wConvertBtn').onclick = () => this._startConversion();
        el('#m2wCancelBtn').onclick = () => { this.cancelled = true; };

        // Download
        el('#m2wDownloadBtn').onclick = () => this._download();
        el('#m2wResetBtn').onclick = () => {
            el('#m2wResult').style.display = 'none';
            el('#m2wVideoWrap').style.display = 'flex';
            el('#m2wVideoControls').style.display = 'flex';
            el('#m2wConvertBtn').disabled = false;
        };

        // Time slider
        el('#m2wTimeSlider').oninput = () => {
            if (this.video) {
                const t = (parseFloat(el('#m2wTimeSlider').value) / 100) * this.video.duration;
                this.video.currentTime = t;
                el('#m2wTimeLabel').textContent = this._fmtTime(t);
            }
        };
    }

    _loadVideo(url) {
        const el = (id) => this.container.querySelector(id);
        if (this.video) { this.video.pause(); this.video.src = ''; }

        const vid = document.createElement('video');
        vid.crossOrigin = 'anonymous';
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';
        vid.src = url;

        const vidEl = el('#m2wVideo');
        vidEl.src = url;
        vidEl.crossOrigin = 'anonymous';
        vidEl.style.display = 'block';
        el('#m2wPlaceholder').style.display = 'none';
        el('#m2wPreviewCanvas').style.display = 'none';
        el('#m2wVideoControls').style.display = 'flex';
        el('#m2wResult').style.display = 'none';

        vidEl.onloadedmetadata = () => {
            el('#m2wDuration').textContent = this._fmtTime(vidEl.duration);
            el('#m2wTimeSlider').max = 100;
        };
        vidEl.ontimeupdate = () => {
            if (vidEl.duration) {
                el('#m2wTimeSlider').value = (vidEl.currentTime / vidEl.duration) * 100;
                el('#m2wTimeLabel').textContent = this._fmtTime(vidEl.currentTime);
            }
        };

        this.video = vid;
        vid.onloadedmetadata = () => {}; // processing video ready
    }

    _fmtTime(sec) {
        if (!sec || isNaN(sec)) return '0:00.0';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 10);
        return `${m}:${String(s).padStart(2, '0')}.${ms}`;
    }

    _updateProgress(label, pct) {
        const el = (id) => this.container.querySelector(id);
        el('#m2wProgressLabel').textContent = label;
        el('#m2wProgressPct').textContent = Math.round(pct) + '%';
        el('#m2wProgressBar').style.width = pct + '%';
    }

    async _startConversion() {
        if (this.processing || !this.selectedShort) return;
        this.processing = true;
        this.cancelled = false;

        const el = (id) => this.container.querySelector(id);
        el('#m2wConvertBtn').disabled = true;
        el('#m2wCancelBtn').style.display = 'block';
        el('#m2wProgress').style.display = 'block';

        try {
            // Ensure processing video is loaded
            const vid = this.video;
            vid.src = this.selectedShort.videoUrl;
            vid.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
                if (vid.readyState >= 1) return resolve();
                vid.onloadedmetadata = resolve;
                vid.onerror = reject;
            });

            const duration = vid.duration;
            const fps = this.fps;
            const totalFrames = Math.max(1, Math.ceil(duration * fps));
            const frameDurationMs = Math.round(1000 / fps);
            const outW = Math.round(vid.videoWidth * this.scale);
            const outH = Math.round(vid.videoHeight * this.scale);

            // Init segmentation model if needed
            if (this.enableBgRemoval) {
                this._updateProgress('加载 AI 模型…', 0);
                if (this.nnModel === 'mediapipe') { await getImageSegmenter(); }
                else if (this.nnModel === 'modnet') { await getModnetSession(); }
                else if (this.nnModel === 'rmbg') { await getRmbgSession(); }
            }

            // Create work canvases
            const segCanvas = document.createElement('canvas');
            segCanvas.width = outW; segCanvas.height = outH;
            const segCtx = segCanvas.getContext('2d', { willReadFrequently: true });

            const previewCanvas = el('#m2wPreviewCanvas');
            previewCanvas.width = outW; previewCanvas.height = outH;
            previewCanvas.style.display = 'block';
            const pCtx = previewCanvas.getContext('2d');

            const processedFrames = [];

            for (let i = 0; i < totalFrames; i++) {
                if (this.cancelled) break;
                const t = i / fps;
                this._updateProgress(`处理帧 ${i + 1}/${totalFrames}`, ((i + 1) / totalFrames) * 80);

                vid.currentTime = t;
                await new Promise(resolve => { vid.onseeked = resolve; });

                segCtx.drawImage(vid, 0, 0, outW, outH);

                if (this.enableBgRemoval) {
                    const maskData = await runSegmentation(this.nnModel, segCanvas, outW, outH);
                    if (maskData) {
                        const imageData = segCtx.getImageData(0, 0, outW, outH);
                        applyStrengthToAlpha(maskData, imageData.data, this.bgRemovalStrength);
                        segCtx.putImageData(imageData, 0, 0);
                    }
                }

                pCtx.clearRect(0, 0, outW, outH);
                pCtx.drawImage(segCanvas, 0, 0);

                const frameClone = document.createElement('canvas');
                frameClone.width = outW; frameClone.height = outH;
                frameClone.getContext('2d').drawImage(segCanvas, 0, 0);
                processedFrames.push(frameClone);
            }

            if (this.cancelled) {
                this._resetUI();
                return;
            }

            if (this.exportMode === 'webp') {
                // Encode animated WebP
                this._updateProgress('编码 WebP…', 82);
                const blob = await encodeAnimatedWebP(processedFrames, frameDurationMs, this.quality, this.method, (phase, cur, total) => {
                    this._updateProgress(`编码帧 ${cur}/${total}`, 80 + (cur / total) * 18);
                });

                this._resultBlob = blob;
                this._resultFrames = null;
                this._resultName = (this.selectedShort.prompt || 'clip').slice(0, 30).replace(/[^\w\u4e00-\u9fff]/g, '_') + '.webp';

                const blobUrl = URL.createObjectURL(blob);
                const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
                el('#m2wResultInfo').textContent = `${sizeMB} MB · ${outW}×${outH} · ${processedFrames.length} 帧`;
                el('#m2wResultImg').src = blobUrl;
                el('#m2wResultImg').style.display = 'block';
            } else {
                // Frame sequence
                this._updateProgress('生成帧序列…', 90);
                const framesData = [];
                const baseName = (this.selectedShort.prompt || 'frame').slice(0, 20).replace(/[^\w\u4e00-\u9fff]/g, '_');
                for (let i = 0; i < processedFrames.length; i++) {
                    const canvas = processedFrames[i];
                    const mimeType = this.frameFormat === 'jpg' ? 'image/jpeg' : 'image/png';
                    const ext = this.frameFormat === 'jpg' ? 'jpg' : 'png';
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, 0.92));
                    const num = String(i + 1).padStart(3, '0');
                    framesData.push({ blob, name: `${baseName}_${num}.${ext}` });
                }

                this._resultBlob = null;
                this._resultFrames = framesData;
                this._resultName = baseName;

                el('#m2wResultInfo').textContent = `${framesData.length} 帧 · ${outW}×${outH} · ${this.frameFormat.toUpperCase()}`;
                el('#m2wResultImg').style.display = 'none';
            }

            this._updateProgress('完成！', 100);

            // Show result
            el('#m2wVideoWrap').style.display = 'none';
            el('#m2wVideoControls').style.display = 'none';
            el('#m2wResult').style.display = 'block';
            el('#m2wDownloadBtn').textContent = this.exportMode === 'webp' ? '💾 下载 WebP' : '💾 下载 ZIP';

        } catch (err) {
            console.error('Conversion failed:', err);
            alert('转换失败: ' + err.message);
        } finally {
            this._resetUI();
        }
    }

    _resetUI() {
        this.processing = false;
        const el = (id) => this.container.querySelector(id);
        el('#m2wCancelBtn').style.display = 'none';
        el('#m2wProgress').style.display = 'none';
        el('#m2wConvertBtn').disabled = !this.selectedShort;
    }

    async _download() {
        if (this._resultBlob) {
            // Single WebP file
            const a = document.createElement('a');
            a.href = URL.createObjectURL(this._resultBlob);
            a.download = this._resultName;
            a.click();
            URL.revokeObjectURL(a.href);
        } else if (this._resultFrames && this._resultFrames.length > 0) {
            // ZIP download - use JSZip or manual download
            if (this._resultFrames.length === 1) {
                const f = this._resultFrames[0];
                const a = document.createElement('a');
                a.href = URL.createObjectURL(f.blob);
                a.download = f.name;
                a.click();
                URL.revokeObjectURL(a.href);
                return;
            }

            // Try to create a ZIP using a simple approach
            try {
                // Dynamically load JSZip
                if (!window.JSZip) {
                    await loadScript('https://cdn.keepwork.com/keepwork/cdn/jszip@3.10.1.min.js');
                }
                const zip = new JSZip();
                for (const f of this._resultFrames) {
                    zip.file(f.name, f.blob);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(zipBlob);
                a.download = this._resultName + '_frames.zip';
                a.click();
                URL.revokeObjectURL(a.href);
            } catch (err) {
                // Fallback: download each frame individually
                console.warn('ZIP creation failed, downloading individually:', err);
                for (const f of this._resultFrames) {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(f.blob);
                    a.download = f.name;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
    }
}
