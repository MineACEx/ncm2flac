/* app.js — 界面逻辑：选取 → 解密 → （可选 MP3 转码）→ 打标签 → 下载 */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const dropEl = $('drop');
  const fileEl = $('file');
  const toolbar = $('toolbar');
  const listEl = $('list');
  const statText = $('statText');
  const btnConvert = $('convertAll');
  const btnDownload = $('downloadAll');
  const btnClear = $('clear');

  const items = [];
  let seq = 0;

  /** 输出格式偏好：flac = 无损原样，mp3 = 转码 */
  const settings = { format: 'flac', bitrate: 320 };

  const fmtBytes = (n) => {
    if (!n && n !== 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  };
  const fmtTime = (ms) => {
    if (!ms || ms <= 0) return '';
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const stem = (name) => name.replace(/\.ncm$/i, '');
  const safeName = (s) =>
    String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'output';

  function newItem(file) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML =
      '<div class="cover ph">♪</div>' +
      '<div class="meta">' +
        '<div class="title"></div>' +
        '<div class="sub"></div>' +
        '<div class="state">等待转换</div>' +
        '<div class="bar" hidden><i></i></div>' +
      '</div>' +
      '<button class="btn save" type="button" hidden>下载</button>';
    el.querySelector('.title').textContent = stem(file.name);
    el.querySelector('.sub').textContent = fmtBytes(file.size);
    listEl.appendChild(el);
    return {
      id: ++seq,
      file,
      el,
      state: 'pending',
      result: null,
      url: null,
      bar: el.querySelector('.bar'),
      barFill: el.querySelector('.bar i'),
      stateEl: el.querySelector('.state'),
      saveBtn: el.querySelector('.save'),
      sizeText: el.querySelector('.sub'),
      titleEl: el.querySelector('.title'),
    };
  }

  function setState(item, cls, text) {
    item.stateEl.className = 'state' + (cls ? ' ' + cls : '');
    item.stateEl.textContent = text;
  }

  async function convertOne(item) {
    if (item.state === 'busy') return;
    item.state = 'busy';
    item.bar.hidden = false;
    item.bar.classList.remove('done');
    item.barFill.style.width = '2%';
    item.saveBtn.hidden = true;
    setState(item, '', '解密中…');
    await new Promise((r) => requestAnimationFrame(r));

    try {
      const buf = new Uint8Array(await item.file.arrayBuffer());
      if (!NCM.isNcm(buf)) throw new Error('不是 NCM 文件');
      const res = await NCM.decrypt(buf, (p) => {
        item.barFill.style.width = Math.max(2, Math.round(p * 60)) + '%';
      });

      const m = res.meta || {};
      const artist = Array.isArray(m.artist)
        ? m.artist.map((a) => (Array.isArray(a) ? a[0] : a)).filter(Boolean).join(' / ')
        : '';
      const title = m.musicName || stem(item.file.name);
      const album = m.album || '';

      let audio = res.audio;
      let format = res.format;

      if (settings.format === 'mp3' && res.format !== 'mp3') {
        setState(item, '', '转码 MP3…');
        item.barFill.style.width = '62%';
        await new Promise((r) => requestAnimationFrame(r));
        audio = await Mp3.encode(audio, { bitrate: settings.bitrate }, (p) => {
          item.barFill.style.width = Math.max(62, Math.round(62 + p * 30)) + '%';
        });
        format = 'mp3';
      }

      setState(item, '', '写入标签…');
      const out = Tagger.apply(audio, format, { title, artist, album, cover: res.cover });

      const blob = new Blob([out], { type: format === 'flac' ? 'audio/flac' : 'audio/mpeg' });
      item.url = URL.createObjectURL(blob);
      item.result = {
        blob,
        filename: safeName(artist ? artist.split(' / ')[0] + ' - ' + title : title) + '.' + format,
        format,
        bytes: out.length,
        durationMs: m.duration || 0,
        lossless: res.format === 'flac' && format === 'flac',
      };
      item.state = 'done';
      item.bar.classList.add('done');
      item.barFill.style.width = '100%';

      const coverEl = item.el.querySelector('.cover');
      if (res.cover) {
        const cu = URL.createObjectURL(new Blob([res.cover], { type: 'image/jpeg' }));
        coverEl.outerHTML = '<img class="cover" alt="" src="' + cu + '" />';
        item.coverUrl = cu;
      }
      item.titleEl.textContent = title;
      const label = format === 'flac' ? 'FLAC 无损' : 'MP3 ' + settings.bitrate + 'kbps';
      item.sizeText.textContent = [artist, album, fmtTime(m.durationMs), label]
        .filter(Boolean).join(' · ') + ' · ' + fmtBytes(out.length);

      setState(item, 'ok', item.result.lossless ? '✓ 无损还原完成' : '✓ 转换完成');
      item.saveBtn.hidden = false;
      item.saveBtn.onclick = () => download(item);
      return true;
    } catch (e) {
      item.state = 'error';
      item.bar.hidden = true;
      setState(item, 'err', '✕ ' + (e && e.message ? e.message : '转换失败'));
      return false;
    } finally {
      refreshStats();
    }
  }

  function download(item) {
    if (!item.result) return;
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function refreshStats() {
    const total = items.length;
    const done = items.filter((i) => i.state === 'done').length;
    toolbar.hidden = total === 0;
    statText.textContent = done === total && total > 0
      ? total + ' 个文件 · 全部完成'
      : done + ' / ' + total + ' 已完成';
    btnConvert.disabled = !items.some((i) => i.state === 'pending' || i.state === 'error');
    btnDownload.disabled = done === 0;
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const ncm = files.filter((f) => /\.ncm$/i.test(f.name));
    if (!ncm.length) {
      dropEl.querySelector('span').textContent = '请选择 .ncm 文件';
      return;
    }
    ncm.forEach((f) => items.push(newItem(f)));
    refreshStats();
    runQueue();
  }

  let running = false;
  async function runQueue() {
    if (running) return;
    running = true;
    btnConvert.disabled = true;
    try {
      for (const it of items) {
        if (it.state === 'pending' || it.state === 'error') await convertOne(it);
      }
    } finally {
      running = false;
      refreshStats();
    }
  }

  /* 格式切换 */
  const segBtns = Array.from(document.querySelectorAll('[data-format]'));
  const bitrateWrap = document.getElementById('bitrateWrap');
  const bitrateSel = document.getElementById('bitrate');

  function syncFormatUI() {
    segBtns.forEach((b) => {
      const on = b.dataset.format === settings.format;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    bitrateWrap.hidden = settings.format !== 'mp3';
  }

  segBtns.forEach((b) =>
    b.addEventListener('click', () => {
      settings.format = b.dataset.format;
      syncFormatUI();
      markStale();
    }));
  if (bitrateSel) {
    bitrateSel.addEventListener('change', () => {
      settings.bitrate = Number(bitrateSel.value) || 320;
      markStale();
    });
  }

  /** 格式改动后，已完成的条目提示需重新转换 */
  function markStale() {
    if (!items.length) return;
    items.forEach((it) => {
      if (it.state === 'done') {
        setState(it, '', '格式已变更 · 点击「重新转换」');
        it.state = 'pending';
        it.saveBtn.hidden = true;
      }
    });
    refreshStats();
  }

  /* events */
  dropEl.addEventListener('click', () => fileEl.click());
  dropEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); }
  });
  fileEl.addEventListener('change', () => { addFiles(fileEl.files); fileEl.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('over'); }));
  ['dragleave', 'dragend', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, () => dropEl.classList.remove('over')));
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  btnConvert.addEventListener('click', runQueue);
  btnDownload.addEventListener('click', () => {
    items.filter((i) => i.state === 'done').forEach((it, idx) => {
      setTimeout(() => download(it), idx * 320);
    });
  });
  btnClear.addEventListener('click', () => {
    items.forEach((it) => {
      if (it.url) URL.revokeObjectURL(it.url);
      if (it.coverUrl) URL.revokeObjectURL(it.coverUrl);
      it.el.remove();
    });
    items.length = 0;
    refreshStats();
  });

  syncFormatUI();
})();
