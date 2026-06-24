/* =========================================================================
   ZOMBIE APOL — juego top-down de oleadas
   HTML + CSS + JS puro, sin dependencias.
   ========================================================================= */

(() => {
  "use strict";

  // ----------------------------------------------------------------------
  //  Configuración general
  // ----------------------------------------------------------------------
  // VISTA (lienzo): se adapta a la ventana, alto fijo 720
  const VH = 720;
  const aspect = () => Math.min(3.0, Math.max(1.2, window.innerWidth / window.innerHeight));
  let VW = Math.round(VH * aspect());
  // MUNDO (región): grande, se explora con cámara (no cabe en pantalla)
  const W = 3200;            // ancho de región (mundo)
  const H = 1800;            // alto de región (mundo)
  const ZOOM = 1.8;          // acercamiento de la cámara
  let cam = { x: 0, y: 0 };
  const REGIONS_X = 4;       // tamaño del mapa en regiones (4x4 = 16 regiones)
  const REGIONS_Y = 4;
  const EDGE = 40;           // margen para detectar cambio de región
  const SCALE = 1.5;         // tamaño global de personajes/criaturas

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  canvas.width = VW; canvas.height = VH;

  // cámara: ventana del mundo centrada en el jugador (acotada a la región)
  function computeCam() {
    if (!player) return { x: 0, y: 0 };
    const vw = VW / ZOOM, vh = VH / ZOOM;
    return {
      x: clamp(player.x - vw / 2, 0, Math.max(0, W - vw)),
      y: clamp(player.y - vh / 2, 0, Math.max(0, H - vh)),
    };
  }
  // punto de aparición justo fuera de la vista (cerca del jugador), dentro de la región
  function spawnEdgePoint() {
    const rx = VW / ZOOM / 2 + 70, ry = VH / ZOOM / 2 + 70;
    const side = randInt(0, 3);
    let x, y;
    if (side === 0) { x = player.x + rand(-rx, rx); y = player.y - ry; }
    else if (side === 1) { x = player.x + rx; y = player.y + rand(-ry, ry); }
    else if (side === 2) { x = player.x + rand(-rx, rx); y = player.y + ry; }
    else { x = player.x - rx; y = player.y + rand(-ry, ry); }
    return { x: clamp(x, 24, W - 24), y: clamp(y, 24, H - 24) };
  }
  const overlay = document.getElementById("overlay");
  const overlayBody = document.getElementById("overlay-body");
  const startBtn = document.getElementById("start-btn");

  // ----------------------------------------------------------------------
  //  Utilidades
  // ----------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const lerp = (a, b, t) => a + (b - a) * t;
  function angLerp(a, b, t) {
    let d = ((b - a + Math.PI * 3) % TAU) - Math.PI;
    return a + d * t;
  }
  // RNG con semilla (para generar regiones deterministas)
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ----------------------------------------------------------------------
  //  Entrada (teclado / ratón)
  // ----------------------------------------------------------------------
  const keys = {};
  const mouse = { x: W / 2, y: H / 2, down: false, rdown: false };

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["Space", "Digit1", "Digit2", "KeyR", "KeyE"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  function updateMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = clamp((e.clientX - r.left) / r.width * VW, 0, VW);
    mouse.y = clamp((e.clientY - r.top) / r.height * VH, 0, VH);
  }
  canvas.addEventListener("mousemove", updateMouse);
  canvas.addEventListener("mousedown", (e) => {
    updateMouse(e);
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) mouse.rdown = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rdown = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ----------------------------------------------------------------------
  //  Definición de armas
  // ----------------------------------------------------------------------
  const WEAPONS = {
    pistol: {
      name: "Pistola", type: "ranged", dmg: 34, rate: 0.28, speed: 720,
      spread: 0.05, mag: 12, reload: 1.2, bullets: 1, color: "#ffe27a",
    },
    rifle: {
      name: "Rifle", type: "ranged", dmg: 26, rate: 0.10, speed: 950,
      spread: 0.09, mag: 30, reload: 1.8, bullets: 1, color: "#ffd24a",
    },
    knife: {
      name: "Machete", type: "melee", dmg: 75, rate: 0.42, range: 62,
      arc: 1.5, knock: 240,
    },
    bat: {
      name: "Bate", type: "melee", dmg: 55, rate: 0.55, range: 70,
      arc: 1.9, knock: 380,
    },
  };

  // ----------------------------------------------------------------------
  //  Personajes seleccionables
  // ----------------------------------------------------------------------
  const CHARACTERS = [
    { id: "soldier", name: "Soldado", desc: "Rifle de asalto. Equilibrado y fiable.",
      body: "#5a6a36", head: "#d8b48a", maxHp: 100, speed: 1.0, primary: "rifle", melee: "knife",
      pants: "#3c4426", vest: "#43512c", accent: "#2a3019", headgear: "helmet", gear: "#4b572f", hair: "#3a2c1c" },
    { id: "police", name: "Policía", desc: "Pistola precisa y rápido de pies.",
      body: "#2a4374", head: "#d8b48a", maxHp: 100, speed: 1.08, primary: "pistol", melee: "knife",
      pants: "#1b2740", vest: "#22365e", accent: "#ffd24a", headgear: "cap", gear: "#1d2c50", hair: "#2a2018" },
    { id: "survivor", name: "Superviviente", desc: "Duro de pelar. Bate demoledor.",
      body: "#8a5a32", head: "#caa07a", maxHp: 130, speed: 0.98, primary: "pistol", melee: "bat",
      pants: "#4a3a24", vest: null, accent: "#b23a3a", headgear: "bandana", gear: "#b23a3a", hair: "#33261a" },
    { id: "medic", name: "Médico", desc: "Regenera vida poco a poco.",
      body: "#e6ebe8", head: "#d8b48a", maxHp: 100, speed: 1.05, primary: "pistol", melee: "knife", regen: 3,
      pants: "#c9d2cd", vest: "#f3f6f4", accent: "#e23b3b", headgear: "cap", gear: "#f1f4f2", hair: "#3a2c1c" },
    { id: "swat", name: "SWAT", desc: "Blindado: mucha vida, algo lento.",
      body: "#2b2f35", head: "#c2a08a", maxHp: 150, speed: 0.85, primary: "rifle", melee: "bat",
      pants: "#191b1f", vest: "#34393f", accent: "#5b626c", headgear: "helmet", gear: "#1c1f24", hair: "#1a1a1a", visor: true },
    { id: "hunter", name: "Cazador", desc: "Ágil y veloz. Golpea y corre.",
      body: "#3d5a32", head: "#caa07a", maxHp: 85, speed: 1.2, primary: "rifle", melee: "knife",
      pants: "#33472a", vest: "#46663a", accent: "#6a7a45", headgear: "hood", gear: "#2f4426", hair: "#2a2018" },
  ];
  let selectedChar = 0;

  // ----------------------------------------------------------------------
  //  Estado global del juego
  // ----------------------------------------------------------------------
  const game = {
    state: "menu",          // menu | wave | mission | gameover | victory
    region: { x: 0, y: 0 },
    regionCache: {},        // datos por región (obstáculos, etc.)
    stash: {},              // enemigos anclados que esperan en su región (guardias)
    wave: 0,
    maxWaves: 8,
    zombiesKilled: 0,
    zombiesGoal: 0,
    spawnTimer: 0,
    mission: null,          // { phase, px, py, dx, dy }
    carrying: false,        // ¿lleva el encargo encima?
    deliverTime: 0,         // segundos restantes para entregar
    deliverTimeMax: 0,
    flashMsg: null,
    flashTime: 0,
    score: 0,
  };

  let player = null;
  let zombies = [];
  let enemies = [];        // enemigos armados (guardias del encargo)
  let dogs = [];           // perros que acompañan a los guardias
  let pending = [];        // enemigos "en tránsito" siguiéndote a otra región
  let bullets = [];        // balas del jugador
  let ebullets = [];       // balas enemigas
  let particles = [];
  let pickups = [];        // botín (munición / vida)
  let encargo = null;      // caja del encargo (punto de recogida)
  let dropzone = null;     // punto de entrega del encargo

  // ----------------------------------------------------------------------
  //  Generación de regiones — PUEBLO orgánico y variado
  // ----------------------------------------------------------------------
  const WALL_COLORS = ["#b9a07a", "#c8b48c", "#a98e6a", "#cfc1a0", "#b08f78", "#9fb0b3", "#c5a98f", "#d6c79c", "#a3a99a"];
  const ROOF_COLORS = ["#7a4a3a", "#6b5a48", "#8a5340", "#566a72", "#7d6b50", "#5e4636", "#8a7a4a", "#933f33", "#48555c"];
  const AWNING_COLORS = ["#c0392b", "#2e7d52", "#2b6ca0", "#c79a2b", "#8e44ad", "#b0563a"];
  const CAR_COLORS = ["#b23a3a", "#3a5fb2", "#cabf4a", "#dcdcdc", "#2c2c2e", "#3a8a52", "#9a6a3a"];
  const TOWN_TINTS = ["#3c4a32", "#43492f", "#4a4636", "#3e4738", "#474334", "#384830"];
  const REGION_TYPES = ["residencial", "mercado", "afueras", "mixto"];
  const ROAD = 92;
  const MARGIN = 92;

  function getRegion(rx, ry) {
    const key = rx + "," + ry;
    if (game.regionCache[key]) return game.regionCache[key];
    const rng = mulberry32((rx * 73856093) ^ (ry * 19349663) ^ 0x9e37);
    const regionType = REGION_TYPES[Math.floor(rng() * REGION_TYPES.length)];
    const tint = TOWN_TINTS[Math.floor(rng() * TOWN_TINTS.length)];
    const town = generateTown(rng, regionType);
    // colisión = todos los rectángulos de cada edificio + puestos
    const obstacles = [];
    for (const b of town.buildings) for (const r of b.rects) obstacles.push(r);
    for (const s of town.stalls) obstacles.push(s);
    const data = { obstacles, town, tint, regionType };
    game.regionCache[key] = data;
    return data;
  }

  // cortes irregulares: divide una longitud en celdas de distinto tamaño separadas por calles
  function buildCuts(start, total, rng) {
    const cells = [], end = start + total;
    let pos = start;
    while (end - pos >= 220) {
      let len = 240 + rng() * 230;
      if (end - pos - len < 220) len = end - pos;
      cells.push({ a: pos, len });
      pos += len;
      if (pos >= end - 6) break;
      pos += ROAD * (0.85 + rng() * 0.5); // calle de ancho variable
    }
    if (!cells.length) cells.push({ a: start, len: total });
    return cells;
  }

  function pickTheme(rng, type) {
    const r = rng();
    if (type === "residencial") return r < 0.68 ? "houses" : r < 0.85 ? "park" : "shops";
    if (type === "mercado") return r < 0.42 ? "shops" : r < 0.68 ? "houses" : r < 0.85 ? "park" : "field";
    if (type === "afueras") return r < 0.4 ? "park" : r < 0.68 ? "field" : r < 0.9 ? "houses" : "shops";
    return r < 0.42 ? "houses" : r < 0.66 ? "shops" : r < 0.86 ? "park" : "field"; // mixto
  }

  function generateTown(rng, regionType) {
    const buildings = [], stalls = [], roads = [], props = [];
    const innerX = MARGIN, innerY = MARGIN, innerW = W - MARGIN * 2, innerH = H - MARGIN * 2;
    const cols = buildCuts(innerX, innerW, rng);
    const rows = buildCuts(innerY, innerH, rng);

    // calles entre celdas (ancho irregular)
    for (let i = 0; i < cols.length - 1; i++) { const x0 = cols[i].a + cols[i].len; roads.push({ x: x0, y: 0, w: cols[i + 1].a - x0, h: H, dir: "v" }); }
    for (let j = 0; j < rows.length - 1; j++) { const y0 = rows[j].a + rows[j].len; roads.push({ x: 0, y: y0, w: W, h: rows[j + 1].a - y0, dir: "h" }); }

    // manzanas
    const blocks = [];
    for (const c of cols) for (const r of rows) blocks.push({ bx: c.a, by: r.a, w: c.len, h: r.len, cx: c.a + c.len / 2, cy: r.a + r.len / 2 });

    // plaza = manzana más cercana al centro
    let plaza = blocks[0], pd = Infinity;
    for (const b of blocks) { const d = Math.hypot(b.cx - W / 2, b.cy - H / 2); if (d < pd) { pd = d; plaza = b; } }

    let plazaRect = null;
    for (const b of blocks) {
      if (b === plaza) { plazaRect = { x: b.bx, y: b.by, w: b.w, h: b.h }; makePlaza(b, stalls, props, rng); continue; }
      const theme = pickTheme(rng, regionType);
      if (theme === "houses") placeHouses(b, buildings, props, rng);
      else if (theme === "shops") placeShops(b, buildings, props, rng);
      else if (theme === "park") placePark(b, props, rng);
      else placeField(b, buildings, props, rng);
    }
    addGlobalProps(roads, props, rng);
    return { buildings, stalls, roads, plazaRect, props };
  }

  const pal = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  // ---- casas pequeñas con jardín, valla y árbol; algunas en forma de L ----
  function placeHouses(b, buildings, props, rng) {
    const rr = (a, c) => a + rng() * (c - a);
    const lw = Math.max(150, b.w / Math.max(1, Math.round(b.w / 185)));
    const lh = Math.max(150, b.h / Math.max(1, Math.round(b.h / 185)));
    const nc = Math.max(1, Math.floor(b.w / lw)), nr = Math.max(1, Math.floor(b.h / lh));
    const cw = b.w / nc, ch = b.h / nr;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      const lx = b.bx + i * cw, ly = b.by + j * ch;
      if (rng() < 0.16) { // lote-jardín vacío
        if (rng() < 0.7) props.push({ t: "tree", x: lx + rr(20, cw - 20), y: ly + rr(20, ch - 20), r: 13 + rng() * 8 });
        continue;
      }
      const pad = 16, maxW = cw - pad * 2, maxH = ch - pad * 2;
      if (maxW < 56 || maxH < 56) continue;
      const hw = rr(maxW * 0.55, maxW * 0.86), hh = rr(maxH * 0.52, maxH * 0.82);
      const hx = lx + pad + rng() * (maxW - hw), hy = ly + pad + rng() * (maxH - hh);
      buildings.push(makeHouse(hx, hy, hw, hh, rng));
      props.push({ t: "fence", x: lx + 7, y: ly + 7, w: cw - 14, h: ch - 14 });
      if (rng() < 0.7) props.push({ t: "tree", x: lx + rr(16, cw - 16), y: ly + rr(16, ch - 16), r: 11 + rng() * 6 });
      if (rng() < 0.45) props.push({ t: "bush", x: lx + rr(16, cw - 16), y: ly + rr(16, ch - 16) });
    }
  }

  function makeHouse(x, y, w, h, rng) {
    const wall = pal(WALL_COLORS, rng), roof = pal(ROOF_COLORS, rng);
    let rects;
    if (rng() < 0.3 && w > 116 && h > 116) { // forma en L
      const tw = w * (0.5 + rng() * 0.2), th = h * (0.42 + rng() * 0.12);
      const left = rng() < 0.5;
      rects = [{ x, y: y + th, w, h: h - th }, { x: left ? x : x + (w - tw), y, w: tw, h: th }];
    } else {
      rects = [{ x, y, w, h }];
    }
    return { rects, x, y, w, h, kind: "house", wall, roof, roofType: rng() < 0.62 ? "gable" : "hip", awning: null, door: w > h ? "S" : "E" };
  }

  // ---- locales / tiendas (medianos, tejado plano y toldo) ----
  function placeShops(b, buildings, props, rng) {
    const rr = (a, c) => a + rng() * (c - a);
    const pad = 18, gap = 22;
    const n = b.w > 540 ? 3 : b.w > 320 ? 2 : 1;
    const lw = (b.w - pad * 2 - (n - 1) * gap) / n;
    if (lw < 70) return;
    for (let i = 0; i < n; i++) {
      if (rng() < 0.12) continue;
      const sx = b.bx + pad + i * (lw + gap);
      const sh = Math.min(b.h - pad * 2, rr(150, 230));
      const sy = b.by + pad + rng() * Math.max(0, b.h - pad * 2 - sh);
      buildings.push(makeShop(sx, sy, lw, sh, rng));
    }
  }

  function makeShop(x, y, w, h, rng) {
    return { rects: [{ x, y, w, h }], x, y, w, h, kind: "shop", wall: pal(WALL_COLORS, rng), roof: pal(ROOF_COLORS, rng), roofType: "flat", awning: pal(AWNING_COLORS, rng), door: w > h ? "S" : "E" };
  }

  // ---- parque: árboles, estanque y banco (sin edificios) ----
  function placePark(b, props, rng) {
    const rr = (a, c) => a + rng() * (c - a);
    if (rng() < 0.5 && b.w > 200 && b.h > 180) {
      const pw = rr(90, Math.min(180, b.w - 60)), ph = rr(70, Math.min(140, b.h - 60));
      props.push({ t: "pond", x: b.cx - pw / 2, y: b.cy - ph / 2, w: pw, h: ph });
    }
    const n = Math.max(3, Math.floor(b.w * b.h / 24000));
    for (let i = 0; i < n; i++) {
      const x = b.bx + rr(22, b.w - 22), y = b.by + rr(22, b.h - 22);
      props.push(rng() < 0.72 ? { t: "tree", x, y, r: 14 + rng() * 11 } : { t: "bush", x, y });
    }
    if (rng() < 0.6) props.push({ t: "bench", x: b.cx - 18, y: b.cy + rr(-40, 40), horiz: true });
  }

  // ---- descampado / huerta: cobertizo ocasional, cajas y árboles sueltos ----
  function placeField(b, buildings, props, rng) {
    const rr = (a, c) => a + rng() * (c - a);
    if (rng() < 0.5 && b.w > 160 && b.h > 130) {
      const w = rr(120, Math.min(210, b.w - 50)), h = rr(90, Math.min(160, b.h - 50));
      const x = b.bx + rr(20, Math.max(20, b.w - w - 20)), y = b.by + rr(20, Math.max(20, b.h - h - 20));
      const shed = makeShop(x, y, w, h, rng); shed.awning = null; buildings.push(shed);
    }
    const nc = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < nc; i++) props.push({ t: "crate", x: b.bx + rr(24, b.w - 24), y: b.by + rr(24, b.h - 24) });
    const nt = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nt; i++) props.push({ t: "tree", x: b.bx + rr(24, b.w - 24), y: b.by + rr(24, b.h - 24), r: 14 + rng() * 8 });
  }

  // plaza con puestos, fuente (en drawPlaza), árboles y banco; centro despejado
  function makePlaza(b, stalls, props, rng) {
    const sw = 56, sh = 58;
    const spots = [
      { x: b.bx + 40, y: b.by + 36 }, { x: b.bx + b.w - sw - 40, y: b.by + 36 },
      { x: b.bx + 40, y: b.by + b.h - sh - 40 }, { x: b.bx + b.w - sw - 40, y: b.by + b.h - sh - 40 },
      { x: b.cx - sw / 2, y: b.by + 30 }, { x: b.cx - sw / 2, y: b.by + b.h - sh - 30 },
    ];
    for (const sp of spots) {
      if (rng() < 0.3) continue;
      if (dist2(sp.x + sw / 2, sp.y + sh / 2, W / 2, H / 2) < 150 * 150) continue;
      stalls.push({ x: sp.x, y: sp.y, w: sw, h: sh, awning: pal(AWNING_COLORS, rng) });
    }
    props.push({ t: "tree", x: b.bx + 32, y: b.by + b.h - 32, r: 20 });
    props.push({ t: "tree", x: b.bx + b.w - 32, y: b.by + 32, r: 20 });
  }

  // decoraciones globales: farolas en calles, árboles perimetrales, coches
  function addGlobalProps(roads, props, rng) {
    const rr = (a, c) => a + rng() * (c - a);
    for (const r of roads) {
      if (r.dir === "v") for (let y = 150; y < H - 110; y += 270) { props.push({ t: "light", x: r.x - 10, y }); props.push({ t: "light", x: r.x + r.w + 10, y }); }
      else for (let x = 150; x < W - 110; x += 270) { props.push({ t: "light", x, y: r.y - 10 }); props.push({ t: "light", x, y: r.y + r.h + 10 }); }
      if (rng() < 0.6) {
        if (r.dir === "h") props.push({ t: "car", x: rr(MARGIN + 100, W - MARGIN - 100), y: r.y + 18, color: pal(CAR_COLORS, rng), horiz: true });
        else props.push({ t: "car", x: r.x + 18, y: rr(MARGIN + 100, H - MARGIN - 100), color: pal(CAR_COLORS, rng), horiz: false });
      }
    }
    for (let i = 0; i < 40; i++) {
      const side = Math.floor(rng() * 4); let x, y;
      if (side === 0) { x = rr(30, W - 30); y = rr(26, MARGIN - 26); }
      else if (side === 1) { x = rr(W - MARGIN + 26, W - 26); y = rr(30, H - 30); }
      else if (side === 2) { x = rr(30, W - 30); y = rr(H - MARGIN + 26, H - 26); }
      else { x = rr(26, MARGIN - 26); y = rr(30, H - 30); }
      props.push({ t: "tree", x, y, r: 18 + rng() * 10 });
    }
  }

  // ----------------------------------------------------------------------
  //  Colisiones círculo vs rectángulos (resuelve solapamiento)
  // ----------------------------------------------------------------------
  function resolveCircleRects(ent, r) {
    const obs = getRegion(game.region.x, game.region.y).obstacles;
    for (const o of obs) {
      const nx = clamp(ent.x, o.x, o.x + o.w);
      const ny = clamp(ent.y, o.y, o.y + o.h);
      const dx = ent.x - nx, dy = ent.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (r - d);
        ent.x += (dx / d) * push;
        ent.y += (dy / d) * push;
      }
    }
  }
  // separa entre sí a TODAS las entidades sólidas (zombies, enemigos y perros)
  // para que ninguna se solape con otra de cualquier tipo
  function resolveCrowd() {
    const all = [...zombies, ...enemies, ...dogs];
    // varias iteraciones para que las pilas densas se asienten bien
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        for (let j = i + 1; j < all.length; j++) {
          const b = all[j];
          const rr = a.r + b.r;
          const dd = dist2(a.x, a.y, b.x, b.y);
          if (dd < rr * rr) {
            let d = Math.sqrt(dd), nx, ny;
            if (d < 0.0001) {
              // superpuestos exactamente: separa en una dirección arbitraria estable
              const a2 = i * 2.3994; nx = Math.cos(a2); ny = Math.sin(a2); d = 0.0001;
            } else {
              nx = (a.x - b.x) / d; ny = (a.y - b.y) / d;
            }
            const push = (rr - d) / 2;
            a.x += nx * push; a.y += ny * push;
            b.x -= nx * push; b.y -= ny * push;
          }
        }
      }
    }
    // tras separarlas, reaplica las restricciones (obstáculos y jugador)
    for (const e of all) { resolveCircleRects(e, e.r); keepOutOfPlayer(e); }
  }

  // impide que una entidad se solape con el jugador (se quedan en su perímetro)
  function keepOutOfPlayer(ent) {
    const minD = ent.r + player.r;
    const d2 = dist2(ent.x, ent.y, player.x, player.y);
    if (d2 < minD * minD) {
      let d = Math.sqrt(d2), nx, ny;
      if (d < 0.0001) {
        // exactamente encima: empuja en dirección opuesta a su apunte
        nx = -Math.cos(ent.aim || 0); ny = -Math.sin(ent.aim || 0); d = 0.0001;
      } else {
        nx = (ent.x - player.x) / d; ny = (ent.y - player.y) / d;
      }
      const push = minD - d;
      ent.x += nx * push; ent.y += ny * push;
    }
  }

  function pointInRects(x, y) {
    const obs = getRegion(game.region.x, game.region.y).obstacles;
    for (const o of obs) if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return true;
    return false;
  }

  // ¿hay línea de tiro despejada entre dos puntos? (muestreo a lo largo del segmento)
  function hasLOS(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (pointInRects(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  // ----------------------------------------------------------------------
  //  Jugador
  // ----------------------------------------------------------------------
  function makePlayer(c) {
    c = c || CHARACTERS[0];
    const hasRifle = c.primary === "rifle";
    return {
      x: W / 2, y: H / 2, r: 16 * SCALE,
      hp: c.maxHp, maxHp: c.maxHp,
      aim: 0,             // ángulo hacia el ratón
      moveAng: 0,
      walkCycle: 0,
      moving: false, running: false,
      speed: 0,
      slot: 0,            // 0 = principal, 1 = melee
      weapons: [c.primary, c.melee],
      ammo: { pistol: WEAPONS.pistol.mag, rifle: WEAPONS.rifle.mag },
      reserve: { pistol: 48, rifle: 90 },
      reloading: 0,
      cooldown: 0,
      meleeSwing: 0,      // temporizador de animación de golpe
      hurtFlash: 0,
      hasRifle,
      bodyColor: c.body,
      headColor: c.head,
      speedMul: c.speed,
      regen: c.regen || 0,
      charName: c.name,
      char: c,
    };
  }

  function currentWeapon() { return WEAPONS[player.weapons[player.slot]]; }

  // ----------------------------------------------------------------------
  //  Spawns
  // ----------------------------------------------------------------------
  // paletas de aspecto de los zombies (tonos apagados y enfermizos, nada de verde chillón)
  const Z_SKIN = ["#8c9a86", "#9aa39b", "#a8a290", "#7e8a80", "#9b8d83", "#879089", "#92a08a", "#b0a892", "#7f8c92"];
  const Z_SHIRT = ["#39495a", "#5a4636", "#45454e", "#6a3a3a", "#384a44", "#4a3a52", "#5a554f", "#2f3a46", "#6a5a3a", "#46303a"];
  const Z_PANTS = ["#2c333a", "#3a2e22", "#33333a", "#402a2a", "#283330", "#332a3a", "#3c3630"];
  const Z_HAIR = ["#2a2018", "#1c1c1c", "#3a2c1c", "#4a4a4a", "#5a4632", "#6a6a66"];
  const Z_EYE = ["#c24a3a", "#caa23a", "#9a3a3a", "#d8d2b0", "#b86a2a"];

  function spawnZombie() {
    // aparece justo fuera de la vista, cerca del jugador
    const p = spawnEdgePoint();
    const x = p.x, y = p.y;
    const tier = Math.random();
    let z = {
      x, y, r: 15, hp: 60, maxHp: 60, speed: rand(55, 80),
      dmg: 12, atkCd: 0, hurt: 0, walkCycle: rand(0, TAU),
      aim: 0, type: "normal",
    };
    // zombies más fuertes en oleadas avanzadas
    if (game.wave >= 3 && tier > 0.78) {
      z = Object.assign(z, { hp: 150, maxHp: 150, r: 20, speed: rand(40, 58), dmg: 22, type: "brute" });
    } else if (tier > 0.6) {
      z = Object.assign(z, { hp: 45, maxHp: 45, r: 13, speed: rand(95, 125), dmg: 8, type: "runner" });
    }
    z.hp += game.wave * 6; z.maxHp = z.hp;
    z.r *= SCALE;
    // aspecto aleatorio (piel putrefacta, ropa desgarrada, pelo, ojos, herida)
    z.skin = pick(Z_SKIN);
    z.shirt = pick(Z_SHIRT);
    z.pants = pick(Z_PANTS);
    z.hair = z.type === "brute" ? (Math.random() < 0.5 ? pick(Z_HAIR) : null) : (Math.random() < 0.8 ? pick(Z_HAIR) : null);
    z.eye = pick(Z_EYE);
    z.wound = { x: rand(-4, 5), y: rand(-5, 5), r: rand(2, 3.4) };
    z.gore = Math.random() < 0.5; // mancha de sangre extra
    zombies.push(z);
  }

  function spawnGuard(x, y, anchor) {
    enemies.push({
      x, y, r: 16 * SCALE, hp: 90, maxHp: 90, speed: 70,
      aim: 0, fireCd: rand(0.5, 1.5), state: "idle",
      walkCycle: rand(0, TAU), hurt: 0, dmg: 14,
      strafeDir: Math.random() < 0.5 ? 1 : -1, // lado por el que rodea la cobertura
      flankTimer: 0, px: x, py: y,
      anchor: anchor || null, // si está anclado, defiende su región y no te persigue fuera
    });
  }

  // enemigo armado que entra cerca de la vista (emboscada en ruta)
  function spawnGuardEdge() {
    const p = spawnEdgePoint();
    spawnGuard(p.x, p.y);
  }

  // perro de ataque: rápido, cuerpo a cuerpo, acompaña a los guardias
  function spawnDog(x, y, anchor) {
    dogs.push({
      x, y, r: 11 * SCALE, hp: 42, maxHp: 42, speed: rand(155, 200),
      dmg: 9, atkCd: 0, aim: rand(0, TAU), walkCycle: rand(0, TAU),
      hurt: 0, moving: true,
      anchor: anchor || null,
    });
  }
  function spawnDogEdge() {
    const p = spawnEdgePoint();
    spawnDog(p.x, p.y);
  }

  function spawnParticles(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(spd * 0.3, spd);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), color, r: rand(1.5, 3.5) });
    }
  }

  function dropLoot(x, y) {
    const r = Math.random();
    if (r < 0.18) pickups.push({ x, y, type: "health", r: 16, t: 0 });
    else if (r < 0.5) pickups.push({ x, y, type: "ammo", r: 16, t: 0 });
  }

  // ----------------------------------------------------------------------
  //  Control de oleadas y misiones
  // ----------------------------------------------------------------------
  function startWave(n) {
    game.wave = n;
    game.state = "wave";
    game.zombiesGoal = 8 + n * 4;
    game.zombiesKilled = 0;
    game.spawnTimer = 0.5;
    zombies = []; enemies = []; dogs = []; pending = []; bullets = []; ebullets = []; encargo = null; dropzone = null;
    game.stash = {}; game.carrying = false;
    flash(`OLEADA ${n}`, `Elimina ${game.zombiesGoal} zombies`);
  }

  function startMission() {
    game.state = "mission";
    // región de recogida (distinta a la actual)
    let px, py, tries = 0;
    do {
      px = randInt(0, REGIONS_X - 1); py = randInt(0, REGIONS_Y - 1); tries++;
    } while (px === game.region.x && py === game.region.y && tries < 20);
    // región de entrega: la MÁS lejana posible a la de recogida
    let best = [], bestDist = -1;
    for (let ry2 = 0; ry2 < REGIONS_Y; ry2++) {
      for (let rx2 = 0; rx2 < REGIONS_X; rx2++) {
        if (rx2 === px && ry2 === py) continue;
        const dd = Math.hypot(rx2 - px, ry2 - py);
        if (dd > bestDist + 0.001) { bestDist = dd; best = [{ x: rx2, y: ry2 }]; }
        else if (Math.abs(dd - bestDist) < 0.001) best.push({ x: rx2, y: ry2 });
      }
    }
    const pick = best[randInt(0, best.length - 1)];
    // pickupSpawned/deliverSpawned: garantizan que los guardias se generan UNA sola vez
    game.mission = { phase: "pickup", px, py, dx: pick.x, dy: pick.y, pickupSpawned: false, deliverSpawned: false };
    game.carrying = false;
    zombies = []; enemies = []; dogs = []; pending = []; encargo = null; dropzone = null;
    game.stash = {};
    flash("ENCARGO DISPONIBLE", `Recógelo en la región ${regName(px, py)}`);
  }

  function regName(x, y) { return String.fromCharCode(65 + x) + (y + 1); }
  function inRegion(x, y) { return game.region.x === x && game.region.y === y; }

  // región objetivo según la fase actual de la misión
  function missionTarget() {
    if (!game.mission) return null;
    return game.mission.phase === "pickup"
      ? { x: game.mission.px, y: game.mission.py }
      : { x: game.mission.dx, y: game.mission.dy };
  }

  // genera enemigos/encargo o punto de entrega al entrar en la región objetivo
  // (sólo una vez por fase: si vuelves, NO se regeneran los guardias)
  function enterMissionRegion() {
    if (!game.mission) return;
    const m = game.mission;

    if (m.phase === "pickup") {
      if (m.pickupSpawned) return;
      if (game.region.x !== m.px || game.region.y !== m.py) return;
      m.pickupSpawned = true;
      encargo = { x: W / 2, y: H / 2, r: 22, pulse: 0 };
      let ex, ey, tries = 0;
      do {
        ex = rand(160, W - 160); ey = rand(160, H - 160); tries++;
      } while ((pointInRects(ex, ey) || dist2(ex, ey, player.x, player.y) < 350 * 350) && tries < 40);
      encargo.x = ex; encargo.y = ey;
      const anchor = { x: m.px, y: m.py }; // defienden el encargo, no te persiguen fuera
      // guardias armados alrededor del encargo
      const guards = 6 + Math.floor(game.wave * 0.8);
      for (let i = 0; i < guards; i++) {
        const a = (i / guards) * TAU + rand(-0.3, 0.3);
        const gx = clamp(ex + Math.cos(a) * rand(90, 170), 60, W - 60);
        const gy = clamp(ey + Math.sin(a) * rand(90, 170), 60, H - 60);
        spawnGuard(gx, gy, anchor);
      }
      // perros patrullando
      const pdogs = 2 + Math.floor(game.wave / 2);
      for (let i = 0; i < pdogs; i++) {
        const a = rand(0, TAU);
        const gx = clamp(ex + Math.cos(a) * rand(60, 200), 50, W - 50);
        const gy = clamp(ey + Math.sin(a) * rand(60, 200), 50, H - 50);
        spawnDog(gx, gy, anchor);
      }
    } else {
      if (m.deliverSpawned) return;
      if (game.region.x !== m.dx || game.region.y !== m.dy) return;
      m.deliverSpawned = true;
      dropzone = { x: W / 2, y: H / 2, r: 34, pulse: 0 };
      let ex, ey, tries = 0;
      do {
        ex = rand(160, W - 160); ey = rand(160, H - 160); tries++;
      } while ((pointInRects(ex, ey) || dist2(ex, ey, player.x, player.y) < 320 * 320) && tries < 40);
      dropzone.x = ex; dropzone.y = ey;
      const anchor = { x: m.dx, y: m.dy }; // defienden el punto de entrega
      // defensores armados esperando en el punto de entrega
      const guards = 5 + Math.floor(game.wave / 2);
      for (let i = 0; i < guards; i++) {
        const a = (i / guards) * TAU + rand(-0.3, 0.3);
        const gx = clamp(ex + Math.cos(a) * rand(80, 160), 60, W - 60);
        const gy = clamp(ey + Math.sin(a) * rand(80, 160), 60, H - 60);
        spawnGuard(gx, gy, anchor);
      }
      // perros guardianes
      const pdogs = 2 + Math.floor(game.wave / 3);
      for (let i = 0; i < pdogs; i++) {
        const a = rand(0, TAU);
        const gx = clamp(ex + Math.cos(a) * rand(60, 190), 50, W - 50);
        const gy = clamp(ey + Math.sin(a) * rand(60, 190), 50, H - 50);
        spawnDog(gx, gy, anchor);
      }
    }
  }

  function flash(title, sub) {
    game.flashMsg = { title, sub };
    game.flashTime = 2.4;
  }

  // ----------------------------------------------------------------------
  //  Cambio de región al tocar los bordes de la pantalla
  // ----------------------------------------------------------------------
  const INSET = 58; // a qué distancia del borde entras a la nueva región (deja sitio detrás)

  function checkRegionSwitch() {
    // posición y región previas (para el seguimiento natural y el anclaje de guardias)
    const oldPx = player.x, oldPy = player.y;
    const oldRegion = { x: game.region.x, y: game.region.y };
    // 'edge' indica por qué borde entras (y por el que tus perseguidores te siguen)
    let edge = null;
    if (player.x < EDGE && game.region.x > 0) { game.region.x--; player.x = W - INSET; edge = "right"; }
    else if (player.x > W - EDGE && game.region.x < REGIONS_X - 1) { game.region.x++; player.x = INSET; edge = "left"; }
    if (player.y < EDGE && game.region.y > 0) { game.region.y--; player.y = H - INSET; edge = "bottom"; }
    else if (player.y > H - EDGE && game.region.y < REGIONS_Y - 1) { game.region.y++; player.y = INSET; edge = "top"; }
    // en los bordes del mapa, frena al jugador
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);

    if (edge) {
      // los enemigos NO se teletransportan: salen de la región y te SIGUEN con un
      // retardo proporcional a lo lejos que estaban del borde que cruzaste
      queueFollowers(edge, oldPx, oldPy, oldRegion);
      // los guardias anclados a esta región (si vuelves) reaparecen donde los dejaste
      restoreStash(game.region.x, game.region.y);
      bullets = []; ebullets = []; // los proyectiles no cruzan
      const r = game.region;
      flash(`REGIÓN ${regName(r.x, r.y)}`, "");
    }
  }

  // distancia de una entidad al borde que el jugador cruzó (en la región anterior)
  function distToEdge(e, edge) {
    if (edge === "right") return Math.abs(e.x - 0);      // cruzaste por la izquierda → su borde era x=0
    if (edge === "left") return Math.abs(W - e.x);       // cruzaste por la derecha  → su borde era x=W
    if (edge === "bottom") return Math.abs(e.y - 0);     // cruzaste por arriba      → su borde era y=0
    return Math.abs(H - e.y);                            // cruzaste por abajo       → su borde era y=H
  }

  // pasa a "tránsito" a todos los enemigos vivos (y reencamina a los ya en tránsito).
  // los guardias ANCLADOS a la región que abandonas no te siguen: se quedan defendiendo.
  function queueFollowers(edge, oldPx, oldPy, oldRegion) {
    const horiz = (edge === "left" || edge === "right");
    const region = { x: game.region.x, y: game.region.y };
    const tag = [
      ...zombies.map(e => ({ kind: "zombie", ent: e })),
      ...enemies.map(e => ({ kind: "enemy", ent: e })),
      ...dogs.map(e => ({ kind: "dog", ent: e })),
    ];
    for (const { kind, ent } of tag) {
      // guardias anclados a esta región: se quedan esperando (no te persiguen)
      if (ent.anchor && ent.anchor.x === oldRegion.x && ent.anchor.y === oldRegion.y) {
        const key = oldRegion.x + "," + oldRegion.y;
        (game.stash[key] || (game.stash[key] = [])).push({ kind, ent });
        continue;
      }
      // tiempo que tardaría en llegar al borde y cruzar, según su velocidad
      const delay = clamp(distToEdge(ent, edge) / (ent.speed || 90), 0.12, 9);
      const lateral = horiz ? ent.y - oldPy : ent.x - oldPx;
      pending.push({ kind, ent, edge, lateral, timer: delay, region });
    }
    // los que YA venían en tránsito hacia la región anterior siguen tras de ti:
    // se reencaminan a la nueva región sumando el tiempo de cruzar otra pantalla
    for (const p of pending) {
      if (p.region.x === region.x && p.region.y === region.y) continue; // recién añadidos
      p.region = region;
      p.edge = edge;
      p.timer += clamp(((W + H) / 2) / (p.ent.speed || 90), 0.5, 6);
    }
    zombies = []; enemies = []; dogs = [];
  }

  // restaura en la región a los guardias anclados que esperaban (donde los dejaste)
  function restoreStash(rx, ry) {
    const key = rx + "," + ry;
    const arr = game.stash[key];
    if (!arr) return;
    for (const { kind, ent } of arr) {
      if (kind === "zombie") zombies.push(ent);
      else if (kind === "enemy") enemies.push(ent);
      else dogs.push(ent);
    }
    delete game.stash[key];
  }

  // hace llegar a los perseguidores cuyo temporizador venció, entrando por el borde
  function updatePending(dt) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      p.timer -= dt;
      if (p.timer > 0) continue;
      if (game.region.x !== p.region.x || game.region.y !== p.region.y) {
        // el jugador ya se fue de esa región: continúan persiguiéndolo a la actual
        p.region = { x: game.region.x, y: game.region.y };
        p.timer = clamp(((W + H) / 2) / (p.ent.speed || 90), 0.5, 6);
        continue;
      }
      materializeFollower(p);
      pending.splice(i, 1);
    }
  }

  // coloca al perseguidor entrando justo por el borde, alineado contigo
  function materializeFollower(p) {
    const e = p.ent, edge = p.edge, depth = rand(0, 22);
    if (edge === "right") { e.x = (W - EDGE) - depth; e.y = clamp(player.y + p.lateral, 36, H - 36); }
    else if (edge === "left") { e.x = EDGE + depth; e.y = clamp(player.y + p.lateral, 36, H - 36); }
    else if (edge === "bottom") { e.y = (H - EDGE) - depth; e.x = clamp(player.x + p.lateral, 36, W - 36); }
    else { e.y = EDGE + depth; e.x = clamp(player.x + p.lateral, 36, W - 36); }
    if (e.px !== undefined) { e.px = e.x; e.py = e.y; e.flankTimer = 0; }
    if (p.kind === "zombie") zombies.push(e);
    else if (p.kind === "enemy") enemies.push(e);
    else dogs.push(e);
  }

  // ----------------------------------------------------------------------
  //  Disparo / ataque
  // ----------------------------------------------------------------------
  function tryAttack(dt) {
    const w = currentWeapon();
    if (player.cooldown > 0) return;

    if (w.type === "ranged") {
      if (!mouse.down) return;
      const key = player.weapons[player.slot];
      if (player.reloading > 0) return;
      if (player.ammo[key] <= 0) { startReload(); return; }
      // dispara
      for (let i = 0; i < w.bullets; i++) {
        const a = player.aim + rand(-w.spread, w.spread);
        bullets.push({
          x: player.x + Math.cos(player.aim) * 22 * SCALE,
          y: player.y + Math.sin(player.aim) * 22 * SCALE,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg, life: 0.9, color: w.color, r: 3.5,
        });
      }
      player.ammo[key]--;
      player.cooldown = w.rate;
      spawnParticles(player.x + Math.cos(player.aim) * 26 * SCALE, player.y + Math.sin(player.aim) * 26 * SCALE, "#ffcf5a", 4, 120);
    } else {
      // melee
      if (!(mouse.rdown || keys["Space"])) return;
      player.cooldown = w.rate;
      player.meleeSwing = 0.22;
      // daña a todo en el arco frontal
      const r2 = w.range * w.range;
      const hitList = [...zombies, ...enemies, ...dogs];
      for (const z of hitList) {
        if (dist2(player.x, player.y, z.x, z.y) > r2) continue;
        const ang = Math.atan2(z.y - player.y, z.x - player.x);
        let diff = Math.abs(((ang - player.aim + Math.PI * 3) % TAU) - Math.PI);
        if (diff < w.arc / 2) {
          z.hp -= w.dmg;
          z.hurt = 0.15;
          const kx = Math.cos(player.aim) * w.knock;
          const ky = Math.sin(player.aim) * w.knock;
          z.x += kx * dt * 6; z.y += ky * dt * 6;
          spawnParticles(z.x, z.y, "#c0402a", 6, 160);
        }
      }
    }
  }

  function startReload() {
    const key = player.weapons[player.slot];
    const w = WEAPONS[key];
    if (w.type !== "ranged") return;
    if (player.reloading > 0) return;
    if (player.ammo[key] >= w.mag) return;
    if (player.reserve[key] <= 0) return;
    player.reloading = w.reload;
  }

  function finishReload() {
    const key = player.weapons[player.slot];
    const w = WEAPONS[key];
    const need = w.mag - player.ammo[key];
    const take = Math.min(need, player.reserve[key]);
    player.ammo[key] += take;
    player.reserve[key] -= take;
  }

  // ----------------------------------------------------------------------
  //  Actualización principal
  // ----------------------------------------------------------------------
  function update(dt) {
    if (game.state !== "wave" && game.state !== "mission") return;

    updatePlayer(dt);
    updateZombies(dt);
    updateEnemies(dt);
    updateDogs(dt);
    updatePending(dt);
    resolveCrowd();
    updateBullets(dt);
    updateEnemyBullets(dt);
    updatePickups(dt);
    updateParticles(dt);

    // lógica de progreso
    if (game.state === "wave") {
      // aparición continua basada en los que FALTAN por matar
      // (robusto ante cambios de región que limpian los zombies vivos)
      game.spawnTimer -= dt;
      const maxAlive = 6 + game.wave * 2;
      const remaining = game.zombiesGoal - game.zombiesKilled; // los que faltan por matar
      // cuenta también los zombies que vienen en tránsito hacia ti
      let pendingZ = 0;
      for (const p of pending) if (p.kind === "zombie") pendingZ++;
      if (game.spawnTimer <= 0 && zombies.length < maxAlive && zombies.length + pendingZ < remaining) {
        spawnZombie();
        game.spawnTimer = clamp(1.4 - game.wave * 0.08, 0.35, 1.4);
      }
      if (game.zombiesKilled >= game.zombiesGoal) {
        // oleada superada → fase de misión
        startMission();
      }
    } else if (game.state === "mission") {
      enterMissionRegion();

      if (game.mission.phase === "pickup") {
        // recoger el encargo tras eliminar a los guardias (sólo en su región)
        if (encargo && inRegion(game.mission.px, game.mission.py)) {
          encargo.pulse += dt;
          const near = dist2(player.x, player.y, encargo.x, encargo.y) < 55 * 55;
          const guardsComing = pending.some(p => p.kind === "enemy" || p.kind === "dog");
          if (near && enemies.length === 0 && dogs.length === 0 && !guardsComing && keys["KeyE"]) {
            game.mission.phase = "deliver";
            game.carrying = true;
            game.score += 300;
            spawnParticles(encargo.x, encargo.y, "#ffd86b", 24, 220);
            encargo = null;
            game.spawnTimer = 1.5;
            // tiempo de entrega proporcional a la distancia (en regiones) a recorrer
            const steps = Math.abs(game.mission.dx - game.mission.px) + Math.abs(game.mission.dy - game.mission.py);
            game.deliverTimeMax = 22 + steps * 15;
            game.deliverTime = game.deliverTimeMax;
            flash("¡ENCARGO RECOGIDO!", `Entrégalo en ${regName(game.mission.dx, game.mission.dy)} — ¡corre, hay tiempo límite!`);
          }
        }
      } else {
        // cuenta atrás de entrega
        game.deliverTime -= dt;
        if (game.deliverTime <= 0) {
          gameOver("SE ACABÓ EL TIEMPO", "No entregaste el encargo a tiempo.");
          return;
        }
        // fase de entrega: emboscada de zombies y enemigos armados por el camino
        game.spawnTimer -= dt;
        if (game.spawnTimer <= 0) {
          if (zombies.length < 8) spawnZombie();
          if (Math.random() < 0.7 && enemies.length < 7) spawnGuardEdge();
          if (Math.random() < 0.55 && dogs.length < 6) spawnDogEdge();
          game.spawnTimer = clamp(1.7 - game.wave * 0.1, 0.6, 1.7);
        }
        if (dropzone && inRegion(game.mission.dx, game.mission.dy)) {
          dropzone.pulse += dt;
          const near = dist2(player.x, player.y, dropzone.x, dropzone.y) < 60 * 60;
          if (near && keys["KeyE"]) {
            game.score += 600;
            game.carrying = false;
            spawnParticles(dropzone.x, dropzone.y, "#9fe86a", 34, 260);
            dropzone = null;
            if (game.wave >= game.maxWaves) win();
            else startWave(game.wave + 1);
          }
        }
      }
    }

    if (game.flashTime > 0) game.flashTime -= dt;
    if (player.hp <= 0) gameOver();
  }

  function updatePlayer(dt) {
    // dirección de apunte (hacia el ratón, convertido a coordenadas del mundo)
    const c = computeCam();
    const mwx = c.x + mouse.x / ZOOM, mwy = c.y + mouse.y / ZOOM;
    player.aim = Math.atan2(mwy - player.y, mwx - player.x);

    // movimiento
    let dx = 0, dy = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) dy -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) dy += 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) dx -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) dx += 1;

    player.moving = dx !== 0 || dy !== 0;
    player.running = player.moving && (keys["ShiftLeft"] || keys["ShiftRight"]);
    const base = (player.running ? 235 : 150) * (game.carrying ? 0.78 : 1) * player.speedMul;

    if (player.moving) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      player.moveAng = Math.atan2(dy, dx);
      player.x += dx * base * dt;
      player.y += dy * base * dt;
      player.speed = base;
      player.walkCycle += dt * (player.running ? 14 : 9);
    } else {
      player.speed = 0;
      player.walkCycle *= 0.8;
    }

    resolveCircleRects(player, player.r);
    checkRegionSwitch();

    // cambio de arma
    if (keys["Digit1"]) player.slot = 0;
    if (keys["Digit2"]) player.slot = 1;
    if (keys["KeyR"]) startReload();

    // temporizadores
    if (player.cooldown > 0) player.cooldown -= dt;
    if (player.meleeSwing > 0) player.meleeSwing -= dt;
    if (player.hurtFlash > 0) player.hurtFlash -= dt;
    if (player.regen && player.hp < player.maxHp) player.hp = clamp(player.hp + player.regen * dt, 0, player.maxHp);
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) finishReload();
    }

    tryAttack(dt);
  }

  function updateZombies(dt) {
    for (let i = zombies.length - 1; i >= 0; i--) {
      const z = zombies[i];
      if (z.hurt > 0) z.hurt -= dt;
      const ang = Math.atan2(player.y - z.y, player.x - z.x);
      z.aim = angLerp(z.aim, ang, 0.2);
      z.x += Math.cos(ang) * z.speed * dt;
      z.y += Math.sin(ang) * z.speed * dt;
      z.walkCycle += dt * (z.speed / 14);
      resolveCircleRects(z, z.r);
      keepOutOfPlayer(z);

      // ataque al jugador
      if (z.atkCd > 0) z.atkCd -= dt;
      const zreach = z.r + player.r + 5;
      if (dist2(z.x, z.y, player.x, player.y) < zreach * zreach) {
        if (z.atkCd <= 0) { hurtPlayer(z.dmg); z.atkCd = 0.7; }
      }

      if (z.hp <= 0) {
        spawnParticles(z.x, z.y, "#7a3020", 14, 200);
        dropLoot(z.x, z.y);
        zombies.splice(i, 1);
        if (game.state === "wave") { game.zombiesKilled++; game.score += 25; }
      }
    }
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hurt > 0) e.hurt -= dt;
      const d2 = dist2(e.x, e.y, player.x, player.y);
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      e.aim = angLerp(e.aim, ang, 0.15);
      const los = hasLOS(e.x, e.y, player.x, player.y);

      if (!los) {
        // SIN línea de tiro: rodea la cobertura para conseguir ángulo limpio
        const perp = ang + (Math.PI / 2) * e.strafeDir;
        let mx = Math.cos(ang) * 0.55 + Math.cos(perp) * 1.0;
        let my = Math.sin(ang) * 0.55 + Math.sin(perp) * 1.0;
        const ml = Math.hypot(mx, my) || 1;
        e.x += (mx / ml) * e.speed * dt;
        e.y += (my / ml) * e.speed * dt;
        e.walkCycle += dt * 8;
        e.moving = true;
        // si se queda atascado contra el muro al rodear, cambia de lado
        e.flankTimer -= dt;
        if (e.flankTimer <= 0) {
          const moved = dist2(e.x, e.y, e.px, e.py);
          if (moved < 5 * 5) e.strafeDir *= -1;
          e.px = e.x; e.py = e.y; e.flankTimer = 0.45;
        }
      } else {
        // CON línea de tiro: mantén la distancia ideal de combate
        const ideal = 260;
        if (d2 > ideal * ideal) {
          e.x += Math.cos(ang) * e.speed * dt;
          e.y += Math.sin(ang) * e.speed * dt;
          e.walkCycle += dt * 8;
          e.moving = true;
        } else if (d2 < (ideal - 80) * (ideal - 80)) {
          e.x -= Math.cos(ang) * e.speed * 0.6 * dt;
          e.y -= Math.sin(ang) * e.speed * 0.6 * dt;
          e.walkCycle += dt * 8;
          e.moving = true;
        } else { e.moving = false; }
      }
      resolveCircleRects(e, e.r);
      keepOutOfPlayer(e);
      // no pueden salirse de la región (si no, dispararían desde fuera de pantalla)
      e.x = clamp(e.x, e.r, W - e.r);
      e.y = clamp(e.y, e.r, H - e.r);

      // sólo dispara si tiene línea de tiro despejada y está en rango
      e.fireCd -= dt;
      if (e.fireCd <= 0 && d2 < 480 * 480 && los) {
        e.fireCd = rand(0.9, 1.7);
        const a = e.aim + rand(-0.08, 0.08);
        ebullets.push({
          x: e.x + Math.cos(e.aim) * 20 * SCALE, y: e.y + Math.sin(e.aim) * 20 * SCALE,
          vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
          dmg: e.dmg, life: 1.1, r: 4,
        });
        spawnParticles(e.x + Math.cos(e.aim) * 22 * SCALE, e.y + Math.sin(e.aim) * 22 * SCALE, "#ff9a4a", 3, 100);
      }

      if (e.hp <= 0) {
        spawnParticles(e.x, e.y, "#7a3020", 16, 220);
        if (Math.random() < 0.6) pickups.push({ x: e.x, y: e.y, type: "ammo", r: 16, t: 0 });
        game.score += 80;
        enemies.splice(i, 1);
      }
    }
  }

  function updateDogs(dt) {
    for (let i = dogs.length - 1; i >= 0; i--) {
      const d = dogs[i];
      if (d.hurt > 0) d.hurt -= dt;
      const ang = Math.atan2(player.y - d.y, player.x - d.x);
      d.aim = angLerp(d.aim, ang, 0.3);
      d.x += Math.cos(ang) * d.speed * dt;
      d.y += Math.sin(ang) * d.speed * dt;
      d.walkCycle += dt * (d.speed / 9);
      resolveCircleRects(d, d.r);
      keepOutOfPlayer(d);
      d.x = clamp(d.x, d.r, W - d.r);
      d.y = clamp(d.y, d.r, H - d.r);

      if (d.atkCd > 0) d.atkCd -= dt;
      const dreach = d.r + player.r + 5;
      if (dist2(d.x, d.y, player.x, player.y) < dreach * dreach) {
        if (d.atkCd <= 0) { hurtPlayer(d.dmg); d.atkCd = 0.55; }
      }

      if (d.hp <= 0) {
        spawnParticles(d.x, d.y, "#7a3020", 12, 180);
        if (Math.random() < 0.3) pickups.push({ x: d.x, y: d.y, type: "ammo", r: 16, t: 0 });
        game.score += 40;
        dogs.splice(i, 1);
      }
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H;
      if (!dead && pointInRects(b.x, b.y)) { spawnParticles(b.x, b.y, "#cfcfcf", 4, 90); dead = true; }
      if (!dead) {
        const targets = [...zombies, ...enemies, ...dogs];
        for (const z of targets) {
          if (dist2(b.x, b.y, z.x, z.y) < (z.r + b.r) * (z.r + b.r)) {
            z.hp -= b.dmg; z.hurt = 0.12;
            spawnParticles(b.x, b.y, "#c0402a", 6, 140);
            dead = true; break;
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }
  }

  function updateEnemyBullets(dt) {
    for (let i = ebullets.length - 1; i >= 0; i--) {
      const b = ebullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H;
      if (!dead && pointInRects(b.x, b.y)) dead = true;
      if (!dead && dist2(b.x, b.y, player.x, player.y) < (player.r + b.r) * (player.r + b.r)) {
        hurtPlayer(b.dmg); dead = true;
      }
      if (dead) ebullets.splice(i, 1);
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      if (dist2(p.x, p.y, player.x, player.y) < (player.r + p.r) * (player.r + p.r)) {
        if (p.type === "health") player.hp = clamp(player.hp + 25, 0, player.maxHp);
        else {
          const key = player.hasRifle ? "rifle" : "pistol";
          player.reserve[key] += player.hasRifle ? 30 : 18;
        }
        spawnParticles(p.x, p.y, p.type === "health" ? "#6fe06f" : "#ffd24a", 8, 120);
        pickups.splice(i, 1);
      } else if (p.t > 18) {
        pickups.splice(i, 1); // desaparece tras un rato
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function hurtPlayer(dmg) {
    player.hp -= dmg;
    player.hurtFlash = 0.25;
  }

  // ----------------------------------------------------------------------
  //  Dibujo
  // ----------------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, VW, VH);
    cam = computeCam();
    // ---- mundo (con cámara) ----
    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-cam.x, -cam.y);
    drawGround();
    drawTown();
    if (game.state === "mission" && encargo && inRegion(game.mission.px, game.mission.py)) drawEncargo();
    if (game.state === "mission" && dropzone && inRegion(game.mission.dx, game.mission.dy)) drawDropzone();
    drawPickups();
    drawBullets(ebullets, "#ff8a3a");
    drawZombies();
    drawEnemies();
    drawDogs();
    if (player) drawPlayer();
    drawBullets(bullets, null);
    drawParticles();
    ctx.restore();
    // ---- interfaz (sin cámara) ----
    drawHUD();
    drawFlash();
    drawHurtVignette();
  }

  function drawGround() {
    const reg = getRegion(game.region.x, game.region.y);
    ctx.fillStyle = reg.tint;
    ctx.fillRect(0, 0, W, H);
    // textura de césped: motas sutiles deterministas
    const r2 = mulberry32((game.region.x + 7) * 101 + (game.region.y + 3) * 53);
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let i = 0; i < 420; i++) {
      const x = r2() * W, y = r2() * H, s = 2 + r2() * 5;
      ctx.fillRect(x, y, s, s);
    }
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let i = 0; i < 260; i++) ctx.fillRect(r2() * W, r2() * H, 2, 2);
    // borde de la región (límite donde se cambia de zona)
    ctx.strokeStyle = "rgba(120,180,90,0.16)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  function drawTown() {
    const t = getRegion(game.region.x, game.region.y).town;
    // recorte a la vista de cámara (rendimiento)
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + VW / ZOOM, vy1 = cam.y + VH / ZOOM;
    const vis = (x, y, w, h) => x < vx1 + 60 && x + w > vx0 - 60 && y < vy1 + 60 && y + h > vy0 - 60;
    const visP = (p) => p.w ? vis(p.x, p.y, p.w, p.h) : vis(p.x - 40, p.y - 40, 80, 80);
    for (const r of t.roads) drawRoad(r);
    if (t.plazaRect) drawPlaza(t.plazaRect);
    // props de suelo (vallas, estanques) por debajo de los edificios
    for (const p of t.props) if ((p.t === "fence" || p.t === "pond") && visP(p)) drawProp(p);
    for (const b of t.buildings) if (vis(b.x, b.y, b.w, b.h)) drawBuilding(b);
    for (const s of t.stalls) if (vis(s.x, s.y, s.w, s.h)) drawStall(s);
    // props superiores (árboles, farolas, coches, etc.)
    for (const p of t.props) if (p.t !== "fence" && p.t !== "pond" && visP(p)) drawProp(p);
  }

  function drawProp(p) {
    if (p.t === "tree") {
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.beginPath(); ctx.ellipse(p.x + 5, p.y + 7, p.r, p.r * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#5a4030"; ctx.fillRect(p.x - 3, p.y - 2, 6, 9); // tronco
      ctx.fillStyle = "#2f5a30"; ctx.beginPath(); ctx.arc(p.x, p.y - 4, p.r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#3c7038"; ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - 4 - p.r * 0.3, p.r * 0.62, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.beginPath(); ctx.arc(p.x - p.r * 0.4, p.y - 4 - p.r * 0.4, p.r * 0.34, 0, TAU); ctx.fill();
    } else if (p.t === "light") {
      ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(p.x + 6, p.y + 3, 8, 3.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#3a3a40"; ctx.fillRect(p.x - 2.5, p.y - 18, 5, 20); // poste
      ctx.fillStyle = "rgba(240,210,120,0.16)"; ctx.beginPath(); ctx.arc(p.x, p.y - 20, 15, 0, TAU); ctx.fill(); // halo
      ctx.fillStyle = "#e8c860"; ctx.beginPath(); ctx.arc(p.x, p.y - 20, 5, 0, TAU); ctx.fill(); // lámpara
    } else if (p.t === "car") {
      const w = p.horiz ? 62 : 30, h = p.horiz ? 30 : 62;
      ctx.fillStyle = "rgba(0,0,0,0.32)"; roundRectPath(p.x - w / 2 + 5, p.y - h / 2 + 6, w, h, 7); ctx.fill();
      ctx.fillStyle = p.color; roundRectPath(p.x - w / 2, p.y - h / 2, w, h, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)"; roundRectPath(p.x - w / 2 + 3, p.y - h / 2 + 3, w - 6, (h - 6) * 0.42, 4); ctx.fill();
      ctx.fillStyle = "#2a3038";
      if (p.horiz) { ctx.fillRect(p.x - w / 2 + 12, p.y - h / 2 + 5, 11, h - 10); ctx.fillRect(p.x + w / 2 - 23, p.y - h / 2 + 5, 11, h - 10); }
      else { ctx.fillRect(p.x - w / 2 + 5, p.y - h / 2 + 12, w - 10, 11); ctx.fillRect(p.x - w / 2 + 5, p.y + h / 2 - 23, w - 10, 11); }
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1.5; roundRectPath(p.x - w / 2, p.y - h / 2, w, h, 7); ctx.stroke();
    } else if (p.t === "bush") {
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, 11, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#356b35"; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = "#447a44"; ctx.beginPath(); ctx.arc(p.x - 3, p.y - 3, 6, 0, TAU); ctx.fill();
    } else if (p.t === "fence") {
      ctx.strokeStyle = "#8a7250"; ctx.lineWidth = 3; ctx.setLineDash([9, 7]);
      ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.setLineDash([]);
      ctx.fillStyle = "#6e5a3c"; // postes en las esquinas
      ctx.fillRect(p.x - 2, p.y - 2, 5, 5); ctx.fillRect(p.x + p.w - 3, p.y - 2, 5, 5);
      ctx.fillRect(p.x - 2, p.y + p.h - 3, 5, 5); ctx.fillRect(p.x + p.w - 3, p.y + p.h - 3, 5, 5);
    } else if (p.t === "pond") {
      ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(p.x + p.w / 2 + 4, p.y + p.h / 2 + 5, p.w / 2, p.h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#3f6f86"; ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#5a92aa"; ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w / 2 - 8, p.h / 2 - 8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.ellipse(p.x + p.w * 0.38, p.y + p.h * 0.36, p.w * 0.12, p.h * 0.08, 0, 0, TAU); ctx.fill();
    } else if (p.t === "bench") {
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(p.x + 2, p.y + 3, 34, 12);
      ctx.fillStyle = "#6b4a2a"; ctx.fillRect(p.x, p.y, 34, 12);
      ctx.fillStyle = "#5a3f24"; ctx.fillRect(p.x, p.y, 34, 3);
    } else if (p.t === "crate") {
      ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(p.x - 9, p.y - 7, 22, 22);
      ctx.fillStyle = "#8a6a3a"; ctx.fillRect(p.x - 11, p.y - 9, 22, 22);
      ctx.strokeStyle = "#5e4426"; ctx.lineWidth = 2; ctx.strokeRect(p.x - 11, p.y - 9, 22, 22);
      ctx.beginPath(); ctx.moveTo(p.x - 11, p.y - 9); ctx.lineTo(p.x + 11, p.y + 13); ctx.moveTo(p.x + 11, p.y - 9); ctx.lineTo(p.x - 11, p.y + 13); ctx.stroke();
    }
  }

  function drawRoad(r) {
    // asfalto
    ctx.fillStyle = "#34373a";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // aceras (bordes claros)
    ctx.fillStyle = "#6c6f6a";
    if (r.dir === "v") {
      ctx.fillRect(r.x - 4, r.y, 4, r.h); ctx.fillRect(r.x + r.w, r.y, 4, r.h);
    } else {
      ctx.fillRect(r.x, r.y - 4, r.w, 4); ctx.fillRect(r.x, r.y + r.h, r.w, 4);
    }
    // línea discontinua central
    ctx.strokeStyle = "rgba(230,210,120,0.55)";
    ctx.lineWidth = 3; ctx.setLineDash([16, 16]);
    ctx.beginPath();
    if (r.dir === "v") { ctx.moveTo(r.x + r.w / 2, r.y); ctx.lineTo(r.x + r.w / 2, r.y + r.h); }
    else { ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function drawPlaza(p) {
    ctx.fillStyle = "#8a8278";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    // baldosas
    ctx.strokeStyle = "rgba(0,0,0,0.10)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = p.x; x <= p.x + p.w; x += 28) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); }
    for (let y = p.y; y <= p.y + p.h; y += 28) { ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); }
    ctx.stroke();
    // fuente central decorativa (salvo si cae sobre el punto de aparición)
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (dist2(cx, cy, W / 2, H / 2) < 80 * 80) return;
    ctx.fillStyle = "#6f7d86"; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = "#3f5d6e"; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, TAU); ctx.fill();
    ctx.fillStyle = "#7fb0c4"; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.fill();
  }

  function drawBuilding(b) {
    // acera bajo el edificio (sigue el contorno)
    ctx.fillStyle = "#7a7d76";
    for (const r of b.rects) { roundRectPath(r.x - 7, r.y - 7, r.w + 14, r.h + 14, 6); ctx.fill(); }
    // sombra proyectada
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    for (const r of b.rects) ctx.fillRect(r.x + 6, r.y + 8, r.w, r.h);
    // muros (esquinas rectas para que las piezas en L se fundan)
    ctx.fillStyle = b.wall;
    for (const r of b.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    // tejado por cada pieza
    for (const r of b.rects) drawRoof(r, b);
    // ventanas y puerta sobre el rectángulo principal
    drawWindows(b.rects[0]);
    drawDoor(b);
  }

  function drawRoof(r, b) {
    const I = 13, x = r.x, y = r.y, w = r.w, h = r.h;
    if (w - 2 * I < 6 || h - 2 * I < 6) { ctx.fillStyle = b.roof; ctx.fillRect(x + 3, y + 3, w - 6, h - 6); return; }
    ctx.fillStyle = b.roof;
    ctx.fillRect(x + I, y + I, w - 2 * I, h - 2 * I);
    if (b.roofType === "gable") {
      ctx.strokeStyle = "rgba(255,255,255,0.13)"; ctx.lineWidth = 3;
      ctx.beginPath();
      if (w >= h) { ctx.moveTo(x + I + 6, y + h / 2); ctx.lineTo(x + w - I - 6, y + h / 2); }
      else { ctx.moveTo(x + w / 2, y + I + 6); ctx.lineTo(x + w / 2, y + h - I - 6); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2; ctx.strokeRect(x + I, y + I, w - 2 * I, h - 2 * I);
      ctx.fillStyle = "#4a3a30"; ctx.fillRect(x + w - I - 16, y + I + 7, 11, 11); // chimenea
    } else if (b.roofType === "hip") {
      // tejado a cuatro aguas: líneas diagonales desde el caballete a las esquinas
      ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + I, y + I);
      ctx.moveTo(x + w, y); ctx.lineTo(x + w - I, y + I);
      ctx.moveTo(x, y + h); ctx.lineTo(x + I, y + h - I);
      ctx.moveTo(x + w, y + h); ctx.lineTo(x + w - I, y + h - I);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 2;
      ctx.beginPath();
      if (w >= h) { ctx.moveTo(x + I + 8, y + h / 2); ctx.lineTo(x + w - I - 8, y + h / 2); }
      else { ctx.moveTo(x + w / 2, y + I + 8); ctx.lineTo(x + w / 2, y + h - I - 8); }
      ctx.stroke();
    } else {
      // plano (local): parapeto + unidad de aire
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 3; ctx.strokeRect(x + I, y + I, w - 2 * I, h - 2 * I);
      ctx.fillStyle = "#5a5f63"; ctx.fillRect(x + w / 2 - 11, y + h / 2 - 8, 22, 16);
      ctx.fillStyle = "#474b4e"; ctx.fillRect(x + w / 2 - 8, y + h / 2 - 5, 7, 10);
    }
  }

  function drawWindows(b, I) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const win = (wx, wy, ww, wh) => {
      ctx.fillStyle = "#cfe6ee"; ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1; ctx.strokeRect(wx, wy, ww, wh);
    };
    const nH = Math.max(1, Math.floor((w - 44) / 50));
    const nV = Math.max(1, Math.floor((h - 44) / 50));
    for (let i = 0; i < nH; i++) {
      const wx = x + 22 + i * ((w - 44) / nH) + ((w - 44) / nH - 14) / 2;
      win(wx, y + 3.5, 14, 7); win(wx, y + h - 10.5, 14, 7);
    }
    for (let j = 0; j < nV; j++) {
      const wy = y + 22 + j * ((h - 44) / nV) + ((h - 44) / nV - 14) / 2;
      win(x + 3.5, wy, 7, 14); win(x + w - 10.5, wy, 7, 14);
    }
  }

  function drawDoor(b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.fillStyle = "#3a2a1c";
    if (b.door === "S") {
      const dx = x + w / 2 - 11;
      ctx.fillRect(dx, y + h - 9, 22, 9);
      if (b.awning) { ctx.fillStyle = b.awning; ctx.fillRect(dx - 9, y + h - 1, 40, 11); drawStripes(dx - 9, y + h - 1, 40, 11); }
    } else {
      const dy = y + h / 2 - 11;
      ctx.fillRect(x + w - 9, dy, 9, 22);
      if (b.awning) { ctx.fillStyle = b.awning; ctx.fillRect(x + w - 1, dy - 9, 11, 40); drawStripes(x + w - 1, dy - 9, 11, 40); }
    }
  }

  function drawStripes(x, y, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    if (w > h) for (let i = x; i < x + w; i += 8) ctx.fillRect(i, y, 4, h);
    else for (let i = y; i < y + h; i += 8) ctx.fillRect(x, i, w, 4);
    ctx.restore();
  }

  function drawStall(s) {
    // puesto de mercado: mesa + toldo a rayas
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(s.x + 4, s.y + 5, s.w, s.h);
    ctx.fillStyle = "#7a5a38"; ctx.fillRect(s.x, s.y + s.h - 15, s.w, 15); // mesa
    ctx.fillStyle = "#caa15a"; ctx.fillRect(s.x + 3, s.y + s.h - 12, s.w - 6, 6); // género
    ctx.fillStyle = "#b0563a"; ctx.fillRect(s.x + 6, s.y + s.h - 11, 6, 4);
    ctx.fillStyle = "#2e7d52"; ctx.fillRect(s.x + s.w - 14, s.y + s.h - 11, 6, 4);
    ctx.fillStyle = s.awning; ctx.fillRect(s.x - 3, s.y, s.w + 6, 13); // toldo
    drawStripes(s.x - 3, s.y, s.w + 6, 13);
    ctx.fillStyle = "#5e4630"; // postes
    ctx.fillRect(s.x, s.y + 12, 4, s.h - 20); ctx.fillRect(s.x + s.w - 4, s.y + 12, 4, s.h - 20);
  }

  function drawEncargo() {
    const e = encargo;
    const pulse = 0.5 + 0.5 * Math.sin(e.pulse * 4);
    ctx.save();
    ctx.translate(e.x, e.y);
    // halo
    ctx.fillStyle = `rgba(255,216,107,${0.12 + pulse * 0.12})`;
    ctx.beginPath(); ctx.arc(0, 0, 40 + pulse * 8, 0, TAU); ctx.fill();
    // caja
    ctx.fillStyle = "#9a6b32"; ctx.fillRect(-18, -18, 36, 36);
    ctx.fillStyle = "#b5823f"; ctx.fillRect(-18, -18, 36, 10);
    ctx.strokeStyle = "#5e3f1c"; ctx.lineWidth = 3; ctx.strokeRect(-18, -18, 36, 36);
    ctx.strokeStyle = "#ffd86b"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.moveTo(0, -18); ctx.lineTo(0, 18); ctx.stroke();
    ctx.restore();

    // indicador de interacción
    const near = dist2(player.x, player.y, e.x, e.y) < 50 * 50;
    if (near) {
      ctx.fillStyle = enemies.length === 0 ? "#9fe86a" : "#ff7a6b";
      ctx.font = "bold 16px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(enemies.length === 0 ? "Pulsa E para recoger" : "¡Elimina a los guardias!", e.x, e.y - 46);
      ctx.textAlign = "left";
    }
  }

  function drawDropzone() {
    const d = dropzone;
    const pulse = 0.5 + 0.5 * Math.sin(d.pulse * 4);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.strokeStyle = `rgba(150,230,110,${0.4 + pulse * 0.4})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(150,230,110,${0.08 + pulse * 0.1})`;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
    ctx.fillStyle = "#9fe86a";
    ctx.font = "bold 26px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✓", 0, 1);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.restore();

    const near = dist2(player.x, player.y, d.x, d.y) < 60 * 60;
    if (near) {
      ctx.fillStyle = "#9fe86a"; ctx.font = "bold 16px Segoe UI"; ctx.textAlign = "center";
      ctx.fillText("Pulsa E para entregar", d.x, d.y - 50); ctx.textAlign = "left";
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      const bob = Math.sin(p.t * 4) * 3;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.scale(SCALE, SCALE);
      if (p.type === "health") {
        ctx.fillStyle = "#1c2a1c"; ctx.fillRect(-9, -9, 18, 18);
        ctx.fillStyle = "#6fe06f";
        ctx.fillRect(-2, -7, 4, 14); ctx.fillRect(-7, -2, 14, 4);
      } else {
        ctx.fillStyle = "#2a2410"; ctx.fillRect(-9, -7, 18, 14);
        ctx.fillStyle = "#ffd24a"; ctx.fillRect(-7, -4, 5, 8); ctx.fillRect(-1, -4, 5, 8); ctx.fillRect(5, -4, 2, 8);
      }
      ctx.restore();
    }
  }

  // --- Personaje genérico top-down con extremidades animadas ---
  function drawHumanoid(o, opts) {
    const { bodyColor, headColor = "#caa07a", scale = 1, weapon = null } = opts;
    const swing = Math.sin(o.walkCycle) * (o.moving === false ? 0 : 1);
    ctx.save();
    ctx.translate(o.x, o.y);

    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(0, 6, 15 * scale, 8 * scale, 0, 0, TAU); ctx.fill();

    ctx.rotate(o.aim);
    const flash = (o.hurt && o.hurt > 0) || (o.hurtFlash && o.hurtFlash > 0);

    // piernas (oscilan a lo largo del eje de avance)
    ctx.fillStyle = flash ? "#ffffff" : "#2c3322";
    const legLen = 9 * scale;
    drawLimb(-4 * scale, -6 * scale, swing * legLen, 5 * scale);
    drawLimb(-4 * scale, 6 * scale, -swing * legLen, 5 * scale);

    // cuerpo
    ctx.fillStyle = flash ? "#ffffff" : bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13 * scale, 11 * scale, 0, 0, TAU);
    ctx.fill();

    // brazos sosteniendo el arma hacia adelante
    ctx.fillStyle = flash ? "#ffffff" : headColor;
    drawLimb(6 * scale, -9 * scale, 4 * scale, 4 * scale);
    drawLimb(6 * scale, 9 * scale, 4 * scale, 4 * scale);

    // arma
    if (weapon === "ranged") {
      ctx.fillStyle = "#2b2b2b";
      ctx.fillRect(10 * scale, -3 * scale, 18 * scale, 6 * scale);
      ctx.fillStyle = "#444";
      ctx.fillRect(10 * scale, 1 * scale, 5 * scale, 6 * scale);
    } else if (weapon === "melee") {
      const s = (o.meleeSwing && o.meleeSwing > 0) ? (1 - o.meleeSwing / 0.22) : 0;
      ctx.save();
      ctx.rotate(lerp(-0.6, 0.7, s));
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(12 * scale, -2 * scale, 24 * scale, 4 * scale);
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(8 * scale, -2.5 * scale, 6 * scale, 5 * scale);
      ctx.restore();
    }

    // cabeza
    ctx.fillStyle = flash ? "#ffffff" : headColor;
    ctx.beginPath(); ctx.arc(4 * scale, 0, 7 * scale, 0, TAU); ctx.fill();

    ctx.restore();
  }

  // dibuja una extremidad como cápsula a lo largo del eje frontal (x)
  function drawLimb(baseX, baseY, reach, w) {
    ctx.save();
    ctx.beginPath();
    const x = baseX + reach;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.strokeStyle = ctx.fillStyle;
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(x, baseY);
    ctx.stroke();
    ctx.restore();
  }

  // trazo de rectángulo redondeado reutilizable
  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // pierna con bota al final
  function drawBootLeg(bx, by, reach, legCol, bootCol) {
    const ex = bx + reach;
    ctx.strokeStyle = legCol; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, by); ctx.stroke();
    ctx.fillStyle = bootCol;
    ctx.beginPath(); ctx.ellipse(ex + 2, by, 4, 3.2, 0, 0, TAU); ctx.fill();
  }

  // arma detallada en el marco local del personaje (+x = frente)
  function drawWeaponDetailed(o, key, w) {
    if (w.type === "ranged") {
      if (key === "rifle") {
        ctx.fillStyle = "#2c2c2e"; roundRectPath(5, -3, 15, 6, 1.6); ctx.fill();
        ctx.fillStyle = "#191919"; ctx.fillRect(19, -1.5, 15, 3);   // cañón
        ctx.fillStyle = "#3a3a3c"; ctx.fillRect(1, -2, 6, 4);        // culata
        ctx.fillStyle = "#161616"; ctx.fillRect(11, 3, 4, 7);        // cargador
        ctx.fillStyle = "#444"; ctx.fillRect(12, -5, 2, 2);          // mira
      } else {
        ctx.fillStyle = "#303033"; roundRectPath(8, -2.5, 9, 5, 1.4); ctx.fill();
        ctx.fillStyle = "#191919"; ctx.fillRect(16, -1.2, 6, 2.4);   // cañón
        ctx.fillStyle = "#454548"; ctx.fillRect(8, 2, 3, 6);         // empuñadura
      }
    } else {
      const s = o.meleeSwing > 0 ? (1 - o.meleeSwing / 0.22) : 0;
      ctx.save();
      ctx.rotate(lerp(-0.5, 0.7, s));
      if (key === "bat") {
        ctx.fillStyle = "#6b4a2a"; ctx.fillRect(8, -2, 7, 4);        // mango
        ctx.fillStyle = "#caa15a"; roundRectPath(15, -3.6, 18, 7.2, 3); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(20, -3, 2, 6);
      } else {
        ctx.fillStyle = "#5e3f1c"; ctx.fillRect(10, -1.6, 6, 3.2);   // mango
        ctx.fillStyle = "#d8dde0";
        ctx.beginPath(); ctx.moveTo(16, -2.2); ctx.lineTo(27, 0); ctx.lineTo(16, 2.2); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  // cabeza con tocado caracterizado
  function drawHead(o, c, F) {
    const hx = 5;
    // cabeza (piel)
    ctx.fillStyle = F(c.head);
    ctx.beginPath(); ctx.arc(hx, 0, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath(); ctx.arc(hx - 1, 2, 6.4, 0, TAU); ctx.fill();

    const g = c.headgear;
    if (g === "cap" || g === "helmet") {
      if (g === "cap") { ctx.fillStyle = F(c.gear); roundRectPath(hx + 4, -4.5, 7, 9, 2.5); ctx.fill(); }
      ctx.fillStyle = F(c.gear);
      ctx.beginPath(); ctx.arc(hx - 1.8, 0, 7.4, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.arc(hx - 3, -2.5, 3, 0, TAU); ctx.fill();
      if (c.accent && g === "cap") { ctx.fillStyle = F(c.accent); ctx.fillRect(hx + 0.5, -2, 3, 4); }
      if (c.visor) { ctx.fillStyle = "rgba(15,22,30,0.92)"; roundRectPath(hx + 2.5, -5, 4.5, 10, 2); ctx.fill(); }
    } else if (g === "hood") {
      ctx.fillStyle = F(c.gear);
      ctx.beginPath(); ctx.arc(hx - 2.5, 0, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath(); ctx.arc(hx - 0.5, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = F(c.head);
      ctx.beginPath(); ctx.arc(hx + 2, 0, 5, 0, TAU); ctx.fill();
    } else if (g === "bandana") {
      ctx.fillStyle = F(c.hair);
      ctx.beginPath(); ctx.arc(hx - 2.2, 0, 7.2, 0, TAU); ctx.fill();
      ctx.fillStyle = F(c.accent); roundRectPath(hx - 1, -7.2, 4, 14.4, 1.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 5, 4); ctx.lineTo(hx - 12, 7); ctx.lineTo(hx - 5, 8); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = F(c.hair);
      ctx.beginPath(); ctx.arc(hx - 2.2, 0, 7.2, 0, TAU); ctx.fill();
    }
    // nariz (indica el frente)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.arc(hx + 6.4, 0, 1.2, 0, TAU); ctx.fill();
  }

  // render detallado del personaje del jugador
  function drawCharacter(o, c, w) {
    const swing = Math.sin(o.walkCycle) * (o.moving ? 1 : 0);
    const flash = o.hurtFlash > 0;
    const F = (col) => (flash ? "#ffffff" : col);
    const key = o.weapons[o.slot];
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(SCALE, SCALE);
    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath(); ctx.ellipse(0, 7, 17, 9, 0, 0, TAU); ctx.fill();
    ctx.rotate(o.aim);

    // piernas + botas
    drawBootLeg(-2, -7, swing * 8, F(c.pants), F("#15110b"));
    drawBootLeg(-2, 7, -swing * 8, F(c.pants), F("#15110b"));

    // brazo trasero (detrás del torso)
    ctx.strokeStyle = F(c.body); ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(1, 8); ctx.lineTo(13, 5); ctx.stroke();

    // torso
    ctx.fillStyle = F(c.body);
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 11.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath(); ctx.ellipse(2, -3, 9, 6, 0, 0, TAU); ctx.fill();

    // chaleco
    if (c.vest) {
      ctx.fillStyle = F(c.vest); roundRectPath(-7, -8, 13, 16, 4); ctx.fill();
      ctx.strokeStyle = F(c.accent); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-2, -7.5); ctx.lineTo(-2, 7.5); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.26)";
      ctx.fillRect(-6, -6, 4, 4); ctx.fillRect(-6, 2.2, 4, 4);
    }
    // emblema (cruz médica)
    if (c.id === "medic") {
      ctx.fillStyle = F(c.accent);
      ctx.fillRect(-2.5, -1.6, 5, 3.2); ctx.fillRect(-1.1, -3, 2.2, 6);
    }

    // arma
    drawWeaponDetailed(o, key, w);

    // brazo delantero + mano
    ctx.strokeStyle = F(c.body); ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(1, -8); ctx.lineTo(15, -3); ctx.stroke();
    ctx.fillStyle = F(c.head);
    ctx.beginPath(); ctx.arc(15, -3, 2.6, 0, TAU); ctx.fill();

    // cabeza
    drawHead(o, c, F);

    ctx.restore();
  }

  function drawPlayer() {
    const w = currentWeapon();
    drawCharacter(player, player.char, w);

    // arco de golpe melee
    if (w.type === "melee" && player.meleeSwing > 0) {
      const s = 1 - player.meleeSwing / 0.22;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.aim);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - s)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, w.range, -w.arc / 2 + s * w.arc * 0.4, w.arc / 2 - s * w.arc * 0.1);
      ctx.stroke();
      ctx.restore();
    }

    // encargo cargado encima del jugador
    if (game.carrying) {
      ctx.save();
      ctx.translate(player.x, player.y - 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(-11, -13, 24, 24);
      ctx.fillStyle = "#9a6b32"; ctx.fillRect(-12, -14, 24, 24);
      ctx.fillStyle = "#b5823f"; ctx.fillRect(-12, -14, 24, 7);
      ctx.strokeStyle = "#5e3f1c"; ctx.lineWidth = 2; ctx.strokeRect(-12, -14, 24, 24);
      ctx.strokeStyle = "#ffd86b"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(12, -2); ctx.moveTo(0, -14); ctx.lineTo(0, 10); ctx.stroke();
      ctx.restore();
    }

    // barra de recarga
    if (player.reloading > 0) {
      const rw = WEAPONS[player.weapons[player.slot]].reload;
      const pct = 1 - player.reloading / rw;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(player.x - 22, player.y - 34, 44, 7);
      ctx.fillStyle = "#ffd24a";
      ctx.fillRect(player.x - 21, player.y - 33, 42 * pct, 5);
      ctx.fillStyle = "#fff"; ctx.font = "9px Segoe UI"; ctx.textAlign = "center";
      ctx.fillText("RECARGANDO", player.x, player.y - 38); ctx.textAlign = "left";
    }
  }

  function drawZombies() {
    for (const z of zombies) {
      drawZombie(z);
      drawHealthBar(z);
    }
  }

  // render detallado y caracterizado del zombi (vista cenital, +x = frente)
  function drawZombie(z) {
    const s = z.r / 15;
    const swing = Math.sin(z.walkCycle);
    const flash = z.hurt > 0;
    const F = (c) => (flash ? "#ffffff" : c);
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.scale(s, s);
    // sombra
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(0, 6, 15, 8, 0, 0, TAU); ctx.fill();
    ctx.rotate(z.aim);

    // piernas (zancada irregular)
    ctx.strokeStyle = F(z.pants); ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(-3 + swing * 7, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(-3 - swing * 7, 6); ctx.stroke();

    // brazos extendidos hacia adelante (pose zombi)
    ctx.strokeStyle = F(z.skin); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(19 + swing * 1.5, -5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(19 - swing * 1.5, 5); ctx.stroke();
    ctx.fillStyle = F(z.skin);
    ctx.beginPath(); ctx.arc(20 + swing * 1.5, -5, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(20 - swing * 1.5, 5, 2.6, 0, TAU); ctx.fill();

    // torso (camisa desgarrada)
    ctx.fillStyle = F(z.shirt);
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 10.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.beginPath(); ctx.ellipse(-1, 2, 9, 6, 0, 0, TAU); ctx.fill();
    // jirón con piel/carne expuesta
    ctx.fillStyle = F(z.skin);
    ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(4, -3); ctx.lineTo(-1, 3); ctx.lineTo(-6, -2); ctx.closePath(); ctx.fill();
    // herida sangrante
    ctx.fillStyle = F("#5e1414");
    ctx.beginPath(); ctx.arc(z.wound.x, z.wound.y, z.wound.r, 0, TAU); ctx.fill();
    if (z.gore) { ctx.fillStyle = "rgba(120,20,20,0.5)"; ctx.beginPath(); ctx.arc(z.wound.x - 3, z.wound.y + 2, z.wound.r * 0.7, 0, TAU); ctx.fill(); }

    // cabeza
    ctx.fillStyle = F(z.skin);
    ctx.beginPath(); ctx.arc(5, 0, 7, 0, TAU); ctx.fill();
    // pelo (parche trasero)
    if (z.hair) {
      ctx.fillStyle = F(z.hair);
      ctx.beginPath(); ctx.arc(2.5, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = F(z.skin);
      ctx.beginPath(); ctx.arc(6.5, 0, 5.6, 0, TAU); ctx.fill(); // cara al frente
    }
    // sombra de la mandíbula / boca
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(10, -1.6, 2.6, 3.2);
    // ojos brillantes al frente
    ctx.fillStyle = flash ? "#000" : F(z.eye);
    ctx.beginPath(); ctx.arc(8.2, -2.4, 1.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(8.2, 2.4, 1.3, 0, TAU); ctx.fill();

    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      drawHumanoid(e, { bodyColor: "#8a3a3a", headColor: "#c99", scale: e.r / 16, weapon: "ranged" });
      drawHealthBar(e);
    }
  }

  function drawDogs() {
    for (const d of dogs) {
      const swing = Math.sin(d.walkCycle);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(d.r / 11, d.r / 11);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(0, 5, 13, 6, 0, 0, TAU); ctx.fill();
      ctx.rotate(d.aim);
      const flash = d.hurt > 0;
      ctx.fillStyle = flash ? "#ffffff" : "#5a4632";
      // patas (animadas)
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(6, -7); ctx.lineTo(6 + swing * 5, -10);
      ctx.moveTo(6, 7); ctx.lineTo(6 - swing * 5, 10);
      ctx.moveTo(-6, -7); ctx.lineTo(-6 - swing * 5, -10);
      ctx.moveTo(-6, 7); ctx.lineTo(-6 + swing * 5, 10);
      ctx.stroke();
      // cola
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-19, swing * 4); ctx.stroke();
      // cuerpo
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, TAU); ctx.fill();
      // cabeza
      ctx.beginPath(); ctx.arc(12, 0, 6, 0, TAU); ctx.fill();
      ctx.fillRect(15, -2, 6, 4); // hocico
      // orejas
      ctx.fillStyle = flash ? "#ffffff" : "#3f3022";
      ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(8, -10); ctx.lineTo(13, -6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(8, 10); ctx.lineTo(13, 6); ctx.fill();
      ctx.restore();
      drawHealthBar(d);
    }
  }

  function drawHealthBar(e) {
    if (e.hp >= e.maxHp) return;
    const pct = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(e.x - 16, e.y - e.r - 12, 32, 5);
    ctx.fillStyle = pct > 0.5 ? "#7fd06a" : pct > 0.25 ? "#ffce4a" : "#ff5a4a";
    ctx.fillRect(e.x - 15, e.y - e.r - 11, 30 * pct, 3);
  }

  function drawBullets(arr, forced) {
    for (const b of arr) {
      ctx.fillStyle = forced || b.color || "#ffe27a";
      ctx.save();
      ctx.translate(b.x, b.y);
      const a = Math.atan2(b.vy, b.vx);
      ctx.rotate(a);
      ctx.fillRect(-5, -1.5, 10, 3);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawHurtVignette() {
    if (!player || player.hurtFlash <= 0) return;
    const a = clamp(player.hurtFlash, 0, 0.25) / 0.25 * 0.4;
    const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH * 0.75);
    g.addColorStop(0, "rgba(180,0,0,0)");
    g.addColorStop(1, `rgba(180,0,0,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);
  }

  // ----------------------------------------------------------------------
  //  HUD
  // ----------------------------------------------------------------------
  function drawHUD() {
    // barra de vida
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(20, 20, 260, 56);
    ctx.fillStyle = "#3a1414";
    ctx.fillRect(30, 30, 240, 16);
    const hp = clamp(player.hp / player.maxHp, 0, 1);
    ctx.fillStyle = hp > 0.5 ? "#6fd06a" : hp > 0.25 ? "#ffce4a" : "#ff5a4a";
    ctx.fillRect(30, 30, 240 * hp, 16);
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(30, 30, 240, 16);
    ctx.fillStyle = "#fff"; ctx.font = "bold 12px Segoe UI"; ctx.textAlign = "left";
    ctx.fillText(`VIDA ${Math.max(0, Math.ceil(player.hp))}/${player.maxHp}`, 34, 42);

    // arma y munición
    const key = player.weapons[player.slot];
    const w = WEAPONS[key];
    ctx.font = "bold 18px Segoe UI";
    ctx.fillStyle = "#e8efe8";
    ctx.fillText(w.name, 34, 68);
    if (w.type === "ranged") {
      ctx.font = "16px Segoe UI";
      ctx.fillStyle = player.ammo[key] === 0 ? "#ff7a6b" : "#ffd24a";
      ctx.fillText(`${player.ammo[key]} / ${player.reserve[key]}`, 130, 68);
    } else {
      ctx.font = "13px Segoe UI"; ctx.fillStyle = "#9fb09f";
      ctx.fillText("∞", 130, 68);
    }
    // ranura de armas
    ctx.font = "11px Segoe UI"; ctx.fillStyle = "#7f8f7f";
    ctx.fillText(`[1] ${WEAPONS[player.weapons[0]].name}   [2] ${WEAPONS[player.weapons[1]].name}`, 34, 90);

    // objetivo (arriba centro)
    ctx.textAlign = "center";
    ctx.font = "bold 20px Segoe UI";
    ctx.fillStyle = "#fff";
    if (game.state === "wave") {
      ctx.fillStyle = "#ff9a8a";
      ctx.fillText(`OLEADA ${game.wave} / ${game.maxWaves}`, VW / 2, 34);
      ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
      ctx.fillText(`Zombies: ${game.zombiesKilled} / ${game.zombiesGoal}`, VW / 2, 56);
    } else if (game.state === "mission") {
      const t = missionTarget();
      const here = game.region.x === t.x && game.region.y === t.y;
      if (game.mission.phase === "pickup") {
        ctx.fillStyle = "#ffd86b";
        ctx.fillText("RECOGE EL ENCARGO", VW / 2, 34);
        ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
        let pendingDef = 0;
        for (const p of pending) if (p.kind === "enemy" || p.kind === "dog") pendingDef++;
        const defenders = enemies.length + dogs.length + pendingDef;
        ctx.fillText(here ? (defenders ? `Defensores restantes: ${defenders}` : "Pulsa E junto al encargo")
          : `Dirígete a la región ${regName(t.x, t.y)}`, VW / 2, 56);
      } else {
        ctx.fillStyle = "#9fe86a";
        ctx.fillText("ENTREGA EL ENCARGO", VW / 2, 34);
        ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
        ctx.fillText(here ? "Llega al punto de entrega y pulsa E"
          : `Llévalo a la región ${regName(t.x, t.y)}`, VW / 2, 56);
        // cronómetro de entrega
        const tleft = Math.max(0, game.deliverTime);
        const mm = Math.floor(tleft / 60), ss = Math.floor(tleft % 60);
        const low = tleft <= 10;
        ctx.font = "bold 24px Segoe UI";
        ctx.fillStyle = low
          ? ((Math.floor(performance.now() / 200) % 2) ? "#ff5a4a" : "#ffd0c0")
          : "#ffd86b";
        ctx.fillText(`⏱ ${mm}:${ss.toString().padStart(2, "0")}`, VW / 2, 82);
      }
    }
    ctx.textAlign = "left";

    // puntuación
    ctx.font = "13px Segoe UI"; ctx.fillStyle = "#9fb09f";
    ctx.textAlign = "right";
    ctx.fillText(`Puntos: ${game.score}`, VW - 20, 30);
    ctx.textAlign = "left";

    drawMinimap();
    drawEdgeArrows();
  }

  function drawMinimap() {
    const cell = 26, pad = 4;
    const mw = REGIONS_X * cell + pad * 2;
    const mh = REGIONS_Y * cell + pad * 2;
    const ox = VW - mw - 20, oy = VH - mh - 20;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(ox - 4, oy - 18, mw + 8, mh + 22);
    ctx.fillStyle = "#9fb09f"; ctx.font = "11px Segoe UI";
    ctx.fillText("MAPA", ox, oy - 6);
    for (let y = 0; y < REGIONS_Y; y++) {
      for (let x = 0; x < REGIONS_X; x++) {
        const cx = ox + pad + x * cell, cy = oy + pad + y * cell;
        ctx.fillStyle = "#1c241a";
        ctx.fillRect(cx, cy, cell - 3, cell - 3);
        // región objetivo de la misión (recogida o entrega)
        if (game.state === "mission" && game.mission) {
          const t = missionTarget();
          if (t.x === x && t.y === y) {
            const blink = Math.floor(performance.now() / 300) % 2;
            if (game.mission.phase === "pickup") ctx.fillStyle = blink ? "#ffd86b" : "#9a7b2f";
            else ctx.fillStyle = blink ? "#9fe86a" : "#4d7a2f";
            ctx.fillRect(cx, cy, cell - 3, cell - 3);
          }
        }
        // región actual
        if (game.region.x === x && game.region.y === y) {
          ctx.fillStyle = "#5fa83f";
          ctx.fillRect(cx, cy, cell - 3, cell - 3);
        }
        ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, cell - 3, cell - 3);
      }
    }
  }

  // flechas que indican un límite de región cercano (en coordenadas de vista)
  function drawEdgeArrows() {
    if (!player) return;
    ctx.fillStyle = "rgba(150,200,110,0.55)";
    const r = game.region, near = 420;
    const tri = (x, y, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    if (r.x > 0 && player.x < near) tri(26, VH / 2, Math.PI);
    if (r.x < REGIONS_X - 1 && player.x > W - near) tri(VW - 26, VH / 2, 0);
    if (r.y > 0 && player.y < near) tri(VW / 2, 26, -Math.PI / 2);
    if (r.y < REGIONS_Y - 1 && player.y > H - near) tri(VW / 2, VH - 26, Math.PI / 2);
  }

  function drawFlash() {
    if (game.flashTime <= 0 || !game.flashMsg) return;
    const a = clamp(game.flashTime / 0.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = "#000"; ctx.fillRect(0, VH / 2 - 70, VW, 130);
    ctx.fillStyle = "#9fe86a"; ctx.font = "bold 52px Segoe UI";
    ctx.fillText(game.flashMsg.title, VW / 2, VH / 2 - 8);
    if (game.flashMsg.sub) {
      ctx.fillStyle = "#e8efe8"; ctx.font = "22px Segoe UI";
      ctx.fillText(game.flashMsg.sub, VW / 2, VH / 2 + 32);
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // ----------------------------------------------------------------------
  //  Fin de partida
  // ----------------------------------------------------------------------
  function gameOver(title, detail) {
    game.state = "gameover";
    showOverlay(
      `<div class="big danger">${title || "HAS MUERTO"}</div>
       ${detail ? `<p>${detail}</p>` : ""}
       <p>Llegaste a la <b>oleada ${game.wave}</b>.</p>
       <p>Puntuación final: <b>${game.score}</b></p>`,
      "REINTENTAR"
    );
  }
  function win() {
    game.state = "victory";
    showOverlay(
      `<div class="big">¡HAS SOBREVIVIDO!</div>
       <p>Superaste las <b>${game.maxWaves} oleadas</b> y todos los encargos.</p>
       <p>Puntuación final: <b>${game.score}</b></p>`,
      "JUGAR DE NUEVO"
    );
  }

  function showOverlay(html, btnText) {
    overlayBody.innerHTML = html;
    startBtn.textContent = btnText;
    overlay.classList.remove("hidden");
  }

  // ----------------------------------------------------------------------
  //  Arranque / reinicio
  // ----------------------------------------------------------------------
  function startGame() {
    overlay.classList.add("hidden");
    game.regionCache = {};
    game.region = { x: 0, y: 0 };
    game.score = 0;
    player = makePlayer(CHARACTERS[selectedChar]);
    zombies = []; enemies = []; dogs = []; pending = []; bullets = []; ebullets = []; particles = []; pickups = [];
    encargo = null; dropzone = null; game.stash = {}; game.carrying = false;
    startWave(1);
  }

  startBtn.addEventListener("click", () => {
    overlayBody.innerHTML = "";
    startGame();
  });

  // ----------------------------------------------------------------------
  //  Selección de personaje (menú)
  // ----------------------------------------------------------------------
  function buildCharSelect() {
    const cont = document.getElementById("char-select");
    if (!cont) return;
    cont.innerHTML = "";
    CHARACTERS.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "char-card" + (i === selectedChar ? " sel" : "");
      const cv = document.createElement("canvas");
      cv.width = 72; cv.height = 64;
      card.appendChild(cv);
      const speedTag = c.speed >= 1.12 ? "Veloz" : c.speed <= 0.9 ? "Lento" : "Normal";
      const extra = c.regen ? " · Regenera" : "";
      card.insertAdjacentHTML("beforeend",
        `<div class="cn">${c.name}</div>
         <div class="cs">❤ ${c.maxHp} · ${WEAPONS[c.primary].name}</div>
         <div class="cd">${c.desc}<br>${speedTag}${extra}</div>`);
      card.addEventListener("click", () => {
        selectedChar = i;
        cont.querySelectorAll(".char-card").forEach(el => el.classList.remove("sel"));
        card.classList.add("sel");
      });
      cont.appendChild(card);
      drawCharPreview(cv, c);
    });
  }

  // dibuja una miniatura detallada del personaje (vista cenital, mirando hacia abajo)
  function drawCharPreview(cv, c) {
    const x = cv.getContext("2d");
    x.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2 + 2;
    const rr = (X, Y, W, H, R) => {
      x.beginPath(); x.moveTo(X + R, Y);
      x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R);
      x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath();
    };
    x.fillStyle = "rgba(0,0,0,0.3)";
    x.beginPath(); x.ellipse(cx, cy + 15, 15, 7, 0, 0, TAU); x.fill();
    x.save();
    x.translate(cx, cy);
    x.rotate(Math.PI / 2); // mira hacia abajo

    // piernas + botas
    x.strokeStyle = c.pants; x.lineWidth = 5; x.lineCap = "round";
    x.beginPath(); x.moveTo(-3, -6); x.lineTo(5, -6); x.moveTo(-3, 6); x.lineTo(5, 6); x.stroke();
    x.fillStyle = "#15110b";
    x.beginPath(); x.ellipse(7, -6, 3.4, 2.7, 0, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(7, 6, 3.4, 2.7, 0, 0, TAU); x.fill();
    // cuerpo
    x.fillStyle = c.body; x.beginPath(); x.ellipse(0, 0, 13, 11, 0, 0, TAU); x.fill();
    x.fillStyle = "rgba(255,255,255,0.1)"; x.beginPath(); x.ellipse(2, -3, 8, 5, 0, 0, TAU); x.fill();
    // chaleco / emblema
    if (c.vest) { x.fillStyle = c.vest; rr(-7, -8, 13, 16, 4); x.fill(); }
    if (c.id === "medic") { x.fillStyle = c.accent; x.fillRect(-2.5, -1.6, 5, 3.2); x.fillRect(-1.1, -3, 2.2, 6); }
    // arma
    if (WEAPONS[c.primary].type === "ranged") {
      if (c.primary === "rifle") { x.fillStyle = "#2c2c2e"; rr(5, -3, 15, 6, 1.6); x.fill(); x.fillStyle = "#191919"; x.fillRect(19, -1.5, 11, 3); }
      else { x.fillStyle = "#303033"; rr(8, -2.5, 9, 5, 1.4); x.fill(); x.fillStyle = "#191919"; x.fillRect(16, -1.2, 6, 2.4); }
    } else if (c.melee === "bat") {
      x.fillStyle = "#6b4a2a"; x.fillRect(8, -2, 7, 4); x.fillStyle = "#caa15a"; rr(15, -3.6, 15, 7.2, 3); x.fill();
    } else {
      x.fillStyle = "#5e3f1c"; x.fillRect(10, -1.6, 6, 3.2); x.fillStyle = "#d8dde0";
      x.beginPath(); x.moveTo(16, -2.2); x.lineTo(25, 0); x.lineTo(16, 2.2); x.closePath(); x.fill();
    }
    // cabeza + tocado
    const hx = 4;
    x.fillStyle = c.head; x.beginPath(); x.arc(hx, 0, 7, 0, TAU); x.fill();
    const g = c.headgear;
    if (g === "cap" || g === "helmet") {
      if (g === "cap") { x.fillStyle = c.gear; rr(hx + 4, -4.5, 7, 9, 2.5); x.fill(); }
      x.fillStyle = c.gear; x.beginPath(); x.arc(hx - 1.8, 0, 7.4, 0, TAU); x.fill();
      if (c.visor) { x.fillStyle = "rgba(15,22,30,0.92)"; rr(hx + 2.5, -5, 4.5, 10, 2); x.fill(); }
      else if (c.accent && g === "cap") { x.fillStyle = c.accent; x.fillRect(hx + 0.5, -2, 3, 4); }
    } else if (g === "hood") {
      x.fillStyle = c.gear; x.beginPath(); x.arc(hx - 2.5, 0, 9, 0, TAU); x.fill();
      x.fillStyle = "rgba(0,0,0,0.22)"; x.beginPath(); x.arc(hx - 0.5, 0, 7, 0, TAU); x.fill();
      x.fillStyle = c.head; x.beginPath(); x.arc(hx + 2, 0, 5, 0, TAU); x.fill();
    } else if (g === "bandana") {
      x.fillStyle = c.hair; x.beginPath(); x.arc(hx - 2.2, 0, 7.2, 0, TAU); x.fill();
      x.fillStyle = c.accent; rr(hx - 1, -7.2, 4, 14.4, 1.5); x.fill();
    } else {
      x.fillStyle = c.hair; x.beginPath(); x.arc(hx - 2.2, 0, 7.2, 0, TAU); x.fill();
    }
    x.restore();
  }

  buildCharSelect();

  // recalcula el ancho lógico cuando cambia el tamaño de la ventana
  function resizeCanvas() {
    const newVW = Math.round(VH * aspect());
    if (newVW === VW) return;
    VW = newVW;
    canvas.width = VW; canvas.height = VH;
  }
  window.addEventListener("resize", resizeCanvas);

  // ----------------------------------------------------------------------
  //  Bucle principal
  // ----------------------------------------------------------------------
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // limita saltos grandes (cambio de pestaña)
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  // pantalla inicial: dibuja un fondo de región vacío
  player = makePlayer();
  requestAnimationFrame(loop);
})();
