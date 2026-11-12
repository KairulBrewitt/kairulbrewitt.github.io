// Run with:  node --test tc-setup-lab/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const P = require(path.join(__dirname, '..', 'web', 'js', 'physics.js'));

const { sub, len, add } = P._internal;
const DEG = P.DEG;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a} (tol ${tol})`);
// Textbook checks run on the generic C-hub car; SP2 checks use the RC Maker SP2 kit.
const build = (mod) => { const s = P.stockSetup('generic'); if (mod) mod(s); return P.buildModel(s); };
const buildSP2 = (mod) => { const s = P.stockSetup('sp2'); if (mod) mod(s); return P.buildModel(s); };

// deterministic RNG for the fuzz test
function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

test('stock setup builds cleanly', () => {
  const m = build();
  assert.ok(m.ok, m.errors.join());
  assert.deepEqual(m.warnings, []);
  close(m.wheelbase, 257, 1e-6, 'wheelbase');
  assert.ok(m.widthOverall <= 190.05, 'width within 190 mm');
});

test('static solve hits ride height, camber and toe targets exactly', () => {
  for (const mod of [null, (s) => { s.front.camber = -3; s.rear.camber = 0.5; s.front.toe = 1.2; s.front.rideHeight = 7; s.rear.rideHeight = 4; }]) {
    const m = build(mod);
    for (const k of ['front', 'rear']) {
      const C = m[k], A = m.setup[k];
      close(C.static.camber, A.camber, 1e-9, `${k} camber`);
      close(C.static.P[2], -A.rideHeight, 1e-8, `${k} ride height`);
    }
    close(m.front.static.toe, m.setup.front.toe, 1e-9, 'front toe');
  }
});

test('link lengths stay constant through the whole travel and steering range', () => {
  const m = build();
  const F = m.front, R = m.rear;
  for (let s = -4; s <= 6; s += 0.5) {
    for (const C of [F, R]) {
      const st = C.stateAtTravel(s, 0);
      assert.ok(st, `assembles at ${s}`);
      close(len(sub(st.B, C.U)), C.Lcl, 1e-8, 'camber link length');
      close(st.W[2] - C.static.W[2], s, 1e-7, 'travel');
    }
    for (const p of [-5, -2, 0, 3, 5]) {
      const th = F.thetaForTravel(s, p);
      const st = F.state(th, p);
      close(len(sub(st.ball, F.plateBall(p))), F.Ltr, 1e-8, 'steering link length');
    }
  }
});

// The rear corner with flat, straight pins is a true planar mechanism, so the
// textbook constructions apply exactly. (At the front, bump steer rotates the
// block about a tilted kingpin, which legitimately adds camber and moves the IC.)
const planarRear = (s) => { s.rear.antiSquat = 0; s.rear.toe = 0; };

test('parallelogram linkage: zero camber gain, roll centre from the arm angle', () => {
  // Put the camber link exactly parallel to, and as long as, the lower arm.
  const base = build(planarRear);
  const F = base.rear;
  const d = sub(F.static.B, F.static.O);
  const U = add(F.Pin, d);
  const m = build((s) => { planarRear(s); s.rear.linkInY = U[1]; s.rear.linkInZ = U[2]; });
  const C = m.rear;
  close(C.Lcl, P.HW.rear.armLen, 1e-6, 'link length equals arm');
  close(C.camberGain, 0, 1e-6, 'camber gain');
  // contact patch moves perpendicular to the arm -> RC = yP * (-tan(arm angle))
  const arm = sub(C.static.O, C.Pin);
  const tanB = arm[2] / arm[1];
  close(C.rcHeight, C.static.P[1] * -tanB, 1e-4, 'roll centre');
});

test('roll centre from velocities equals the classic instant-centre construction', () => {
  for (const mod of [null, (s) => { s.rear.linkInZ = 24; s.rear.pivotZ = 8.5; }, (s) => { s.rear.linkInY = 30; s.rear.linkInZ = 34; }]) {
    const m = build((s) => { planarRear(s); if (mod) mod(s); });
    const C = m.rear, S = C.static;
    // front-view lines: lower arm (inner pin -> outer pin), camber link (inner -> outer ball)
    const l1 = [C.Pin[1], C.Pin[2], S.O[1], S.O[2]], l2 = [C.U[1], C.U[2], S.B[1], S.B[2]];
    const [x1, y1, x2, y2] = l1, [x3, y3, x4, y4] = l2;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    const icY = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
    const icZ = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
    close(C.ic[0], icY, 1e-5 * Math.max(1, Math.abs(icY)), 'IC y');
    close(C.ic[1], icZ, 1e-5 * Math.max(1, Math.abs(icZ)), 'IC z');
    // RC: line from contact patch through IC, evaluated on the centreline
    const Py = S.P[1], Pz = S.P[2];
    const rcZ = Pz + (icZ - Pz) * (0 - Py) / (icY - Py);
    close(C.rcHeight, rcZ - Pz, 1e-4, 'RC height');
  }
});

test('anti-squat matches tan(angle) * L / h * rear drive share', () => {
  for (const ang of [0, 1, 2.5, 4]) {
    const m = build((s) => { s.rear.antiSquat = ang; s.rear.toe = 0; });
    const expected = (1 - m.driveFront) * Math.tan(ang * DEG) * m.wheelbase / m.h * 100;
    close(m.antiSquat, expected, 1e-4, `anti-squat at ${ang}°`);
  }
});

test('front kick-up adds to C-hub caster', () => {
  for (const [c, k] of [[4, 0], [4, 2], [6, -1], [2, 3]]) {
    const m = build((s) => { s.front.caster = c; s.front.kickup = k; s.front.camber = 0; s.front.toe = 0; });
    close(m.front.caster, c + k, 1e-6, `caster ${c}+${k}`);
  }
});

test('kingpin geometry: positive caster gives positive trail and the right camber change on lock', () => {
  const m = build((s) => { s.front.caster = 6; });
  assert.ok(m.front.trail > 0, 'trail positive');
  const full = m.steer.full;
  assert.ok(full.camberOut < m.front.static.camber, 'outside wheel gains negative camber');
  assert.ok(full.camberIn > m.front.static.camber, 'inside wheel gains positive camber');
});

test('vertical kingpin produces no steering jacking', () => {
  const m = build((s) => { s.front.caster = 0; s.front.kpi = 0; s.front.camber = 0; s.front.toe = 0; s.front.kickup = 0; });
  close(m.steer.full.dzIn, 0, 1e-6, 'inner dz');
  close(m.steer.full.dzOut, 0, 1e-6, 'outer dz');
  const more = build((s) => { s.front.caster = 8; });
  const less = build((s) => { s.front.caster = 2; });
  assert.ok(Math.abs(P.steeringJacking(more).diagonalGrams) > Math.abs(P.steeringJacking(less).diagonalGrams));
});

test('Ackermann: ideal formula, symmetry and the effect of the steering-arm ball', () => {
  const L = 257, T = 166;
  for (const i of [5, 15, 30]) {
    const o = P.idealOuter(i, L, T);
    close(1 / Math.tan(o * DEG) - 1 / Math.tan(i * DEG), T / L, 1e-9, 'cot(o) - cot(i) = T/L');
  }
  const m = build();
  for (const p of [1, 3, 5]) {
    const a = P.steerAt(m.front, p), b = P.steerAt(m.front, -p);
    close(a.left, -b.right, 1e-9, 'mirror');
    close(a.right, -b.left, 1e-9, 'mirror');
  }
  close(m.steer.full.inner, m.setup.front.lock, 1e-6, 'lock reached');
  const ack = [0, 2, 4, 6, 8].map((i) => build((s) => { s.front.ackInset = i; }).steer.ackermannPct);
  for (let i = 1; i < ack.length; i++) assert.ok(ack[i] > ack[i - 1], 'more inset, more Ackermann');
});

test('bump steer responds to the steering ball height', () => {
  const g = [0, 1, 2, 3, 4].map((b) => build((s) => { s.front.ballSpacer = b; }).front.toeGain);
  for (let i = 1; i < g.length; i++) assert.ok(g[i] < g[i - 1], 'raising the outer ball reduces toe-in in bump');
  assert.ok(Math.abs(build().front.toeGain) < 0.02, 'stock bump steer is small');
});

test('vehicle: static equilibrium and global balances', () => {
  const m = build();
  const r0 = P.solveVehicle(m, {});
  assert.ok(r0.converged);
  r0.corners.forEach((c, i) => close(c.N, i < 2 ? m.N0.front : m.N0.rear, 1e-6, 'static load'));
  close(r0.roll, 0, 1e-9); close(r0.pitch, 0, 1e-9); close(r0.heave, 0, 1e-9);

  for (const cond of [{ ay: 0.8 }, { ay: -1.3 }, { ax: 1 }, { ax: -0.9 }, { ay: 1, ax: 0.5 }]) {
    const r = P.solveVehicle(m, cond);
    assert.ok(r.converged, JSON.stringify(cond));
    const sumN = r.corners.reduce((a, c) => a + c.N, 0);
    close(sumN, m.mass * P.G, 1e-6, 'sum of wheel loads equals weight');
  }
});

test('vehicle: total lateral transfer close to m*ay*h/t and mirror symmetric', () => {
  const m = build();
  const r = P.solveVehicle(m, { ay: 0.2 });
  const dF = (r.corners[1].N - r.corners[0].N) / 2, dR = (r.corners[3].N - r.corners[2].N) / 2;
  const t = 2 * m.front.trackHalf;
  const expected = m.mass * 0.2 * P.G * m.h / t;
  close(dF + dR, expected, 0.03 * expected, 'lateral load transfer');
  const l = P.solveVehicle(m, { ay: -1.1 }), rr = P.solveVehicle(m, { ay: 1.1 });
  close(l.corners[0].N, rr.corners[1].N, 1e-6); close(l.corners[2].N, rr.corners[3].N, 1e-6);
  close(l.roll, -rr.roll, 1e-6);
});

test('vehicle: load transfer reacts the right way to bars, roll centres and droop', () => {
  const lltd = (mod, g) => P.solveVehicle(build(mod), { ay: g || 1.2 }).lltdFront;
  assert.ok(lltd((s) => { s.front.swayBar = 1.6; }) > lltd((s) => { s.front.swayBar = 0.8; }), 'stiffer front bar -> more front LLTD');
  assert.ok(lltd((s) => { s.rear.swayBar = 1.6; }) < lltd((s) => { s.rear.swayBar = 0; }), 'stiffer rear bar -> less front LLTD');
  assert.ok(lltd((s) => { s.front.pivotZ = 8.5; }) > lltd((s) => { s.front.pivotZ = 5.5; }), 'higher front RC -> more front LLTD');
  assert.ok(lltd((s) => { s.front.droop = 0.8; }, 2) > lltd((s) => { s.front.droop = 5; }, 2), 'less front droop -> more front LLTD at high g');
  const rollSoft = P.solveVehicle(build((s) => { s.front.spring = 0.3; s.rear.spring = 0.3; }), { ay: 1 }).roll;
  const rollHard = P.solveVehicle(build((s) => { s.front.spring = 1.0; s.rear.spring = 1.0; }), { ay: 1 }).roll;
  assert.ok(rollSoft > rollHard, 'softer springs roll more');
});

test('vehicle: anti-squat reduces squat; one-way removes front braking anti-dive', () => {
  const squat = (as) => P.solveVehicle(build((s) => { s.rear.antiSquat = as; }), { ax: 1 }).rearHeightChange;
  assert.ok(squat(0) < squat(2) && squat(2) < squat(4), 'rear sinks less with more anti-squat');
  const spool = build((s) => { s.front.kickup = -2; s.car.frontDiff = 'spool'; });
  const oneway = build((s) => { s.front.kickup = -2; s.car.frontDiff = 'oneway'; });
  assert.ok(spool.antiDive > 0, 'front pins lower at the front give anti-dive');
  close(oneway.antiDive, 0, 1e-12, 'no front braking with a one-way');
  const kick = build((s) => { s.front.kickup = 2; });
  assert.ok(kick.antiDive < 0, 'kick-up (front of pin higher) is pro-dive');
});

test('front-view roll centre also holds on the steered front corner when bump steer is zero', () => {
  // with the tie rod tuned for ~zero bump steer, front RC ~ IC construction
  const m = build((s) => { s.front.kickup = 0; });
  assert.ok(Math.abs(m.front.toeGain) < 0.01);
  const C = m.front, S = C.static;
  const icY = C.ic[0], icZ = C.ic[1];
  const rcZ = S.P[2] + (icZ - S.P[2]) * (0 - S.P[1]) / (icY - S.P[1]);
  close(C.rcHeight, rcZ - S.P[2], 1e-3, 'RC via IC');
});

test('RC Maker SP2 kit: reproduces the published kit numbers', () => {
  const m = buildSP2();
  assert.ok(m.ok, m.errors.join());
  assert.deepEqual(m.warnings, []);
  assert.equal(m.setup.car.model, 'sp2');
  close(m.front.caster, 4, 0.05, 'front caster (kit inserts)');
  close(m.rear.caster, -2.5, 0.05, 'rear caster (kit inserts)');
  close(m.steer.full.inner, 27, 1e-6, 'kit lock, inside');
  close(m.steer.full.outer, 17, 0.1, 'kit lock, outside (manual: roughly 17 deg)');
  assert.ok(m.widthOverall <= 190.05, 'width within 190 mm');
  close(m.setup.front.swayBar, 1.1, 1e-9); close(m.setup.rear.swayBar, 1.1, 1e-9);
  assert.equal(m.setup.car.frontDiff, 'spool');
  assert.ok(Math.abs(m.front.toeGain) < 0.02, 'front bump steer near zero with kit spacers');
  assert.ok(m.front.rcHeight > 0 && m.rear.rcHeight > m.front.rcHeight, 'roll centres above ground, rear higher');
});

test('RC Maker SP2: rear toe link sets toe and keeps its length through travel', () => {
  for (const toe of [0, 1.5, 3]) {
    const m = buildSP2((s) => { s.rear.toe = toe; });
    close(m.rear.static.toe, toe, 1e-9, 'rear toe from the toe link');
  }
  const m = buildSP2();
  const R = m.rear;
  for (let s = -4; s <= 5; s += 0.5) {
    const st = R.stateAtTravel(s, 0);
    assert.ok(st, `rear assembles at ${s}`);
    close(len(sub(st.ball, R.plateBall(0))), R.Ltr, 1e-8, 'toe link length');
    close(len(sub(st.B, R.U)), R.Lcl, 1e-8, 'upper arm length');
  }
  const more = buildSP2((s) => { s.rear.ballSpacer = 2; }).rear.toeGain;
  assert.notEqual(Math.sign(more - R.toeGain), 0, 'toe-link ball spacer changes rear toe gain');
});

test('RC Maker SP2: caster comes from the upper balls, not from the hinge-pin angle', () => {
  const a = buildSP2((s) => { s.rear.antiSquat = 0; s.front.kickup = 0; });
  const b = buildSP2((s) => { s.rear.antiSquat = 4; s.front.kickup = 3; });
  close(a.rear.caster, b.rear.caster, 0.05, 'rear caster unchanged by anti-squat');
  close(a.front.caster, b.front.caster, 0.05, 'front caster unchanged by kick-up');
  // on the C-hub car kick-up does add to caster
  assert.ok(build((s) => { s.front.kickup = 3; }).front.caster > build().front.caster + 2.9);
});

test('cars: stock values, parameter availability and switching', () => {
  assert.equal(P.stockSetup().car.model, 'sp2', 'SP2 is the default car');
  assert.equal(P.sanitize({ car: { model: 'nope' } }).car.model, 'sp2');
  assert.equal(P.sanitize({ car: { model: 'generic' } }).car.model, 'generic');
  assert.equal(P.stockValue('front.caster', 'sp2'), 4);
  assert.equal(P.stockValue('front.lock', 'sp2'), 27);
  assert.equal(P.stockValue('front.lock', 'generic'), P.PARAMS['front.lock'].v);
  assert.ok(P.applies('rear.caster', P.stockSetup('sp2')));
  assert.ok(!P.applies('rear.caster', P.stockSetup('generic')));
  for (const id of Object.keys(P.CARS)) {
    const s = P.stockSetup(id);
    for (const k in P.PARAMS) {
      const p = P.PARAMS[k], v = P.getPath(s, k);
      if (p.options) assert.ok(p.options.includes(v), `${id} ${k}`);
      else assert.ok(v >= p.min && v <= p.max, `${id} ${k}=${v} within ${p.min}..${p.max}`);
    }
  }
});

test('sanitize: garbage input never breaks the model', () => {
  const junk = [undefined, null, {}, { car: { mass: 'heavy' } }, { front: { camber: NaN, droop: Infinity } }, { rear: { spring: -5, toe: '2.5' } }, { car: { frontDiff: 'banana' } }];
  for (const j of junk) {
    const m = P.buildModel(j);
    assert.ok(m.ok, JSON.stringify(j));
    const r = P.solveVehicle(m, { ay: 1 });
    assert.ok(r.converged);
  }
  assert.equal(P.sanitize({ rear: { toe: '2.5' } }).rear.toe, 2.5);
  assert.equal(P.sanitize({ front: { camber: -99 } }).front.camber, P.PARAMS['front.camber'].min);
});

test('fuzz: random setups inside the slider ranges stay finite and converge', () => {
  const rand = rng(12345);
  const keys = Object.keys(P.PARAMS);
  let built = 0, failed = 0;
  for (let n = 0; n < 250; n++) {
    const s = P.stockSetup(n % 2 ? 'generic' : 'sp2');
    for (const k of keys) {
      const p = P.PARAMS[k];
      if (k === 'car.model') continue;
      if (p.options) { P.setPath(s, k, p.options[Math.floor(rand() * p.options.length)]); continue; }
      if (rand() < 0.5) P.setPath(s, k, p.min + rand() * (p.max - p.min));
    }
    const m = P.buildModel(s);
    if (!m.ok) { failed++; assert.ok(m.errors.length > 0, 'failure is reported'); continue; }
    built++;
    for (const v of [m.front.rcHeight, m.rear.rcHeight, m.front.camberGain, m.antiSquat, m.steer.ackermannPct, m.front.trail, m.front.wheelRate, m.rear.rideFreq]) {
      assert.ok(Number.isFinite(v), 'finite output');
    }
    for (const cond of [{ ay: rand() * 2 }, { ax: rand() * 2 - 1 }]) {
      const r = P.solveVehicle(m, cond);
      assert.ok(r && r.converged, `converges ${JSON.stringify(cond)} for ${JSON.stringify(s)}`);
      for (const c of r.corners) assert.ok(Number.isFinite(c.N) && c.N >= 0);
    }
  }
  assert.ok(built > 240, `built ${built}, failed ${failed}`);
});
