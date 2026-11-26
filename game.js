/* ============================================================================
   SKY COURIER — Island Mail Run
   A sunset arcade flight game for make.fun's "Make the best flight game".
   Built with PixiJS (rendering + particles), matter-js (collision) and
   anime.js (DOM UI animation). Everything here is drawn in code — no
   image assets — so the whole game ships as a few text files.
   Fly the mail plane across a tropical archipelago: thread golden rings,
   catch parcels, dodge storm clouds, birds and balloons, and land on
   every island strip. Three legs, three lives, one sunset.
   ============================================================================ */
'use strict';

/* ---------- constants ---------- */
const W = 1280, H = 720;
const OCEAN_Y = 648;            // waterline
const PLANE_X = 330;            // plane's fixed screen x
const BASE_SPEED = 3.4;         // px per frame at 60fps
const BOOST_SPEED = 5.6;
const LEG_LENGTH = 12000;       // px per leg
const LEGS = 3;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';        // title | flight | storm | landing
const AUTOPLAY = params.get('autoplay') === '1';

/* ---------- tiny utils ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);

/* ---------- audio: tiny WebAudio synth, no files ---------- */
const AudioSys = {
  ctx: null, muted: false, hum: null, humGain: null,
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = 52;
        g.gain.value = 0.0; o.connect(g); g.connect(this.ctx.destination); o.start();
        this.hum = o; this.humGain = g;
      } catch (e) { /* audio unavailable: stay silent */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ring()  { this.tone(880, 0.16, 'sine', 0.14); setTimeout(() => this.tone(1318, 0.22, 'sine', 0.12), 70); },
  parcel(){ this.tone(523, 0.1, 'triangle', 0.14); setTimeout(() => this.tone(784, 0.14, 'triangle', 0.12), 60); },
  crash() { this.tone(160, 0.35, 'sawtooth', 0.2, 40); },
  land()  { this.tone(392, 0.18, 'sine', 0.12); setTimeout(() => this.tone(587, 0.26, 'sine', 0.12), 120); },
  setHum(on, speedNorm) {
    if (!this.ctx || !this.humGain) return;
    const target = (on && !this.muted) ? 0.02 + 0.02 * speedNorm : 0.0;
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    if (this.hum) this.hum.frequency.setTargetAtTime(48 + 30 * speedNorm, this.ctx.currentTime, 0.1);
  },
};

/* ---------- game state ---------- */
const G = {
  state: 'title',        // title | playing | legdone | over | win
  leg: 1, score: 0, combo: 0, bestCombo: 0,
  parcels: 0, rings: 0, lives: 3, fuel: 100,
  distance: 0, legDistance: 0, speed: 0, boost: false,
  planeY: 330, planeVy: 0, pitch: 0,
  invuln: 0, time: 0, shake: 0, flash: 0,
  legStartAt: 0, legTime: 0, seed: 20261126,
  spawn: [], spawnIdx: 0, runway: null,
  pointerY: null, keys: {},
};

/* ---------- Pixi setup ---------- */
const app = new PIXI.Application();
let sky, ocean, sun, sunGlow, farLayer, midLayer, nearLayer, fxLayer, plane, prop, hud;
let planeBody = null, engine = null;
const obstacles = [];   // {sprite, body, kind, scored}
const particles = [];
const clouds = [];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return PIXI.Texture.from(c);
}

/* Sunset sky: indigo top -> magenta -> orange -> gold at the horizon. */
function makeSky() {
  const tex = canvasTexture(W, H, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, '#1b1445');
    grad.addColorStop(0.30, '#4b2a6e');
    grad.addColorStop(0.55, '#a83e6b');
    grad.addColorStop(0.72, '#ff7e5f');
    grad.addColorStop(0.86, '#feb47b');
    grad.addColorStop(1.00, '#ffd98a');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // faint stars up high
    const rnd = mulberry32(7);
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.55;
      g.fillStyle = '#fff';
      g.fillRect(rnd() * w, rnd() * h * 0.3, 1.6, 1.6);
    }
    g.globalAlpha = 1;
  });
  const s = new PIXI.Sprite(tex);
  app.stage.addChild(s);
  return s;
}

