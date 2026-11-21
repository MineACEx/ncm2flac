/* squircle.js — G2 连续曲率圆角
 * 矩形：优先用 CSS corner-shape: squircle（Chrome 139+ 原生 G2）
 * 其余：圆角矩形用超椭圆 clip-path，保证曲率从直边 0 平滑过渡到角部峰值
 */
'use strict';

const Squircle = (() => {
  const N = 4;          // 超椭圆指数，n=4 为 G2 与饱满度的平衡点
  const STEPS = 44;     // 每段角的采样数

  const supportsCornerShape = (() => {
    try { return CSS.supports('corner-shape', 'squircle'); } catch { return false; }
  })();

  /** 超椭圆极坐标半径：rho(φ) = r / (|cosφ|^n + |sinφ|^n)^(1/n) */
  function rho(phi, r) {
    const c = Math.abs(Math.cos(phi));
    const s = Math.abs(Math.sin(phi));
    return r / Math.pow(Math.pow(c, N) + Math.pow(s, N), 1 / N);
  }

  /** 生成 w×h 超椭圆圆角矩形的 path（r 为角半径） */
  function path(w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r <= 0.5) return 'path("M 0 0 H ' + w + ' V ' + h + ' H 0 Z")';

    const d = [];
    const deg = Math.PI / 2;
    const corner = (cx, cy, start) => {
      for (let i = 0; i <= STEPS; i++) {
        const phi = start + (i / STEPS) * deg;
        const rr = rho(phi, r);
        const x = cx + rr * Math.cos(phi);
        const y = cy + rr * Math.sin(phi);
        d.push((i === 0 && d.length === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2));
      }
    };

    // 右上角：圆心 (w-r, r)，φ 从 -90° 到 0°
    corner(w - r, r, -deg);
    // 右下角：圆心 (w-r, h-r)，φ 从 0° 到 90°
    corner(w - r, h - r, 0);
    // 左下角：圆心 (r, h-r)，φ 从 90° 到 180°
    corner(r, h - r, deg);
    // 左上角：圆心 (r, r)，φ 从 180° 到 270°
    corner(r, r, 2 * deg);

    return 'path("' + d.join(' ') + ' Z")';
  }

  /** 把 CSS 里声明的 border-radius 读出来，转成超椭圆 clip-path */
  function apply(el) {
    if (!el || !el.isConnected) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;

    const declared = parseFloat(getComputedStyle(el).getPropertyValue('--squircle-r')) ||
                     parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    if (!declared) return;

    const p = path(w, h, declared);
    el.style.clipPath = p;
    el.style.webkitClipPath = p;
  }

  function watch(el) {
    apply(el);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => apply(el));
      ro.observe(el);
      el.__squircleRO = ro;
    }
  }

  function init(root) {
    // 支持原生 corner-shape 就直接交给浏览器，省掉逐帧重算
    if (supportsCornerShape) {
      document.documentElement.classList.add('has-corner-shape');
      return;
    }
    const els = (root || document).querySelectorAll('[data-squircle]');
    els.forEach(watch);
  }

  return { init, apply, path, supportsCornerShape, N };
})();
