// Scroll-scrubbed film background: scrolling moves the camera through each clip,
// and clips crossfade into each other at the scene boundaries.
(function () {
  const root = document.documentElement;
  const vids = [...document.querySelectorAll('#reel video')];
  if (!vids.length) return;

  // Where each scene starts, as the element whose top marks the cut. Scene 0 starts at the top of the page.
  const CUTS = [].slice(0, vids.length - 1);
  // location captions by progress through the whole walk
  const ZONES = [[0.05, ''], [0.34, 'Sunset Beach'], [0.67, 'The Strip'], [2, 'Downtown']];

  vids.forEach(v => {
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    // load the whole clip into memory so every frame can be seeked instantly, on any host
    const src = (innerWidth < 768 && v.dataset.srcMobile) || v.dataset.src;
    fetch(src).then(r => r.blob()).then(b => { v.src = URL.createObjectURL(b); }).catch(() => { v.src = src; });
    // prime the decoder so seeking works on phones
    v.addEventListener('loadeddata', () => { const p = v.play(); if (p) p.then(() => v.pause()).catch(() => {}); }, { once: true });
  });

  let bounds = [], max = 1;
  function measure() {
    max = Math.max(1, root.scrollHeight - innerHeight);
    const cuts = CUTS.map(id => {
      const el = document.getElementById(id);
      return el ? Math.min(max, Math.max(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.9)) : max;
    });
    bounds = [0, ...cuts, max];
  }
  addEventListener('resize', measure);
  new ResizeObserver(measure).observe(document.body);
  measure();

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', e => { mouse.tx = e.clientX / innerWidth - 0.5; mouse.ty = e.clientY / innerHeight - 0.5; });

  const locEl = document.getElementById('loc'), rail = document.getElementById('railFill');
  const panels = [...document.querySelectorAll('section > .wrap, footer')];
  let zone = '', zoneTimer, cineAt = 0;
  function setZone(name) {
    if (name === zone) return; zone = name;
    locEl.classList.remove('on'); clearTimeout(zoneTimer);
    if (!name) return;
    setTimeout(() => { locEl.textContent = name; locEl.classList.add('on'); }, 250);
    zoneTimer = setTimeout(() => locEl.classList.remove('on'), 3600);
  }

  let cur = scrollY, last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    cur += (scrollY - cur) * (1 - Math.exp(-dt * 5));
    mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
    const fade = innerHeight * 0.6;

    vids.forEach((v, i) => {
      const a = bounds[i], b = bounds[i + 1];
      const local = Math.min(1, Math.max(0, (cur - a) / Math.max(1, b - a)));
      // opacity: scene i fades in across its start cut; the first scene is the base layer
      const op = i === 0 ? 1 : Math.min(1, Math.max(0, (cur - (a - fade / 2)) / fade));
      v.style.opacity = op;
      if (op > 0 && v.readyState >= 2 && v.duration) {
        const t = local * (v.duration - 0.08);
        if (!v.seeking && Math.abs(v.currentTime - t) > 0.02) v.currentTime = t;
      }
      const s = 1.08 + local * 0.06;
      v.style.transform = `translate3d(${-mouse.x * 28}px, ${-mouse.y * 18}px, 0) scale(${s})`;
    });

    const prog = Math.min(1, cur / max);
    for (const [lim, name] of ZONES) if (prog < lim) { setZone(name); break; }
    if (rail) rail.style.transform = `scaleY(${Math.min(1, cur / max)})`;
    if (now - cineAt > 160) {
      cineAt = now;
      const lo = innerHeight * 0.26, hi = innerHeight * 0.74;
      let covered = scrollY < 80;
      for (const el of panels) { const r = el.getBoundingClientRect(); if (r.top < hi && r.bottom > lo) { covered = true; break; } }
      root.classList.toggle('cine', !covered);
    }
  }
  requestAnimationFrame(tick);
})();
