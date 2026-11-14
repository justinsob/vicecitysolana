// Scroll-driven camera flight through an original, procedurally built neon city.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const root = document.documentElement;
if (root.classList.contains('has3d')) {
  init().catch(err => { console.error(err); root.classList.remove('has3d'); });
}

async function init() {
  THREE.ColorManagement.enabled = false;
  const canvas = document.getElementById('city');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const small = Math.min(innerWidth, innerHeight) < 700;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.5));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb03a78, 0.0017);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 5000);

  const U = { // shared uniforms
    uTime: { value: 0 }, uNight: { value: 0 },
    uFog: { value: new THREE.Color(0xb03a78) }, uFogD: { value: 0.0017 }
  };

  // seeded random so the city is the same on every visit
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------- sky ---------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        varying vec3 vD; uniform float uNight;
        void main(){
          vec3 d = normalize(vD); float h = max(d.y, 0.);
          vec3 day = mix(vec3(1.,.72,.36), vec3(.95,.33,.48), smoothstep(0.,.10,h));
          day = mix(day, vec3(.42,.12,.50), smoothstep(.08,.30,h));
          day = mix(day, vec3(.09,.04,.22), smoothstep(.28,.75,h));
          vec3 night = mix(vec3(.30,.09,.42), vec3(.05,.03,.14), smoothstep(0.,.22,h));
          night = mix(night, vec3(.012,.008,.04), smoothstep(.2,.7,h));
          vec3 col = mix(day, night, uNight);
          vec3 sd = normalize(vec3(0., .11 - uNight*.30, -1.));
          float dist = distance(d, sd);
          float yy = (d.y - sd.y)/.17;
          float stripes = yy < .2 ? step(.32 + (.2-yy)*.28, fract(yy*8.)) : 1.;
          float disc = smoothstep(.172,.166,dist)*stripes;
          vec3 sun = mix(vec3(1.,.25,.6), vec3(1.,.86,.45), smoothstep(-1.,1.,yy));
          col = mix(col, sun, disc);
          col += vec3(1.,.45,.25)*exp(-dist*5.)*.35*(1.-uNight);
          gl_FragColor = vec4(col,1.);
        }`
    })
  );
  scene.add(sky);

  const starPos = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.9, r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * r * 2500, y * 2500, Math.sin(a) * r * 2500);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(stars);

  /* ---------- ground, road, beach, water ---------- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: `varying vec3 vW;
        void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec3 vW;
        uniform float uTime, uNight, uFogD; uniform vec3 uFog;
        void main(){
          float x = vW.x, z = vW.z, ax = abs(x); vec3 col; float vDist = distance(vW, cameraPosition);
          float shore = 120. + sin(x*.045 + uTime*.5)*1.6 + sin(uTime*.9)*1.8;
          if (z > shore) {
            col = mix(vec3(.13,.05,.26), vec3(.02,.02,.08), uNight);
            float w = sin(z*.33 - uTime*1.3 + sin(x*.07 + uTime*.35)*2.2)*.5 + .5;
            float band = smoothstep(26. + (z-120.)*.22, 0., ax);
            col += vec3(1.,.55,.28)*pow(w,5.)*band*(1.-uNight);
            col += vec3(1.,.3,.7)*pow(w,9.)*.10;
            col += vec3(1.,.86,.9)*smoothstep(2.4,0.,z-shore)*.6;
          } else if (z > 78.) {
            col = mix(vec3(.44,.25,.27), vec3(.08,.05,.12), uNight);
            col *= mix(.55, 1., smoothstep(0., 7., shore - z));
            col *= .92 + .08*sin(x*1.7)*sin(z*2.3);
          } else {
            col = vec3(.035,.02,.075);
            if (ax < 14.) {
              col = vec3(.06,.04,.11);
              float dash = step(.5, fract(z/8.));
              col += vec3(1.,.78,.3)*(smoothstep(.22,.08,abs(ax-.35)));
              col += vec3(.75)*smoothstep(.16,.05,abs(ax-4.6))*dash*.7;
              col += vec3(1.,.24,.65)*smoothstep(.35,.1,abs(ax-9.2))*1.1;
            }
            float gx = (.5 - abs(fract((ax-14.)/32.) - .5))*32.;
            float gz = (.5 - abs(fract(z/32.) - .5))*32.;
            float l = ax < 13. ? gz + 99. : min(gx, gz);
            col += vec3(1.,.24,.65)*smoothstep(.55,.1,l)*.55;
            col += vec3(.18,.9,.9)*smoothstep(2.6,.0,l)*.05;
          }
          float f = 1. - exp(-pow(vDist*uFogD, 2.));
          gl_FragColor = vec4(mix(col, uFog, f), 1.);
        }`
    })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* ---------- buildings (one instanced draw call) ---------- */
  const blds = [];
  for (let k = 1; k >= -26; k--) {
    const z = 16 + 32 * k;
    const dt = Math.exp(-Math.pow((z + 440) / 210, 2));
    for (const side of [-1, 1]) for (let c = 0; c < 8; c++) {
      const x = side * (30 + 32 * c);
      if (side < 0 && c < 2 && z <= -270 && z >= -340) continue; // Wasted Plaza
      let h = z > -60 ? 6 + rnd() * 11 : 9 + rnd() * 15 + dt * (38 + rnd() * 105);
      if (c === 0) h *= 0.8;
      if (rnd() < 0.07) h *= 1.4;
      h = Math.min(h, 150);
      blds.push({ x: x + (rnd() - .5) * 3, z: z + (rnd() - .5) * 3, w: 19 + rnd() * 8, d: 19 + rnd() * 8, h });
    }
  }
  const bMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `
      varying vec3 vP; varying vec3 vN; varying vec3 vHalf; varying float vSeed; varying float vDist;
      void main(){
        vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vP = position*s; vN = normal; vHalf = s*.5;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233)))*43758.5453);
        vec4 mv = modelViewMatrix*instanceMatrix*vec4(position,1.);
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      varying vec3 vP; varying vec3 vN; varying vec3 vHalf; varying float vSeed; varying float vDist;
      uniform float uNight, uFogD; uniform vec3 uFog;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      vec3 pal(float s){ return s < .4 ? vec3(1.,.24,.65) : s < .75 ? vec3(.18,.9,.9) : vec3(1.,.72,.3); }
      void main(){
        vec3 neon = pal(vSeed); vec3 col;
        float y01 = (vP.y + vHalf.y)/(2.*vHalf.y);
        if (vN.y > .5) {
          float e = min(vHalf.x - abs(vP.x), vHalf.z - abs(vP.z));
          col = mix(vec3(.03,.015,.07), neon, smoothstep(.8,.3,e));
        } else {
          bool sx = abs(vN.x) > .5;
          float u = sx ? vP.z : vP.x; float hu = sx ? vHalf.z : vHalf.x;
          vec2 g = vec2((u + hu)/1.9, (vP.y + vHalf.y)/2.7);
          vec2 c = floor(g); vec2 f = fract(g);
          float win = step(.18,f.x)*step(f.x,.82)*step(.3,f.y)*step(f.y,.85);
          float r = hash(c + vSeed*91.7 + (sx ? 17. : 0.));
          float lit = step(mix(.74,.40,uNight), r);
          vec3 wall = mix(vec3(.05,.02,.11), vec3(.15,.055,.21), y01);
          vec3 wc = mix(vec3(1.,.80,.48), neon, step(.62, hash(c.yx + vSeed*13.)));
          col = mix(wall, wc*(.75 + .35*r), win*lit);
          col += win*(1.-lit)*vec3(.03,.02,.06);
          if (fract(vSeed*7.) > .35) col = mix(col, neon, step(vHalf.y - .55, vP.y));
        }
        float f = 1. - exp(-pow(vDist*uFogD, 2.));
        gl_FragColor = vec4(mix(col, uFog, f), 1.);
      }`
  });
  const bMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bMat, blds.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  blds.forEach((b, i) => { m4.compose(v3.set(b.x, b.h / 2, b.z), q, s3.set(b.w, b.h, b.d)); bMesh.setMatrixAt(i, m4); });
  bMesh.frustumCulled = false;
  scene.add(bMesh);

  /* ---------- palms ---------- */
  function palmGeometry() {
    const pos = [];
    const trunk = new THREE.CylinderGeometry(.22, .38, 10, 5, 1).toNonIndexed(); trunk.translate(0, 5, 0);
    pos.push(...trunk.attributes.position.array);
    const N = 9, SEG = 5, L = 5.5;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2 + (i % 2) * .2, ca = Math.cos(a), sa = Math.sin(a), droop = .9 + (i % 3) * .25;
      let prev = null;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG, r = t * L, y = 10 + t * 1.2 - droop * t * t * 3.2, w = (1 - t * .85) * .55;
        const A = [ca * r - sa * w, y, sa * r + ca * w], B = [ca * r + sa * w, y, sa * r - ca * w];
        if (prev) pos.push(...prev[0], ...prev[1], ...A, ...prev[1], ...B, ...A);
        prev = [A, B];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }
  const palmSpots = [];
  for (let z = 84; z > -250; z -= 22) for (const sx of [-1, 1]) palmSpots.push([sx * 11.6, z + rnd() * 6]);
  for (let x = -260; x <= 260; x += 17) if (Math.abs(x) > 26) palmSpots.push([x + rnd() * 6, 86 + rnd() * 18]);
  const palms = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshBasicMaterial({ color: 0x07030f, side: THREE.DoubleSide }), palmSpots.length);
  const e = new THREE.Euler();
  palmSpots.forEach(([x, z], i) => {
    const sc = .8 + rnd() * .6;
    m4.compose(v3.set(x, 0, z), q.setFromEuler(e.set((rnd() - .5) * .12, rnd() * 6.28, (rnd() - .5) * .12)), s3.set(sc, sc, sc));
    palms.setMatrixAt(i, m4);
  });
  palms.frustumCulled = false;
  scene.add(palms);
  q.identity();

  /* ---------- glow sprites: street lamps + traffic ---------- */
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gx = gc.getContext('2d'), grad = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.25, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = grad; gx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(gc);
  const glowMat = size => new THREE.PointsMaterial({ map: glowTex, size, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true, fog: false });

  const lp = [], lc = [];
  for (let z = 100, i = 0; z > -830; z -= 20, i++) for (const sx of [-1, 1]) {
    lp.push(sx * 10.4, 7, z);
    (i + (sx > 0 ? 1 : 0)) % 2 ? lc.push(1, .3, .7) : lc.push(.25, .9, .95);
  }
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lampGeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  scene.add(new THREE.Points(lampGeo, glowMat(7)));

  const CARS = 70, cars = [], cp = new Float32Array(CARS * 6), cc = new Float32Array(CARS * 6);
  for (let i = 0; i < CARS; i++) {
    const toward = i % 2 === 0; // toward the camera start = headlights
    const lane = (toward ? -1 : 1) * (rnd() < .5 ? 2.4 : 6.6);
    cars.push({ x: lane, z: 60 - rnd() * 880, v: (toward ? 1 : -1) * (26 + rnd() * 30) });
    const col = toward ? [1, .93, .7] : [1, .12, .16];
    cc.set([...col, ...col], i * 6);
  }
  const carGeo = new THREE.BufferGeometry();
  carGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  carGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const carPts = new THREE.Points(carGeo, glowMat(3.2)); carPts.frustumCulled = false;
  scene.add(carPts);

  /* ---------- neon signs ---------- */
  await Promise.all([document.fonts.load('100px "Mr Dafoe"'), document.fonts.load('100px Anton')]).catch(() => {});
  function signCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function neonText(ctx, text, x, y, font, color, blur = 28) {
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.fillText(text, x, y);
    ctx.shadowBlur = 6; ctx.fillStyle = '#fff'; ctx.globalAlpha = .75; ctx.fillText(text, x, y); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  function frame(ctx, w, h, color) {
    ctx.fillStyle = 'rgba(8,4,18,.92)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.shadowColor = color; ctx.shadowBlur = 24;
    ctx.strokeRect(14, 14, w - 28, h - 28); ctx.shadowBlur = 0;
  }
  const dark = new THREE.MeshBasicMaterial({ color: 0x07030f });
  function board(canvas, W, H, x, y, z, ry = 0) {
    const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    return tex;
  }
  function gantry(z, y, W, H, draw) {
    const c = signCanvas(1024, Math.round(1024 * H / W)); draw(c.getContext('2d'), c.width, c.height);
    board(c, W, H, 0, y, z);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.6, y + H / 2, .6), dark); p.position.set(sx * (W / 2 + .3), (y + H / 2) / 2, z); scene.add(p); }
  }
  gantry(40, 16, 26, 8, (c, w, h) => { frame(c, w, h, '#2ee6e6'); neonText(c, 'WELCOME TO', w / 2, h * .22, '54px Anton', '#2ee6e6', 16); neonText(c, 'Vice City', w / 2, h * .62, '170px "Mr Dafoe"', '#ff3ea5'); });
  gantry(-110, 18, 26, 6, (c, w, h) => { frame(c, w, h, '#ff3ea5'); neonText(c, '$VICECITY', w / 2, h * .54, '150px Anton', '#2ee6e6'); });
  gantry(-215, 19, 26, 6, (c, w, h) => { frame(c, w, h, '#ffd166'); neonText(c, '← $WASTED PLAZA', w / 2, h * .54, '120px Anton', '#ffd166'); });

  const blades = ['MOTEL', 'BAR', 'OPEN', '24H', 'DINER', 'CLUB', 'HODL', 'TAXI', 'SOL', 'PAWN', 'LIVE', 'DEX'];
  const bcol = ['#ff3ea5', '#2ee6e6', '#ffd166'];
  blades.forEach((t, i) => {
    const c = signCanvas(128, 512), x = c.getContext('2d'), col = bcol[i % 3];
    frame(x, 128, 512, col);
    const step = 440 / t.length;
    [...t].forEach((ch, j) => neonText(x, ch, 64, 40 + step * (j + .5), `${Math.min(92, step * .95)}px Anton`, col, 18));
    const sx = i % 2 ? 1 : -1;
    board(c, 2.6, 10.4, sx * 12.6, 9 + (i % 3) * 2, 55 - i * 23 - (i > 9 ? 40 : 0));
  });

  // the $WASTED billboard, with live numbers pulled from the page
  const bbC = signCanvas(1024, 340), bbX = bbC.getContext('2d');
  const BB = new THREE.Vector3(-40, 25, -330);
  const bbTex = board(bbC, 48, 16, BB.x, BB.y, BB.z, 0.62);
  for (const off of [-16, 16]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 18, 1), dark); p.position.set(BB.x + Math.cos(.62) * off, 9, BB.z - Math.sin(.62) * off); scene.add(p); }
  function drawBillboard() {
    const mc = document.getElementById('wMc')?.textContent || '–', ch = document.getElementById('w24')?.textContent || '';
    bbX.clearRect(0, 0, 1024, 340); frame(bbX, 1024, 340, '#ff3b30');
    neonText(bbX, 'THE CITY RUNS ON', 512, 62, '46px Anton', '#ffd166', 12);
    neonText(bbX, '$WASTED', 512, 178, '190px Anton', '#ff3b30', 34);
    neonText(bbX, mc === '–' ? 'PARENT COIN · ON-CHAIN PAIR' : `MC ${mc}  ·  24H ${ch}`, 512, 292, '44px Anton', '#ffffff', 10);
    bbTex.needsUpdate = true;
  }
  drawBillboard(); setInterval(drawBillboard, 5000);


  /* ---------- beach set: umbrellas, loungers, lifeguard huts, boats, birds, banner plane ---------- */
  const basic = c => new THREE.MeshBasicMaterial({ color: c });
  const add = (geo, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const umb = [], PAL = [0xff4fa8, 0x35d6d6, 0xffd166, 0xf3ecff];
  for (let x = -230; x <= 230; x += 9) {
    if (Math.abs(x) < 27) continue;
    for (const z of [88, 97, 106]) if (rnd() < .8) umb.push([x + rnd() * 4, z + rnd() * 3]);
  }
  const canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(2.3, .9, 10), new THREE.MeshBasicMaterial(), umb.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .06, 2.7, 4), basic(0x0c0616), umb.length);
  const beds = new THREE.InstancedMesh(new THREE.BoxGeometry(.75, .28, 2.1), basic(0x7a5570), umb.length * 2);
  const tint = new THREE.Color();
  umb.forEach(([x, z], i) => {
    m4.compose(v3.set(x, 3.0, z), q, s3.set(1, 1, 1)); canopy.setMatrixAt(i, m4);
    canopy.setColorAt(i, tint.setHex(PAL[i % 4]).multiplyScalar(.8));
    m4.compose(v3.set(x, 1.35, z), q, s3.set(1, 1, 1)); poles.setMatrixAt(i, m4);
    [-1, 1].forEach((o, j) => { m4.compose(v3.set(x + o * .9, .3, z + .4), q, s3.set(1, 1, 1)); beds.setMatrixAt(i * 2 + j, m4); });
  });
  canopy.instanceColor.needsUpdate = true;
  for (const m of [canopy, poles, beds]) { m.frustumCulled = false; scene.add(m); }

  [[-120, 0xff7ab8, 0x35d6d6], [-50, 0xffd166, 0xff4fa8], [54, 0x35d6d6, 0xffd166], [126, 0xf3ecff, 0xff4fa8]].forEach(([x, c1, c2]) => {
    const g = new THREE.Group(); g.position.set(x, 0, 112); scene.add(g);
    add(new THREE.BoxGeometry(3.2, 2.4, 3.2), basic(new THREE.Color(c1).multiplyScalar(.6)), 0, 4.2, 0, g);
    add(new THREE.BoxGeometry(4.2, .3, 4.2), basic(new THREE.Color(c2).multiplyScalar(.7)), 0, 5.55, 0, g);
    add(new THREE.BoxGeometry(4.3, .12, 4.3), basic(c2), 0, 5.3, 0, g);
    add(new THREE.BoxGeometry(4, .18, 4), dark, 0, 2.95, 0, g);
    for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) add(new THREE.BoxGeometry(.2, 3, .2), dark, lx, 1.5, lz, g);
  });

  const boats = [];
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, 0, 0, 9.4, 0, 3.6, 1.4, 0, 0, 2, 0, -2.6, 2, 0, 0, 8, 0], 3));
  [[-100, 170], [40, 186], [104, 152], [-18, 222]].forEach(([x, z], i) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rnd() * 6.28; scene.add(g);
    add(new THREE.BoxGeometry(7.5, 1.3, 2.3), basic(0x0a0414), 0, .5, 0, g);
    add(new THREE.BoxGeometry(2.6, .9, 1.6), basic(0x150a24), -1, 1.5, 0, g);
    add(new THREE.BoxGeometry(.14, 9.4, .14), basic(0x0a0414), 0, 5.3, 0, g);
    add(sailGeo, new THREE.MeshBasicMaterial({ color: 0x241038, side: THREE.DoubleSide }), 0, 0, 0, g);
    boats.push([g, i * 1.7]);
  });

  const BIRDS = 18, birdOff = [], birdArr = new Float32Array(BIRDS * 12);
  for (let i = 0; i < BIRDS; i++) birdOff.push([(rnd() - .5) * 34, (rnd() - .5) * 9, (rnd() - .5) * 26, rnd() * 6.28]);
  const birdGeo = new THREE.BufferGeometry(); birdGeo.setAttribute('position', new THREE.BufferAttribute(birdArr, 3));
  const birds = new THREE.LineSegments(birdGeo, new THREE.LineBasicMaterial({ color: 0x1a0a28, fog: false })); birds.frustumCulled = false;
  scene.add(birds);

  const plane = new THREE.Group(); plane.position.set(-450, 118, -80); scene.add(plane);
  add(new THREE.BoxGeometry(7, 1.1, 1.1), dark, 0, 0, 0, plane);
  add(new THREE.BoxGeometry(1.7, .16, 9.5), dark, .8, .2, 0, plane);
  add(new THREE.BoxGeometry(.9, 1.7, .14), dark, -3.2, .8, 0, plane);
  add(new THREE.BoxGeometry(12, .06, .06), dark, -9.5, 0, 0, plane);
  const banC = signCanvas(1024, 112), banX = banC.getContext('2d');
  banX.fillStyle = '#d6c4ae'; banX.fillRect(0, 0, 1024, 112);
  banX.font = '78px Anton'; banX.textAlign = 'center'; banX.textBaseline = 'middle'; banX.fillStyle = '#b3155a';
  banX.fillText('$VICECITY  ·  WASTED IN VICE CITY', 512, 60);
  add(new THREE.PlaneGeometry(64, 7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(banC), side: THREE.DoubleSide, fog: false }), -47.5, 0, 0, plane);

  /* ---------- hero car for the chase shot down the strip ---------- */
  const car = new THREE.Group(); scene.add(car);
  add(new THREE.BoxGeometry(2.1, .5, 4.5), basic(0xd81f7a), 0, .55, 0, car);
  add(new THREE.BoxGeometry(1.7, .42, 2.1), basic(0x120820), 0, 1.0, .25, car);
  add(new THREE.BoxGeometry(2.14, .12, 4.54), basic(0x35d6d6), 0, .3, 0, car);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(.62, .14, .06), basic(0xff2a2a), sx * .62, .62, 2.26, car);
  const under = add(new THREE.PlaneGeometry(4.2, 7), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff3ea5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 0, .06, 0, car);
  under.rotation.x = -Math.PI / 2;

  /* ---------- camera path ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const KF = [
    [V(0, 34, 260), V(0, 44, -400)],            // 0 hero
    [V(-60, 14, 175), V(-20, 6, 60)],           // 1 drop toward the beach
    [V(-70, 2.5, 126), V(-10, 10, 40)],         // 2 beach dolly, from the surf
    [V(-22, 3, 118), V(0, 10, 20)],             // 3 beach dolly end
    [V(-2, 7, 100), V(0, 10, -150)],            // 4 crane onto the boulevard
    [V(-3, 5, 70), V(0, 9, -150)],              // 5 #live
    [V(3, 6, -90), V(-10, 12, -260)],           // 6 chase down the strip
    [V(9, 13, -255), V(BB.x, BB.y - 1, BB.z)],  // 7 #wasted
    [V(-20, 4, -292), V(BB.x, BB.y + 3, BB.z)], // 8 #fumblers, low under the billboard
    [V(-4, 42, -335), V(0, 46, -560)],          // 9 #stats
    [V(0, 110, -410), V(0, 36, -640)],          // 10 #countdown
    [V(0, 175, -380), V(0, 0, -490)],           // 11 #buy
    [V(0, 250, -180), V(0, 0, -420)]            // 12 end
  ];
  const LAST = KF.length - 1;
  const posCurve = new THREE.CatmullRomCurve3(KF.map(k => k[0]), false, 'catmullrom', .5);
  const lookCurve = new THREE.CatmullRomCurve3(KF.map(k => k[1]), false, 'catmullrom', .5);

  const anchors = [['live', 5], ['wasted', 7], ['fumblers', 8], ['stats', 9], ['countdown', 10], ['buy', 11]];
  let stops = [];
  function measure() {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    stops = [[0, 0]];
    for (const [id, idx] of anchors) {
      const el = document.getElementById(id); if (!el) continue;
      const r = el.getBoundingClientRect(), top = r.top + scrollY;
      const s = Math.min(max - 1, Math.max(stops[stops.length - 1][0] + 1, top + Math.min(r.height, innerHeight) / 2 - innerHeight / 2));
      stops.push([s, idx]);
    }
    stops.push([max, LAST]);
  }
  const pin = parseFloat(new URLSearchParams(location.search).get('cam')); // ?cam=4 pins the camera for previewing a stop
  function idxFromScroll() {
    if (!isNaN(pin)) return pin;
    const y = scrollY;
    for (let i = 1; i < stops.length; i++) if (y <= stops[i][0]) {
      const [a, ia] = stops[i - 1], [b, ib] = stops[i];
      return ia + (ib - ia) * Math.max(0, (y - a) / (b - a));
    }
    return LAST;
  }

  /* ---------- post ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .55, .7, .78);
  composer.addPass(bloom);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.fov = w < h ? 74 : 60; camera.updateProjectionMatrix();
    measure();
  }
  addEventListener('resize', resize);
  new ResizeObserver(measure).observe(document.body);
  resize();

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', ev => { mouse.tx = ev.clientX / innerWidth - .5; mouse.ty = ev.clientY / innerHeight - .5; });

  /* ---------- HUD ---------- */
  const locEl = document.getElementById('loc'), rail = document.getElementById('railFill');
  const zones = [[.5, ''], [4.4, 'Sunset Beach'], [6.6, 'The Strip'], [8.6, 'Wasted Plaza'], [10.6, 'Downtown'], [99, 'After Dark']];
  let zone = '', zoneTimer;
  function setZone(name) {
    if (name === zone) return; zone = name;
    locEl.classList.remove('on'); clearTimeout(zoneTimer);
    if (!name) return;
    setTimeout(() => { locEl.textContent = name; locEl.classList.add('on'); }, 250);
    zoneTimer = setTimeout(() => locEl.classList.remove('on'), 3600);
  }

  /* ---------- loop ---------- */
  const fogDay = new THREE.Color(0xb03a78), fogNight = new THREE.Color(0x120a2c);
  const p = new THREE.Vector3(), l = new THREE.Vector3();
  let cur = idxFromScroll(), last = performance.now(), cineAt = 0;
  const panels = [...document.querySelectorAll('section > .wrap, .clip, footer')];
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    cur += (idxFromScroll() - cur) * (1 - Math.exp(-dt * 3.2));
    const u = Math.min(1, Math.max(0, cur / LAST));
    posCurve.getPoint(u, p); lookCurve.getPoint(u, l);
    mouse.x += (mouse.tx - mouse.x) * .05; mouse.y += (mouse.ty - mouse.y) * .05;
    p.y = Math.max(2.2, p.y) + Math.sin(t * .7) * .2;
    p.x += Math.sin(t * .45) * .3;
    camera.position.copy(p);
    const reach = p.distanceTo(l) * .12;
    camera.lookAt(l.x + mouse.x * reach, l.y - mouse.y * reach * .6, l.z);
    camera.rotateZ(-mouse.x * .03);

    const night = THREE.MathUtils.smoothstep(cur, 6.2, 9.6);
    U.uTime.value = t; U.uNight.value = night;
    U.uFog.value.copy(fogDay).lerp(fogNight, night);
    U.uFogD.value = THREE.MathUtils.lerp(.0013, .0010, night);
    scene.fog.color.copy(U.uFog.value); scene.fog.density = U.uFogD.value;
    stars.material.opacity = night * .9;
    bloom.strength = .5 + night * .35;

    for (let i = 0; i < CARS; i++) {
      const c = cars[i]; c.z += c.v * dt;
      if (c.z > 70) c.z -= 890; else if (c.z < -820) c.z += 890;
      cp.set([c.x - .7, .8, c.z, c.x + .7, .8, c.z], i * 6);
    }
    carGeo.attributes.position.needsUpdate = true;

    for (const [g, ph] of boats) { g.position.y = Math.sin(t * .9 + ph) * .25; g.rotation.z = Math.sin(t * .7 + ph) * .04; }
    const fx = Math.cos(t * .1) * 110, fy = 60 + Math.sin(t * .3) * 6, fz = 70 + Math.sin(t * .1) * 80;
    for (let i = 0; i < BIRDS; i++) {
      const [ox, oy, oz, ph] = birdOff[i], x = fx + ox, y = fy + oy, z = fz + oz, w = Math.sin(t * 7 + ph) * .9;
      birdArr.set([x, y, z, x - 2.2, y + w, z + .6, x, y, z, x + 2.2, y + w, z + .6], i * 12);
    }
    birdGeo.attributes.position.needsUpdate = true;
    plane.position.x = ((t * 14) % 1000) - 500;
    car.visible = cur > 3.6 && cur < 7.4;
    car.position.set(2.6 + Math.sin(t * .6) * .5, 0, Math.min(58, p.z - 20) - Math.max(0, cur - 6.4) * 260);

    if (now - cineAt > 160) {
      cineAt = now;
      const lo = innerHeight * .26, hi = innerHeight * .74;
      let covered = scrollY < 80;
      for (const el of panels) { const r = el.getBoundingClientRect(); if (r.top < hi && r.bottom > lo) { covered = true; break; } }
      root.classList.toggle('cine', !covered);
    }

    for (const [lim, name] of zones) if (cur < lim) { setZone(name); break; }
    if (rail) rail.style.transform = `scaleY(${u})`;
    composer.render();
  }
  requestAnimationFrame(tick);
}
