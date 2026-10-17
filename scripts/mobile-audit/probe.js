// Probe DOM mobile (t_eebe4678) — dipakai browser_exec via js(<isi file>).
// Murni baca state; tidak mengubah DOM dan tidak menyentuh DB.
(() => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const aside = q('aside.app-sidebar');
  const asideOffscreen = aside ? aside.getBoundingClientRect().right <= 0 : false;

  const de = document.documentElement;
  const overflow = {
    innerWidth: window.innerWidth,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    horizontalOverflowPx: Math.max(0, de.scrollWidth - window.innerWidth)
  };

  // Elemen yang melewati tepi viewport, DIKECUALIKAN:
  //  - drawer off-canvas (by design) & backdrop
  //  - isi area scroll lokal bertanda (tabel lebar / BOQ) yang memang boleh scroll
  const wide = [];
  qa('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    if (asideOffscreen && aside && aside.contains(el)) return;
    if (el.classList.contains('mobile-backdrop')) return;
    if (el.closest('[data-scroll-local], .table, .boq-table-wrap')) return;
    if (r.right > window.innerWidth + 1 || r.left < -1) {
      wide.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 60),
        left: Math.round(r.left),
        right: Math.round(r.right),
        w: Math.round(r.width),
        pos: getComputedStyle(el).position
      });
    }
  });

  const small = [];
  qa('button, a[href], select, [role=button]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    if (asideOffscreen && aside && aside.contains(el)) return;
    if (r.width < 44 || r.height < 44) {
      small.push({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 50),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 28)
      });
    }
  });

  const smallFont = [];
  qa('input:not([type=checkbox]):not([type=radio]), select, textarea').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (asideOffscreen && aside && aside.contains(el)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) smallFont.push({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 44),
      fontSize: fs,
      ph: (el.placeholder || '').slice(0, 24)
    });
  });

  const bd = q('.mobile-backdrop');
  const btn = q('.mobile-menu-btn');
  const atBtn = (() => {
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el ? ((el.className || el.tagName) + '|' + el.tagName) : null;
  })();

  const drawer = {
    asideRect: rect(aside),
    asideClass: aside && aside.className,
    asideOffscreen,
    asideVisibility: aside && getComputedStyle(aside).visibility,
    asidePE: aside && getComputedStyle(aside).pointerEvents,
    asideAriaHidden: aside && aside.getAttribute('aria-hidden'),
    asideInert: aside && aside.hasAttribute('inert'),
    backdropMounted: !!bd,
    backdropDisplay: bd && getComputedStyle(bd).display,
    backdropRect: rect(bd),
    menuBtnRect: rect(btn),
    menuBtnAriaExpanded: btn && btn.getAttribute('aria-expanded'),
    elementAtMenuBtn: atBtn,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    offscreenFocusableNav: aside
      ? [...aside.querySelectorAll('button')].filter(b => b.tabIndex >= 0 && b.getBoundingClientRect().right <= 0).length
      : 0
  };

  return {
    page: (q('h1') || {}).innerText || null,
    overflow,
    wideCount: wide.length,
    wide: wide.slice(0, 10),
    smallCount: small.length,
    small: small.slice(0, 12),
    smallFontCount: smallFont.length,
    smallFont: smallFont.slice(0, 12),
    drawer,
    header: rect(q('.mobile-header')),
    hasModal: !!q('.modal'),
    modalRect: rect(q('.dialog'))
  };
})()
