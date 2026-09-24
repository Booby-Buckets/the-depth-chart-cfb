/* cfb.js — helpers shared by the CFB pages (window.CFB).
 *   fmt / pct / ord   number formatting
 *   paintTeam(meta)   sets --tc-band (a team colour that holds white text) and --tc-text
 *                     (the team colour nudged until it reads on the current theme), and
 *                     re-paints on theme toggle
 *   tip(el, card, x, y, html)  positions a .tip tooltip inside a card
 */
(function () {
  const fmt = (v, d = 1, sign = false) => v == null ? '—' : (sign && v > 0 ? '+' : '') + Number(v).toFixed(d);
  const pct = p => p == null ? '—' : p > .995 ? '>99%' : p < .005 ? '<1%' : Math.round(p * 100) + '%';
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

  const hex2rgb = h => { h = (h || '555555').replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const lum = rgb => { const c = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = rgb => `rgb(${rgb.join(',')})`;
  function toward(rgb, target, bg, need) { for (let t = 0; t <= 1; t += .05) { const c = mix(rgb, target, t); if (contrast(c, bg) >= need) return c; } return target; }

  let painted = null, onRepaint = [];
  function apply() {
    if (!painted) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [250, 249, 246]).slice(0, 3).map(Number);
    const base = hex2rgb(painted.color);
    const r = document.documentElement.style;
    r.setProperty('--tc-band', css(toward(base, [0, 0, 0], [255, 255, 255], 4.5)));
    r.setProperty('--tc-on', '#fff');
    r.setProperty('--tc-text', css(toward(base, dark ? [255, 255, 255] : [0, 0, 0], bg, 3.2)));
    onRepaint.forEach(f => f());
  }
  function paintTeam(meta, repaint) {
    painted = meta;
    if (repaint) onRepaint.push(repaint);
    apply();
  }
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function tip(el, card, x, y, html) {
    const b = card.getBoundingClientRect();
    el.innerHTML = html; el.style.left = (x - b.left) + 'px'; el.style.top = (y - b.top) + 'px'; el.style.opacity = 1;
  }

  window.CFB = { fmt, pct, ord, paintTeam, tip };
})();
