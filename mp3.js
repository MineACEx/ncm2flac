/* mp3.js — FLAC/MP3 解码 + lamejs 转码（浏览器内完成，不联网） */
'use strict';

const Mp3 = (() => {
  const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

  /** decodeAudioData 只吃 ArrayBuffer；Uint8Array 复用同一块内存时用这个切出独立 ArrayBuffer */
  function toArrayBuffer(view) {
    if (view instanceof ArrayBuffer) return view.slice(0);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  function pickRate(sourceRate) {
    if (!sourceRate || !isFinite(sourceRate)) return 44100;
    let best = 44100;
    for (const r of LAME_RATES) if (Math.abs(r - sourceRate) < Math.abs(best - sourceRate)) best = r;
    if (sourceRate > 48000) best = 48000;
    return best;
  }

  const floatToInt16 = (f) => {
    const n = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      let s = f[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      n[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return n;
  };

  /** 解码任意浏览器支持的音频（FLAC/MP3）到 PCM */
  async function decode(bytes) {
    const probe = new OfflineAudioContext(2, 1, 44100);
    try {
      return await probe.decodeAudioData(toArrayBuffer(bytes));
    } catch (e) {
      throw new Error('浏览器无法解码该音频（可能是 24bit 高解析 FLAC 或文件损坏）');
    }
  }

  /**
   * 把原始音频字节编码成 MP3
   * @param {Uint8Array} bytes 已解密的原始音频（FLAC / MP3）
   * @param {{bitrate?: number}} opts
   * @param {(p:number)=>void} onProgress
   * @returns {Promise<Uint8Array>}
   */
  async function encode(bytes, opts, onProgress) {
    const bitrate = (opts && opts.bitrate) || 320;

    if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
      throw new Error('MP3 编码器未加载');
    }

    let audio = await decode(bytes);

    const rate = pickRate(audio.sampleRate);
    if (Math.abs(audio.sampleRate - rate) > 1) {
      // 需要重采样：交给浏览器的离线上下文，避免 lame 内部重采样带来的额外失真
      const offline = new OfflineAudioContext(audio.numberOfChannels > 1 ? 2 : 1, 1, rate);
      try {
        audio = await offline.decodeAudioData(toArrayBuffer(bytes));
      } catch (e) { /* 保留原采样率 */ }
    }

    // LAME quality：0 = 最精细（最慢），9 = 最快。320kbps 已是 MP3 规范上限，
    // 想再提升只能靠更精细的心理声学搜索，所以这里暴露 quality 档。
    const quality = (opts && typeof opts.quality === 'number') ? opts.quality : 3;
    globalThis.__LAME_OPTS__ = { quality };

    const channels = Math.min(2, audio.numberOfChannels);
    const encoder = new lamejs.Mp3Encoder(channels, audio.sampleRate, bitrate);
    const left = floatToInt16(audio.getChannelData(0));
    const right = channels > 1 ? floatToInt16(audio.getChannelData(1)) : left;

    const BLOCK = 1152;
    const chunks = [];
    let total = 0;
    const frames = left.length;

    for (let i = 0; i < frames; i += BLOCK) {
      const end = Math.min(i + BLOCK, frames);
      const l = left.subarray(i, end);
      const data = channels > 1 ? encoder.encodeBuffer(l, right.subarray(i, end)) : encoder.encodeBuffer(l);
      if (data.length > 0) {
        const c = new Uint8Array(data.length);
        c.set(data);
        chunks.push(c);
        total += c.length;
      }
      if ((i / BLOCK) % 24 === 0) {
        if (onProgress) onProgress(i / frames);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    const tail = encoder.flush();
    if (tail.length > 0) {
      const c = new Uint8Array(tail.length);
      c.set(tail);
      chunks.push(c);
      total += c.length;
    }
    if (onProgress) onProgress(1);

    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  return { encode, decode, pickRate, toArrayBuffer };
})();
