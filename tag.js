/* tag.js — 把封面与标签写进 FLAC / MP3，不改动任何音频字节 */
'use strict';

const Tagger = (() => {
  const enc = new TextEncoder();

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const u32be = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, false); return b; };

  function jpegSize(u8) {
    let i = 2;
    const end = u8.length - 9;
    while (i < end) {
      if (u8[i] !== 0xff) { i++; continue; }
      const m = u8[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += (m === 0xff ? 1 : 2); continue; }
      const len = (u8[i + 2] << 8) | u8[i + 3];
      if (len < 2) break;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return {
          height: (u8[i + 5] << 8) | u8[i + 6],
          width: (u8[i + 7] << 8) | u8[i + 8],
        };
      }
      i += 2 + len;
    }
    return { width: 0, height: 0 };
  }

  /* ---------- FLAC ---------- */
  function vorbisComment(fields) {
    const vendor = enc.encode('ncm2flac');
    const items = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined || v === '') continue;
      items.push(enc.encode(k.toUpperCase() + '=' + v));
    }
    const parts = [u32le(vendor.length), vendor, u32le(items.length)];
    for (const it of items) parts.push(u32le(it.length), it);
    return concat(parts);
  }

  function flacPicture(cover, fields) {
    const mime = enc.encode('image/jpeg');
    let descStr = fields.title || '';
    const desc = descStr ? enc.encode(descStr) : new Uint8Array(0);
    const { width, height } = jpegSize(cover);
    return concat([
      u32be(3),                 // front cover
      u32be(mime.length), mime,
      u32be(desc.length), desc,
      u32be(width), u32be(height), u32be(24), u32be(0),
      u32be(cover.length), cover,
    ]);
  }

  function addFlacTags(audio, fields) {
    if (audio.length < 8 || audio[0] !== 0x66 || audio[1] !== 0x4c || audio[2] !== 0x61 || audio[3] !== 0x43) {
      return audio; // 不是 FLAC，原样返回
    }
    const blocks = [];
    let off = 4;
    let guard = 0;
    while (off + 4 <= audio.length && guard++ < 512) {
      const header = audio[off];
      const last = (header & 0x80) !== 0;
      const type = header & 0x7f;
      const len = (audio[off + 1] << 16) | (audio[off + 2] << 8) | audio[off + 3];
      const start = off + 4;
      const end = start + len;
      if (end > audio.length) break;
      blocks.push({ type, data: audio.subarray(start, end) });
      off = end;
      if (last) break;
    }
    if (!blocks.length) return audio;
    const audioStart = off;

    // 去掉旧的 VORBIS_COMMENT / PICTURE，STREAMINFO 必须留在首位
    const kept = blocks.filter((b) => b.type !== 4 && b.type !== 6);
    const streaminfo = kept.filter((b) => b.type === 0);
    const others = kept.filter((b) => b.type !== 0);

    const next = [...streaminfo];
    const vc = vorbisComment(fields);
    if (vc.length) next.push({ type: 4, data: vc });
    if (fields.cover) next.push({ type: 6, data: flacPicture(fields.cover, fields) });
    next.push(...others);

    const head = [enc.encode('fLaC')];
    next.forEach((b, i) => {
      const isLast = i === next.length - 1;
      head.push(new Uint8Array([
        (isLast ? 0x80 : 0x00) | (b.type & 0x7f),
        (b.data.length >> 16) & 0xff,
        (b.data.length >> 8) & 0xff,
        b.data.length & 0xff,
      ]));
      head.push(b.data);
    });
    head.push(audio.subarray(audioStart));
    return concat(head);
  }

  /* ---------- MP3 (ID3v2.3) ---------- */
  function utf16(str) {
    const out = new Uint8Array(2 + str.length * 2);
    out[0] = 0xff; out[1] = 0xfe; // BOM little endian
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[2 + i * 2] = c & 0xff;
      out[3 + i * 2] = (c >> 8) & 0xff;
    }
    return out;
  }

  function textFrame(id, value) {
    if (!value) return null;
    const body = utf16(value);
    const data = concat([new Uint8Array([0x01]), body]); // encoding 1 = UTF-16 with BOM
    return concat([enc.encode(id), u32be(data.length), new Uint8Array([0x00, 0x00]), data]);
  }

  function apicFrame(cover, fields) {
    const mime = enc.encode('image/jpeg');
    const desc = new Uint8Array([0x00, 0x00]); // UTF-16 empty description (BOM + term)
    const data = concat([
      new Uint8Array([0x01]), mime, new Uint8Array([0x00]), // encoding + mime + null
      new Uint8Array([0x03]),                              // front cover
      desc,
      cover,
    ]);
    return concat([enc.encode('APIC'), u32be(data.length), new Uint8Array([0x00, 0x00]), data]);
  }

  function syncsafe(n) {
    return new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
  }

  function addMp3Tags(audio, fields) {
    let body = audio;
    // 剥掉已有的 ID3v2
    if (body.length > 10 && body[0] === 0x49 && body[1] === 0x44 && body[2] === 0x33) {
      const size = (body[6] & 0x7f) << 21 | (body[7] & 0x7f) << 14 | (body[8] & 0x7f) << 7 | (body[9] & 0x7f);
      body = body.subarray(10 + size);
    }
    const frames = [];
    const f1 = textFrame('TIT2', fields.title); if (f1) frames.push(f1);
    const f2 = textFrame('TPE1', fields.artist); if (f2) frames.push(f2);
    const f3 = textFrame('TALB', fields.album); if (f3) frames.push(f3);
    if (fields.cover) frames.push(apicFrame(fields.cover, fields));
    const tagBody = concat(frames);
    const header = concat([enc.encode('ID3'), new Uint8Array([0x03, 0x00, 0x00]), syncsafe(tagBody.length)]);
    return concat([header, tagBody, body]);
  }

  function apply(audio, format, fields) {
    if (!fields || (!fields.title && !fields.artist && !fields.album && !fields.cover)) return audio;
    try {
      return format === 'flac' ? addFlacTags(audio, fields) : addMp3Tags(audio, fields);
    } catch (e) {
      return audio;
    }
  }

  return { apply, jpegSize };
})();
