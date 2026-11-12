/*
 * TC Setup Lab: physics engine
 * ---------------------------------------------------------------
 * 3D kinematics of a 1/10 electric touring car corner and a quasi-static
 * whole-car model. Pure functions, no DOM. Runs in the browser (global
 * `TCPhysics`) and in Node (module.exports) for the test suite.
 *
 * Units: mm, degrees (API) / radians (internal), grams (mass inputs),
 * newtons, N/mm. Lateral/longitudinal acceleration in g.
 *
 * Chassis frame: x forward (0 = front axle station), y to the left,
 * z up with z = 0 on the underside of the chassis plate. The ground sits
 * at z = -rideHeight when the car is static.
 *
 * Every corner is solved for the LEFT side; the right side is its mirror
 * image (y -> -y), with steering input mirrored as well.
 *
 * Corner mechanism (as on a typical TC):
 *  - lower arm hinged on an inner pin (revolute joint), carrying an outer pin
 *    parallel to it;
 *  - C-hub (front) or rear hub rotates on the outer pin;
 *  - upper camber link (turnbuckle, ball ends) from chassis to the hub;
 *  - front: steering block pivots on a kingpin fixed in the C-hub, driven by a
 *    steering link from a steering plate that rides on twin bellcranks.
 * That is one degree of freedom in heave plus one in steer. All constraints
 * are solved in closed form (rotation about a fixed axis), so nothing is
 * approximated as 2D.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCPhysics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const G = 9.80665; // m/s^2
  const STEEL_G = 79300; // shear modulus of spring steel, N/mm^2

  // ------------------------------------------------------------------
  // Vector / matrix helpers (arrays, rows for matrices)
  // ------------------------------------------------------------------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  function rotM(k, ang) {
    const [x, y, z] = k, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
  }
  const mv = (M, v) => [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
  const mtv = (M, v) => [
    M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
    M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
    M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
  ];
  function mm(A, B) {
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      R[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    return R;
  }
  const fromCols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /** Solve P cos(x) + Q sin(x) = S for the root closest to `ref`. */
  function solveTrig(P, Q, S, ref) {
    const R0 = Math.hypot(P, Q);
    if (!(R0 > 1e-12)) return NaN;
    const c = S / R0;
    if (c > 1 + 1e-12 || c < -1 - 1e-12) return NaN; // geometry cannot close
    const base = Math.atan2(Q, P), d = Math.acos(clamp(c, -1, 1));
    const x1 = base + d, x2 = base - d;
    const r1 = ref + wrap(x1 - ref), r2 = ref + wrap(x2 - ref);
    return Math.abs(r1 - ref) <= Math.abs(r2 - ref) ? r1 : r2;
  }
  /** Angle about unit axis k (through C) so that |C + R(ang) r - Q| = L. */
  function solveRotDist(k, C, r, Q, L, ref) {
    const d = sub(C, Q);
    const rpar = mul(k, dot(k, r)), rperp = sub(r, rpar);
    const P = dot(d, rperp), Qs = dot(d, cross(k, r));
    const S = (L * L - dot(d, d) - dot(r, r)) / 2 - dot(d, rpar);
    return solveTrig(P, Qs, S, ref);
  }
  /** Angle about unit axis k so that n . (R(ang) r) = target. */
  function solveRotDot(k, r, n, target, ref) {
    const rpar = mul(k, dot(k, r)), rperp = sub(r, rpar);
    return solveTrig(dot(n, rperp), dot(n, cross(k, r)), target - dot(n, rpar), ref);
  }

  /**
   * Robust scalar root finder: expands a bracket around x0 and refines with
   * the Illinois false-position method. f may return NaN where the mechanism
   * cannot assemble; those points are treated as outside the domain.
   */
  function findRoot(f, x0, dx, lo, hi, tol) {
    tol = tol || 1e-11;
    let a = x0, fa = f(a);
    if (!isFinite(fa)) return NaN;
    if (fa === 0) return a;
    let b = NaN, fb = NaN, step = dx;
    for (let i = 0; i < 60 && isNaN(b); i++) {
      for (const sgn of [1, -1]) {
        const x = clamp(x0 + sgn * step, lo, hi), fx = f(x);
        if (isFinite(fx) && Math.sign(fx) !== Math.sign(fa)) { b = x; fb = fx; break; }
      }
      step *= 1.6;
      if (x0 - step < lo && x0 + step > hi && i > 3) { if (isNaN(b)) break; }
    }
    if (isNaN(b)) return NaN;
    let side = 0;
    for (let i = 0; i < 200; i++) {
      const x = (a * fb - b * fa) / (fb - fa);
      const fx = f(x);
      if (!isFinite(fx)) return NaN;
      if (Math.abs(fx) < tol || Math.abs(b - a) < 1e-13) return x;
      if (Math.sign(fx) === Math.sign(fb)) { b = x; fb = fx; if (side === -1) fa /= 2; side = -1; }
      else { a = x; fa = fx; if (side === 1) fb /= 2; side = 1; }
    }
    return (a + b) / 2;
  }

  // ------------------------------------------------------------------
  // Hardware: fixed part dimensions of a generic 190 mm touring car.
  // Coordinates for hub parts are in the hub's own frame, relative to the
  // outer hinge pin: u forward (along the pin), v outward, w up.
  // ------------------------------------------------------------------
  const HW = {
    front: {
      innerY: 18,          // inner hinge pin, distance from centreline
      armLen: 50,          // inner pin to outer pin
      kpLow: [0, 4, 3],    // lower kingpin pivot in C-hub
      kpLen: 22,           // kingpin length (drawing only)
      wheel: [0, 11.5, 16.5], // wheel centre relative to lower kingpin pivot
      ballZ: 9,            // steering-arm ball height above lower kingpin pivot
      camberBall: [0, 1.5, 24], // camber link ball on C-hub (+ spacer)
      shockArmZ: 2.5,      // shock ball stud height above arm pin line
      shockTowerZ: 60,     // shock top mount height above chassis
      arbArm: 24, arbArmZ: 1.5, // sway-bar link position on the arm
      arbLever: 18, arbSpan: 60, // bar lever-arm length, twisting length
      bellcrank: 16,       // bellcrank radius (steering plate rides on it)
      plateX: -14,         // steering plate ball, x relative to front axle
      plateZ: 18,          // steering plate ball height (no spacers)
    },
    rear: {
      innerY: 18,
      armLen: 50,
      wheel: [0, 15.7, 19.5],
      camberBall: [0, 1.5, 24],
      shockArmZ: 2.5,
      shockTowerZ: 60,
      arbArm: 24, arbArmZ: 1.5,
      arbLever: 18, arbSpan: 60,
    },
    chassis: { halfWidth: 46, front: 48, rear: 22, thick: 2.25 },
    unsprungPerCorner: 50, // g: wheel, tyre, hub, half the arm and links
  };

  // ------------------------------------------------------------------
  // Setup parameters: stock values + allowed range (inputs are clamped).
  // ------------------------------------------------------------------
  const PARAMS = {
    'car.mass':        { v: 1380, min: 1250, max: 1650, step: 5,    unit: 'g' },
    'car.frontPct':    { v: 49,   min: 42,   max: 56,   step: 0.5,  unit: '%' },
    'car.cgHeight':    { v: 21,   min: 15,   max: 32,   step: 0.5,  unit: 'mm' },
    'car.wheelbase':   { v: 257,  min: 250,  max: 266,  step: 0.5,  unit: 'mm' },
    'car.tireDia':     { v: 64,   min: 60,   max: 66,   step: 0.1,  unit: 'mm' },
    'car.tireWidth':   { v: 24,   min: 22,   max: 27,   step: 0.5,  unit: 'mm' },
    'car.tireRate':    { v: 10,   min: 4,    max: 25,   step: 0.5,  unit: 'N/mm' },
    'car.frontDiff':   { v: 'spool', options: ['spool', 'oneway', 'diff'] },

    'front.rideHeight':  { v: 5.0,  min: 3.5,  max: 8.0,  step: 0.1,  unit: 'mm' },
    'front.camber':      { v: -1.5, min: -4.0, max: 1.0,  step: 0.1,  unit: '°' },
    'front.toe':         { v: -0.5, min: -3.0, max: 2.0,  step: 0.1,  unit: '°' },
    'front.droop':       { v: 2.0,  min: 0.5,  max: 7.0,  step: 0.1,  unit: 'mm' },
    'front.linkInZ':     { v: 27.0, min: 22,   max: 38,   step: 0.5,  unit: 'mm' },
    'front.linkInY':     { v: 20.0, min: 12,   max: 32,   step: 0.5,  unit: 'mm' },
    'front.linkOutSpacer': { v: 1.0, min: 0,   max: 4,    step: 0.5,  unit: 'mm' },
    'front.pivotZ':      { v: 6.5,  min: 5.0,  max: 9.0,  step: 0.25, unit: 'mm' },
    'front.kickup':      { v: 0.0,  min: -2.0, max: 4.0,  step: 0.25, unit: '°' },
    'front.caster':      { v: 4.0,  min: 0.0,  max: 8.0,  step: 0.5,  unit: '°' },
    'front.kpi':         { v: 0.0,  min: 0.0,  max: 10.0, step: 0.5,  unit: '°' },
    'front.wheelSpacer': { v: 0.0,  min: -1.0, max: 2.0,  step: 0.25, unit: 'mm' },
    'front.spring':      { v: 0.50, min: 0.25, max: 1.20, step: 0.01, unit: 'N/mm' },
    'front.shockArm':    { v: 40,   min: 32,   max: 46,   step: 0.5,  unit: 'mm' },
    'front.shockTowerY': { v: 36,   min: 26,   max: 46,   step: 0.5,  unit: 'mm' },
    'front.swayBar':     { v: 1.2,  min: 0,    max: 1.8,  step: 0.1,  unit: 'mm' },
    'front.ackInset':    { v: 4.0,  min: 0,    max: 10,   step: 0.5,  unit: 'mm' },
    'front.armLength':   { v: 14.0, min: 10,   max: 18,   step: 0.5,  unit: 'mm' },
    'front.plateY':      { v: 19.0, min: 12,   max: 26,   step: 0.5,  unit: 'mm' },
    'front.plateDX':     { v: 0.0,  min: -6,   max: 6,    step: 0.5,  unit: 'mm' },
    'front.ballSpacer':  { v: 2.0,  min: 0,    max: 4,    step: 0.5,  unit: 'mm' },
    'front.plateSpacer': { v: 0.0,  min: 0,    max: 4,    step: 0.5,  unit: 'mm' },
    'front.lock':        { v: 28,   min: 15,   max: 38,   step: 0.5,  unit: '°' },

    'rear.rideHeight':  { v: 5.0,  min: 3.5,  max: 8.0,  step: 0.1,  unit: 'mm' },
    'rear.camber':      { v: -2.0, min: -4.0, max: 1.0,  step: 0.1,  unit: '°' },
    'rear.toe':         { v: 2.5,  min: 0.0,  max: 4.5,  step: 0.25, unit: '°' },
    'rear.droop':       { v: 2.5,  min: 0.5,  max: 7.0,  step: 0.1,  unit: 'mm' },
    'rear.linkInZ':     { v: 26.0, min: 22,   max: 38,   step: 0.5,  unit: 'mm' },
    'rear.linkInY':     { v: 20.0, min: 12,   max: 32,   step: 0.5,  unit: 'mm' },
    'rear.linkOutSpacer': { v: 1.0, min: 0,   max: 4,    step: 0.5,  unit: 'mm' },
    'rear.pivotZ':      { v: 6.5,  min: 5.0,  max: 9.0,  step: 0.25, unit: 'mm' },
    'rear.antiSquat':   { v: 2.0,  min: 0.0,  max: 5.0,  step: 0.25, unit: '°' },
    'rear.wheelSpacer': { v: 0.0,  min: -1.0, max: 2.0,  step: 0.25, unit: 'mm' },
    'rear.spring':      { v: 0.45, min: 0.25, max: 1.20, step: 0.01, unit: 'N/mm' },
    'rear.shockArm':    { v: 40,   min: 32,   max: 46,   step: 0.5,  unit: 'mm' },
    'rear.shockTowerY': { v: 36,   min: 26,   max: 46,   step: 0.5,  unit: 'mm' },
    'rear.swayBar':     { v: 1.0,  min: 0,    max: 1.8,  step: 0.1,  unit: 'mm' },
  };

  function getPath(obj, path) { const [a, b] = path.split('.'); return obj && obj[a] ? obj[a][b] : undefined; }
  function setPath(obj, path, val) { const [a, b] = path.split('.'); (obj[a] = obj[a] || {})[b] = val; }

  function stockSetup() {
    const s = { car: {}, front: {}, rear: {} };
    for (const k in PARAMS) setPath(s, k, PARAMS[k].v);
    return s;
  }
  /** Returns a complete, finite, in-range copy of any (partial) setup. */
  function sanitize(input) {
    const out = stockSetup();
    for (const k in PARAMS) {
      const p = PARAMS[k], v = getPath(input, k);
      if (p.options) { if (p.options.includes(v)) setPath(out, k, v); continue; }
      const n = typeof v === 'string' ? parseFloat(v) : v;
      if (typeof n === 'number' && isFinite(n)) setPath(out, k, clamp(n, p.min, p.max));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Corner model
  // ------------------------------------------------------------------
  function buildCorner(setup, axle, xShift) {
    const car = setup.car, A = setup[axle], H = HW[axle];
    const isF = axle === 'front';
    const Rt = car.tireDia / 2;
    const x0 = (isF ? 0 : -car.wheelbase) + (xShift || 0);

    // Inner hinge-pin axis: pitch (+ = front end higher), yaw (+ = front toward centre).
    // Front "kick-up" and rear "anti-squat" both raise the front end of the pin.
    const pitch = (isF ? A.kickup : A.antiSquat) * DEG;
    const yaw = isF ? 0 : A.toe * DEG;
    const a = norm([Math.cos(pitch) * Math.cos(yaw), -Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]);
    const e3 = norm(sub([0, 0, 1], mul(a, a[2])));
    const e2 = cross(e3, a);
    const M = fromCols(a, e2, e3);
    const Pin = [x0, H.innerY, A.pivotZ];
    const oLoc = [0, H.armLen, 0];
    const U = [x0, A.linkInY, A.linkInZ];            // camber link inner ball
    const Bloc = [H.camberBall[0], H.camberBall[1], H.camberBall[2] + A.linkOutSpacer];
    const shockTop = [x0, A.shockTowerY, H.shockTowerZ];
    const shockLoc = [0, A.shockArm, H.shockArmZ];   // arm frame, relative to inner pin
    const arbLoc = [0, H.arbArm, H.arbArmZ];
    const sLoc = [0, 1, 0];

    let kpLoc = [0, 0, 0], kLoc = [0, 0, 1], wRel, ballRel = null, plate0 = null;
    if (isF) {
      kpLoc = H.kpLow.slice();
      kLoc = norm([-Math.tan(A.caster * DEG), -Math.tan(A.kpi * DEG), 1]);
      wRel = [H.wheel[0], H.wheel[1] + A.wheelSpacer, H.wheel[2]];
      ballRel = [-A.armLength, -A.ackInset, H.ballZ + A.ballSpacer];
      plate0 = [x0 + H.plateX + A.plateDX, A.plateY, H.plateZ + A.plateSpacer];
    } else {
      wRel = [H.wheel[0], H.wheel[1] + A.wheelSpacer, H.wheel[2]];
    }

    const C = {
      axle, isF, Rt, x0, a, M, Pin, U, shockTop, Hw: H, A, car,
      Lcl: NaN, Ltr: NaN, pDir: 1, pMax: 0,
    };

    /** Plate ball position for lateral plate displacement p (left-side ball). */
    C.plateBall = function (p) {
      if (!isF) return null;
      const r = H.bellcrank, pp = clamp(p, -r * 0.95, r * 0.95);
      return [plate0[0] + (r - Math.sqrt(r * r - pp * pp)), plate0[1] + pp, plate0[2]];
    };

    /**
     * Full pose for arm angle th, hub angle psi (about pin axis) and steer
     * angle del (about kingpin). Returns world points + wheel orientation.
     */
    C.pose = function (th, psi, del) {
      const Ra = rotM(a, th);
      const O = add(Pin, mv(Ra, mv(M, oLoc)));
      const Rh = mm(rotM(a, psi), M);
      const kp = add(O, mv(Rh, kpLoc));
      const kW = mv(Rh, kLoc);
      const Rb = isF ? mm(rotM(kW, del), Rh) : Rh;
      const W = add(kp, mv(Rb, wRel));
      const s = mv(Rb, sLoc);
      const B = add(O, mv(Rh, Bloc));
      const ball = isF ? add(kp, mv(Rb, ballRel)) : null;
      const shockLow = add(Pin, mv(Ra, mv(M, shockLoc)));
      const arbPt = add(Pin, mv(Ra, mv(M, arbLoc)));
      // lowest point of the wheel's centre-plane circle = contact patch
      const dn = norm(add([0, 0, -1], mul(s, s[2])));
      const P = add(W, mul(dn, Rt));
      const fwd = norm(cross(s, [0, 0, 1]));
      return {
        th, psi, del, O, Rh, Rb, kp, kW, W, s, B, ball, P, shockLow, arbPt,
        camber: -Math.asin(clamp(s[2], -1, 1)) * RAD,
        toe: Math.atan2(s[0], s[1]) * RAD,        // + = toe-in (left wheel)
        heading: Math.atan2(fwd[1], fwd[0]) * RAD, // + = pointing left
        kpTop: isF ? add(kp, mul(kW, H.kpLen)) : null,
      };
    };

    /** Hub angle from the camber link for a given arm angle. */
    C.psiFor = function (th, ref) {
      const O = add(Pin, mv(rotM(a, th), mv(M, oLoc)));
      return solveRotDist(a, O, mv(M, Bloc), U, C.Lcl, ref === undefined ? 0 : ref);
    };
    /** Steer angle from the steering link for given arm/hub angles and plate displacement. */
    C.delFor = function (th, psi, p, ref) {
      if (!isF) return 0;
      const O = add(Pin, mv(rotM(a, th), mv(M, oLoc)));
      const Rh = mm(rotM(a, psi), M);
      const kp = add(O, mv(Rh, kpLoc));
      const kW = mv(Rh, kLoc);
      return solveRotDist(kW, kp, mv(Rh, ballRel), C.plateBall(p), C.Ltr, ref === undefined ? 0 : ref);
    };
    /** Assembled state at arm angle th and plate displacement p (null if it cannot assemble). */
    C.state = function (th, p) {
      const psi = C.psiFor(th, C.psi0 || 0);
      if (!isFinite(psi)) return null;
      const del = C.delFor(th, psi, p || 0, C.del0 || 0);
      if (!isFinite(del)) return null;
      return C.pose(th, psi, del);
    };

    // ---------- static solve: ride height, camber, toe -> link lengths ----------
    const target = { h: A.rideHeight, camber: A.camber, toe: isF ? A.toe : null };
    function innerAngles(th) {
      // alternate closed-form solves for hub angle (camber) and steer (toe)
      let psi = 0, del = 0;
      const nz = -Math.sin(target.camber * DEG);
      for (let i = 0; i < 30; i++) {
        const sv = mv(M, isF ? mv(rotM(kLoc, del), sLoc) : sLoc);
        const psiN = solveRotDot(a, sv, [0, 0, 1], nz, psi);
        if (!isFinite(psiN)) return null;
        let delN = 0;
        if (isF) {
          const Rh = mm(rotM(a, psiN), M);
          const kW = mv(Rh, kLoc);
          const tz = target.toe * DEG;
          delN = solveRotDot(kW, mv(Rh, sLoc), [Math.cos(tz), -Math.sin(tz), 0], 0, del);
          if (!isFinite(delN)) return null;
        }
        const done = Math.abs(psiN - psi) < 1e-13 && Math.abs(delN - del) < 1e-13;
        psi = psiN; del = delN;
        if (done) break;
      }
      return [psi, del];
    }
    const th0 = findRoot((th) => {
      const r = innerAngles(th);
      if (!r) return NaN;
      return C.pose(th, r[0], r[1]).P[2] + target.h;
    }, 0, 0.02, -1.2, 1.2);
    if (!isFinite(th0)) { C.ok = false; C.error = 'Ride height cannot be reached with this arm geometry.'; return C; }
    const ang0 = innerAngles(th0);
    C.th0 = th0; C.psi0 = ang0[0]; C.del0 = ang0[1];
    const S0 = C.pose(th0, C.psi0, C.del0);
    C.Lcl = len(sub(S0.B, U));
    C.Ltr = isF ? len(sub(S0.ball, C.plateBall(0))) : NaN;
    C.static = S0;
    C.ok = true;

    // a point fixed to the wheel carrier, given in its local frame (origin = wheel centre)
    const bodyPoint = (st, loc) => add(st.W, mv(st.Rb, loc));

    /** Arm angle for wheel-centre vertical travel s (mm, bump +). */
    const Wz0 = S0.W[2];
    C.thetaForTravel = function (s, p) {
      return findRoot((th) => { const st = C.state(th, p); return st ? st.W[2] - Wz0 - s : NaN; },
        th0 + s / 60, 0.01, th0 - 1.2, th0 + 1.2, 1e-10);
    };
    C.stateAtTravel = function (s, p) {
      const th = C.thetaForTravel(s, p || 0);
      return isFinite(th) ? C.state(th, p || 0) : null;
    };

    /** Derivatives with respect to wheel travel at arm angle th (plate p). */
    C.derivs = function (th, p) {
      const e = 2e-5;
      const st = C.state(th, p), a1 = C.state(th - e, p), a2 = C.state(th + e, p);
      if (!st || !a1 || !a2) return null;
      const loc = mtv(st.Rb, sub(st.P, st.W));
      const P1 = bodyPoint(a1, loc), P2 = bodyPoint(a2, loc);
      const dz = a2.W[2] - a1.W[2];
      const vP = mul(sub(P2, P1), 1 / dz);                 // hub-fixed contact point, per mm travel
      const vW = mul(sub(a2.W, a1.W), 1 / dz);
      const lS1 = len(sub(a1.shockLow, shockTop)), lS2 = len(sub(a2.shockLow, shockTop));
      return {
        st, vP, vW,
        camberGain: (a2.camber - a1.camber) / dz,       // deg/mm
        toeGain: (a2.toe - a1.toe) / dz,                // deg/mm
        mr: -(lS2 - lS1) / dz,                           // shock compression per wheel travel
        arbMr: (a2.arbPt[2] - a1.arbPt[2]) / dz,
      };
    };

    // ---------- static characteristics ----------
    const D0 = C.derivs(th0, 0);
    C.d0 = D0;
    const yP = S0.P[1], h = target.h;
    C.rcHeight = yP * D0.vP[1] / D0.vP[2];               // above ground
    C.ic = instantCentre(D0);
    C.camberGain = D0.camberGain;
    C.toeGain = D0.toeGain;
    C.scrub = D0.vP[1];                                  // track change per mm (one side)
    C.antiSlope = D0.vW[0];                              // dx_W/ds (side-view)
    C.mr = D0.mr;
    C.arbMr = D0.arbMr;
    C.shockLen = len(sub(S0.shockLow, shockTop));
    C.shockAngle = Math.atan2(Math.abs(shockTop[1] - S0.shockLow[1]), shockTop[2] - S0.shockLow[2]) * RAD;
    C.wheelX = S0.W[0];
    C.trackHalf = yP;
    C.widthHalf = S0.W[1] + car.tireWidth / 2;

    if (isF) {
      const k = S0.kW, kp = S0.kp;
      C.caster = Math.atan2(-k[0], k[2]) * RAD;
      C.kpi = Math.atan2(-k[1], k[2]) * RAD;
      const t = (-h - kp[2]) / k[2];
      const Gp = add(kp, mul(k, t));
      C.kpGround = Gp;
      C.trail = Gp[0] - S0.P[0];
      C.scrubRadius = S0.P[1] - Gp[1];
      // which plate direction turns the car left?
      const sp = C.state(th0, 1);
      C.pDir = sp && sp.heading > S0.heading ? 1 : -1;
    }
    return C;
  }

  /**
   * Front-view instant centre (y, z): intersection of the normals to the
   * velocities of the contact patch and the wheel centre. Null when the
   * normals are parallel (IC at infinity).
   */
  function instantCentre(d) {
    const st = d.st;
    const nP = [-d.vP[2], d.vP[1]], nW = [-d.vW[2], d.vW[1]];
    const det = nP[0] * (-nW[1]) - nP[1] * (-nW[0]);
    if (Math.abs(det) < 1e-12) return null;
    const ry = st.W[1] - st.P[1], rz = st.W[2] - st.P[2];
    const t = (ry * (-nW[1]) - rz * (-nW[0])) / det;
    return [st.P[1] + t * nP[0], st.P[2] + t * nP[1]];
  }
  /** Front-view kinematics of a corner at wheel travel s (left side, plate centred). */
  function frontViewAt(C, s) {
    const th = C.thetaForTravel(s, 0);
    if (!isFinite(th)) return null;
    const d = C.derivs(th, 0);
    if (!d) return null;
    return {
      st: d.st, ic: instantCentre(d),
      rc: d.st.P[1] * d.vP[1] / d.vP[2],           // roll centre above the ground
      camberGain: d.camberGain, toeGain: d.toeGain, mr: d.mr,
    };
  }

  // ------------------------------------------------------------------
  // Steering (front)
  // ------------------------------------------------------------------
  /** Left- and right-wheel steer angles (deg, + = left) for a plate displacement p. */
  function steerAt(F, p) {
    const sL = F.state(F.th0, p), sR = F.state(F.th0, -p);
    if (!sL || !sR) return null;
    return {
      left: sL.heading - F.static.heading,
      right: -(sR.heading - F.static.heading),
      sL, sR,
    };
  }
  function idealOuter(inner, L, T) {
    if (Math.abs(inner) < 1e-9) return 0;
    const ti = Math.tan(Math.abs(inner) * DEG);
    return Math.sign(inner) * Math.atan(L / (L / ti + T)) * RAD;
  }
  function solveSteering(F, model) {
    const lock = F.A.lock;
    const pmax = 0.95 * F.Hw.bellcrank;
    const f = (p) => { const r = steerAt(F, F.pDir * p); return r ? r.left - lock : NaN; };
    let p = findRoot(f, 4, 0.5, 0, pmax, 1e-9);
    F.lockReached = isFinite(p);
    if (!isFinite(p)) { // cannot reach requested lock: use the furthest assembling travel
      p = 0;
      for (let q = 0; q <= pmax; q += 0.05) if (isFinite(f(q))) p = q; else break;
    }
    F.pMax = p;
    const L = model.wheelbase, T = 2 * F.trackHalf;
    const sweep = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const pp = F.pDir * p * i / n, r = steerAt(F, pp);
      if (!r) continue;
      sweep.push({
        p: pp, inner: r.left, outer: r.right, ideal: idealOuter(r.left, L, T),
        camberIn: r.sL.camber, camberOut: r.sR.camber,
        dzIn: r.sL.P[2] - F.static.P[2], dzOut: r.sR.P[2] - F.static.P[2],
        sL: r.sL, sR: r.sR,
      });
    }
    const last = sweep[sweep.length - 1];
    const ack = (o) => {
      const dAct = o.inner - o.outer, dIdeal = o.inner - o.ideal;
      return Math.abs(dIdeal) > 1e-6 ? 100 * dAct / dIdeal : 0;
    };
    sweep.forEach((o) => { o.ackPct = ack(o); });
    const meanSteer = (last.inner + last.outer) / 2;
    return {
      sweep, full: last,
      ackermannPct: last ? last.ackPct : 0,
      turnRadius: L / Math.tan(Math.max(1e-6, meanSteer) * DEG), // rear axle centre
      turnDiameterOuter: 2 * Math.hypot(L, L / Math.tan(Math.max(1e-6, meanSteer) * DEG) + T / 2),
      lockReached: F.lockReached,
    };
  }

  // ------------------------------------------------------------------
  // Travel tables used by the whole-car solver
  // ------------------------------------------------------------------
  const TBL = { lo: -9, hi: 11, step: 0.25 };
  function buildTable(C, sprungLoad, springRate) {
    const n = Math.round((TBL.hi - TBL.lo) / TBL.step) + 1;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const s = TBL.lo + i * TBL.step;
      const th = C.thetaForTravel(s, 0);
      const d = isFinite(th) ? C.derivs(th, 0) : null;
      if (!d) { rows.push(null); continue; }
      rows.push({
        s, th, camber: d.st.camber, toe: d.st.toe, yP: d.st.P[1], xW: d.st.W[0],
        qy: d.vP[1], qx: d.vW[0], rz: d.vP[2], mr: d.mr, arbMr: d.arbMr,
        shockLen: len(sub(d.st.shockLow, C.shockTop)),
        rc: d.st.P[1] * d.vP[1] / d.vP[2],
      });
    }
    // feasible contiguous range around s = 0
    const i0 = Math.round(-TBL.lo / TBL.step);
    let iLo = i0, iHi = i0;
    while (iLo - 1 >= 0 && rows[iLo - 1]) iLo--;
    while (iHi + 1 < n && rows[iHi + 1]) iHi++;
    // spring force at the wheel: F_spring(shock length) * motion ratio
    const r0 = rows[i0];
    const Fsp0 = sprungLoad / r0.mr;  // spring force at static
    for (let i = iLo; i <= iHi; i++) {
      const r = rows[i];
      const Fsp = Math.max(0, Fsp0 + springRate * (r0.shockLen - r.shockLen));
      r.Fs = Fsp * r.mr;
    }
    const tbl = { rows, iLo, iHi, sLo: rows[iLo].s, sHi: rows[iHi].s, Fsp0, static: r0 };
    tbl.at = function (s, key) {
      const x = clamp((s - TBL.lo) / TBL.step, iLo, iHi);
      const i = Math.min(iHi - 1, Math.floor(x)), t = x - i;
      if (iHi === iLo) return rows[iLo][key];
      return lerp(rows[i][key], rows[i + 1][key], t);
    };
    tbl.slope = function (s, key) {
      const x = clamp((s - TBL.lo) / TBL.step, iLo, iHi);
      const i = Math.min(iHi - 1, Math.floor(x));
      return (rows[i + 1][key] - rows[i][key]) / TBL.step;
    };
    // spring wheel rate at static (incl. motion-ratio change)
    tbl.wheelRate = (tbl.at(0.25, 'Fs') - tbl.at(-0.25, 'Fs')) / 0.5;
    return tbl;
  }

  // ------------------------------------------------------------------
  // Model: everything derived from a setup
  // ------------------------------------------------------------------
  function buildModel(input) {
    const setup = sanitize(input || {});
    const car = setup.car;
    // Build each corner, then shift it fore/aft so the wheel centres sit exactly
    // on the axle stations (pin angles move the wheel centre slightly).
    let F = buildCorner(setup, 'front');
    if (F.ok) F = buildCorner(setup, 'front', -F.wheelX);
    let R = buildCorner(setup, 'rear');
    if (R.ok) R = buildCorner(setup, 'rear', -setup.car.wheelbase - R.wheelX);
    const model = { setup, front: F, rear: R, ok: F.ok && R.ok, warnings: [], errors: [] };
    if (!F.ok) model.errors.push('Front: ' + F.error);
    if (!R.ok) model.errors.push('Rear: ' + R.error);
    if (!model.ok) return model;

    const m = car.mass / 1000, f = car.frontPct / 100;
    const WB = F.wheelX - R.wheelX;
    model.wheelbase = WB;
    model.mass = m;
    model.a = (1 - f) * WB;            // CG to front axle
    model.b = f * WB;                  // CG to rear axle
    model.h = car.cgHeight;
    const mu = HW.unsprungPerCorner / 1000;
    model.mUnsprung = mu;
    model.mSprung = m - 4 * mu;
    model.N0 = { front: m * G * f / 2, rear: m * G * (1 - f) / 2 };
    model.widthOverall = 2 * Math.max(F.widthHalf, R.widthHalf);

    for (const [C, key] of [[F, 'front'], [R, 'rear']]) {
      const A = setup[key];
      const sprungLoad = model.N0[key] - mu * G;
      C.table = buildTable(C, sprungLoad, A.spring);
      C.wheelRate = C.table.wheelRate;
      // sway bar: torsion k = G*J/L, J = pi d^4 / 32  -> force at wheel per mm of L/R difference
      const d = A.swayBar;
      const kTheta = d > 0 ? STEEL_G * Math.PI * Math.pow(d, 4) / 32 / C.Hw.arbSpan : 0; // N*mm/rad
      C.barRate = kTheta * C.arbMr * C.arbMr / (C.Hw.arbLever * C.Hw.arbLever);         // N/mm
      C.droop = Math.min(A.droop, -C.table.sLo);
      if (C.droop < A.droop - 1e-9) model.warnings.push(`${key === 'front' ? 'Front' : 'Rear'}: droop limited to ${C.droop.toFixed(1)} mm by the linkage.`);
      const kt = car.tireRate;
      const kw = C.wheelRate;
      C.rideRate = 1 / (1 / kw + 1 / kt);
      const mc = (model.N0[key] / G) - mu; // sprung mass per corner, kg
      C.rideFreq = Math.sqrt(C.rideRate * 1000 / mc) / (2 * Math.PI);
      const t = 2 * C.trackHalf;
      // roll stiffness (N*mm/rad): springs + bar, in series with tyres
      const kSusp = (kw + 2 * C.barRate) * t * t / 2;
      const kTyre = kt * t * t / 2;
      C.rollStiffness = 1 / (1 / kSusp + 1 / kTyre);
    }
    model.rollStiffFrontPct = 100 * F.rollStiffness / (F.rollStiffness + R.rollStiffness);
    model.rollAxisAtCg = R.rcHeight + (F.rcHeight - R.rcHeight) * model.b / WB;

    // steering
    model.steer = solveSteering(F, model);

    // drive / brake shares
    model.driveFront = f;
    model.brakeFront = car.frontDiff === 'oneway' ? 0 : f;
    // anti-geometry (% of the load transfer carried by the links)
    const asGeom = (q) => -q * WB / model.h * 100;
    model.antiSquat = asGeom(R.antiSlope) * (1 - model.driveFront);
    model.antiLiftFront = -asGeom(F.antiSlope) * model.driveFront;
    model.antiDive = -asGeom(F.antiSlope) * model.brakeFront;
    model.antiLiftRear = asGeom(R.antiSlope) * (1 - model.brakeFront);
    model.antiSquatRwd = asGeom(R.antiSlope);

    if (model.widthOverall > 190.05) model.warnings.push(`Overall width ${model.widthOverall.toFixed(1)} mm is over the 190 mm limit.`);
    if (!model.steer.lockReached) model.warnings.push('Requested steering lock cannot be reached; the linkage runs out first.');
    model.solveState = null;
    return model;
  }

  // ------------------------------------------------------------------
  // Whole-car quasi-static equilibrium
  // ------------------------------------------------------------------
  /**
   * cond: { ay (g, + = left turn), ax (g, + = accelerating), e: [FL,FR,RL,RR]
   * ground offsets (mm, + pushes that wheel up relative to the chassis) }.
   * Unknown chassis pose: heave, roll, pitch. Each corner: tyre spring in
   * series with the suspension (spring through motion ratio, sway bar, droop
   * stop), plus link jacking from lateral and drive/brake forces.
   */
  function solveVehicle(model, cond) {
    if (!model.ok) return null;
    const c = Object.assign({ ay: 0, ax: 0, e: [0, 0, 0, 0] }, cond || {});
    const car = model.setup.car;
    const F = model.front, R = model.rear;
    const m = model.mass, kt = car.tireRate, mug = model.mUnsprung * G;
    const ayN = c.ay * G, axN = c.ax * G; // m/s^2
    const share = c.ax >= 0 ? model.driveFront : model.brakeFront;
    const axles = [
      { C: F, N0: model.N0.front, x: model.a, fy: m * ayN * (model.b / model.wheelbase), fx: share * m * axN / 2, e: [c.e[0], c.e[1]] },
      { C: R, N0: model.N0.rear, x: -model.b, fy: m * ayN * (model.a / model.wheelbase), fx: (1 - share) * m * axN / 2, e: [c.e[2], c.e[3]] },
    ];
    const hRA = model.rollAxisAtCg;

    function corner(T, N0, cc, sOther, Kb, fy, fx, D) {
      const g = (s) => T.at(s, 'Fs') + Kb * (s - sOther) + mug - (fy * T.at(s, 'qy') + fx * T.at(s, 'qx')) - (N0 + kt * (cc - s));
      const lo = -D, hi = T.sHi;
      if (g(lo) >= 0) return { s: lo, N: Math.max(0, N0 + kt * (cc - lo)), stop: true };
      if (g(hi) <= 0) return { s: hi, N: Math.max(0, N0 + kt * (cc - hi)), bottom: true };
      let a = lo, b = hi, fa = g(a), fb = g(b), side = 0, s = 0;
      for (let i = 0; i < 100; i++) {
        s = (a * fb - b * fa) / (fb - fa);
        const fs = g(s);
        if (Math.abs(fs) < 1e-10 || b - a < 1e-12) break;
        if (Math.sign(fs) === Math.sign(fb)) { b = s; fb = fs; if (side === -1) fa /= 2; side = -1; }
        else { a = s; fa = fs; if (side === 1) fb /= 2; side = 1; }
      }
      return { s, N: Math.max(0, N0 + kt * (cc - s)) };
    }

    function evalPose(X, keep) {
      const dh = X[0], phi = X[1] / 1000, th = X[2] / 1000;
      const out = [];
      let sumN = 0, sumNy = 0, sumNx = 0;
      for (let ai = 0; ai < 2; ai++) {
        const ax = axles[ai], C = ax.C, T = C.table, D = C.droop, Kb = C.barRate;
        const yL = C.trackHalf;
        const ccL = -(dh + phi * yL + th * ax.x) + ax.e[0];
        const ccR = -(dh - phi * yL + th * ax.x) + ax.e[1];
        let L = { s: 0, N: ax.N0 }, Rr = { s: 0, N: ax.N0 };
        for (let it = 0; it < 60; it++) {
          const sum = L.N + Rr.N;
          const fyL = sum > 1e-9 ? ax.fy * L.N / sum : ax.fy / 2, fyR = ax.fy - fyL;
          const L2 = corner(T, ax.N0, ccL, Rr.s, Kb, fyL, ax.fx, D);
          // right corner is solved in its mirrored frame: lateral force flips sign
          const R2 = corner(T, ax.N0, ccR, L2.s, Kb, -fyR, ax.fx, D);
          const dd = Math.abs(L2.s - L.s) + Math.abs(R2.s - Rr.s) + Math.abs(L2.N - L.N) + Math.abs(R2.N - Rr.N);
          L = L2; Rr = R2;
          if (dd < 1e-11) break;
        }
        const yPL = T.at(L.s, 'yP'), yPR = -T.at(Rr.s, 'yP');
        sumN += L.N + Rr.N;
        sumNy += L.N * yPL + Rr.N * yPR;
        sumNx += (L.N + Rr.N) * ax.x;
        out.push(L, Rr);
      }
      const hcg = model.h + dh * model.mSprung / m;
      const r1 = sumN - m * G;
      const r2 = (sumNy + model.mSprung * G * (hcg - hRA) * phi + m * ayN * hcg) / 100;
      const r3 = (sumNx + model.mSprung * G * (hcg - model.setup.front.rideHeight) * th + m * axN * hcg) / 100;
      return keep ? { r: [r1, r2, r3], corners: out } : [r1, r2, r3];
    }

    const nrm = (r) => Math.hypot(r[0], r[1], r[2]);
    let X = model.solveState && model.solveState.length === 3 ? model.solveState.slice() : [0, 0, 0];
    let r = evalPose(X);
    if (!r.every(isFinite)) { X = [0, 0, 0]; r = evalPose(X); }
    let converged = false;
    for (let it = 0; it < 80; it++) {
      if (nrm(r) < 1e-7) { converged = true; break; }
      // numerical Jacobian
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let j = 0; j < 3; j++) {
        const hstep = 1e-5;
        const Xp = X.slice(); Xp[j] += hstep;
        const rp = evalPose(Xp);
        for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r[i]) / hstep;
      }
      const dx = solve3(J, r.map((v) => -v));
      if (!dx) break;
      // cap the step and backtrack
      const cap = 3;
      const sc = Math.min(1, cap / Math.max(Math.abs(dx[0]), Math.abs(dx[1]) / 10, Math.abs(dx[2]) / 10, 1e-12));
      let t = sc, improved = false;
      for (let ls = 0; ls < 30; ls++) {
        const Xn = [X[0] + t * dx[0], X[1] + t * dx[1], X[2] + t * dx[2]];
        const rn = evalPose(Xn);
        if (rn.every(isFinite) && nrm(rn) < nrm(r)) { X = Xn; r = rn; improved = true; break; }
        t /= 2;
      }
      if (!improved) break;
    }
    if (nrm(r) < 1e-4) converged = true;
    const res = evalPose(X, true);
    model.solveState = converged ? X.slice() : null;

    const names = ['FL', 'FR', 'RL', 'RR'];
    const phiDeg = X[1] / 1000 * RAD, thDeg = X[2] / 1000 * RAD;
    const corners = res.corners.map((cr, i) => {
      const C = i < 2 ? F : R, T = C.table, left = i % 2 === 0;
      const camberChassis = T.at(cr.s, 'camber');
      return {
        name: names[i], N: cr.N, grams: cr.N / G * 1000, travel: cr.s,
        onStop: !!cr.stop && cr.N > 1e-9, lifted: cr.N <= 1e-9, bottomed: !!cr.bottom,
        camberChassis,
        camberGround: camberChassis + (left ? -phiDeg : phiDeg),
        toe: T.at(cr.s, 'toe'),
      };
    });
    // chassis plate corners: lowest point above ground
    const ch = HW.chassis, dh = X[0], phi = X[1] / 1000, th = X[2] / 1000;
    const hF = model.setup.front.rideHeight, hR = model.setup.rear.rideHeight;
    const plateH = (xc, yc) => {
      const xa = xc; // relative to CG
      const base = lerp(hR, hF, (xa + model.b) / model.wheelbase); // static height under that point
      return base + dh + phi * yc + th * xa;
    };
    const pts = [[model.a + ch.front, ch.halfWidth], [model.a + ch.front, -ch.halfWidth], [-model.b - ch.rear, ch.halfWidth], [-model.b - ch.rear, -ch.halfWidth]];
    const minPlate = Math.min(...pts.map((p) => plateH(p[0], p[1])));
    const minPlateStatic = Math.min(...pts.map((p) => lerp(hR, hF, (p[0] + model.b) / model.wheelbase)));
    const dF = (corners[1].N - corners[0].N) / 2, dR = (corners[3].N - corners[2].N) / 2;
    return {
      converged, residual: nrm(r),
      heave: dh, roll: phiDeg, pitch: thDeg,
      corners,
      lltdFront: Math.abs(dF + dR) > 1e-9 ? 100 * dF / (dF + dR) : NaN,
      minPlateHeight: minPlate,
      minPlateStatic,
      scrape: minPlate < 0,
      frontHeightChange: dh + th * model.a,
      rearHeightChange: dh - th * model.b,
    };
  }

  function solve3(A, b) {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  /** Lateral g at which the inside wheel of each axle unloads completely. */
  function liftOffG(model, maxG, stepG) {
    maxG = maxG || 3; stepG = stepG || 0.1;
    const saved = model.solveState;
    const out = { front: Infinity, rear: Infinity, scrapeG: Infinity };
    // march up in g (continuation keeps the solver on the physical branch)
    model.solveState = null;
    let prevG = 0, prevState = null;
    const inside = (r, idx) => r.corners[idx].N <= 1e-6;
    for (let g = stepG; g <= maxG + 1e-9; g += stepG) {
      const r = solveVehicle(model, { ay: g });
      if (!r || !r.converged) break;
      if (r.scrape && out.scrapeG === Infinity) out.scrapeG = g;
      for (const [key, idx] of [['front', 0], ['rear', 2]]) {
        if (out[key] !== Infinity || !inside(r, idx)) continue;
        // refine between prevG and g
        let lo = prevG, hi = g;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          model.solveState = prevState ? prevState.slice() : null;
          const rm = solveVehicle(model, { ay: mid });
          if (rm && inside(rm, idx)) hi = mid; else lo = mid;
        }
        out[key] = hi;
      }
      model.solveState = r.converged ? model.solveState : null;
      prevG = g; prevState = model.solveState ? model.solveState.slice() : null;
      if (out.front !== Infinity && out.rear !== Infinity) break;
    }
    model.solveState = saved;
    return out;
  }

  /** Effect of steering at full lock on wheel loads (caster/KPI jacking). */
  function steeringJacking(model) {
    const full = model.steer.full;
    if (!full) return null;
    const e = [-full.dzIn, -full.dzOut, 0, 0];
    const saved = model.solveState;
    model.solveState = null;
    const r = solveVehicle(model, { e });
    model.solveState = saved;
    if (!r) return null;
    const N0f = model.N0.front, N0r = model.N0.rear;
    const d = r.corners.map((c, i) => c.N - (i < 2 ? N0f : N0r));
    return {
      dzIn: full.dzIn, dzOut: full.dzOut, result: r,
      deltaGrams: d.map((v) => v / G * 1000),
      // load added to the inside-front + outside-rear diagonal (left turn: FL + RR)
      diagonalGrams: (d[0] + d[3]) / G * 1000,
    };
  }

  /** Sweep a corner through its travel for charts (left side, plate centred). */
  function travelSweep(C, sLo, sHi, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const s = lerp(sLo, sHi, i / n);
      const st = C.stateAtTravel(s, 0);
      if (!st) continue;
      out.push({ s, camber: st.camber, toe: st.toe, yP: st.P[1], st });
    }
    return out;
  }

  // Unit helpers for display
  const units = {
    nmmToLbin: (k) => k / 0.17512684,
    nmmToGfmm: (k) => k * 1000 / G,
    newtonToGrams: (n) => n / G * 1000,
  };

  return {
    DEG, RAD, G, HW, PARAMS, TBL,
    stockSetup, sanitize, getPath, setPath,
    buildModel, buildCorner, solveVehicle, liftOffG, steeringJacking, steerAt, travelSweep, idealOuter, frontViewAt,
    units,
    _internal: { solveTrig, solveRotDist, solveRotDot, findRoot, rotM, mv, mm, norm, cross, dot, sub, add, mul, len },
  };
});
