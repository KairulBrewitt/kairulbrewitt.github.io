/*
 * TC Setup Lab: UI controller
 * Owns the setup state, builds the adjusters for each topic and redraws the
 * drawing, readouts and charts from a fresh physics model on every change.
 */
(function () {
  'use strict';
  const P = window.TCPhysics, D = window.TCDraw, D3 = window.TCDraw3D;
  const KEY = 'tc-setup-lab:v1';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const fmt = D.fmt, fmtS = D.fmtS;
  const G = P.G;

  // ------------------------------------------------------------------
  // Parameter labels and help (what a mechanic would call them)
  // ------------------------------------------------------------------
  const AXN = { front: 'Front', rear: 'Rear' };
  const META = {
    camber: { label: 'Static camber', help: 'Set with the camber-link turnbuckle. Negative = top of the tyre leans in.', signed: true },
    rideHeight: { label: 'Ride height', help: 'Chassis underside to the ground. Set with the spring collars.' },
    linkInZ: { label: 'Camber link, inner height', help: 'Inner ball height above the chassis (tower or bulkhead hole plus spacers).' },
    linkInY: { label: 'Camber link, inner position', help: 'Inner ball distance from the centreline. Further out = shorter link.' },
    linkOutSpacer: { label: 'Camber link, hub spacer', help: 'Spacers under the outer ball stud on the hub.' },
    pivotZ: { label: 'Inner hinge-pin height', help: 'Pin centre above the chassis. Change with shims under the suspension mounts.' },
    caster: { label: 'C-hub caster', help: 'Caster built into the C-hub (part choice).' },
    kickup: { label: 'Front kick-up', help: 'Side angle of the front hinge pins. + = front of the pin higher. Adds to caster.', signed: true },
    kpi: { label: 'Kingpin inclination', help: 'Front-view lean of the kingpin built into the C-hub.' },
    lock: { label: 'Steering lock', help: 'Inside-wheel angle at full lock, set with the servo end-point.' },
    ackInset: { label: 'Ackermann ball, inboard offset', help: 'Ball position on the steering block. Further inboard = more Ackermann.' },
    armLength: { label: 'Steering arm length', help: 'Kingpin to ball, measured fore-aft. Shorter = quicker steering.' },
    plateY: { label: 'Plate ball, lateral', help: 'Inner steering-link ball, distance from the centreline.' },
    plateDX: { label: 'Plate ball, fore/aft', help: 'Moves the inner ball forward (+) or back (−) on the steering plate.', signed: true },
    toe: {
      front: { label: 'Front toe', help: 'Steering-link turnbuckle. + = toe-in, − = toe-out.', signed: true },
      rear: { label: 'Rear toe-in', help: 'Built into the rear suspension mounts.' },
    },
    ballSpacer: { label: 'Steering-block ball spacer', help: 'Spacers under the outer steering-link ball. The main bump-steer adjuster.' },
    plateSpacer: { label: 'Steering-plate ball spacer', help: 'Spacers under the inner steering-link ball.' },
    antiSquat: { label: 'Rear anti-squat', help: 'Side angle of the rear hinge pins. + = front of the pin higher.' },
    droop: { label: 'Droop', help: 'How far the wheel centre can drop below ride height before the droop screw stops the arm.' },
    wheelSpacer: { label: 'Wheel spacer', help: 'Shims behind the wheel hex. Widens the track.', signed: true },
    spring: { label: 'Spring rate', help: 'Rate of the shock spring.' },
    shockArm: { label: 'Shock mount on arm', help: 'Lower shock ball, distance from the inner hinge pin.' },
    shockTowerY: { label: 'Shock mount on tower', help: 'Upper shock mount, distance from the centreline. Further in = more lean.' },
    swayBar: { label: 'Anti-roll bar wire', help: 'Wire diameter. 0 = no bar fitted.' },
    mass: { label: 'Weight, ready to run', help: 'Including body and battery.' },
    frontPct: { label: 'Front weight', help: 'Share of the weight on the front wheels.' },
    cgHeight: { label: 'CG height', help: 'Centre of gravity above the ground.' },
    wheelbase: { label: 'Wheelbase', help: 'Front axle to rear axle.' },
    tireDia: { label: 'Tyre diameter', help: 'Shrinks as tyres wear. Ride height is held, so the arm angles change.' },
    tireWidth: { label: 'Tyre width', help: 'Sets the overall width with the wheel spacers.' },
    tireRate: { label: 'Tyre vertical stiffness', help: 'Rubber and insert together. Works in series with the springs.' },
    frontDiff: {
      label: 'Front differential',
      options: { spool: ['Spool', 'brakes the front'], oneway: ['One-way', 'front freewheels'], diff: ['Gear diff', 'brakes the front'] },
    },
  };
  const SHARED = new Set(['camber', 'rideHeight', 'linkInZ', 'linkInY', 'linkOutSpacer', 'pivotZ', 'droop', 'wheelSpacer', 'spring', 'shockArm', 'shockTowerY', 'swayBar']);

  function metaFor(path, prefixAxle) {
    const [axle, key] = path.split('.');
    let m = META[key] || { label: key, help: '' };
    if (m.front || m.rear) m = m[axle];
    let label = m.label;
    if (prefixAxle && SHARED.has(key) && (axle === 'front' || axle === 'rear')) label = AXN[axle] + ' ' + label.charAt(0).toLowerCase() + label.slice(1);
    return Object.assign({}, m, { label });
  }
  const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 && Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2);

  // ------------------------------------------------------------------
  // Topics
  // ------------------------------------------------------------------
  const TABS = [
    { id: 'camber', name: 'Camber', title: 'Camber & roll centre', axle: true,
      controls: (a) => [a + '.camber', a + '.rideHeight', a + '.linkInZ', a + '.linkInY', a + '.linkOutSpacer', a + '.pivotZ'] },
    { id: 'caster', name: 'Caster', title: 'Caster', controls: () => ['front.caster', 'front.kickup', 'front.kpi', 'front.lock'] },
    { id: 'ackermann', name: 'Ackermann', title: 'Ackermann', controls: () => ['front.lock', 'front.ackInset', 'front.plateDX', 'front.armLength', 'front.plateY'] },
    { id: 'toe', name: 'Toe', title: 'Toe & bump steer', controls: () => ['front.toe', 'rear.toe', 'front.ballSpacer', 'front.plateSpacer'] },
    { id: 'antisquat', name: 'Anti-squat', title: 'Anti-squat', controls: () => ['rear.antiSquat', 'front.kickup', 'car.cgHeight', 'car.frontDiff'] },
    { id: 'droop', name: 'Droop', title: 'Droop & roll', axle: true, axleIsView: true,
      controls: () => ['front.droop', 'rear.droop', 'front.rideHeight', 'rear.rideHeight'] },
    { id: 'springs', name: 'Springs', title: 'Springs & bars', axle: true,
      controls: (a) => [a + '.spring', a + '.shockArm', a + '.shockTowerY', a + '.swayBar'] },
    { id: 'car', name: 'Car', title: 'Car & tyres',
      controls: () => ['car.mass', 'car.frontPct', 'car.cgHeight', 'car.wheelbase', 'car.tireDia', 'car.tireWidth', 'car.tireRate', 'front.wheelSpacer', 'rear.wheelSpacer', 'car.frontDiff'] },
    { id: 'sheet', name: 'Setup sheet', title: 'Setup sheet', controls: () => [] },
  ];
  const tabById = (id) => TABS.find((t) => t.id === id) || TABS[0];

  // ------------------------------------------------------------------
  // State and storage
  // ------------------------------------------------------------------
  const state = {
    setup: P.stockSetup(), tab: 'camber', axle: 'front',
    travel: 0, steer: 1, ay: 1.4, ax: 1.0, exaggerate: true, theme: 'auto',
    ctl: 'slider', view: '2d', pinned: true, cam: { yaw: 35, elev: 22 },
  };
  const CTL_STYLES = [['slider', 'Slider'], ['wheel', 'Wheel'], ['dial', 'Dial']];
  // starting camera for the live 3D view on each topic
  const CAM_DEFAULT = {
    camber: { yaw: 180, elev: 8 }, springs: { yaw: 200, elev: 14 }, droop: { yaw: 196, elev: 10 },
    antisquat: { yaw: -90, elev: 4 }, ackermann: { yaw: 180, elev: 86 }, toe: { yaw: 180, elev: 86 },
    caster: { yaw: 35, elev: 18 }, car: { yaw: 35, elev: 22 },
  };
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.setup) state.setup = P.sanitize(d.setup);
      if (d.axle === 'front' || d.axle === 'rear') state.axle = d.axle;
      if (typeof d.exaggerate === 'boolean') state.exaggerate = d.exaggerate;
      if (['auto', 'dark', 'light'].includes(d.theme)) state.theme = d.theme;
      if (CTL_STYLES.some(([k]) => k === d.ctl)) state.ctl = d.ctl;
      if (d.view === '2d' || d.view === '3d') state.view = d.view;
      if (typeof d.pinned === 'boolean') state.pinned = d.pinned;
      if (d.tab && TABS.some((t) => t.id === d.tab)) state.tab = d.tab;
    } catch (e) { /* storage unavailable: run with stock values */ }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ setup: state.setup, axle: state.axle, exaggerate: state.exaggerate, theme: state.theme, tab: state.tab, ctl: state.ctl, view: state.view, pinned: state.pinned }));
      } catch (e) { /* ignore */ }
    }, 250);
  }

  // ------------------------------------------------------------------
  // Model cache
  // ------------------------------------------------------------------
  let model = null, modelKey = '';
  function getModel() {
    const key = JSON.stringify(state.setup);
    if (key !== modelKey) {
      try { model = P.buildModel(state.setup); } catch (e) { model = { ok: false, errors: ['Could not solve this setup: ' + e.message], warnings: [] }; }
      modelKey = key;
      heavy.key = '';
    }
    return model;
  }
  // slower sweeps (lift-off, g sweeps) are computed after the slider settles
  const heavy = { key: '', data: null, timer: 0 };

  // ------------------------------------------------------------------
  // DOM skeleton
  // ------------------------------------------------------------------
  const el = {};
  function buildShell() {
    el.title = $('#title');
    el.tabs = $('#tabs');
    el.main = $('#main');
    el.tabs.innerHTML = TABS.map((t) => `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-selected="false">${t.name}</button>`).join('');
    el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) selectTab(b.dataset.tab, true);
    });
    $('#theme').addEventListener('click', () => {
      state.theme = state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto';
      applyTheme(); save();
    });
    const setTabsH = () => document.documentElement.style.setProperty('--tabs-h', ($('.tabs').offsetHeight || 52) + 'px');
    setTabsH();
    window.addEventListener('resize', () => { setTabsH(); scheduleUpdate(); });
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.tab && TABS.some((t) => t.id === id)) selectTab(id, false); });
  }
  function applyTheme() {
    const b = $('#theme');
    // AUTO leaves the page theme alone (the host or the system decides); only undo our own override
    if (state.theme === 'auto') { if (applyTheme.set) document.documentElement.removeAttribute('data-theme'); applyTheme.set = false; }
    else { document.documentElement.setAttribute('data-theme', state.theme); applyTheme.set = true; }
    b.textContent = state.theme === 'auto' ? 'AUTO' : state.theme === 'dark' ? 'DARK' : 'LIGHT';
    b.setAttribute('aria-label', 'Theme: ' + state.theme);
  }

  function selectTab(id, user) {
    state.tab = tabById(id).id;
    for (const b of el.tabs.querySelectorAll('.tab')) {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        const bar = el.tabs, left = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2;
        try { bar.scrollTo({ left, behavior: user ? 'smooth' : 'auto' }); } catch (e) { bar.scrollLeft = left; }
      }
    }
    try { if (location.hash.slice(1) !== state.tab) history.replaceState(null, '', '#' + state.tab); } catch (e) { /* ignore */ }
    buildTab();
    update();
    if (user) window.scrollTo({ top: 0 });
    save();
  }

  // ------------------------------------------------------------------
  // Tab construction
  // ------------------------------------------------------------------
  function buildTab() {
    const t = tabById(state.tab);
    el.title.textContent = t.title;
    document.title = 'TC Setup Lab';
    state.cam = Object.assign({}, CAM_DEFAULT[t.id] || D3.VIEWS.iso);
    const parts = [];
    parts.push('<div id="notices"></div>');
    if (t.id !== 'sheet') {
      parts.push(`<section class="drawing${state.pinned ? ' pinned' : ''}" id="drawing" aria-label="Live view">
        <div class="viewbar">
          <div class="vseg" role="group" aria-label="View"><button id="v-2d" data-view="2d">Drawing</button><button id="v-3d" data-view="3d">3D car</button></div>
          <span class="vgap"></span>
          <button class="chip" id="ex-chip" hidden>Exaggerate</button>
          <button class="chip" id="pin-chip">Pin</button>
        </div>
        <div class="cap" id="cap"></div>
        <div class="dg-wrap"><div id="dg"></div>
          <div class="v3" id="v3" hidden>${Object.keys(D3.VIEWS).map((v) => `<button data-cam="${v}">${{ iso: '3/4', front: 'Front', side: 'Side', rear: 'Rear', top: 'Top' }[v]}</button>`).join('')}</div>
        </div>
        <div id="scrub" class="scrub"></div>
      </section>`);
    }
    if (t.axle) {
      const lab = t.axleIsView ? ['Front axle', 'view from behind'] : ['Front', 'axle'];
      const labR = t.axleIsView ? ['Rear axle', 'view from behind'] : ['Rear', 'axle'];
      parts.push(`<div class="seg" role="group" aria-label="Axle"><button id="ax-front" data-axle="front" aria-pressed="${state.axle === 'front'}"><b>${lab[0]}</b><span>${lab[1]}</span></button><button id="ax-rear" data-axle="rear" aria-pressed="${state.axle === 'rear'}"><b>${labR[0]}</b><span>${labR[1]}</span></button></div>`);
    }
    parts.push('<div class="tiles" id="tiles"></div>');
    parts.push('<div id="extra"></div>');
    if (t.id !== 'sheet') {
      parts.push(`<div class="adjust-head"><h2 class="section-h">Adjust</h2><div class="vseg" role="group" aria-label="Adjust with">${CTL_STYLES.map(([k, l]) => `<button data-ctl="${k}" id="ctl-${k}">${l}</button>`).join('')}</div></div>`);
      parts.push('<div class="controls" id="controls"></div>');
      parts.push('<div class="btn-row"><button class="btn" id="tab-reset">Back to stock</button></div>');
    }
    parts.push('<div id="charts" style="display:grid;gap:14px"></div>');
    parts.push('<section class="card explain" id="explain"></section>');
    el.main.innerHTML = parts.join('');
    for (const b of el.main.querySelectorAll('[data-axle]')) {
      b.addEventListener('click', () => {
        state.axle = b.dataset.axle;
        for (const x of el.main.querySelectorAll('[data-axle]')) x.setAttribute('aria-pressed', x.dataset.axle === state.axle ? 'true' : 'false');
        buildControls(); update(); save();
      });
    }
    for (const b of el.main.querySelectorAll('[data-ctl]')) {
      b.addEventListener('click', () => { state.ctl = b.dataset.ctl; refreshToggles(); buildControls(); save(); });
    }
    for (const b of el.main.querySelectorAll('[data-view]')) {
      b.addEventListener('click', () => { state.view = b.dataset.view; refreshToggles(); update(); save(); });
    }
    for (const b of el.main.querySelectorAll('[data-cam]')) {
      b.addEventListener('click', () => { state.cam = Object.assign({}, D3.VIEWS[b.dataset.cam]); refreshToggles(); update(); });
    }
    const pin = $('#pin-chip');
    if (pin) pin.addEventListener('click', () => {
      state.pinned = !state.pinned;
      $('#drawing').classList.toggle('pinned', state.pinned);
      refreshToggles(); save();
    });
    const ex = $('#ex-chip');
    if (ex) ex.addEventListener('click', () => { state.exaggerate = !state.exaggerate; refreshToggles(); update(); save(); });
    const reset = $('#tab-reset');
    if (reset) reset.addEventListener('click', () => {
      for (const p of controlList()) P.setPath(state.setup, p, P.PARAMS[p].v);
      buildControls(); update(); save();
    });
    attachOrbit();
    buildScrub();
    buildControls();
    refreshToggles();
    $('#explain').innerHTML = '<h3>How it works on track</h3><ul>' + (EXPLAIN[t.id] || []).map((x) => `<li>${x}</li>`).join('') + '</ul>';
  }
  function controlList() {
    const t = tabById(state.tab);
    return t.controls(state.axle);
  }
  function refreshToggles() {
    const press = (sel, on) => { const b = $(sel); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    press('#v-2d', state.view !== '3d'); press('#v-3d', state.view === '3d');
    for (const [k] of CTL_STYLES) press('#ctl-' + k, state.ctl === k);
    press('#pin-chip', state.pinned);
    const pin = $('#pin-chip'); if (pin) pin.textContent = state.pinned ? 'Pinned' : 'Pin';
    const ex = $('#ex-chip');
    if (ex) { ex.hidden = !(SCRUB[state.tab] && SCRUB[state.tab].exaggerate); press('#ex-chip', state.exaggerate); }
    const v3 = $('#v3');
    if (v3) {
      v3.hidden = state.view !== '3d';
      for (const b of v3.querySelectorAll('[data-cam]')) {
        const v = D3.VIEWS[b.dataset.cam];
        b.setAttribute('aria-pressed', Math.abs(v.yaw - state.cam.yaw) < 0.5 && Math.abs(v.elev - state.cam.elev) < 0.5 ? 'true' : 'false');
      }
    }
    const dg = $('#dg'); if (dg) dg.classList.toggle('orbit', state.view === '3d');
  }

  // ---------- 3D orbit (drag to rotate) ----------
  function attachOrbit() {
    const dg = $('#dg');
    if (!dg) return;
    let drag = null;
    dg.addEventListener('pointerdown', (e) => {
      if (state.view !== '3d') return;
      drag = { x: e.clientX, y: e.clientY, yaw: state.cam.yaw, elev: state.cam.elev };
      try { dg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    dg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      state.cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.45;
      state.cam.elev = Math.max(2, Math.min(88, drag.elev + (e.clientY - drag.y) * 0.35));
      refreshToggles();
      scheduleLive();
    });
    const end = () => { drag = null; };
    dg.addEventListener('pointerup', end);
    dg.addEventListener('pointercancel', end);
    dg.addEventListener('dblclick', () => { if (state.view === '3d') { state.cam = Object.assign({}, CAM_DEFAULT[state.tab] || D3.VIEWS.iso); refreshToggles(); scheduleLive(); } });
  }
  let liveRaf = 0;
  function scheduleLive() { if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; const m = getModel(); if (m.ok) render3D(m); }); }

  // ---------- adjusters: slider, thumbwheel or dial, plus -/+ steps ----------
  const WHEEL_PX = 10; // drag distance per step on the thumbwheel (one rib)
  function snap(spec, v) {
    const x = spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
    return parseFloat(Math.min(spec.max, Math.max(spec.min, x)).toFixed(4));
  }
  let lastTick = 0;
  function tick() {
    const now = Date.now();
    if (now - lastTick < 25) return;
    lastTick = now;
    try { if (navigator.vibrate) navigator.vibrate(5); } catch (e) { /* no haptics */ }
  }
  function setParam(path, v, haptic) {
    const spec = P.PARAMS[path];
    const nv = snap(spec, v), old = P.getPath(state.setup, path);
    if (nv === old) return false;
    P.setPath(state.setup, path, nv);
    if (haptic) tick();
    refreshControls();
    scheduleUpdate(); save();
    return true;
  }
  function holdRepeat(btn, fn) {
    let t1 = 0, t2 = 0;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      stop();
      t1 = setTimeout(() => { t2 = setInterval(fn, 70); }, 380);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(ev, stop);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function keySteps(el, path, spec) {
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (d) { e.preventDefault(); setParam(path, P.getPath(state.setup, path) + d * spec.step, true); }
      if (e.key === 'Home') { e.preventDefault(); setParam(path, spec.min, true); }
      if (e.key === 'End') { e.preventDefault(); setParam(path, spec.max, true); }
    });
  }
  function buildSlider(w, path, spec, id) {
    w.innerHTML = `<input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${P.getPath(state.setup, path)}">`;
    const input = w.querySelector('input');
    input.addEventListener('input', () => setParam(path, parseFloat(input.value), false));
  }
  function buildWheel(w, path, spec, id, label) {
    w.innerHTML = `<div class="wheel" id="${id}" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${spec.min}" aria-valuemax="${spec.max}"><div class="wheel-drum"></div><div class="wheel-mark"></div></div><div class="wheel-range"><i></i></div>`;
    const el2 = w.querySelector('.wheel');
    let drag = null;
    el2.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, t: e.timeStamp, acc: 0 };
      el2.classList.add('active');
      try { el2.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el2.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dt = Math.max(1, e.timeStamp - drag.t);
      drag.x = e.clientX; drag.t = e.timeStamp;
      const speed = Math.abs(dx) / dt;                      // px per ms
      drag.acc += dx * (speed > 1.4 ? 4 : speed > 0.7 ? 2 : 1); // flick to travel faster
      const steps = Math.trunc(drag.acc / WHEEL_PX);
      if (steps) { drag.acc -= steps * WHEEL_PX; setParam(path, P.getPath(state.setup, path) + steps * spec.step, true); }
    });
    const end = () => { drag = null; el2.classList.remove('active'); };
    el2.addEventListener('pointerup', end);
    el2.addEventListener('pointercancel', end);
    keySteps(el2, path, spec);
  }
  const DIAL_SWEEP = 270;
  const dialPt = (a, r) => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
  function dialArc(a0, a1, r) {
    const p0 = dialPt(a0, r), p1 = dialPt(a1, r);
    return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
  }
  function buildDial(w, path, spec, id, label) {
    const nSteps = Math.round((spec.max - spec.min) / spec.step);
    const div = nSteps <= 40 ? nSteps : 20;
    let ticks = '';
    for (let i = 0; i <= div; i++) {
      const a = -DIAL_SWEEP / 2 + DIAL_SWEEP * i / div, major = i === 0 || i === div || (div > 10 ? i % 5 === 0 : true);
      const p0 = dialPt(a, major ? 50 : 52), p1 = dialPt(a, 57);
      ticks += `<line x1="${p0[0].toFixed(2)}" y1="${p0[1].toFixed(2)}" x2="${p1[0].toFixed(2)}" y2="${p1[1].toFixed(2)}" class="tick${major ? ' major' : ''}"/>`;
    }
    w.innerHTML = `<div class="dial" id="${id}" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${spec.min}" aria-valuemax="${spec.max}">
      <svg viewBox="-60 -60 120 120" aria-hidden="true">${ticks}<path class="track" d="${dialArc(-DIAL_SWEEP / 2, DIAL_SWEEP / 2, 44)}"/><path class="arc" d=""/>
      <g class="knobg"><circle r="31" class="knob"/><line x1="0" y1="-14" x2="0" y2="-27" class="mark"/></g></svg><div class="dial-v"></div></div>`;
    const el2 = w.querySelector('.dial');
    let drag = null;
    const angleAt = (e) => {
      const r = el2.getBoundingClientRect();
      return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
    };
    el2.addEventListener('pointerdown', (e) => {
      drag = { a: angleAt(e), acc: 0 };
      el2.classList.add('active');
      try { el2.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el2.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = angleAt(e);
      let d = a - drag.a;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      drag.a = a;
      drag.acc += d / DIAL_SWEEP * (spec.max - spec.min);
      const steps = Math.trunc(drag.acc / spec.step);
      if (steps) { drag.acc -= steps * spec.step; setParam(path, P.getPath(state.setup, path) + steps * spec.step, true); }
    });
    const end = () => { drag = null; el2.classList.remove('active'); };
    el2.addEventListener('pointerup', end);
    el2.addEventListener('pointercancel', end);
    keySteps(el2, path, spec);
  }
  function editValue(path, btn) {
    const spec = P.PARAMS[path];
    const input = document.createElement('input');
    input.type = 'number'; input.step = spec.step; input.min = spec.min; input.max = spec.max;
    input.value = P.getPath(state.setup, path);
    input.className = 'ctl-edit';
    input.setAttribute('aria-label', 'Value');
    btn.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      if (apply) { const v = parseFloat(String(input.value).replace(',', '.')); if (isFinite(v)) setParam(path, v, false); }
      input.replaceWith(btn);
      refreshControls();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }
  function buildControls() {
    const box = $('#controls');
    if (!box) return;
    const t = tabById(state.tab);
    const prefix = !t.axle || t.axleIsView;
    box.innerHTML = '';
    box.dataset.style = state.ctl;
    for (const path of controlList()) {
      const spec = P.PARAMS[path], m = metaFor(path, prefix);
      const id = 'c-' + path.replace('.', '-');
      const row = document.createElement('div');
      row.className = 'ctl';
      row.dataset.path = path;
      if (spec.options) {
        row.innerHTML = `<div class="ctl-head"><label>${m.label}</label></div>
          <div class="seg" role="group" aria-label="${m.label}">${spec.options.map((o) => `<button data-opt="${o}" id="${id}-${o}"><b>${m.options[o][0]}</b><span>${m.options[o][1]}</span></button>`).join('')}</div>`;
        row.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
          P.setPath(state.setup, path, b.dataset.opt);
          refreshControls(); scheduleUpdate(); save();
        }));
      } else {
        row.innerHTML = `<div class="ctl-head"><label for="${id}" id="${id}-l">${m.label}</label><button class="ctl-val" id="${id}-v" aria-label="Type a value for ${m.label}"></button><button class="stock" id="${id}-s" aria-label="Reset ${m.label} to stock">Stock</button></div>
          <div class="ctl-input"><button class="step" id="${id}-dn" aria-label="Decrease ${m.label}">−</button><div class="ctl-widget"></div><button class="step" id="${id}-up" aria-label="Increase ${m.label}">+</button></div>
          <div class="help">${m.help}<span class="alt" id="${id}-a"></span></div>`;
        const w = row.querySelector('.ctl-widget');
        if (state.ctl === 'wheel') buildWheel(w, path, spec, id, m.label);
        else if (state.ctl === 'dial') buildDial(w, path, spec, id, m.label);
        else buildSlider(w, path, spec, id);
        holdRepeat(row.querySelector('#' + id + '-dn'), () => setParam(path, P.getPath(state.setup, path) - spec.step, true));
        holdRepeat(row.querySelector('#' + id + '-up'), () => setParam(path, P.getPath(state.setup, path) + spec.step, true));
        const vb = row.querySelector('.ctl-val');
        vb.addEventListener('click', () => editValue(path, vb));
        row.querySelector('.stock').addEventListener('click', () => setParam(path, spec.v, true));
      }
      box.appendChild(row);
    }
    refreshControls();
  }
  function refreshControls() {
    const box = $('#controls');
    if (!box) return;
    for (const row of box.children) {
      const path = row.dataset.path, spec = P.PARAMS[path], v = P.getPath(state.setup, path);
      const id = 'c-' + path.replace('.', '-');
      if (spec.options) {
        row.querySelectorAll('[data-opt]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.opt === v ? 'true' : 'false'));
        continue;
      }
      const m = metaFor(path, false);
      const frac = (v - spec.min) / (spec.max - spec.min);
      const dec = decimals(spec.step);
      let txt = m.signed ? fmtS(v, dec) : fmt(v, dec);
      let unit = spec.unit;
      if (path.endsWith('swayBar') && v === 0) { txt = 'Off'; unit = ''; }
      const vb = row.querySelector('.ctl-val');
      if (vb) vb.innerHTML = `${txt}${unit ? `<small>${unit}</small>` : ''}`;
      const input = row.querySelector('input[type="range"]');
      if (input) {
        if (parseFloat(input.value) !== v) input.value = v;
        input.style.setProperty('--pct', (frac * 100).toFixed(2) + '%');
      }
      const wheel = row.querySelector('.wheel');
      if (wheel) {
        wheel.querySelector('.wheel-drum').style.backgroundPosition = `${((v - spec.min) / spec.step * WHEEL_PX).toFixed(1)}px 0`;
        row.querySelector('.wheel-range i').style.width = (frac * 100).toFixed(1) + '%';
        wheel.setAttribute('aria-valuenow', v); wheel.setAttribute('aria-valuetext', txt + ' ' + unit);
      }
      const dial = row.querySelector('.dial');
      if (dial) {
        const a = -DIAL_SWEEP / 2 + DIAL_SWEEP * frac;
        dial.querySelector('.arc').setAttribute('d', frac > 0.002 ? dialArc(-DIAL_SWEEP / 2, a, 44) : '');
        dial.querySelector('.knobg').setAttribute('transform', `rotate(${a.toFixed(2)})`);
        dial.querySelector('.dial-v').textContent = txt;
        dial.setAttribute('aria-valuenow', v); dial.setAttribute('aria-valuetext', txt + ' ' + unit);
      }
      const sb = row.querySelector('.stock');
      if (sb) sb.disabled = Math.abs(v - spec.v) < 1e-9;
      row.querySelector('#' + id + '-dn').disabled = v <= spec.min + 1e-9;
      row.querySelector('#' + id + '-up').disabled = v >= spec.max - 1e-9;
      let alt = '';
      if (path.endsWith('spring')) alt = ` ≈ ${P.units.nmmToLbin(v).toFixed(2)} lb/in · ${P.units.nmmToGfmm(v).toFixed(0)} gf/mm`;
      if (path.endsWith('.toe') && path.startsWith('front')) alt = v > 0 ? ' (toe-in)' : v < 0 ? ' (toe-out)' : '';
      const altEl = row.querySelector('#' + id + '-a');
      if (altEl) altEl.textContent = alt ? ' ' + alt : '';
    }
  }

  // ---------- in-drawing scrub controls ----------
  const SCRUB = {
    camber: { key: 'travel', label: 'Wheel travel, both sides', unit: 'mm', step: 0.1, range: (m, s) => [-m[state.axle].droop, s[state.axle].rideHeight], fmt: (v) => fmtS(v, 1) + ' mm' },
    springs: { key: 'travel', label: 'Wheel travel, both sides', unit: 'mm', step: 0.1, range: (m, s) => [-m[state.axle].droop, s[state.axle].rideHeight], fmt: (v) => fmtS(v, 1) + ' mm' },
    ackermann: { key: 'steer', label: 'Steering input (left turn)', step: 0.01, range: () => [0, 1], fmt: (v) => Math.round(v * 100) + ' %' },
    antisquat: { key: 'ax', label: 'Acceleration (+) / braking (−)', step: 0.05, range: () => [-1.5, 1.5], fmt: (v) => fmtS(v, 2) + ' g', exaggerate: true },
    droop: { key: 'ay', label: 'Cornering force (left turn)', step: 0.05, range: () => [0, 2.5], fmt: (v) => v.toFixed(2) + ' g', exaggerate: true },
  };
  function buildScrub() {
    const box = $('#scrub');
    if (!box) return;
    const sc = SCRUB[state.tab];
    if (!sc) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="scrub-row"><label for="scrub-in">${sc.label}</label><b id="scrub-v"></b></div><input type="range" id="scrub-in" step="${sc.step}">`;
    const input = $('#scrub-in');
    input.addEventListener('input', () => { state[sc.key] = parseFloat(input.value); scheduleUpdate(); });
  }
  function refreshScrub(m) {
    const sc = SCRUB[state.tab], input = $('#scrub-in');
    if (!sc || !input || !m.ok) return;
    const [lo, hi] = sc.range(m, state.setup);
    input.min = lo; input.max = hi;
    state[sc.key] = Math.min(hi, Math.max(lo, state[sc.key]));
    if (document.activeElement !== input) input.value = state[sc.key];
    const pct = ((state[sc.key] - lo) / (hi - lo || 1)) * 100;
    input.style.setProperty('--pct', pct.toFixed(2) + '%');
    $('#scrub-v').textContent = sc.fmt(state[sc.key]);
  }

  // ------------------------------------------------------------------
  // Update cycle
  // ------------------------------------------------------------------
  let raf = 0;
  function scheduleUpdate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }

  function tilesHTML(list) {
    return list.map((t) => `<div class="tile ${t.state || ''}"><div class="k">${t.k}</div><div class="v">${t.v}${t.u ? `<small>${t.u}</small>` : ''}</div>${t.s ? `<div class="s">${t.s}</div>` : ''}</div>`).join('');
  }
  function legend(items) {
    const cls = ['var(--accent)', 'var(--blue)', 'var(--arm)', 'var(--rod)', 'var(--muted)'];
    return `<div class="legend">${items.map((it) => `<span><i class="${it.dash ? 'dash' : ''}" style="background:${cls[it.c]};color:${cls[it.c]}"></i>${it.name}</span>`).join('')}</div>`;
  }
  function chartCard(title, svgStr, leg) {
    return `<section class="card chart-card"><h3>${title}</h3>${svgStr}${leg || ''}</section>`;
  }
  /**
   * Exaggeration for body motion: up to x5, but never so much that the drawn
   * chassis would hit the track when the real one does not.
   */
  function motionScale(res) {
    if (!state.exaggerate || !res) return 1;
    const drop = res.minPlateStatic - res.minPlateHeight;
    if (res.scrape || drop <= 1e-6) return res.scrape ? 1 : 5;
    const e = (res.minPlateStatic - 0.6) / drop;
    return Math.max(1, Math.min(5, Math.floor(e * 2) / 2));
  }
  const scaleNote = (E) => (E > 1 ? `body motion drawn ×${E % 1 ? E.toFixed(1) : E}` : 'true scale');
  function pxWidth() {
    const d = $('#dg');
    return Math.max(260, (d && d.clientWidth) || 360);
  }

  function draw2D(html) {
    const dg = $('#dg');
    if (!dg || state.view === '3d') return;
    dg.innerHTML = html;
    dg.classList.toggle('multi', dg.querySelectorAll('svg').length > 1);
  }
  /** What the live 3D car shows on each topic: the same condition as the drawing. */
  function liveCondition(m) {
    const t = state.tab;
    const solve = (c) => P.solveVehicle(m, c);
    if (t === 'antisquat') { const res = solve({ ax: state.ax }); return { res, p: 0, E: motionScale(res), loads: true, note: `${state.ax < 0 ? 'braking' : 'accelerating'} ${fmt(Math.abs(state.ax), 2)} g · pitch ${fmtS(res.pitch, 2)}°` }; }
    if (t === 'droop') { const res = solve({ ay: state.ay }); return { res, p: 0, E: motionScale(res), loads: true, note: `${state.ay.toFixed(2)} g left turn · roll ${fmt(res.roll, 2)}°` }; }
    if (t === 'camber' || t === 'springs') {
      const s = state.travel;
      return { res: { heave: -s, roll: 0, pitch: 0, corners: [0, 1, 2, 3].map(() => ({ travel: s, grams: 0 })) }, p: 0, E: 1, loads: false, note: s === 0 ? 'at ride height' : `wheels ${s > 0 ? 'up' : 'down'} ${fmt(Math.abs(s))} mm` };
    }
    if (t === 'ackermann' || t === 'caster') {
      const input = t === 'ackermann' ? state.steer : 1;
      const F = m.front, p = F.pDir * F.pMax * input, r = P.steerAt(F, p);
      const e = r ? [-(r.sL.P[2] - F.static.P[2]), -(r.sR.P[2] - F.static.P[2]), 0, 0] : [0, 0, 0, 0];
      m.solveState = null;
      const res = solve({ e });
      return { res, p, E: 1, loads: t === 'caster', note: r ? `steering ${fmt(r.left, 1)}° / ${fmt(r.right, 1)}°` : '' };
    }
    return { res: solve({}), p: 0, E: 1, loads: true, note: 'static, on the setup board' };
  }
  function render3D(m) {
    const dg = $('#dg');
    if (!dg) return;
    const c = liveCondition(m);
    if (!c.res) return;
    dg.innerHTML = D3.render(m, c, { px: pxWidth(), yaw: state.cam.yaw, elev: state.cam.elev, E: c.E, loads: c.loads });
    dg.classList.remove('multi');
    $('#cap').innerHTML = `<span><b>Live 3D</b> · drag to rotate · ${c.note}</span><span>${scaleNote(c.E)}</span>`;
  }

  function update() {
    const m = getModel();
    refreshControls();
    // notices
    const nb = $('#notices');
    if (nb) {
      let html = '';
      if (!m.ok) html += `<div class="notice bad"><b>This geometry cannot be assembled.</b><ul>${m.errors.map((e) => `<li>${e}</li>`).join('')}</ul>Move the last slider back, or tap Back to stock.</div>`;
      else if (m.warnings.length) html += `<div class="notice"><ul>${m.warnings.map((e) => `<li>${e}</li>`).join('')}</ul></div>`;
      nb.innerHTML = html;
    }
    if (!m.ok) return;
    refreshScrub(m);
    try {
      RENDER[state.tab](m);
      if (state.view === '3d' && state.tab !== 'sheet') render3D(m);
    } catch (e) {
      const nb2 = $('#notices');
      if (nb2) nb2.innerHTML = `<div class="notice bad">Display error: ${e.message}</div>`;
      if (window.console) console.error(e);
    }
  }

  // ------------------------------------------------------------------
  // Topic renderers
  // ------------------------------------------------------------------
  const RENDER = {};
  const outsideCamberAt = (m, g) => {
    const r = P.solveVehicle(m, { ay: g });
    return r ? { f: r.corners[1].camberGround, r: r.corners[3].camberGround, res: r } : null;
  };

  RENDER.camber = function (m) {
    const a = state.axle, C = m[a], s = state.travel;
    const view = D.axleView(m, a, { s, px: pxWidth(), ic: true });
    draw2D(view.svg);
    $('#cap').innerHTML = `<span><b>View from behind</b> · ${a} axle · ride height ${fmt(m.setup[a].rideHeight)} mm</span><span>${s === 0 ? 'static' : (s > 0 ? 'bump ' : 'droop ') + fmt(Math.abs(s)) + ' mm'}</span>`;
    const T = C.table;
    const rcUp = P.frontViewAt(C, 1), rcDn = P.frontViewAt(C, -1);
    const mig = rcUp && rcDn ? (rcUp.rc - rcDn.rc) / 2 : NaN;
    const oc = outsideCamberAt(m, 1.5);
    const ocv = oc ? (a === 'front' ? oc.f : oc.r) : NaN;
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Roll centre', v: fmt(view.fv.rc), u: 'mm', s: s === 0 ? 'above the ground' : `static ${fmt(C.rcHeight)} mm`, state: 'good' },
      { k: 'Camber gain', v: fmtS(C.camberGain, 2), u: '°/mm', s: `${fmtS(T.at(2, 'camber'))}° at 2 mm bump` },
      { k: 'Outside tyre, 1.5 g', v: fmtS(ocv, 2), u: '°', s: 'camber to the track', state: ocv > 0 ? 'warn' : '' },
      { k: 'RC migration', v: fmtS(mig, 2), u: 'mm/mm', s: 'per mm of heave' },
      { k: 'Camber link', v: fmt(C.Lcl, 1), u: 'mm', s: 'ball centre to ball centre' },
      { k: 'Track change', v: fmtS(2 * C.scrub, 3), u: 'mm/mm', s: 'both sides, per mm bump' },
    ]);
    const lo = -C.droop, hi = m.setup[a].rideHeight;
    const pts = [], rc = [];
    for (let x = lo; x <= hi + 1e-9; x += (hi - lo) / 40) { pts.push([x, T.at(x, 'camber')]); rc.push([x, T.at(x, 'rc')]); }
    $('#charts').innerHTML =
      chartCard('Camber vs wheel travel', D.lineChart({ series: [{ pts }], xLabel: 'wheel travel, mm (bump +)', yLabel: 'camber °', markers: [{ x: s, y: T.at(s, 'camber') }], yMinSpan: 1 })) +
      chartCard('Roll centre height vs heave', D.lineChart({ series: [{ pts: rc, c: 1 }], xLabel: 'wheel travel, mm (bump +)', yLabel: 'RC height, mm', markers: [{ x: s, y: T.at(s, 'rc'), c: 1 }], yInclude: [0] }));
  };

  RENDER.springs = function (m) {
    const a = state.axle, C = m[a], s = state.travel;
    const view = D.axleView(m, a, { s, px: pxWidth(), ic: false, emphShock: true });
    draw2D(view.svg);
    $('#cap').innerHTML = `<span><b>View from behind</b> · ${a} axle</span><span>shock ${fmt(C.shockAngle)}° from vertical</span>`;
    const r1 = P.solveVehicle(m, { ay: 1 });
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Motion ratio', v: C.mr.toFixed(3), s: 'shock travel ÷ wheel travel', state: 'good' },
      { k: 'Wheel rate', v: C.wheelRate.toFixed(3), u: 'N/mm', s: `spring ${m.setup[a].spring.toFixed(2)} × MR²` },
      { k: 'Ride frequency', v: C.rideFreq.toFixed(2), u: 'Hz', s: 'incl. tyre stiffness' },
      { k: 'Bar rate at wheel', v: C.barRate.toFixed(3), u: 'N/mm', s: m.setup[a].swayBar > 0 ? `${m.setup[a].swayBar.toFixed(1)} mm wire` : 'no bar' },
      { k: 'Roll stiffness, front', v: m.rollStiffFrontPct.toFixed(1), u: '%', s: 'springs + bars + tyres' },
      { k: 'Front LLTD at 1 g', v: r1 ? r1.lltdFront.toFixed(1) : '–', u: '%', s: 'share of load transfer' },
    ]);
    const T = C.table, lo = -C.droop, hi = m.setup[a].rideHeight;
    const wr = [], fs = [];
    for (let x = lo; x <= hi + 1e-9; x += (hi - lo) / 40) { wr.push([x, T.slope(x, 'Fs')]); fs.push([x, T.at(x, 'Fs') / G * 1000]); }
    $('#charts').innerHTML =
      chartCard('Wheel rate vs travel', D.lineChart({ series: [{ pts: wr }], xLabel: 'wheel travel, mm (bump +)', yLabel: 'N/mm', markers: [{ x: s, y: T.slope(s, 'Fs') }], yMinSpan: 0.05 })) +
      chartCard('Spring force at the wheel', D.lineChart({ series: [{ pts: fs, c: 1 }], xLabel: 'wheel travel, mm (bump +)', yLabel: 'grams', markers: [{ x: s, y: T.at(s, 'Fs') / G * 1000, c: 1 }] }));
  };

  RENDER.caster = function (m) {
    const F = m.front;
    draw2D(D.casterView(m, { px: pxWidth() }));
    $('#cap').innerHTML = `<span><b>Side view</b> · left front wheel</span><span>steering axis in green</span>`;
    const j = P.steeringJacking(m);
    const full = m.steer.full;
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Caster', v: fmt(F.caster, 2), u: '°', s: `C-hub ${fmt(m.setup.front.caster)}° + kick-up ${fmtS(m.setup.front.kickup, 2)}°`, state: 'good' },
      { k: 'Mechanical trail', v: fmt(F.trail, 2), u: 'mm', s: 'axis at ground ahead of patch' },
      { k: 'Camber at full lock', v: `${fmtS(full.camberIn)} / ${fmtS(full.camberOut)}`, u: '°', s: 'inside / outside wheel' },
      { k: 'Diagonal load at lock', v: j ? fmtS(j.diagonalGrams, 0) : '–', u: 'g', s: 'onto inside front + outside rear' },
      { k: 'Kingpin inclination', v: fmt(F.kpi, 2), u: '°', s: 'incl. C-hub rotation from camber' },
      { k: 'Scrub radius', v: fmt(F.scrubRadius, 1), u: 'mm', s: 'patch outboard of axis' },
    ]);
    const sw = m.steer.sweep;
    $('#charts').innerHTML = chartCard('Camber vs steering angle',
      D.lineChart({ series: [{ pts: sw.map((o) => [o.inner, o.camberIn]) }, { pts: sw.map((o) => [o.outer, o.camberOut]), c: 1 }], xLabel: 'wheel steering angle, °', yLabel: 'camber °', yMinSpan: 1 }),
      legend([{ name: 'inside wheel', c: 0 }, { name: 'outside wheel', c: 1 }])) +
      chartCard('Wheel height change vs steering angle',
        D.lineChart({ series: [{ pts: sw.map((o) => [o.inner, -o.dzIn]) }, { pts: sw.map((o) => [o.outer, -o.dzOut]), c: 1 }], xLabel: 'wheel steering angle, °', yLabel: 'mm (+ = lifts that corner)', yInclude: [0] }),
        legend([{ name: 'inside wheel', c: 0 }, { name: 'outside wheel', c: 1 }]));
  };

  RENDER.ackermann = function (m) {
    const px = pxWidth();
    draw2D(D.ackermannOverview(m, state.steer, { px }) + D.linkageView(m, state.steer, { px }));
    const st = D.steerState(m, state.steer).r;
    const L = m.wheelbase, Tt = 2 * m.front.trackHalf;
    const ideal = P.idealOuter(st.left, L, Tt);
    const pctNow = Math.abs(st.left - ideal) > 1e-6 ? 100 * (st.left - st.right) / (st.left - ideal) : NaN;
    $('#cap').innerHTML = `<span><b>Top view</b> · lines through the front axles meet the rear-axle line at 100 %</span>`;
    const full = m.steer.full;
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Ackermann at full lock', v: fmt(m.steer.ackermannPct, 0), u: '%', s: '100 % = true Ackermann', state: 'good' },
      { k: 'Inside / outside', v: `${fmt(full.inner, 1)} / ${fmt(full.outer, 1)}`, u: '°', s: `ideal outside ${fmt(full.ideal, 1)}°` },
      { k: 'Now', v: isFinite(pctNow) && state.steer > 0.05 ? fmt(pctNow, 0) : '–', u: '%', s: `${fmt(st.left, 1)}° / ${fmt(st.right, 1)}°` },
      { k: 'Turning circle', v: (m.steer.turnDiameterOuter / 1000).toFixed(2), u: 'm', s: 'outside front wheel, low speed' },
      { k: 'Toe-out on lock', v: fmt(full.inner - full.outer, 1), u: '°', s: 'inside minus outside' },
      { k: 'Steering link', v: fmt(m.front.Ltr, 1), u: 'mm', s: 'ball centres, re-set for toe' },
    ]);
    const sw = m.steer.sweep;
    $('#charts').innerHTML = chartCard('Outside vs inside wheel angle',
      D.lineChart({
        series: [{ pts: sw.map((o) => [o.inner, o.outer]) }, { pts: sw.map((o) => [o.inner, o.ideal]), c: 4, dash: true }, { pts: sw.map((o) => [o.inner, o.inner]), c: 2, dash: true }],
        xLabel: 'inside wheel angle, °', yLabel: 'outside wheel angle, °', markers: [{ x: st.left, y: st.right }],
      }),
      legend([{ name: 'this setup', c: 0 }, { name: '100 % Ackermann', c: 4, dash: true }, { name: 'parallel (0 %)', c: 2, dash: true }]));
  };

  RENDER.toe = function (m) {
    const px = pxWidth();
    draw2D(D.toeView(m, { px }) + D.axleView(m, 'front', { s: 0, px, ic: true, rod: true }).svg);
    $('#cap').innerHTML = `<span><b>Top view</b>, front to the right, toe drawn ×5. Below: <b>front axle from behind</b> with the steering links.</span>`;
    const F = m.front, R = m.rear;
    const warnBS = (v) => (Math.abs(v) > 0.06 ? 'warn' : '');
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Front toe', v: fmtS(F.static.toe, 2), u: '°', s: F.static.toe >= 0 ? 'toe-in (per wheel)' : 'toe-out (per wheel)', state: 'good' },
      { k: 'Rear toe', v: fmtS(R.static.toe, 2), u: '°', s: 'mounts + hub rotation from camber' },
      { k: 'Front bump steer', v: fmtS(F.toeGain, 3), u: '°/mm', s: F.toeGain > 0 ? 'toe-in in bump' : 'toe-out in bump', state: warnBS(F.toeGain) },
      { k: 'Rear bump steer', v: fmtS(R.toeGain, 3), u: '°/mm', s: R.toeGain > 0 ? 'toe-in in bump' : 'toe-out in bump', state: warnBS(R.toeGain) },
      { k: 'Front toe at +2 mm', v: fmtS(F.table.at(2, 'toe'), 2), u: '°', s: `${fmtS(F.table.at(-2, 'toe'), 2)}° at −2 mm` },
      { k: 'Steering link', v: fmt(F.Ltr, 1), u: 'mm', s: 'ball centres' },
    ]);
    const mk = (C) => { const out = []; const lo = -C.droop, hi = m.setup[C.axle].rideHeight; for (let x = lo; x <= hi + 1e-9; x += (hi - lo) / 40) out.push([x, C.table.at(x, 'toe')]); return out; };
    $('#charts').innerHTML = chartCard('Toe vs wheel travel (bump steer)',
      D.lineChart({ series: [{ pts: mk(F) }, { pts: mk(R), c: 1 }], xLabel: 'wheel travel, mm (bump +)', yLabel: 'toe-in °', yMinSpan: 0.4 }),
      legend([{ name: 'front', c: 0 }, { name: 'rear', c: 1 }]));
  };

  RENDER.antisquat = function (m) {
    const res = P.solveVehicle(m, { ax: state.ax });
    const E = motionScale(res);
    const braking = state.ax < 0;
    draw2D(D.sideView(m, res, { px: pxWidth(), E, anti: true, braking, ax: state.ax }));
    const rearSq = res.rearHeightChange;
    $('#cap').innerHTML = `<span><b>Side view</b> · ${braking ? 'braking' : 'accelerating'} ${fmt(Math.abs(state.ax), 2)} g · rear ${rearSq <= 0 ? 'squats' : 'rises'} ${fmt(Math.abs(rearSq), 2)} mm</span><span>${scaleNote(E)}</span>`;
    const N0r = m.N0.rear, rearLoad = (res.corners[2].N + res.corners[3].N - 2 * N0r) / G * 1000;
    const diffName = { spool: 'spool', oneway: 'one-way', diff: 'gear diff' }[m.setup.car.frontDiff];
    $('#tiles').innerHTML = tilesHTML([
      { k: braking ? 'Rear anti-lift' : 'Anti-squat', v: fmt(braking ? m.antiLiftRear : m.antiSquat, 0), u: '%', s: `${fmt(m.antiSquatRwd, 0)} % if only the rear drove`, state: 'good' },
      { k: braking ? 'Front anti-dive' : 'Front anti-lift', v: fmt(braking ? m.antiDive : m.antiLiftFront, 0), u: '%', s: braking ? `front ${diffName}` : 'from front pin angle', state: braking && m.antiDive < -0.5 ? 'warn' : '' },
      { k: 'Pitch', v: fmtS(res.pitch, 2), u: '°', s: 'nose up +' },
      { k: 'Rear ride height', v: fmtS(rearSq, 2), u: 'mm', s: `front ${fmtS(res.frontHeightChange, 2)} mm` },
      { k: 'Load onto the rear', v: fmtS(rearLoad, 0), u: 'g', s: 'both rear tyres' },
      { k: 'Lowest chassis point', v: fmt(res.minPlateHeight, 2), u: 'mm', s: res.scrape ? 'chassis touches the track' : 'above the track', state: res.scrape ? 'bad' : res.minPlateHeight < 1 ? 'warn' : '' },
    ]);
    // pitch vs longitudinal g
    const key = 'as:' + modelKey;
    if (heavy.key !== key) {
      clearTimeout(heavy.timer);
      heavy.timer = setTimeout(() => {
        const sq = [], fr = [];
        m.solveState = null;
        for (let g = 0; g <= 1.5001; g += 0.1) { const r = P.solveVehicle(m, { ax: g }); if (r) { sq.push([g, r.rearHeightChange]); fr.push([g, r.frontHeightChange]); } }
        const bq = [], bf = [];
        m.solveState = null;
        for (let g = 0; g >= -1.5001; g -= 0.1) { const r = P.solveVehicle(m, { ax: g }); if (r) { bq.push([g, r.rearHeightChange]); bf.push([g, r.frontHeightChange]); } }
        heavy.key = key;
        heavy.data = { rear: bq.reverse().concat(sq.slice(1)), front: bf.reverse().concat(fr.slice(1)) };
        if (state.tab === 'antisquat') drawAsChart();
      }, 120);
    } else drawAsChart();
    function drawAsChart() {
      const d = heavy.data;
      $('#charts').innerHTML = chartCard('Ride height change vs acceleration',
        D.lineChart({ series: [{ pts: d.rear }, { pts: d.front, c: 1 }], xLabel: 'braking −  ·  acceleration +  (g)', yLabel: 'mm', markers: [{ x: state.ax, y: res.rearHeightChange }, { x: state.ax, y: res.frontHeightChange, c: 1 }], yInclude: [0] }),
        legend([{ name: 'rear', c: 0 }, { name: 'front', c: 1 }]));
    }
  };

  RENDER.droop = function (m) {
    const a = state.axle;
    const res = P.solveVehicle(m, { ay: state.ay });
    const E = motionScale(res);
    draw2D(D.rollView(m, a, res, { px: pxWidth(), E, ay: state.ay }));
    $('#cap').innerHTML = `<span><b>${a === 'front' ? 'Front' : 'Rear'} axle from behind</b> · left turn</span><span>${scaleNote(E)}</span>`;
    const c = res.corners;
    const key = 'droop:' + modelKey;
    const lift = heavy.key === key && heavy.data ? heavy.data.lift : null;
    const liftTxt = (v) => (v === Infinity ? '> 2.5' : fmt(v, 2));
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Body roll', v: fmt(res.roll, 2), u: '°', s: `${fmt(res.roll / Math.max(0.05, state.ay), 2)} °/g`, state: 'good' },
      { k: 'Front LLTD', v: isFinite(res.lltdFront) ? fmt(res.lltdFront, 1) : '–', u: '%', s: 'higher = more understeer' },
      { k: 'Inside front lifts at', v: lift ? liftTxt(lift.front) : '…', u: 'g', s: `droop ${fmt(m.front.droop, 1)} mm`, state: lift && lift.front < 2 ? 'warn' : '' },
      { k: 'Inside rear lifts at', v: lift ? liftTxt(lift.rear) : '…', u: 'g', s: `droop ${fmt(m.rear.droop, 1)} mm`, state: lift && lift.rear < 2 ? 'warn' : '' },
      { k: 'Outside front camber', v: fmtS(c[1].camberGround, 2), u: '°', s: 'to the track' },
      { k: 'Lowest chassis point', v: fmt(res.minPlateHeight, 2), u: 'mm', s: res.scrape ? 'chassis touches the track' : 'above the track', state: res.scrape ? 'bad' : res.minPlateHeight < 1 ? 'warn' : '' },
    ]);
    const tot = c.reduce((s2, x) => s2 + x.grams, 0);
    const box = (x, label) => `<div class="load ${x.lifted ? 'lifted' : x.onStop ? 'stop' : ''}"><div class="k"><span>${label}</span><b>${x.lifted ? 'lifted' : x.onStop ? 'droop stop' : ''}</b></div><div class="v">${Math.round(x.grams)} g</div><div class="bar"><i style="width:${Math.min(100, x.grams / tot * 200).toFixed(1)}%"></i></div></div>`;
    $('#extra').innerHTML = `<div class="loads" aria-label="Wheel loads">${box(c[0], 'Front left · inside')}${box(c[1], 'Front right · outside')}${box(c[2], 'Rear left · inside')}${box(c[3], 'Rear right · outside')}</div>`;
    if (heavy.key !== key) {
      $('#charts').innerHTML = chartCard('Wheel load vs cornering force', '<p class="small">Calculating…</p>');
      clearTimeout(heavy.timer);
      heavy.timer = setTimeout(() => {
        const series = [[], [], [], []];
        m.solveState = null;
        for (let g = 0; g <= 2.5001; g += 0.1) {
          const r = P.solveVehicle(m, { ay: g });
          if (!r || !r.converged) break;
          r.corners.forEach((x, i) => series[i].push([g, x.grams]));
        }
        heavy.key = key;
        heavy.data = { series, lift: P.liftOffG(m, 2.5, 0.1) };
        if (state.tab === 'droop') update();
      }, 120);
    } else {
      const s = heavy.data.series;
      $('#charts').innerHTML = chartCard('Wheel load vs cornering force',
        D.lineChart({ series: [{ pts: s[0] }, { pts: s[2], c: 1 }, { pts: s[1], c: 0, dash: true }, { pts: s[3], c: 1, dash: true }], xLabel: 'lateral g (left turn)', yLabel: 'grams', yInclude: [0], markers: [{ x: state.ay, y: c[0].grams }, { x: state.ay, y: c[2].grams, c: 1 }] }),
        legend([{ name: 'inside front', c: 0 }, { name: 'inside rear', c: 1 }, { name: 'outside front', c: 0, dash: true }, { name: 'outside rear', c: 1, dash: true }]));
    }
  };

  RENDER.car = function (m) {
    draw2D(D.sideView(m, null, { px: pxWidth(), anti: false }));
    $('#cap').innerHTML = `<span><b>Side view</b> · generic 190 mm touring car</span><span>CG ${fmt(m.h)} mm</span>`;
    const g = (N) => Math.round(N / G * 1000);
    $('#tiles').innerHTML = tilesHTML([
      { k: 'Overall width', v: fmt(m.widthOverall, 1), u: 'mm', s: m.widthOverall > 190.05 ? 'over the 190 mm limit' : '190 mm limit', state: m.widthOverall > 190.05 ? 'bad' : 'good' },
      { k: 'Corner weights', v: `${g(m.N0.front)} / ${g(m.N0.rear)}`, u: 'g', s: 'each front / each rear' },
      { k: 'Track (patch centres)', v: `${fmt(2 * m.front.trackHalf, 1)} / ${fmt(2 * m.rear.trackHalf, 1)}`, u: 'mm', s: 'front / rear' },
      { k: 'Ride frequency', v: `${m.front.rideFreq.toFixed(1)} / ${m.rear.rideFreq.toFixed(1)}`, u: 'Hz', s: 'front / rear' },
      { k: 'Roll axis at CG', v: fmt(m.rollAxisAtCg, 1), u: 'mm', s: `CG ${fmt(m.h - m.rollAxisAtCg, 1)} mm above it` },
      { k: 'Tyre squash', v: fmt(m.N0.front / m.setup.car.tireRate, 2), u: 'mm', s: 'front tyre, static' },
    ]);
    $('#charts').innerHTML = '';
  };

  RENDER.sheet = function (m) {
    const groups = [['Front', 'front.'], ['Rear', 'rear.'], ['Car', 'car.']];
    const row = (path) => {
      const spec = P.PARAMS[path], v = P.getPath(state.setup, path), meta = metaFor(path, false);
      let txt;
      if (spec.options) txt = META.frontDiff.options[v][0];
      else txt = (meta.signed ? fmtS(v, decimals(spec.step)) : fmt(v, decimals(spec.step))) + ' ' + spec.unit;
      const changed = spec.options ? v !== spec.v : Math.abs(v - spec.v) > 1e-9;
      return `<tr><th>${meta.label}</th><td class="${changed ? 'mod' : ''}">${txt}</td></tr>`;
    };
    const tables = groups.map(([name, pre]) => `<section class="card"><h3>${name}</h3><div class="sheet-wrap"><table class="sheet">${Object.keys(P.PARAMS).filter((k) => k.startsWith(pre)).map(row).join('')}</table></div></section>`).join('');
    const r = P.solveVehicle(m, { ay: 1.5 });
    const out = [
      ['Roll centre F / R', `${fmt(m.front.rcHeight, 1)} / ${fmt(m.rear.rcHeight, 1)} mm`],
      ['Camber gain F / R', `${fmtS(m.front.camberGain, 2)} / ${fmtS(m.rear.camberGain, 2)} °/mm`],
      ['Caster / trail', `${fmt(m.front.caster, 2)}° / ${fmt(m.front.trail, 2)} mm`],
      ['Ackermann at lock', `${fmt(m.steer.ackermannPct, 0)} %`],
      ['Bump steer F / R', `${fmtS(m.front.toeGain, 3)} / ${fmtS(m.rear.toeGain, 3)} °/mm`],
      ['Anti-squat / anti-dive', `${fmt(m.antiSquat, 0)} % / ${fmt(m.antiDive, 0)} %`],
      ['Wheel rate F / R', `${m.front.wheelRate.toFixed(3)} / ${m.rear.wheelRate.toFixed(3)} N/mm`],
      ['Roll stiffness front', `${m.rollStiffFrontPct.toFixed(1)} %`],
      ['Front LLTD at 1.5 g', r ? `${r.lltdFront.toFixed(1)} %` : '–'],
      ['Roll at 1.5 g', r ? `${r.roll.toFixed(2)}°` : '–'],
      ['Overall width', `${fmt(m.widthOverall, 1)} mm`],
    ];
    $('#tiles').innerHTML = '';
    $('#extra').innerHTML = `<div class="sheet-grid">${tables}<section class="card"><h3>Results</h3><div class="sheet-wrap"><table class="sheet">${out.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table></div></section>
      <section class="card"><h3>Save or share</h3><p class="small">Values that differ from stock are shown in green. Copy the setup as text to keep it or send it to a teammate, and paste one back in to load it.</p>
      <div class="btn-row"><button class="btn primary" id="copy">Copy setup</button><button class="btn" id="reset-all">Reset everything</button></div>
      <p class="small" id="copy-msg" aria-live="polite"></p>
      <label class="small" for="paste">Paste a setup</label><textarea id="paste" spellcheck="false" placeholder='{"front": {...}, "rear": {...}, "car": {...}}'></textarea>
      <div class="btn-row" style="margin-top:8px"><button class="btn" id="load">Load pasted setup</button></div></section></div>`;
    $('#copy').addEventListener('click', () => {
      const text = JSON.stringify(state.setup, null, 1);
      const msg = $('#copy-msg');
      const fallback = () => { const t = $('#paste'); t.value = text; t.focus(); t.select(); msg.textContent = 'Copy is blocked here. The setup is selected in the box below; copy it from there.'; };
      try {
        navigator.clipboard.writeText(text).then(() => { msg.textContent = 'Setup copied.'; }, fallback);
      } catch (e) { fallback(); }
    });
    $('#reset-all').addEventListener('click', () => {
      const msg = $('#copy-msg');
      if (msg.dataset.confirm !== '1') { msg.dataset.confirm = '1'; msg.textContent = 'Tap Reset everything again to confirm.'; return; }
      state.setup = P.stockSetup(); msg.dataset.confirm = ''; save(); update();
      $('#copy-msg').textContent = 'All values are back to stock.';
    });
    $('#load').addEventListener('click', () => {
      const msg = $('#copy-msg');
      try {
        const d = JSON.parse($('#paste').value);
        state.setup = P.sanitize(d); save(); update();
        $('#copy-msg').textContent = 'Setup loaded. Out-of-range values were clamped.';
      } catch (e) { msg.textContent = 'That text is not a setup. Paste the text from Copy setup.'; }
    });
  };

  // ------------------------------------------------------------------
  // Explanations
  // ------------------------------------------------------------------
  const EXPLAIN = {
    camber: [
      'Static camber is set with the turnbuckle. After every geometry change the app works out the new link length, as you would on the setup board.',
      '<b>Camber gain</b> is the camber a wheel picks up per mm of bump. Body roll adds positive camber to the outside tyre and camber gain takes it back; the tile for a 1.5 g corner shows the net result against the track.',
      '<b>Roll centre</b>: the green line runs from the contact patch through the instant centre (IC) and crosses the centreline at the roll centre. A higher RC sends more of the cornering load through the arms and links, which is instant, and less through the springs, so that end rolls less and reacts faster. A lower RC gives more roll and a slower, softer reaction.',
      'Short links make the RC move a lot as the chassis heaves. Drag the travel slider to watch it migrate.',
    ],
    caster: [
      'Caster tilts the steering axis back. The axis meets the ground ahead of the contact patch; that gap is the <b>trail</b>, which makes the steering self-centre.',
      'On lock, positive caster leans the outside wheel to more negative camber and the inside wheel to more positive camber.',
      'It also jacks the chassis. The inside wheel is pushed down and the outside wheel rises, which puts load on the inside-front and outside-rear diagonal while the wheels are turned. More caster gives a bigger effect.',
      'Kick-up tilts the whole C-hub with the hinge pins, so it adds to caster. It also changes how the front moves under braking; see Anti-squat.',
      'Static camber rotates the C-hub as well, so the effective kingpin inclination shifts a little with camber.',
    ],
    ackermann: [
      'At 100 % Ackermann both front wheels turn around one point on the rear-axle line, so the inside wheel steers more than the outside one. At 0 % both wheels steer the same angle.',
      'Moving the steering-block ball inboard or the plate ball rearward gives more Ackermann. The steering plate rides on the bellcranks, so it also moves fore-aft as it travels; that is included.',
      'At speed the tyres run at slip angles, so the low-speed ideal no longer applies. Changing Ackermann changes how hard the lightly loaded inside tyre works compared with the outside one, mostly mid-corner and at full lock.',
      'Every change re-sets front toe with the steering links, as you would after moving a ball.',
    ],
    toe: [
      'Front toe-out makes turn-in more eager and toe-in calms it. Rear toe-in adds stability and grip on power, at the cost of some drag.',
      '<b>Bump steer</b> is toe change as the suspension moves. On the outside front, toe-in in bump makes the car steer more as it rolls and toe-out in bump makes it steer less. Rear toe-in in bump stabilises the rear.',
      'The ball spacers move the steering link up or down. Bump steer is zero when the steering link points at the same instant centre as the lower arm and camber link and has the matching length. In the lower drawing, watch the yellow link against the dashed lines.',
    ],
    antisquat: [
      'Touring cars drive and brake through diffs on the chassis, so the drive force reaches the suspension at the wheel centre. With angled hinge pins the wheel moves on a slanted path, and part of the load transfer goes straight through the arms instead of the springs.',
      'The green line starts at the rear wheel centre. If it reached the 100 % mark the rear would not squat at all. The total load transfer (weight × acceleration × CG height ÷ wheelbase) does not change. Anti-squat only changes how far the chassis pitches and how quickly the load reaches the tyres.',
      'Both axles drive, so only the rear share of the drive force acts through the rear arms. That is why the same pin angle gives about half the percentage a rear-drive car would get.',
      'Front kick-up (front of the pin higher) makes the nose dive more under braking. Front pins that are lower at the front give anti-dive. With a one-way the front wheels freewheel off-throttle, so the front geometry does nothing under braking.',
    ],
    droop: [
      'Droop is how far the wheel can hang below ride height before the droop screw stops the arm.',
      'In a corner the inside wheels extend. Once an inside wheel reaches its droop stop, that end cannot roll further without unloading the wheel, so its load transfer rises faster. Less droop at one end means more load transfer and less grip at that end at the limit.',
      '<b>Front LLTD</b> is the front axle’s share of the total lateral load transfer. Higher means more understeer at the limit and lower means more oversteer.',
      'More droop also lets the chassis pitch and roll further and keeps the tyres on the track over bumps.',
    ],
    springs: [
      'Wheel rate = spring rate × motion ratio². The motion ratio comes from where the shock sits on the arm and how far it leans. Moving the lower mount outward or standing the shock up raises it.',
      'The anti-roll bar only works when the two sides move differently, so it adds roll stiffness without changing ride stiffness. A stiffer bar at one end raises that end’s share of the load transfer, which means less grip there at the limit.',
      'The tyres act as springs in series with the suspension, so they lower the effective ride and roll stiffness.',
      'Ride frequency uses the sprung mass on each corner and the tyre stiffness.',
    ],
    car: [
      'These are the baseline inputs. The model is a generic 190 mm 4WD touring car: 50 mm lower arms on hinge pins, turnbuckle camber links, C-hubs with steering blocks on kingpins, twin-bellcrank steering and inboard diffs.',
      'Corner weights assume a level car with equal left and right weight.',
      'Wheel spacers and tyre width set the overall width, which is checked against the 190 mm limit.',
    ],
    sheet: [
      'Everything on this sheet comes from the same solver that drives the drawings.',
      'The setup is saved on this device as you change it.',
    ],
  };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot() {
    load();
    const h = location.hash.slice(1);
    if (h && TABS.some((t) => t.id === h)) state.tab = h;
    buildShell();
    applyTheme();
    selectTab(state.tab, false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