/* The sun: a warm disc with a soft halo, low over the sea. */
function makeSun() {
  const glowTex = canvasTexture(420, 420, (g, w, h) => {
    const grad = g.createRadialGradient(w/2, h/2, 10, w/2, h/2, w/2);
    grad.addColorStop(0, 'rgba(255, 214, 130, 0.85)');
    grad.addColorStop(0.35, 'rgba(255, 150, 80, 0.35)');
    grad.addColorStop(1, 'rgba(255, 120, 60, 0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  sunGlow = new PIXI.Sprite(glowTex);
  sunGlow.anchor.set(0.5); sunGlow.position.set(930, 560); sunGlow.alpha = 0.9;
  app.stage.addChild(sunGlow);
  const disc = new PIXI.Graphics();
  disc.circle(0, 0, 62).fill(0xffe9a8);
  disc.circle(0, 0, 52).fill(0xfff3c4);
  disc.position.set(930, 560);
  app.stage.addChild(disc);
  sun = disc;
}

/* Ocean: deep teal with a glittering sun-path and slow wave lines. */
function makeOcean() {
  const tex = canvasTexture(W, H - OCEAN_Y, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#e8865a');
    grad.addColorStop(0.25, '#7a4a6e');
    grad.addColorStop(0.6, '#1e3a5f');
    grad.addColorStop(1, '#0d2138');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const rnd = mulberry32(21);
    for (let i = 0; i < 130; i++) {           // sun glitter
      const x = 700 + (rnd() - 0.5) * 560 * (0.3 + rnd());
      const y = rnd() * h * 0.55;
      g.globalAlpha = 0.12 + rnd() * 0.4;
      g.fillStyle = '#ffd98a';
      g.fillRect(x, y, 14 + rnd() * 30, 2);
    }
    g.globalAlpha = 1;
  });
  ocean = new PIXI.Sprite(tex);
  ocean.position.set(0, OCEAN_Y);
  app.stage.addChild(ocean);
}

/* A soft cloud puff texture, reused for all clouds. */
let cloudTex;
function makeCloudTexture() {
  cloudTex = canvasTexture(220, 110, (g) => {
    const puff = (x, y, r, a) => {
      const grad = g.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, `rgba(255, 236, 220, ${a})`);
      grad.addColorStop(1, 'rgba(255, 236, 220, 0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    puff(60, 62, 42, 0.9); puff(105, 48, 52, 0.95); puff(155, 64, 44, 0.9);
    puff(90, 70, 46, 0.8); puff(140, 74, 40, 0.75);
  });
}

function spawnCloud(x, y, scale, alpha, speed, tint) {
  const s = new PIXI.Sprite(cloudTex);
  s.anchor.set(0.5); s.position.set(x, y);
  s.scale.set(scale); s.alpha = alpha;
  if (tint) s.tint = tint;
  farLayer.addChild(s);
  clouds.push({ s, speed });
  return s;
}

/* Islands: sand ellipse + palm cluster, baked to a texture per variant. */
function islandTexture(variant) {
  const rnd = mulberry32(100 + variant);
  const tex = canvasTexture(420, 150, (g, w, h) => {
    // sand
    g.fillStyle = '#e8c98a';
    g.beginPath(); g.ellipse(w/2, 108, 190, 34, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9b878';
    g.beginPath(); g.ellipse(w/2 - 40, 112, 120, 22, 0, 0, Math.PI * 2); g.fill();
    // green top
    g.fillStyle = variant === 2 ? '#2e7d5b' : '#3a9e6a';
    g.beginPath(); g.ellipse(w/2, 100, 165, 26, 0, Math.PI, 0); g.fill();
    // palms
    const palm = (x, y, s, lean) => {
      g.strokeStyle = '#6b4a2f'; g.lineWidth = 5 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 14, y - 34 * s, x + lean * 22, y - 52 * s); g.stroke();
      g.strokeStyle = '#2f8f5f'; g.lineWidth = 4 * s;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI * (0.15 + i * 0.17) + (lean > 0 ? 0.3 : -0.3);
        g.beginPath(); g.moveTo(x + lean * 22, y - 52 * s);
        g.quadraticCurveTo(
          x + lean * 22 + Math.cos(a) * 26 * s, y - 52 * s + Math.sin(a) * 20 * s,
          x + lean * 22 + Math.cos(a) * 40 * s, y - 52 * s + Math.sin(a) * 34 * s + 12 * s);
        g.stroke();
      }
      g.fillStyle = '#7a4a22';
      g.beginPath(); g.arc(x + lean * 22, y - 50 * s, 5 * s, 0, Math.PI * 2); g.fill();
    };
    palm(150 + rnd() * 40, 102, 1, rnd() > 0.5 ? 1 : -1);
    palm(250 + rnd() * 40, 100, 0.8, rnd() > 0.5 ? 1 : -1);
    if (variant === 1) { // lighthouse on variant 1
      g.fillStyle = '#fff'; g.fillRect(300, 52, 16, 48);
      g.fillStyle = '#e14b4b'; g.fillRect(300, 64, 16, 10); g.fillRect(300, 84, 16, 10);
      g.fillStyle = '#333'; g.fillRect(297, 44, 22, 10);
      g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(308, 49, 14, 0, Math.PI * 2); g.fill();
    }
    if (variant === 2) { // little hut on variant 2
      g.fillStyle = '#8a5a33'; g.fillRect(286, 76, 34, 24);
      g.fillStyle = '#c96f3f';
      g.beginPath(); g.moveTo(280, 78); g.lineTo(303, 58); g.lineTo(326, 78); g.closePath(); g.fill();
    }
  });
  return tex;
}

function addIsland(x, y, scale, variant, layer) {
  const s = new PIXI.Sprite(islandTexture(variant));
  s.anchor.set(0.5, 0.85); s.position.set(x, y); s.scale.set(scale);
  layer.addChild(s);
  return s;
}

/* ---------- the plane: "Nuri", the little orange mail plane ---------- */
function makePlane() {
  plane = new PIXI.Container();
  const body = new PIXI.Graphics();
  // pontoons
  body.roundRect(-34, 16, 46, 8, 4).fill(0x8a5a33);
  body.roundRect(6, 16, 46, 8, 4).fill(0x8a5a33);
  body.rect(-30, 8, 4, 10).fill(0x5d3a1f);
  body.rect(34, 8, 4, 10).fill(0x5d3a1f);
  // fuselage: warm cream with orange belly
  body.moveTo(-46, 0);
  body.quadraticCurveTo(-30, -16, 6, -14);
  body.quadraticCurveTo(40, -12, 52, -2);
  body.quadraticCurveTo(56, 4, 44, 8);
  body.quadraticCurveTo(10, 14, -30, 12);
  body.quadraticCurveTo(-48, 8, -46, 0);
  body.fill(0xfff3d6);
  body.moveTo(-44, 6);
  body.quadraticCurveTo(0, 12, 46, 4);
  body.quadraticCurveTo(10, 14, -30, 12);
  body.quadraticCurveTo(-46, 10, -44, 6);
  body.fill(0xff8c42);
  // cockpit windows
  body.circle(18, -8, 7).fill(0x9fd8ef);
  body.circle(30, -7, 6).fill(0x9fd8ef);
  body.circle(18, -8, 7).stroke({ width: 1.5, color: 0x2a4a5a });
  body.circle(30, -7, 6).stroke({ width: 1.5, color: 0x2a4a5a });
  // mail stripe + letter
  body.roundRect(-28, -4, 30, 7, 3).fill(0x2f6fb2);
  // tail
  body.moveTo(-44, -4); body.lineTo(-58, -22); body.lineTo(-46, -20); body.lineTo(-34, -8);
  body.closePath().fill(0xff8c42);
  body.moveTo(-44, 2); body.lineTo(-56, 12); body.lineTo(-40, 10); body.closePath().fill(0xe06e1e);
  // wing
  body.moveTo(-8, -6); body.lineTo(10, -26); body.lineTo(19, -24); body.lineTo(10, -2);
  body.closePath().fill(0xffb347);
  body.moveTo(-8, -6); body.lineTo(10, -26); body.lineTo(19, -24); body.lineTo(10, -2);
  body.closePath().stroke({ width: 1.5, color: 0xd97b1e });
  plane.addChild(body);
  // spinning propeller: a translucent blur disc + two thin blades
  prop = new PIXI.Container();
  const disc = new PIXI.Graphics();
  disc.circle(0, 0, 21).fill({ color: 0xdddddd, alpha: 0.14 });
  prop.addChild(disc);
  const blades = new PIXI.Graphics();
  blades.roundRect(-2.5, -20, 5, 40, 2.5).fill({ color: 0x3a2a1a, alpha: 0.75 });
  blades.roundRect(-20, -2.5, 40, 5, 2.5).fill({ color: 0x3a2a1a, alpha: 0.45 });
  prop.addChild(blades);
  const hub = new PIXI.Graphics();
  hub.circle(0, 0, 5).fill(0x888888);
  hub.circle(0, 0, 2.5).fill(0xcccccc);
  prop.addChild(hub);
  prop.position.set(54, -1);
  plane.addChild(prop);
  plane.position.set(PLANE_X, G.planeY);
  plane.scale.set(1.15);
  app.stage.addChild(plane);
}

/* ---------- obstacles & pickups (matter-js sensors) ---------- */
function ensurePhysics() {
  if (engine) return;
  engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
  planeBody = Matter.Bodies.circle(PLANE_X, G.planeY, 24, { isSensor: true, label: 'plane' });
  Matter.Composite.add(engine.world, planeBody);
  Matter.Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const other = a.label === 'plane' ? b : b.label === 'plane' ? a : null;
      if (other) onTouch(other.label, other);
    }
  });
}

