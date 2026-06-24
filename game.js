/* =========================================================================
   ZOMBIE APOL — juego top-down de oleadas
   HTML + CSS + JS puro, sin dependencias.
   ========================================================================= */

(() => {
  "use strict";

  // ----------------------------------------------------------------------
  //  Configuración general
  // ----------------------------------------------------------------------
  const W = 1280;            // resolución lógica
  const H = 720;
  const REGIONS_X = 4;       // tamaño del mapa en regiones (4x4 = 16 pantallas)
  const REGIONS_Y = 4;
  const EDGE = 40;           // margen para detectar cambio de región

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayBody = document.getElementById("overlay-body");
  const startBtn = document.getElementById("start-btn");

  // ----------------------------------------------------------------------
  //  Utilidades
  // ----------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
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
    mouse.x = clamp((e.clientX - r.left) / r.width * W, 0, W);
    mouse.y = clamp((e.clientY - r.top) / r.height * H, 0, H);
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
  //  Generación de regiones (obstáculos / decoración)
  // ----------------------------------------------------------------------
  function getRegion(rx, ry) {
    const key = rx + "," + ry;
    if (game.regionCache[key]) return game.regionCache[key];

    const rng = mulberry32((rx * 73856093) ^ (ry * 19349663) ^ 0x9e37);
    const obstacles = [];
    const n = 3 + Math.floor(rng() * 4);
    let tries = 0;
    while (obstacles.length < n && tries < 60) {
      tries++;
      const w = 60 + rng() * 180;
      const h = 60 + rng() * 160;
      const x = 120 + rng() * (W - 240 - w);
      const y = 120 + rng() * (H - 240 - h);
      const rect = { x, y, w, h };
      // evita que tape el centro de aparición
      if (dist2(x + w / 2, y + h / 2, W / 2, H / 2) < 160 * 160) continue;
      let overlap = false;
      for (const o of obstacles) {
        if (x < o.x + o.w + 30 && x + w + 30 > o.x && y < o.y + o.h + 30 && y + h + 30 > o.y) { overlap = true; break; }
      }
      if (!overlap) obstacles.push(rect);
    }
    // tono de terreno según región para distinguir zonas
    const tint = (rx + ry) % 2 === 0 ? "#20271f" : "#232a26";
    const data = { obstacles, tint, rng: mulberry32((rx + 1) * 911 + (ry + 1) * 333) };
    game.regionCache[key] = data;
    return data;
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
  function makePlayer() {
    return {
      x: W / 2, y: H / 2, r: 16,
      hp: 100, maxHp: 100,
      aim: 0,             // ángulo hacia el ratón
      moveAng: 0,
      walkCycle: 0,
      moving: false, running: false,
      speed: 0,
      slot: 0,            // 0 = principal, 1 = melee
      weapons: ["pistol", "knife"],
      ammo: { pistol: WEAPONS.pistol.mag, rifle: WEAPONS.rifle.mag },
      reserve: { pistol: 48, rifle: 90 },
      reloading: 0,
      cooldown: 0,
      meleeSwing: 0,      // temporizador de animación de golpe
      hurtFlash: 0,
      hasRifle: false,
    };
  }

  function currentWeapon() { return WEAPONS[player.weapons[player.slot]]; }

  // ----------------------------------------------------------------------
  //  Spawns
  // ----------------------------------------------------------------------
  function spawnZombie() {
    // aparece desde un borde de la pantalla
    const side = randInt(0, 3);
    let x, y;
    if (side === 0) { x = rand(0, W); y = -30; }
    else if (side === 1) { x = W + 30; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + 30; }
    else { x = -30; y = rand(0, H); }
    const tier = Math.random();
    let z = {
      x, y, r: 15, hp: 60, maxHp: 60, speed: rand(55, 80),
      dmg: 12, atkCd: 0, hurt: 0, walkCycle: rand(0, TAU),
      aim: 0, type: "normal", color: "#6f8f4a",
    };
    // zombies más fuertes en oleadas avanzadas
    if (game.wave >= 3 && tier > 0.78) {
      z = Object.assign(z, { hp: 150, maxHp: 150, r: 20, speed: rand(40, 58), dmg: 22, type: "brute", color: "#4f7a3a" });
    } else if (tier > 0.6) {
      z = Object.assign(z, { hp: 45, maxHp: 45, r: 13, speed: rand(95, 125), dmg: 8, type: "runner", color: "#8aa85a" });
    }
    z.hp += game.wave * 6; z.maxHp = z.hp;
    zombies.push(z);
  }

  function spawnGuard(x, y, anchor) {
    enemies.push({
      x, y, r: 16, hp: 90, maxHp: 90, speed: 70,
      aim: 0, fireCd: rand(0.5, 1.5), state: "idle",
      walkCycle: rand(0, TAU), hurt: 0, dmg: 14,
      strafeDir: Math.random() < 0.5 ? 1 : -1, // lado por el que rodea la cobertura
      flankTimer: 0, px: x, py: y,
      anchor: anchor || null, // si está anclado, defiende su región y no te persigue fuera
    });
  }

  // enemigo armado que entra desde un borde (emboscada en ruta)
  function spawnGuardEdge() {
    const side = randInt(0, 3);
    let x, y;
    if (side === 0) { x = rand(0, W); y = -28; }
    else if (side === 1) { x = W + 28; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + 28; }
    else { x = -28; y = rand(0, H); }
    spawnGuard(clamp(x, 30, W - 30), clamp(y, 30, H - 30));
  }

  // perro de ataque: rápido, cuerpo a cuerpo, acompaña a los guardias
  function spawnDog(x, y, anchor) {
    dogs.push({
      x, y, r: 11, hp: 42, maxHp: 42, speed: rand(155, 200),
      dmg: 9, atkCd: 0, aim: rand(0, TAU), walkCycle: rand(0, TAU),
      hurt: 0, moving: true,
      anchor: anchor || null,
    });
  }
  function spawnDogEdge() {
    const side = randInt(0, 3);
    let x, y;
    if (side === 0) { x = rand(0, W); y = -28; }
    else if (side === 1) { x = W + 28; y = rand(0, H); }
    else if (side === 2) { x = rand(0, W); y = H + 28; }
    else { x = -28; y = rand(0, H); }
    spawnDog(clamp(x, 30, W - 30), clamp(y, 30, H - 30));
  }

  function spawnParticles(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(spd * 0.3, spd);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), color, r: rand(1.5, 3.5) });
    }
  }

  function dropLoot(x, y) {
    const r = Math.random();
    if (r < 0.18) pickups.push({ x, y, type: "health", r: 12, t: 0 });
    else if (r < 0.5) pickups.push({ x, y, type: "ammo", r: 12, t: 0 });
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
  const INSET = 78; // a qué distancia del borde entras a la nueva región (deja sitio detrás)

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
          x: player.x + Math.cos(player.aim) * 22,
          y: player.y + Math.sin(player.aim) * 22,
          vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
          dmg: w.dmg, life: 0.9, color: w.color, r: 3,
        });
      }
      player.ammo[key]--;
      player.cooldown = w.rate;
      spawnParticles(player.x + Math.cos(player.aim) * 26, player.y + Math.sin(player.aim) * 26, "#ffcf5a", 4, 120);
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
    // dirección de apunte (hacia el ratón)
    player.aim = Math.atan2(mouse.y - player.y, mouse.x - player.x);

    // movimiento
    let dx = 0, dy = 0;
    if (keys["KeyW"] || keys["ArrowUp"]) dy -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) dy += 1;
    if (keys["KeyA"] || keys["ArrowLeft"]) dx -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) dx += 1;

    player.moving = dx !== 0 || dy !== 0;
    player.running = player.moving && (keys["ShiftLeft"] || keys["ShiftRight"]);
    const base = (player.running ? 235 : 150) * (game.carrying ? 0.78 : 1);

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
          x: e.x + Math.cos(e.aim) * 20, y: e.y + Math.sin(e.aim) * 20,
          vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
          dmg: e.dmg, life: 1.1, r: 3.5,
        });
        spawnParticles(e.x + Math.cos(e.aim) * 22, e.y + Math.sin(e.aim) * 22, "#ff9a4a", 3, 100);
      }

      if (e.hp <= 0) {
        spawnParticles(e.x, e.y, "#7a3020", 16, 220);
        if (Math.random() < 0.6) pickups.push({ x: e.x, y: e.y, type: "ammo", r: 12, t: 0 });
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
        if (Math.random() < 0.3) pickups.push({ x: d.x, y: d.y, type: "ammo", r: 12, t: 0 });
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
    ctx.clearRect(0, 0, W, H);
    drawGround();
    drawObstacles();
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
    drawHUD();
    drawFlash();
    drawHurtVignette();
  }

  function drawGround() {
    const reg = getRegion(game.region.x, game.region.y);
    ctx.fillStyle = reg.tint;
    ctx.fillRect(0, 0, W, H);
    // rejilla sutil
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // borde de la región (indica los límites donde se cambia de zona)
    ctx.strokeStyle = "rgba(120,180,90,0.18)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  function drawObstacles() {
    const obs = getRegion(game.region.x, game.region.y).obstacles;
    for (const o of obs) {
      ctx.fillStyle = "#11160f";
      ctx.fillRect(o.x + 5, o.y + 6, o.w, o.h); // sombra
      ctx.fillStyle = "#39432f";
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "#4a5740";
      ctx.fillRect(o.x, o.y, o.w, 10);
      ctx.strokeStyle = "#222a1c";
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
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

  function drawPlayer() {
    const w = currentWeapon();
    drawHumanoid(player, {
      bodyColor: "#3f6fae",
      headColor: "#d8b48a",
      scale: 1,
      weapon: w.type === "ranged" ? "ranged" : "melee",
    });

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
      drawHumanoid(z, { bodyColor: z.color, headColor: "#86a35a", scale: z.r / 15, weapon: null });
      drawHealthBar(z);
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      drawHumanoid(e, { bodyColor: "#8a3a3a", headColor: "#c99", scale: 1, weapon: "ranged" });
      drawHealthBar(e);
    }
  }

  function drawDogs() {
    for (const d of dogs) {
      const swing = Math.sin(d.walkCycle);
      ctx.save();
      ctx.translate(d.x, d.y);
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
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(180,0,0,0)");
    g.addColorStop(1, `rgba(180,0,0,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
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
      ctx.fillText(`OLEADA ${game.wave} / ${game.maxWaves}`, W / 2, 34);
      ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
      ctx.fillText(`Zombies: ${game.zombiesKilled} / ${game.zombiesGoal}`, W / 2, 56);
    } else if (game.state === "mission") {
      const t = missionTarget();
      const here = game.region.x === t.x && game.region.y === t.y;
      if (game.mission.phase === "pickup") {
        ctx.fillStyle = "#ffd86b";
        ctx.fillText("RECOGE EL ENCARGO", W / 2, 34);
        ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
        let pendingDef = 0;
        for (const p of pending) if (p.kind === "enemy" || p.kind === "dog") pendingDef++;
        const defenders = enemies.length + dogs.length + pendingDef;
        ctx.fillText(here ? (defenders ? `Defensores restantes: ${defenders}` : "Pulsa E junto al encargo")
          : `Dirígete a la región ${regName(t.x, t.y)}`, W / 2, 56);
      } else {
        ctx.fillStyle = "#9fe86a";
        ctx.fillText("ENTREGA EL ENCARGO", W / 2, 34);
        ctx.font = "15px Segoe UI"; ctx.fillStyle = "#e8efe8";
        ctx.fillText(here ? "Llega al punto de entrega y pulsa E"
          : `Llévalo a la región ${regName(t.x, t.y)}`, W / 2, 56);
        // cronómetro de entrega
        const tleft = Math.max(0, game.deliverTime);
        const mm = Math.floor(tleft / 60), ss = Math.floor(tleft % 60);
        const low = tleft <= 10;
        ctx.font = "bold 24px Segoe UI";
        ctx.fillStyle = low
          ? ((Math.floor(performance.now() / 200) % 2) ? "#ff5a4a" : "#ffd0c0")
          : "#ffd86b";
        ctx.fillText(`⏱ ${mm}:${ss.toString().padStart(2, "0")}`, W / 2, 82);
      }
    }
    ctx.textAlign = "left";

    // puntuación
    ctx.font = "13px Segoe UI"; ctx.fillStyle = "#9fb09f";
    ctx.textAlign = "right";
    ctx.fillText(`Puntos: ${game.score}`, W - 20, 30);
    ctx.textAlign = "left";

    drawMinimap();
    drawEdgeArrows();
  }

  function drawMinimap() {
    const cell = 26, pad = 4;
    const mw = REGIONS_X * cell + pad * 2;
    const mh = REGIONS_Y * cell + pad * 2;
    const ox = W - mw - 20, oy = H - mh - 20;
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

  // flechas que indican hacia dónde se puede cambiar de región
  function drawEdgeArrows() {
    ctx.fillStyle = "rgba(150,200,110,0.5)";
    const r = game.region;
    const tri = (x, y, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    if (r.x > 0) tri(24, H / 2, Math.PI);
    if (r.x < REGIONS_X - 1) tri(W - 24, H / 2, 0);
    if (r.y > 0) tri(W / 2, 24, -Math.PI / 2);
    if (r.y < REGIONS_Y - 1) tri(W / 2, H - 24, Math.PI / 2);
  }

  function drawFlash() {
    if (game.flashTime <= 0 || !game.flashMsg) return;
    const a = clamp(game.flashTime / 0.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = "#000"; ctx.fillRect(0, H / 2 - 70, W, 130);
    ctx.fillStyle = "#9fe86a"; ctx.font = "bold 52px Segoe UI";
    ctx.fillText(game.flashMsg.title, W / 2, H / 2 - 8);
    if (game.flashMsg.sub) {
      ctx.fillStyle = "#e8efe8"; ctx.font = "22px Segoe UI";
      ctx.fillText(game.flashMsg.sub, W / 2, H / 2 + 32);
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
    player = makePlayer();
    zombies = []; enemies = []; dogs = []; pending = []; bullets = []; ebullets = []; particles = []; pickups = [];
    encargo = null; dropzone = null; game.stash = {}; game.carrying = false;
    startWave(1);
  }

  startBtn.addEventListener("click", () => {
    overlayBody.innerHTML = "";
    startGame();
  });

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
