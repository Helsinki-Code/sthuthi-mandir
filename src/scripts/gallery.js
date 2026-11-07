document.querySelectorAll('[data-gallery]').forEach((g) => {
  const track = g.querySelector('[data-track]');
  const thumbs = [...g.querySelectorAll('[data-thumb]')];
  const images = JSON.parse(g.querySelector('[data-gallery-json]').textContent);
  const slides = [...g.querySelectorAll('[data-slide]')];
  // Off-screen slides load when they come within one slide of view (after the page has loaded).
  const hydrate = (pic) => {
    if (!pic || pic.dataset.done) return;
    pic.querySelectorAll('source[data-srcset]').forEach((s) => { s.srcset = s.dataset.srcset; });
    const im = pic.querySelector('img[data-src]'); if (im) im.src = im.dataset.src;
    pic.dataset.done = '1';
  };
  const near = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { hydrate(e.target.querySelector('picture[data-defer]')); near.unobserve(e.target); } }),
    { root: track, rootMargin: '0px 100% 0px 100%' });
  const start = () => slides.forEach((s) => near.observe(s));
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
  const mark = (i) => thumbs.forEach((t) => t.setAttribute('aria-current', String(+t.dataset.thumb === i)));
  const go = (i) => (mark(i), track.scrollTo({ left: slides[i].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  thumbs.forEach((t) => t.addEventListener('click', () => go(+t.dataset.thumb)));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio > 0.6) thumbs.forEach((t) => t.setAttribute('aria-current', String(t.dataset.thumb === e.target.dataset.slide)));
  }), { root: track, threshold: [0.6] });
  slides.forEach((s) => io.observe(s));
  track.addEventListener('keydown', (e) => {
    const cur = Math.round(track.scrollLeft / track.clientWidth);
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.min(slides.length - 1, cur + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.max(0, cur - 1)); }
  });

  // Lightbox with zoom + pan
  const dlg = g.querySelector('[data-lightbox]');
  const stage = dlg.querySelector('[data-stage]');
  const img = dlg.querySelector('[data-lb-img]');
  const count = dlg.querySelector('[data-lb-count]');
  const cap = dlg.querySelector('[data-lb-caption]');
  let idx = 0, scale = 1, tx = 0, ty = 0, drag = null, opener = null;
  const render = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; stage.classList.toggle('zoomed', scale > 1); };
  const reset = () => { scale = 1; tx = 0; ty = 0; render(); };
  const show = (i) => {
    idx = (i + images.length) % images.length;
    const im = images[idx];
    img.src = im.src; img.alt = im.alt;
    count.textContent = `${idx + 1} / ${images.length}`;
    cap.textContent = `${im.kind === 'photo' ? '' : 'Visualisation · '}${im.alt}`;
    reset();
  };
  // transform-origin is 0 0: a client point (cx, cy) stays fixed while the scale changes.
  const zoomAt = (factor, cx, cy) => {
    const r = img.getBoundingClientRect();
    const bl = r.left - tx, bt = r.top - ty;
    const ns = Math.min(4, Math.max(1, scale * factor));
    if (ns === 1) { reset(); return; }
    const x = cx ?? r.left + r.width / 2, y = cy ?? r.top + r.height / 2;
    const u = (x - bl - tx) / scale, v = (y - bt - ty) / scale;
    tx = x - bl - u * ns; ty = y - bt - v * ns; scale = ns; render();
  };
  g.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { opener = b; show(+b.dataset.open); dlg.showModal(); }));
  dlg.querySelector('[data-lb-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { reset(); opener?.focus(); });
  dlg.querySelector('[data-lb-prev]')?.addEventListener('click', () => show(idx - 1));
  dlg.querySelector('[data-lb-next]')?.addEventListener('click', () => show(idx + 1));
  dlg.querySelector('[data-zoom-in]').addEventListener('click', () => zoomAt(1.6));
  dlg.querySelector('[data-zoom-out]').addEventListener('click', () => zoomAt(1 / 1.6));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === '+' || e.key === '=') zoomAt(1.6);
    if (e.key === '-') zoomAt(1 / 1.6);
  });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); }, { passive: false });
  let lastTap = 0, swipeX = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    swipeX = e.clientX;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (scale > 1) { tx = drag.tx + dx; ty = drag.ty + dy; render(); }
  });
  stage.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d) return;
    if (scale === 1 && d.moved && Math.abs(e.clientX - swipeX) > 50) { show(idx + (e.clientX < swipeX ? 1 : -1)); return; }
    if (!d.moved) {
      const now = Date.now();
      if (e.pointerType !== 'touch' || now - lastTap < 300) { scale > 1 ? reset() : zoomAt(2.2, e.clientX, e.clientY); }
      lastTap = now;
    }
  });
});