function makeRing(x, y) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.circle(0, 0, 46).stroke({ width: 9, color: 0xffd34d });
  g.circle(0, 0, 46).stroke({ width: 3, color: 0xfff3c4 });
  g.circle(0, 0, 34).stroke({ width: 2, color: 0xffd34d, alpha: 0.5 });
  c.addChild(g);
  const star = new PIXI.Graphics();
  star.star(0, 0, 5, 12, 5).fill(0xffe9a8);
  c.addChild(star);
  c.position.set(x, y);
  nearLayer.addChild(c);
  const body = Matter.Bodies.circle(x, y, 44, { isSensor: true, label: 'ring' });
  Matter.Composite.add(engine.world, body);
  const ob = { sprite: c, body, kind: 'ring', scored: false, spin: 0 };
  body.plugin = { ob };
  obstacles.push(ob);
  return ob;
}

function makeParcel(x, y) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.roundRect(-15, -13, 30, 26, 4).fill(0xc98a4b);
  g.rect(-15, -3, 30, 6).fill(0x8a5a33);
  g.rect(-3, -13, 6, 26).fill(0x8a5a33);
  g.moveTo(-15, -13); g.lineTo(15, 13); g.moveTo(15, -13); g.lineTo(-15, 13);
  g.stroke({ width: 2, color: 0x6b4a2f });
  // little parachute
  g.moveTo(0, -13); g.lineTo(-14, -34); g.lineTo(14, -34); g.closePath().fill(0xff6b6b);
  g.circle(0, -34, 4).fill(0xfff3d6);
  c.addChild(g);
  c.position.set(x, y);
  nearLayer.addChild(c);
  const body = Matter.Bodies.circle(x, y, 24, { isSensor: true, label: 'parcel' });
  Matter.Composite.add(engine.world, body);
  const ob = { sprite: c, body, kind: 'parcel', scored: false, bob: Math.random() * 6 };
  body.plugin = { ob };
  obstacles.push(ob);
  return ob;
}

function makeStorm(x, y, r) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  const blob = (bx, by, br, col, a) => {
    g.circle(bx, by, br).fill({ color: col, alpha: a });
  };
  blob(-r * 0.5, 0, r * 0.55, 0x2c2340, 0.95);
  blob(0, -r * 0.25, r * 0.7, 0x3a2f52, 0.95);
  blob(r * 0.5, 0, r * 0.55, 0x241c38, 0.95);
  blob(0, r * 0.3, r * 0.6, 0x1d1830, 0.9);
  // lightning bolt
  g.moveTo(-6, 6); g.lineTo(4, 26); g.lineTo(-2, 26); g.lineTo(8, 48);
  g.stroke({ width: 4, color: 0xffe95e });
  c.addChild(g);
  c.position.set(x, y);
  nearLayer.addChild(c);
  const body = Matter.Bodies.circle(x, y, r * 0.85, { isSensor: true, label: 'storm' });
  Matter.Composite.add(engine.world, body);
  const ob = { sprite: c, body, kind: 'storm', scored: false, r };
  body.plugin = { ob };
  obstacles.push(ob);
  return ob;
}

function makeBird(x, y) {
  const g = new PIXI.Graphics();
  g.moveTo(-14, 0); g.quadraticCurveTo(-6, -10, 0, 0); g.quadraticCurveTo(6, -10, 14, 0);
  g.stroke({ width: 3, color: 0x2a2438, alpha: 0.9 });
  g.position.set(x, y);
  nearLayer.addChild(g);
  const body = Matter.Bodies.circle(x, y, 16, { isSensor: true, label: 'bird' });
  Matter.Composite.add(engine.world, body);
  const ob = { sprite: g, body, kind: 'bird', scored: false, flap: Math.random() * 6, baseY: y };
  body.plugin = { ob };
  obstacles.push(ob);
  return ob;
}

