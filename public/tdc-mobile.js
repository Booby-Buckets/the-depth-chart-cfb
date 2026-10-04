/* tdc-mobile.js — one type system on phones (≤ 640px). Football copy of the basketball site's
 * tdc-mobile.js (loaded by app/layout.tsx); keep the two in step.
 *
 * The site's pages were written one at a time and carry ~17 font sizes, 5 families and 5 weights
 * each. On a phone that reads as messy. Rather than hand-editing ~80 pages, this snaps every piece of
 * text to the same small set as it renders (and as pages redraw, via a MutationObserver):
 *
 *   sizes    11 · 13 · 15 · 18 · 22 · 28 · 36   (nothing under 11px; a page's biggest hero numbers cap at 36)
 *   family   Inter everywhere; Playfair only for page titles and section headings (≥ 18px, not numbers)
 *   weight   500 · 600 · 700
 *   labels   UPPERCASE text gets one letter-spacing (.05em)
 *   inputs   16px (iOS zooms the page on any smaller form field)
 *
 * Desktop is untouched. Add data-type-keep to any element (and its subtree) to opt out.
 */
(function () {
  'use strict';
  if (window.__tdcMobile) return; window.__tdcMobile = 1;
  const mq = window.matchMedia('(max-width: 640px)');
  const SIZES = [11, 13, 15, 18, 22, 28, 36];
  const snapSize = s => s <= 11.75 ? 11 : s <= 14 ? 13 : s <= 16.5 ? 15 : s <= 20 ? 18 : s <= 25 ? 22 : s <= 32 ? 28 : 36;
  const snapWeight = w => (w <= 550 ? 500 : w <= 650 ? 600 : 700);
  const NUMERIC = /^[\s\d.,%+\-–—:/#()×x·]+$/;
  const SERIF = /playfair|georgia|serif$/i;
  const HEADING = /^H[1-3]$/;
  const done = new WeakSet();

  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
  }
  function fix(el) {
    if (done.has(el)) return;
    done.add(el);
    if (el.closest('svg,[data-type-keep],.tdn-wrap,.nav-wrap,canvas,code,pre')) return;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      el.style.setProperty('font-size', '16px', 'important');
      el.style.setProperty('font-family', "'Inter', system-ui, sans-serif", 'important');
      return;
    }
    if (el.classList && el.classList.contains('sheet-wrap')) flattenTable(el);
    if (!hasOwnText(el)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const size = parseFloat(cs.fontSize) || 15;
    const to = snapSize(size);
    if (Math.abs(to - size) > 0.2) el.style.setProperty('font-size', to + 'px', 'important');
    const w = parseInt(cs.fontWeight, 10) || 400;
    const tw = snapWeight(w);
    if (tw !== w && w >= 450) el.style.setProperty('font-weight', String(tw), 'important');
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const text = el.textContent.trim();
    const isSerif = SERIF.test(fam) || fam.includes('playfair');
    const keepSerif = isSerif && to >= 18 && !NUMERIC.test(text) && (HEADING.test(tag) || to >= 22);
    if (!keepSerif && fam !== 'inter') {
      el.style.setProperty('font-family', "'Inter', system-ui, sans-serif", 'important');
      if (NUMERIC.test(text)) el.style.setProperty('font-variant-numeric', 'tabular-nums', 'important');
    }
    if (cs.textTransform === 'uppercase') el.style.setProperty('letter-spacing', '.05em', 'important');
  }
  // A bordered table box inside a padded, bordered card reads as box-in-a-box on a phone and costs the
  // table ~30px of width: run it edge to edge inside the card instead (top/bottom rules stay).
  function boxed(e) {
    const c = getComputedStyle(e);
    return parseFloat(c.borderLeftWidth) > 0 && parseFloat(c.borderRightWidth) > 0 && parseFloat(c.paddingLeft) >= 8;
  }
  function flattenTable(el) {
    let p = el.parentElement;
    for (let i = 0; p && p !== document.body && i < 6; i++, p = p.parentElement) {
      if (boxed(p)) {
        const cs = getComputedStyle(p), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
        el.style.setProperty('margin-left', -pl + 'px', 'important');
        el.style.setProperty('margin-right', -pr + 'px', 'important');
        el.style.setProperty('border-left-width', '0', 'important');
        el.style.setProperty('border-right-width', '0', 'important');
        el.style.setProperty('border-radius', '0', 'important');
        return;
      }
    }
  }
  function walk(root) {
    if (root.nodeType !== 1) return;
    fix(root);
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) fix(all[i]);
  }

  let pending = [], raf = 0;
  function flush() {
    raf = 0;
    const list = pending; pending = [];
    for (const n of list) if (n.isConnected) walk(n);
  }
  function start() {
    if (!mq.matches) return;
    document.documentElement.classList.add('tdc-m');
    walk(document.body);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => { if (n.nodeType === 1) pending.push(n); });
          // new text inside an element we already styled (innerHTML / textContent rewrites): style it again
          if (m.target && m.target.nodeType === 1 && [...m.addedNodes].some(n => n.nodeType === 3)) { done.delete(m.target); pending.push(m.target); }
        }
        else if (m.target && m.target.parentElement) { done.delete(m.target.parentElement); pending.push(m.target.parentElement); }
      }
      // a short timer, not requestAnimationFrame: rAF is paused in background tabs, which left pages
      // opened in a new tab unstyled until they were looked at
      if (pending.length && !raf) raf = setTimeout(flush, 30);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
