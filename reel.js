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

  // Phones only decode a video after it has been played once, and iOS only allows that
  // from a muted inline video or a tap. So: try to start it right away, and again on the first touch.
  const touch = matchMedia('(pointer: coarse)').matches;
  function prime(v) {
    if (v._primed) return;
    const p = v.play();
    if (p) p.then(() => { v.pause(); v._primed = true; }).catch(() => {});
  }
  vids.forEach(v => {
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    const src = (innerWidth < 768 && v.dataset.srcMobile) || v.dataset.src;
    const use = url => { v.src = url; v.load(); prime(v); };
    // desktop: load the whole clip into memory so every frame seeks instantly on any host.
    // phones: stream the file directly, which mobile browsers handle more reliably than in-memory video.
    if (touch) use(src);
    else fetch(src).then(r => r.blob()).then(b => use(URL.createObjectURL(b))).catch(() => use(src));
    v.addEventListener('loadedmetadata', () => prime(v));
  });
  const kick = () => vids.forEach(prime);
  ['touchstart', 'touchend', 'click'].forEach(ev => addEventListener(ev, kick, { passive: true }));

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
      if (op > 0 && v.readyState >= 1 && v.duration) {
        const t = local * (v.duration - 0.08);
        // don't wait forever on a seek that a phone never reports as finished
        const busy = v.seeking && now - (v._seekAt || 0) < 400;
        if (!busy && Math.abs(v.currentTime - t) > 0.03) { v._seekAt = now; v.currentTime = t; }
      }
      const s = touch ? 1 + local * 0.03 : 1.05 + local * 0.04; // less zoom keeps the footage sharper
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