function makeBalloon(x, y) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.ellipse(0, -14, 20, 26).fill(0xe14b6b);
  g.ellipse(-6, -18, 10, 16).fill(0xff7e9c);
  g.moveTo(-8, 10); g.lineTo(8, 10); g.lineTo(0, 20); g.closePath().fill(0x8a5a33);
  g.rect(-6, 20, 12, 10).fill(0xc98a4b);
  c.addChild(g);
  c.position.set(x, y);
  nearLayer.addChild(c);
  const body = Matter.Bodies.circle(x, y - 8, 24, { isSensor: true, label: 'balloon' });
  Matter.Composite.add(engine.world, body);
  const ob = { sprite: c, body, kind: 'balloon', scored: false, baseY: y };
  body.plugin = { ob };
  obstacles.push(ob);
  return ob;
}

function makeRunway(x) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.fillStyle = '#e8c98a';
  g.beginPath(); g.ellipse(0, 0, 260, 26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a9e6a';
  g.beginPath(); g.ellipse(0, -4, 235, 20, 0, Math.PI, 0); g.fill();
  // runway strip
  g.roundRect(-200, -8, 400, 12, 4).fill(0x4a4a55);
  for (let i = -180; i < 190; i += 40) g.rect(i, -3, 20, 3).fill(0xffe9a8);
  // windsock
  g.rect(150, -52, 3, 48).fill(0xdddddd);
  g.moveTo(152, -52); g.lineTo(182, -46); g.lineTo(152, -40); g.closePath().fill(0xff6b6b);
  c.addChild(g);
  c.position.set(x, OCEAN_Y - 6);
  nearLayer.addChild(c);
  return c;
}

/* ---------- particles ---------- */
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const g = new PIXI.Graphics();
    const r = 2 + Math.random() * 4;
    g.circle(0, 0, r).fill(color);
    g.position.set(x, y);
    fxLayer.addChild(g);
    const a = Math.random() * Math.PI * 2;
    const v = (0.4 + Math.random() * 0.6) * speed;
    particles.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.02 + Math.random() * 0.03 });
  }
}
function contrail(x, y) {
  const g = new PIXI.Graphics();
  g.circle(0, 0, 3 + Math.random() * 2).fill({ color: 0xffffff, alpha: 0.5 });
  g.position.set(x, y);
  fxLayer.addChild(g);
  particles.push({ g, vx: -1.2, vy: 0.3, life: 0.6, decay: 0.02, grow: true });
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= p.decay;
    if (p.life <= 0) { fxLayer.removeChild(p.g); p.g.destroy(); particles.splice(i, 1); continue; }
    p.g.position.x += p.vx; p.g.position.y += p.vy;
    p.g.alpha = Math.min(1, p.life * 1.6);
    if (p.grow) p.g.scale.setScalar(1 + (1 - p.life) * 1.6);
  }
}

/* ---------- HUD (Pixi) ---------- */
function makeHud() {
  hud = new PIXI.Container();
  const bar = new PIXI.Graphics();
  bar.roundRect(0, 0, W, 54, 0).fill({ color: 0x120e2a, alpha: 0.42 });
  hud.addChild(bar);
  const style = { fontFamily: 'Trebuchet MS, sans-serif', fontSize: 26, fill: 0xffffff, fontWeight: 'bold' };
  hud.score = new PIXI.Text({ text: '0', style });
  hud.score.position.set(18, 10); hud.addChild(hud.score);
  hud.combo = new PIXI.Text({ text: '', style: { ...style, fontSize: 20, fill: 0xffd34d } });
  hud.combo.position.set(18, 34); hud.addChild(hud.combo);
  hud.leg = new PIXI.Text({ text: 'LEG 1/3', style: { ...style, fontSize: 20, fill: 0xffe9b0 } });
  hud.leg.anchor.set(0.5, 0); hud.leg.position.set(W / 2, 12); hud.addChild(hud.leg);
  hud.parcels = new PIXI.Text({ text: '✉ 0', style: { ...style, fontSize: 20, fill: 0xffd9a0 } });
  hud.parcels.anchor.set(0.5, 0); hud.parcels.position.set(W / 2, 34); hud.addChild(hud.parcels);
  // hearts
  hud.hearts = [];
  for (let i = 0; i < 3; i++) {
    const h = new PIXI.Graphics();
    h.moveTo(0, 6);
    h.bezierCurveTo(-12, -6, -6, -14, 0, -6);
    h.bezierCurveTo(6, -14, 12, -6, 0, 6);
    h.fill(0xff5e7a);
    h.position.set(W - 260 + i * 30, 26);
    hud.addChild(h); hud.hearts.push(h);
  }
  // fuel gauge
  hud.fuelBg = new PIXI.Graphics();
  hud.fuelBg.roundRect(0, 0, 150, 14, 7).fill({ color: 0x000000, alpha: 0.45 });
  hud.fuelBg.position.set(W - 180, 16);
  hud.addChild(hud.fuelBg);
  hud.fuel = new PIXI.Graphics();
  hud.fuel.position.set(W - 180, 16);
  hud.addChild(hud.fuel);
  const fuelLabel = new PIXI.Text({ text: 'FUEL', style: { fontFamily: 'Trebuchet MS, sans-serif', fontSize: 12, fill: 0xffe9b0, fontWeight: 'bold' } });
  fuelLabel.position.set(W - 180, 34); hud.addChild(fuelLabel);
  hud.speed = new PIXI.Text({ text: '', style: { ...style, fontSize: 15, fill: 0xcfc2f5 } });
  hud.speed.anchor.set(1, 0); hud.speed.position.set(W - 20, 48); hud.addChild(hud.speed);
  hud.visible = false;
  app.stage.addChild(hud);
}

