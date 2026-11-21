/* core.js — 纯前端 NCM 解密核心（无依赖）
 * 算法：AES-128-ECB 解出 RC4 密钥 → RC4(KSA/PRGA) 逐字节还原音频 → 元数据 AES 解密
 */
'use strict';

const AES = (() => {
  const exp = new Uint8Array(512), log = new Uint8Array(256);
  const xtime = (a) => { a <<= 1; if (a & 0x100) a ^= 0x11b; return a & 0xff; };
  let g = 1;
  for (let i = 0; i < 255; i++) { exp[i] = g; exp[i + 255] = g; log[g] = i; g ^= xtime(g); }
  const SBOX = new Uint8Array(256), INV_SBOX = new Uint8Array(256);
  const rotl = (b, n) => ((b << n) | (b >>> (8 - n))) & 0xff;
  for (let a = 0; a < 256; a++) {
    const inv = a === 0 ? 0 : exp[255 - log[a]];
    const s = inv ^ rotl(inv, 1) ^ rotl(inv, 2) ^ rotl(inv, 3) ^ rotl(inv, 4) ^ 0x63;
    SBOX[a] = s; INV_SBOX[s] = a;
  }
  const mul = (a, b) => (a && b) ? exp[log[a] + log[b]] : 0;
  const M9 = new Uint8Array(256), M11 = new Uint8Array(256), M13 = new Uint8Array(256), M14 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { M9[i] = mul(i, 9); M11[i] = mul(i, 11); M13[i] = mul(i, 13); M14[i] = mul(i, 14); }

  function expandKey(key) {
    const w = new Uint8Array(176);
    w.set(key);
    let rcon = 1;
    for (let i = 16; i < 176; i += 4) {
      let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if (i % 16 === 0) {
        const tmp = t0;
        t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[tmp];
        rcon = xtime(rcon);
      }
      w[i] = w[i - 16] ^ t0; w[i + 1] = w[i - 15] ^ t1;
      w[i + 2] = w[i - 14] ^ t2; w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }

  function invShiftRows(s, o) {
    let t = s[o + 13]; s[o + 13] = s[o + 9]; s[o + 9] = s[o + 5]; s[o + 5] = s[o + 1]; s[o + 1] = t;
    t = s[o + 2]; s[o + 2] = s[o + 10]; s[o + 10] = t;
    t = s[o + 6]; s[o + 6] = s[o + 14]; s[o + 14] = t;
    t = s[o + 3]; s[o + 3] = s[o + 7]; s[o + 7] = s[o + 11]; s[o + 11] = s[o + 15]; s[o + 15] = t;
  }

  function decryptBlock(w, s, off) {
    for (let i = 0; i < 16; i++) s[off + i] ^= w[160 + i];
    for (let round = 9; round >= 1; round--) {
      invShiftRows(s, off);
      for (let i = 0; i < 16; i++) s[off + i] = INV_SBOX[s[off + i]];
      const ko = round * 16;
      for (let i = 0; i < 16; i++) s[off + i] ^= w[ko + i];
      for (let c = 0; c < 16; c += 4) {
        const a0 = s[off + c], a1 = s[off + c + 1], a2 = s[off + c + 2], a3 = s[off + c + 3];
        s[off + c]     = M14[a0] ^ M11[a1] ^ M13[a2] ^ M9[a3];
        s[off + c + 1] = M9[a0] ^ M14[a1] ^ M11[a2] ^ M13[a3];
        s[off + c + 2] = M13[a0] ^ M9[a1] ^ M14[a2] ^ M11[a3];
        s[off + c + 3] = M11[a0] ^ M13[a1] ^ M9[a2] ^ M14[a3];
      }
    }
    invShiftRows(s, off);
    for (let i = 0; i < 16; i++) s[off + i] = INV_SBOX[s[off + i]] ^ w[i];
  }

  return {
    decryptECB(data, key) {
      if (data.length % 16 !== 0) {
        const padded = new Uint8Array(Math.ceil(data.length / 16) * 16);
        padded.set(data);
        data = padded;
      }
      const w = expandKey(key);
      const out = new Uint8Array(data);
      for (let off = 0; off < out.length; off += 16) decryptBlock(w, out, off);
      return out;
    }
  };
})();

const NCM = (() => {
  const CORE_KEY = new TextEncoder().encode('hzHRAmso5kInbaxW');
  const META_KEY = new TextEncoder().encode("#14ljk_!\\]&0U<'(");
  const PREFIX = "163 key(Don't modify):";
  const MAGIC = [0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]; // CTENFDAM

  function latin1(u8) {
    let s = '';
    const CH = 8192;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return s;
  }

  function b64ToBytes(s) {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
    const raw = atob(clean);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function stripPkcs7(buf) {
    if (!buf.length) return buf;
    const pad = buf[buf.length - 1];
    if (pad > 0 && pad <= 16 && buf.length >= pad) {
      let ok = true;
      for (let i = buf.length - pad; i < buf.length; i++) if (buf[i] !== pad) { ok = false; break; }
      if (ok) return buf.subarray(0, buf.length - pad);
    }
    return buf;
  }

  function keyBox(keyData) {
    const box = new Uint8Array(256);
    for (let i = 0; i < 256; i++) box[i] = i;
    let c = 0, last = 0, ko = 0;
    for (let i = 0; i < 256; i++) {
      const swap = box[i];
      c = (swap + last + keyData[ko]) & 0xff;
      ko = (ko + 1) % keyData.length;
      box[i] = box[c]; box[c] = swap; last = c;
    }
    return box;
  }

  function decodeMeta(bytes) {
    let s = latin1(bytes);
    const idx = s.indexOf(PREFIX);
    if (idx === 0) s = s.slice(PREFIX.length);
    else if (s.indexOf(':') > 0) s = s.slice(s.indexOf(':') + 1);
    const plain = new TextDecoder('utf-8').decode(stripPkcs7(AES.decryptECB(b64ToBytes(s), META_KEY)));
    const sep = plain.indexOf(':');
    if (sep <= 0) return null;
    try { return JSON.parse(plain.slice(sep + 1)); } catch { return null; }
  }

  function isNcm(u8) {
    if (u8.length < 32) return false;
    for (let i = 0; i < 8; i++) if (u8[i] !== MAGIC[i]) return false;
    return true;
  }

  function detectFormat(audio, meta) {
    if (audio.length > 4 && audio[0] === 0x66 && audio[1] === 0x4c && audio[2] === 0x61 && audio[3] === 0x43) return 'flac';
    if (audio.length > 3 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) return 'mp3';
    if (audio.length > 1 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) return 'mp3';
    if (meta && meta.format === 'flac') return 'flac';
    return 'mp3';
  }

  async function decrypt(u8, onProgress) {
    if (!isNcm(u8)) throw new Error('不是有效的 NCM 文件');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 10;

    const keyLen = dv.getUint32(off, true); off += 4;
    if (keyLen <= 0 || off + keyLen > u8.length) throw new Error('文件头损坏：密钥段');
    const keyXor = new Uint8Array(keyLen);
    for (let i = 0; i < keyLen; i++) keyXor[i] = u8[off + i] ^ 0x64;
    off += keyLen;
    const rc4Key = stripPkcs7(AES.decryptECB(keyXor, CORE_KEY)).subarray(17);
    if (rc4Key.length < 8) throw new Error('文件头损坏：密钥长度异常');

    const metaLen = dv.getUint32(off, true); off += 4;
    let meta = null;
    if (metaLen > 0 && off + metaLen <= u8.length) {
      const mraw = new Uint8Array(metaLen);
      for (let i = 0; i < metaLen; i++) mraw[i] = u8[off + i] ^ 0x63;
      off += metaLen;
      try { meta = decodeMeta(mraw); } catch { meta = null; }
    }

    // 封面定位：JPEG 魔数，长度字段在其前 4 字节（小端）
    let imgStart = -1;
    const scanEnd = Math.min(off + 8192, u8.length - 3);
    for (let i = off; i < scanEnd; i++) {
      if (u8[i] === 0xff && u8[i + 1] === 0xd8 && u8[i + 2] === 0xff) { imgStart = i; break; }
    }
    let cover = null, audioStart = -1;
    if (imgStart > 4) {
      const imgLen = dv.getUint32(imgStart - 4, true);
      if (imgLen > 64 && imgStart + imgLen <= u8.length) {
        cover = u8.subarray(imgStart, imgStart + imgLen);
        audioStart = imgStart + imgLen;
      }
    }
    if (audioStart < 0) {
      // 无封面：crc32(4) + 保留(1)
      audioStart = off + 5;
      if (audioStart > u8.length) throw new Error('文件头损坏：音频段定位失败');
    }

    const box = keyBox(rc4Key);
    const len = u8.length - audioStart;
    const audio = new Uint8Array(len);
    const CHUNK = 1 << 20;
    for (let base = 0; base < len; base += CHUNK) {
      const end = Math.min(base + CHUNK, len);
      for (let i = base; i < end; i++) {
        const j = (i + 1) & 0xff;
        audio[i] = u8[audioStart + i] ^ box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
      }
      if (onProgress) onProgress(end / len);
      if (end < len) await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(1);

    return { audio, cover, meta, format: detectFormat(audio, meta) };
  }

  return { isNcm, decrypt, detectFormat };
})();