let lastHud = {};
function updateHud() {
  if (!hud.visible) return;
  const s = {
    score: G.score, combo: G.combo, leg: G.leg, parcels: G.parcels,
    lives: G.lives, fuel: Math.round(G.fuel),
    speed: Math.round((G.boost ? BOOST_SPEED : BASE_SPEED) * 32),
  };
  if (s.score !== lastHud.score) hud.score.text = s.score.toLocaleString('en-US');
  if (s.combo !== lastHud.combo) hud.combo.text = s.combo > 1 ? `COMBO ×${Math.min(s.combo, 5)}` : '';
  if (s.leg !== lastHud.leg) hud.leg.text = `LEG ${s.leg}/3`;
  if (s.parcels !== lastHud.parcels) hud.parcels.text = `✉ ${s.parcels}`;
  if (s.lives !== lastHud.lives) hud.hearts.forEach((h, i) => { h.visible = i < s.lives; });
  if (s.fuel !== lastHud.fuel) {
    hud.fuel.clear();
    const w = 150 * clamp(s.fuel, 0, 100) / 100;
    const col = s.fuel > 35 ? 0x7ddc6a : s.fuel > 15 ? 0xffb347 : 0xff5e5e;
    if (w > 2) hud.fuel.roundRect(0, 0, w, 14, 7).fill(col);
  }
  if (s.speed !== lastHud.speed) hud.speed.text = `${s.speed} kn`;
  lastHud = s;
}

/* ---------- DOM helpers (anime.js) ---------- */
function showBanner(big, sub) {
  const b = $('banner');
  b.innerHTML = `<div class="big">${big}</div><div class="sub">${sub}</div>`;
  b.classList.remove('hidden');
  anime({ targets: '#banner', opacity: [0, 1], scale: [0.85, 1], duration: 450, easing: 'easeOutBack' });
  setTimeout(() => anime({
    targets: '#banner', opacity: 0, duration: 500, easing: 'easeInQuad',
    complete: () => b.classList.add('hidden'),
  }), 1900);
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  anime({ targets: '#toast', opacity: [0, 1], duration: 250, easing: 'easeOutQuad' });
  setTimeout(() => anime({ targets: '#toast', opacity: 0, duration: 400 }), 1500);
}

/* ---------- leg generation (seeded, so every leg is fair) ---------- */
function generateLeg(leg, seed) {
  const rnd = mulberry32(seed + leg * 7919);
  const table = [];
  let d = 500;
  let n = 0;
  while (d < LEG_LENGTH - 900) {
    n++;
    const roll = rnd();
    const y = 140 + rnd() * 420;
    if (roll < 0.52) table.push({ d, kind: 'ring', y });
    else if (roll < 0.66) table.push({ d, kind: 'parcel', y });
    else if (roll < 0.76 && leg > 1) table.push({ d, kind: 'balloon', y: 160 + rnd() * 300 });
    else if (roll < 0.86) table.push({ d, kind: 'bird', y: 180 + rnd() * 360 });
    else table.push({ d, kind: 'storm', y: 180 + rnd() * 340, r: 62 + rnd() * 26 });
    // a second ring nearby sometimes, for satisfying chains
    if (rnd() < 0.35) table.push({ d: d + 240 + rnd() * 120, kind: 'ring', y: clamp(y + (rnd() - 0.5) * 220, 130, 580) });
    d += 560 + rnd() * 300;
  }
  // extra storm walls on later legs
  if (leg >= 2) {
    for (let s = 0; s < leg; s++) {
      const sd = 3500 + s * 3200 + rnd() * 800;
      table.push({ d: sd, kind: 'storm', y: 220 + rnd() * 240, r: 78 });
      table.push({ d: sd + 190, kind: 'storm', y: 300 + rnd() * 200, r: 66 });
    }
  }
  // decorative islands along the way
  let id = 900;
  while (id < LEG_LENGTH) {
    table.push({ d: id, kind: 'island', y: OCEAN_Y + 6, variant: 1 + Math.floor(rnd() * 3), scale: 0.55 + rnd() * 0.5, par: 0.45 });
    id += 1600 + rnd() * 1400;
  }
  let nid = 1500;
  while (nid < LEG_LENGTH) {
    table.push({ d: nid, kind: 'island', y: OCEAN_Y + 2, variant: 1 + Math.floor(rnd() * 3), scale: 0.9 + rnd() * 0.4, par: 1 });
    nid += 2400 + rnd() * 1600;
  }
  table.push({ d: LEG_LENGTH + 260, kind: 'runway' });
  table.sort((a, b) => a.d - b.d);
  return table;
}

function spawnEntry(e) {
  const x = PLANE_X + (e.d - G.legDistance) * (e.par || 1);
  switch (e.kind) {
    case 'ring': { const ob = makeRing(x, e.y); ob.dist = e.d; break; }
    case 'parcel': { const ob = makeParcel(x, e.y); ob.dist = e.d; break; }
    case 'storm': { const ob = makeStorm(x, e.y, e.r || 70); ob.dist = e.d; break; }
    case 'bird': { const ob = makeBird(x, e.y); ob.dist = e.d; break; }
    case 'balloon': { const ob = makeBalloon(x, e.y); ob.dist = e.d; break; }
    case 'island': {
      const s = addIsland(x, e.y, e.scale, e.variant, e.par < 1 ? midLayer : nearLayer);
      if (e.par < 1) s.alpha = 0.92;
      decor.push({ sprite: s, dist: e.d, par: e.par });
      break;
    }
    case 'runway': {
      G.runway = { sprite: makeRunway(x), dist: e.d };
      break;
    }
  }
}

/* ---------- collisions ---------- */
function removeObstacle(ob) {
  ob.dead = true;
  if (ob.sprite && ob.sprite.parent) ob.sprite.parent.removeChild(ob.sprite);
  if (ob.body) Matter.Composite.remove(engine.world, ob.body);
}

function onTouch(label, body) {
  if (G.state !== 'playing' || SHOT) return;   // screenshots never score or crash
  const ob = body.plugin && body.plugin.ob;
  if (!ob || ob.scored) return;
  if (label === 'ring') {
    ob.scored = true;
    G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo); G.rings++;
    const mult = Math.min(G.combo, 5);
    G.score += 100 * mult;
    G.fuel = Math.min(100, G.fuel + 12);
    burst(body.position.x, body.position.y, 0xffd34d, 16, 4);
    AudioSys.ring();
    removeObstacle(ob);
  } else if (label === 'parcel') {
    ob.scored = true;
    G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo); G.parcels++;
    const mult = Math.min(G.combo, 5);
    G.score += 150 * mult;
    G.fuel = Math.min(100, G.fuel + 20);
    burst(body.position.x, body.position.y, 0xff9d45, 14, 3.5);
    AudioSys.parcel();
    toast('Parcel secured! +' + 150 * mult);
    removeObstacle(ob);
  } else if (label === 'storm' || label === 'bird' || label === 'balloon') {
    if (G.invuln > 0) return;
    crash();
    removeObstacle(ob);
  }
}

function crash() {
  G.lives--;
  G.combo = 0;
  G.invuln = 130;
  G.shake = 14;
  G.flash = 0.7;
  burst(PLANE_X, G.planeY, 0xff5e5e, 26, 6);
  burst(PLANE_X, G.planeY, 0x888888, 14, 3);
  AudioSys.crash();
  if (G.lives <= 0) { gameOver(false); return; }
  G.fuel = Math.max(G.fuel, 55);
  G.planeY = 300; G.planeVy = 0;
  toast(G.lives === 2 ? 'Careful! Two lives left.' : 'Last life, pilot!');
}

function waterCrash() {
  if (G.invuln > 0 || G.state !== 'playing') return;
  burst(PLANE_X, OCEAN_Y, 0x9fd8ef, 22, 5);
  crash();
}

/* ---------- flow ---------- */
const LEG_NAMES = ['Palau Atoll', 'Coral Strait', 'Golden Reach'];
function startGame() {
  AudioSys.ensure();
  $('title-screen').classList.add('hidden');
  $('end-screen').classList.add('hidden');
  G.state = 'playing';
  G.leg = 1; G.score = 0; G.combo = 0; G.bestCombo = 0;
  G.parcels = 0; G.rings = 0; G.lives = 3; G.fuel = 100;
  G.distance = 0; G.legDistance = 0; G.planeY = 330; G.planeVy = 0;
  G.spawn = generateLeg(1, G.seed); G.spawnIdx = 0;
  G.legStartAt = G.time;
  hud.visible = true;
  AudioSys.setHum(true, 0.4);
  showBanner('LEG 1', 'Deliver the mail — ' + LEG_NAMES[0]);
}

function legComplete() {
  const timeBonus = Math.max(0, 75 - Math.round(G.legTime)) * 10;
  const fuelBonus = Math.round(G.fuel) * 5;
  const bonus = 500 + timeBonus + fuelBonus;
  G.score += bonus;
  AudioSys.land();
  burst(PLANE_X, G.planeY, 0xffd34d, 30, 5);
  if (G.leg >= LEGS) { gameOver(true); return; }
  showBanner(`LEG ${G.leg} COMPLETE`, `Bonus +${bonus}  ·  next: ${LEG_NAMES[G.leg]}`);
  G.leg++;
  G.legDistance = 0;
  G.fuel = 100;
  G.spawn = generateLeg(G.leg, G.seed); G.spawnIdx = 0;
  G.legStartAt = G.time;
  G.state = 'playing';
  G.runway = null;
}

function gameOver(won) {
  G.state = won ? 'win' : 'over';
  AudioSys.setHum(false, 0);
  hud.visible = false;
  $('end-eyebrow').textContent = won ? 'ALL MAIL DELIVERED' : 'RUN OVER';
  $('end-title').textContent = won ? 'Mail delivered!' : 'The plane is down.';
  $('end-text').textContent = won
    ? 'Three islands, three landings, every parcel home before dark. The sunset salutes you, courier.'
    : 'The archipelago keeps its mail today. Patch her up and fly again — the sunset will wait.';
  $('end-stats').innerHTML =
    `<div><b>${G.score.toLocaleString('en-US')}</b><span>Score</span></div>` +
    `<div><b>${G.rings}</b><span>Rings</span></div>` +
    `<div><b>${G.parcels}</b><span>Parcels</span></div>` +
    `<div><b>×${Math.min(G.bestCombo, 5)}</b><span>Best combo</span></div>`;
  $('end-screen').classList.remove('hidden');
  anime({ targets: '#end-screen .panel', opacity: [0, 1], translateY: [24, 0], duration: 600, easing: 'easeOutCubic' });
}

function togglePause() {
  if (G.state !== 'playing' && G.state !== 'paused') return;
  if (G.state === 'playing') {
    G.state = 'paused';
    $('pause-screen').classList.remove('hidden');
    AudioSys.setHum(false, 0);
  } else {
    G.state = 'playing';
    $('pause-screen').classList.add('hidden');
    AudioSys.setHum(true, 0.4);
  }
}

/* ---------- input ---------- */
window.addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') { AudioSys.muted = !AudioSys.muted; toast(AudioSys.muted ? 'Sound off' : 'Sound on'); }
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { G.keys[e.code] = false; });
const stageEl = $('stage');
stageEl.addEventListener('pointerdown', (e) => { AudioSys.ensure(); setPointer(e); });
stageEl.addEventListener('pointermove', (e) => { if (e.buttons) setPointer(e); });
function setPointer(e) {
  const r = stageEl.getBoundingClientRect();
  G.pointerY = (e.clientY - r.top) * (H / r.height);
}

/* ---------- per-frame update ---------- */
let landTimer = 0;
function update() {
  G.time++;
  if (G.state === 'paused' || G.state === 'title' && !SHOT) {
    // title screen still drifts clouds behind the overlay
    driftClouds(0.3);
    return;
  }
  if (G.state === 'title' && SHOT) { driftClouds(0.3); return; }
  if (G.state === 'over' || G.state === 'win') { driftClouds(0.3); updateParticles(); return; }

  // Screenshot tableau (?shot=...): freeze the world so the capture is
  // deterministic — plane, clouds, particles and propeller keep moving,
  // but nothing scrolls, scores or crashes.
  if (SHOT && G.state === 'playing') {
    prop.rotation += 0.6;
    plane.rotation = SHOT === 'landing' ? -0.06 : 0.05;
    sunGlow.alpha = 0.85 + Math.sin(G.time * 0.01) * 0.08;
    driftClouds(0.3);
    if (SHOT === 'storm' && particles.length < 50 && G.time % 2 === 0) {
      const g = new PIXI.Graphics();
      g.rect(0, 0, 2, 26).fill({ color: 0xbfd8ff, alpha: 0.55 });
      g.position.set(80 + Math.random() * 1120, 60 + Math.random() * 500);
      fxLayer.addChild(g);
      particles.push({ g, vx: -2, vy: 14, life: 1, decay: 0.05 });
    }
    if (G.time % 3 === 0) contrail(PLANE_X - 52, G.planeY + 4);
    if (G.flash > 0) { G.flash = Math.max(0, G.flash - 0.01); flashRect.alpha = G.flash * 0.5; }
    updateParticles();
    updateHud();
    return;
  }

  const playing = G.state === 'playing';
  const speedTarget = playing ? (G.boost ? BOOST_SPEED : BASE_SPEED) : 0;
  G.speed = lerp(G.speed, speedTarget, 0.06);

  if (playing) {
    G.legDistance += G.speed;
    G.distance += G.speed;
    G.legTime = (G.time - G.legStartAt) / 60;
    // spawn ahead
    while (G.spawnIdx < G.spawn.length) {
      const e = G.spawn[G.spawnIdx];
      const ahead = 1100 / (e.par || 1);
      if (e.d <= G.legDistance + ahead) { spawnEntry(e); G.spawnIdx++; }
      else break;
    }
    // fuel
    G.fuel -= G.boost ? 0.045 : 0.02;
    if (G.fuel <= 0) { G.fuel = 0; waterCrash(); G.fuel = 55; }
    // steering
    let targetVy = 0;
    if (G.keys['ArrowUp'] || G.keys['KeyW']) targetVy = -4.4;
    else if (G.keys['ArrowDown'] || G.keys['KeyS']) targetVy = 4.4;
    else if (G.pointerY != null) targetVy = clamp((G.pointerY - G.planeY) * 0.06, -4.4, 4.4);
    else if (AUTOPLAY) targetVy = autoplaySteer();
    else targetVy = (330 - G.planeY) * 0.012;   // gentle auto-level
    G.boost = !!(G.keys['ShiftLeft'] || G.keys['ShiftRight'] || G.keys['Space']);
    G.planeVy = lerp(G.planeVy, targetVy, 0.12);
    G.planeY += G.planeVy;
    if (G.planeY < 70) { G.planeY = 70; G.planeVy = Math.max(0, G.planeVy); }
    if (G.planeY > OCEAN_Y - 12) waterCrash();
    G.pitch = clamp(G.planeVy * 0.055, -0.38, 0.38);
    // runway reached?
    if (G.runway) {
      const rx = PLANE_X + (G.runway.dist - G.legDistance);
      G.runway.sprite.position.x = rx;
      if (rx <= PLANE_X + 30) {
        G.state = 'legdone'; landTimer = 0;
        G.runway = null;
      }
    }
    // contrail + speed streaks
    if (G.time % 2 === 0) contrail(PLANE_X - 52, G.planeY + 4);
    if (G.boost && G.time % 3 === 0) contrail(PLANE_X - 60, G.planeY - 8);
    AudioSys.setHum(true, G.speed / BOOST_SPEED);
  }

  if (G.state === 'legdone') {
    landTimer++;
    G.speed = lerp(G.speed, 0, 0.05);
    G.legDistance += G.speed;
    G.planeY = lerp(G.planeY, OCEAN_Y - 34, 0.06);
    G.pitch = lerp(G.pitch, 0, 0.08);
    if (landTimer > 100) legComplete();
  }

  // move obstacles + decor with the world
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i];
    if (ob.dead) { obstacles.splice(i, 1); continue; }
    const x = PLANE_X + (ob.dist - G.legDistance);
    ob.sprite.position.x = x;
    Matter.Body.setPosition(ob.body, { x, y: ob.sprite.position.y });
    if (ob.kind === 'ring') { ob.sprite.rotation += 0.004; }
    if (ob.kind === 'parcel') { ob.sprite.position.y += Math.sin(G.time * 0.05 + ob.bob) * 0.35; }
    if (ob.kind === 'bird') {
      ob.sprite.position.y = ob.baseY + Math.sin(G.time * 0.08 + ob.flap) * 18;
      ob.sprite.scale.y = 1 + Math.sin(G.time * 0.5 + ob.flap) * 0.25;
    }
    if (ob.kind === 'balloon') { ob.sprite.position.y = ob.baseY + Math.sin(G.time * 0.03) * 10 - (G.time % 600) * 0.01; }
    if (ob.kind === 'storm' && Math.random() < 0.006) {
      G.flash = Math.max(G.flash, 0.35);   // distant lightning
    }
    if (x < -180) removeObstacle(ob);
  }
  // decor islands scroll
  for (let i = decor.length - 1; i >= 0; i--) {
    const d = decor[i];
    d.sprite.position.x = PLANE_X + (d.dist - G.legDistance) * d.par;
    if (d.sprite.position.x < -300) { d.sprite.parent.removeChild(d.sprite); decor.splice(i, 1); }
  }

  // physics step + collisions
  Matter.Body.setPosition(planeBody, { x: PLANE_X, y: G.planeY });
  Matter.Engine.update(engine, 1000 / 60);

  // plane visuals
  plane.position.set(PLANE_X, G.planeY);
  plane.rotation = G.pitch;
  prop.rotation += 0.55 + G.speed * 0.08;
  if (G.invuln > 0) { G.invuln--; plane.visible = Math.floor(G.time / 5) % 2 === 0; }
  else plane.visible = true;

  // sun shimmer + clouds
  sunGlow.alpha = 0.85 + Math.sin(G.time * 0.01) * 0.08;
  driftClouds(G.speed * 0.12 + 0.12);
  if (G.shake > 0) {
    G.shake *= 0.88;
    app.stage.position.set((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
  } else app.stage.position.set(0, 0);
  if (G.flash > 0) { G.flash = Math.max(0, G.flash - 0.03); flashRect.alpha = G.flash * 0.5; }
  else flashRect.alpha = 0;
  updateParticles();
  updateHud();
}

const decor = [];   // {sprite, dist, par}
function driftClouds(dx) {
  for (const c of clouds) {
    c.s.position.x -= dx * c.speed;
    if (c.s.position.x < -140) { c.s.position.x = W + 140; c.s.position.y = 40 + Math.random() * 320; }
  }
}

function autoplaySteer() {
  let best = null, bestX = 1e9;
  for (const ob of obstacles) {
    if (ob.dead || ob.scored) continue;
    if ((ob.kind === 'ring' || ob.kind === 'parcel') && ob.sprite.position.x > PLANE_X && ob.sprite.position.x < bestX) {
      best = ob; bestX = ob.sprite.position.x;
    }
  }
  let target = 330;
  if (best) {
    target = best.sprite.position.y;
    for (const ob of obstacles) {
      if (ob.dead || (ob.kind !== 'storm' && ob.kind !== 'bird')) continue;
      const dx = ob.sprite.position.x - PLANE_X;
      if (dx > 0 && dx < 220 && Math.abs(ob.sprite.position.y - target) < 90) {
        target = ob.sprite.position.y > target ? target - 130 : target + 130;
      }
    }
  }
  return clamp((target - G.planeY) * 0.08, -4.4, 4.4);
}

/* ---------- screenshot scenes (?shot=...) ---------- */
let flashRect;
function setupShot() {
  $('title-screen').classList.add('hidden');
  hud.visible = true;
  ensurePhysics();
  if (SHOT === 'title') {
    G.state = 'title';
    $('title-screen').classList.remove('hidden');
    hud.visible = false;
    const rw = makeRunway(PLANE_X - 40);
    rw.position.y = OCEAN_Y - 6;
    G.planeY = OCEAN_Y - 34;
    plane.position.set(PLANE_X, G.planeY);
    addIsland(1080, OCEAN_Y + 4, 0.8, 1, nearLayer);
    addIsland(180, OCEAN_Y + 8, 0.6, 2, midLayer);
  } else if (SHOT === 'flight' || SHOT === 'storm' || SHOT === 'landing') {
    G.state = 'playing';
    G.spawn = generateLeg(1, G.seed); G.spawnIdx = 0;
    G.legDistance = 1500;
    while (G.spawnIdx < G.spawn.length && G.spawn[G.spawnIdx].d <= G.legDistance + 1100) {
      spawnEntry(G.spawn[G.spawnIdx]); G.spawnIdx++;
    }
    if (SHOT === 'flight') {
      G.planeY = 300;
      const r = makeRing(640, 300); r.dist = G.legDistance + 310;
      const r2 = makeRing(880, 230); r2.dist = G.legDistance + 550;
      makeParcel(760, 420).dist = G.legDistance + 430;
    }
    if (SHOT === 'storm') {
      G.planeY = 330;
      makeStorm(620, 300, 84).dist = G.legDistance + 290;
      makeStorm(820, 420, 70).dist = G.legDistance + 490;
      makeStorm(1020, 240, 66).dist = G.legDistance + 690;
      makeBird(700, 180).dist = G.legDistance + 370;
      G.flash = 0.5;
      for (let i = 0; i < 40; i++) {
        const g = new PIXI.Graphics();
        g.rect(0, 0, 2, 26).fill({ color: 0xbfd8ff, alpha: 0.55 });
        g.position.set(80 + Math.random() * 1120, 60 + Math.random() * 500);
        fxLayer.addChild(g);
        particles.push({ g, vx: -2, vy: 14, life: 1, decay: 0.05 });
      }
    }
    if (SHOT === 'landing') {
      G.planeY = 250;
      G.runway = { sprite: makeRunway(760), dist: G.legDistance + 430 };
      G.score = 12450; G.parcels = 6; G.rings = 11; G.combo = 3; G.fuel = 62;
      addIsland(1120, OCEAN_Y + 4, 0.9, 2, nearLayer);
    }
  }
  plane.position.set(PLANE_X, G.planeY);
  setTimeout(() => { document.body.dataset.ready = '1'; }, 400);
}

/* ---------- boot ---------- */
async function boot() {
  await app.init({ width: W, height: H, background: 0x1b1445, antialias: true });
  $('game').appendChild(app.canvas);
  makeSky();
  makeSun();
  farLayer = new PIXI.Container(); app.stage.addChild(farLayer);
  makeOcean();
  midLayer = new PIXI.Container(); app.stage.addChild(midLayer);
  nearLayer = new PIXI.Container(); app.stage.addChild(nearLayer);
  makeCloudTexture();
  // drifting clouds
  const rnd = mulberry32(99);
  for (let i = 0; i < 11; i++) {
    spawnCloud(rnd() * W, 40 + rnd() * 330, 0.7 + rnd() * 1.1, 0.5 + rnd() * 0.4, 0.5 + rnd(), i % 3 === 0 ? 0xffd9c2 : 0xffffff);
  }
  // distant island silhouettes
  addIsland(240, OCEAN_Y + 10, 0.55, 3, farLayer).alpha = 0.85;
  addIsland(1050, OCEAN_Y + 12, 0.7, 1, farLayer).alpha = 0.9;
  fxLayer = new PIXI.Container(); app.stage.addChild(fxLayer);
  flashRect = new PIXI.Graphics();
  flashRect.rect(0, 0, W, H).fill(0xffffff);
  flashRect.alpha = 0;
  fxLayer.addChild(flashRect);
  makePlane();
  makeHud();
  ensurePhysics();

  $('btn-fly').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-again').addEventListener('click', () => {
    for (const ob of [...obstacles]) removeObstacle(ob);
    for (const d of [...decor]) { d.sprite.parent.removeChild(d.sprite); }
    decor.length = 0;
    if (G.runway) { G.runway.sprite.parent.removeChild(G.runway.sprite); G.runway = null; }
    startGame();
  });

  if (SHOT) setupShot();
  // Attract mode (?autoplay=1): start flying on its own, for testing and demos.
  if (AUTOPLAY && !SHOT) setTimeout(startGame, 800);
  app.ticker.add(update);
}
boot();
