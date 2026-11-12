/*
 * TC Setup Lab: drawings and charts
 * Every diagram is drawn at true scale (mm) from the solver output. The
 * only exception is chassis motion in the side and roll views, which can be
 * exaggerated; the caption always states the factor used.
 */
(function (root) {
  'use strict';
  const P = root.TCPhysics;
  const DEG = Math.PI / 180;

  const n = (v) => (Math.round(v * 100) / 100).toString();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const L = (x1, y1, x2, y2, cls) => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="${cls}"/>`;
  const C = (x, y, r, cls) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" class="${cls}"/>`;
  const PG = (pts, cls) => `<polygon points="${pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" class="${cls}"/>`;
  const PL = (pts, cls) => `<polyline points="${pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" class="${cls}"/>`;
  const PATH = (d, cls) => `<path d="${d}" class="${cls}"/>`;
  // text with a halo in the panel colour so it stays legible over line work
  const T = (x, y, s, size, cls, anchor) =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" class="${cls || ''}" text-anchor="${anchor || 'start'}" style="stroke-width:${n(size * 0.3)}px">${esc(s)}</text>`;
  const svg = (vb, inner, label) =>
    `<svg class="dg" viewBox="${vb.map(n).join(' ')}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  const fmtS = (v, d) => { const dd = d === undefined ? 1 : d; const r = Math.abs(v).toFixed(dd); return (Number(r) === 0 ? '' : v < 0 ? '−' : '+') + r; };
  const fmt = (v, d) => { const dd = d === undefined ? 1 : d; const r = Math.abs(v).toFixed(dd); return (v < 0 && Number(r) !== 0 ? '−' : '') + r; };
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
  const rot2 = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

  function grid(vb, step) {
    let s = '';
    const [x0, y0, w, h] = vb;
    for (let x = Math.ceil(x0 / step) * step; x <= x0 + w; x += step) s += L(x, y0, x, y0 + h, 'gridline');
    for (let y = Math.ceil(y0 / step) * step; y <= y0 + h; y += step) s += L(x0, y, x0 + w, y, 'gridline');
    return s;
  }
  function ground(x0, x1, y, k) {
    let s = L(x0, y, x1, y, 'ground');
    const d = 5 * k;
    for (let x = x0 + 2; x < x1 + d; x += 7 * k) s += L(x, y + 0.6 * k, x - d, y + d + 0.6 * k, 'hatch');
    return s;
  }
  /** Tyre and rim seen from front/behind. W, s are 3D (y,z used); P2 maps [y,z] to the screen. */
  function wheelFront(W, s, R, w, P2) {
    const l = Math.hypot(s[1], s[2]);
    const a = [s[1] / l, s[2] / l], u = [-a[1], a[0]];
    const up = u[1] >= 0 ? u : [-u[0], -u[1]];
    const corner = (ka, ku, rr, ww) => P2([W[1] + a[0] * ww * ka + up[0] * rr * ku, W[2] + a[1] * ww * ka + up[1] * rr * ku]);
    const rect = (rr, ww) => [corner(-0.5, -1, rr, ww), corner(0.5, -1, rr, ww), corner(0.5, 1, rr, ww), corner(-0.5, 1, rr, ww)];
    return PG(rect(R, w), 'tyre') + PG(rect(R * 0.66, w - 3), 'rim');
  }
  const contactMark = (X, Y, k) => PG([[X, Y], [X - 3 * k, Y + 5 * k], [X + 3 * k, Y + 5 * k]], 'fill-accent');
  function zigzag(p1, p2, coils, amp) {
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], l = Math.hypot(dx, dy);
    const nx = -dy / l, ny = dx / l;
    const pts = [p1];
    const N = coils * 2;
    for (let i = 1; i < N; i++) {
      const t = i / N, sgn = i % 2 ? 1 : -1;
      pts.push([p1[0] + dx * t + nx * amp * sgn, p1[1] + dy * t + ny * amp * sgn]);
    }
    pts.push(p2);
    return pts;
  }
  function shock(lo, hi, k, emph) {
    const dx = hi[0] - lo[0], dy = hi[1] - lo[1], l = Math.hypot(dx, dy);
    const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const bodyLen = l * 0.55, half = 3.6;
    const b0 = [hi[0] - ux * bodyLen, hi[1] - uy * bodyLen];
    const body = [[hi[0] + nx * half, hi[1] + ny * half], [hi[0] - nx * half, hi[1] - ny * half],
      [b0[0] - nx * half, b0[1] - ny * half], [b0[0] + nx * half, b0[1] + ny * half]];
    let s = L(lo[0], lo[1], b0[0], b0[1], emph ? 'ink' : 'ink-thin');
    s += PG(body, 'shock-body');
    const sp0 = [lo[0] + ux * 4, lo[1] + uy * 4], sp1 = [hi[0] - ux * 6, hi[1] - uy * 6];
    s += PL(zigzag(sp0, sp1, 9, 5), 'spring');
    s += C(lo[0], lo[1], 2 * k, 'pivot') + C(hi[0], hi[1], 2 * k, 'pivot');
    return s;
  }
  /** Clip a segment to a rectangle (Liang-Barsky). */
  function clip(p0, p1, vb) {
    const [x0, y0, w, h] = vb, x1 = x0 + w, y1 = y0 + h;
    let t0 = 0, t1 = 1;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    for (const [p, q] of [[-dx, p0[0] - x0], [dx, x1 - p0[0]], [-dy, p0[1] - y0], [dy, y1 - p0[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[p0[0] + t0 * dx, p0[1] + t0 * dy], [p0[0] + t1 * dx, p0[1] + t1 * dy]];
  }
  const segClipped = (p0, p1, vb, cls) => { const c = clip(p0, p1, vb); return c ? L(c[0][0], c[0][1], c[1][0], c[1][1], cls) : ''; };
  const inside = (p, vb) => p[0] > vb[0] && p[0] < vb[0] + vb[2] && p[1] > vb[1] && p[1] < vb[1] + vb[3];

  // ------------------------------------------------------------------
  // Axle seen from behind: arms, links, hubs, wheels, IC / RC construction
  // ------------------------------------------------------------------
  function axleView(model, axle, o) {
    o = Object.assign({ s: 0, px: 360, ic: true, shock: false, rod: false, emphShock: false, labels: true }, o);
    const Cn = model[axle], R = Cn.Rt, tw = model.setup.car.tireWidth;
    const fv = P.frontViewAt(Cn, o.s) || P.frontViewAt(Cn, 0);
    const st = fv.st;
    const gz = st.P[2];
    const vb = [-114, -74, 228, 100];
    const k = vb[2] / o.px;
    const P2 = (q) => [-q[0], -q[1]];           // view from behind: car's left on screen left
    const yz = (p) => [p[1], p[2]];
    const mir = (p) => [p[0], -p[1], p[2]];
    let s = grid(vb, 10);
    s += ground(vb[0], vb[0] + vb[2], -gz, k);
    s += L(0, -gz, 0, -70, 'faint dash');
    const ty = Cn.shockTop[1] + 8;
    s += PG([P2([-40, 2.25]), P2([-ty, 64]), P2([ty, 64]), P2([40, 2.25])], 'tower');
    const ch = P.HW.chassis;
    s += PG([P2([-ch.halfWidth, 0]), P2([ch.halfWidth, 0]), P2([ch.halfWidth, ch.thick]), P2([-ch.halfWidth, ch.thick])], 'chassis');

    let wheels = '', construction = '', parts = '', labels = '';
    for (const side of [1, -1]) {
      const m = side === 1 ? (p) => p : mir;
      const q = (p) => P2(yz(m(p)));
      const Pin = q(Cn.Pin), O = q(st.O), U = q(Cn.U), B = q(st.B), W = q(st.W), Pc = q(st.P);
      wheels += wheelFront(m(st.W), m(st.s), R, tw, P2);
      if (o.ic) {
        const rcY = -(gz + fv.rc);
        const ic = fv.ic ? q([0, fv.ic[0], fv.ic[1]]) : null;
        if (ic && Math.abs(fv.ic[0]) < 6000) {
          construction += segClipped(Pin, ic, vb, 'faint dash');
          construction += segClipped(U, ic, vb, 'faint dash');
          construction += segClipped(Pc, ic, vb, 'accent-thin dash');
          if (inside(ic, vb)) construction += C(ic[0], ic[1], 2.6 * k, 'fill-bg') + T(ic[0], ic[1] - 5 * k, 'IC', 10 * k, 't-muted', 'middle');
        }
        construction += L(Pc[0], Pc[1], 0, rcY, 'accent');
      }
      if (o.shock || o.emphShock) parts += shock(q(st.shockLow), q(Cn.shockTop), k, o.emphShock);
      parts += L(Pin[0], Pin[1], O[0], O[1], 'arm');
      parts += L(U[0], U[1], B[0], B[1], 'link');
      const Wi = q(add3(st.W, mul3(st.s, -9)));
      if (Cn.isF) {
        const kp = q(st.kp), kt = q(st.kpTop);
        parts += PG([O, kp, kt, B], 'hub');
        parts += L(kp[0], kp[1], kt[0], kt[1], 'ink');
        parts += L(Wi[0], Wi[1], W[0], W[1], 'ink');
        if (o.rod) {
          const pb = q(Cn.plateBall(0)), ball = q(st.ball);
          parts += L(pb[0], pb[1], ball[0], ball[1], 'rod') + C(pb[0], pb[1], 2.1 * k, 'pivot') + C(ball[0], ball[1], 2.1 * k, 'pivot');
        }
      } else {
        parts += PG([O, B, Wi], 'hub');
        parts += L(Wi[0], Wi[1], W[0], W[1], 'ink');
      }
      parts += C(Pin[0], Pin[1], 2.3 * k, 'pivot-arm') + C(O[0], O[1], 2.3 * k, 'pivot-arm');
      parts += C(U[0], U[1], 2.1 * k, 'pivot') + C(B[0], B[1], 2.1 * k, 'pivot');
      parts += contactMark(Pc[0], Pc[1], k);
      labels += T(W[0], -(st.W[2] + R) - 5 * k, fmtS(st.camber) + '°', 12 * k, 't-accent', 'middle');
      if (side === 1 && o.labels) {
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const mU = mid(U, B), mA = mid(Pin, O);
        if (!o.emphShock) {
          labels += T(mU[0], mU[1] - 4 * k, 'camber link', 9.5 * k, 't-arm', 'middle');
          labels += T(mA[0], mA[1] + 10 * k, 'lower arm', 9.5 * k, 't-arm', 'middle');
        }
        if (o.rod) { const pb = q(Cn.plateBall(0)), ball = q(st.ball); const mr = mid(pb, ball); labels += T(mr[0], mr[1] + 10 * k, 'steering link', 9.5 * k, 't-arm', 'middle'); }
        if (o.emphShock) { const lo = q(st.shockLow), hi = q(Cn.shockTop); labels += T((lo[0] + hi[0]) / 2 + 9 * k, (lo[1] + hi[1]) / 2 + 3 * k, 'shock', 10 * k, 't-blue'); }
      }
    }
    if (o.ic) {
      const rcY = -(gz + fv.rc);
      labels += C(0, rcY, 3.2 * k, 'fill-bg') + L(-5 * k, rcY, 5 * k, rcY, 'accent-thin') + L(0, rcY - 5 * k, 0, rcY + 5 * k, 'accent-thin');
      labels += T(0, -gz + 14 * k, 'RC ' + fmt(fv.rc) + ' mm', 11 * k, 't-accent', 'middle');
    }
    return { svg: svg(vb, s + wheels + construction + parts + labels, `${axle} axle seen from behind`), fv };
  }

  // ------------------------------------------------------------------
  // Side view: whole car, anti-squat / anti-dive lines, pitch
  // ------------------------------------------------------------------
  function bodyOutline(WB) {
    // generic 190 mm touring-car shell, x relative to the front axle (mm), z above ground
    const u = (f) => f * WB;
    return {
      top: [[u(0.335), 14], [u(0.348), 24], [u(0.343), 36], [u(0.31), 47], [u(0.16), 56], [u(0.02), 62],
        [u(-0.2), 101], [u(-0.3), 109], [u(-0.5), 111], [u(-0.6), 104], [u(-0.8), 81], [u(-1.0), 77],
        [u(-1.19), 75], [u(-1.225), 69], [u(-1.245), 32], [u(-1.235), 14]],
      window: [[u(-0.19), 96], [u(-0.3), 104], [u(-0.49), 106], [u(-0.58), 100], [u(-0.74), 81], [u(-0.1), 70]],
      wing: [[u(-1.08), 95], [u(-1.255), 100]],
      stands: [[[u(-1.12), 76], [u(-1.12), 96]], [[u(-1.2), 75], [u(-1.2), 98]]],
    };
  }
  function cgSymbol(x, y, r) {
    return C(x, y, r, 'fill-bg') +
      PATH(`M${n(x)} ${n(y)} L${n(x + r)} ${n(y)} A${n(r)} ${n(r)} 0 0 0 ${n(x)} ${n(y - r)} Z`, 'fill-ink') +
      PATH(`M${n(x)} ${n(y)} L${n(x - r)} ${n(y)} A${n(r)} ${n(r)} 0 0 0 ${n(x)} ${n(y + r)} Z`, 'fill-ink');
  }
  function wheelSide(x, z, R, k) {
    let s = C(x, -z, R, 'tyre') + C(x, -z, R * 0.66, 'rim');
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + 0.3;
      s += L(x + Math.cos(a) * R * 0.14, -z + Math.sin(a) * R * 0.14, x + Math.cos(a) * R * 0.6, -z + Math.sin(a) * R * 0.6, 'ink-thin');
    }
    return s + C(x, -z, 1.6 * k, 'fill-ink');
  }
  function sideView(model, res, o) {
    o = Object.assign({ px: 360, E: 1, anti: true }, o);
    const E = o.E, WB = model.wheelbase, R = model.front.Rt, h = model.h;
    const hF = model.setup.front.rideHeight, hR = model.setup.rear.rideHeight;
    const vb = [-WB - 118, -134, WB + 226, 166];
    const k = vb[2] / o.px;
    const th = (res ? res.pitch : 0) * DEG, dh = res ? res.heave : 0;
    const disp = (x) => E * (dh + th * (x + model.a));
    const Y = (x, z) => -(z + disp(x));
    let s = grid(vb, 20);
    s += ground(vb[0], vb[0] + vb[2], 0, k);
    const b = bodyOutline(WB);
    const pts = b.top.map(([x, z]) => [x, Y(x, z)]);
    const archR = R + 6, skirt = 14;
    const lower = (x) => [x, Y(x, skirt)];
    const rearBottom = pts[pts.length - 1];
    let d = `M${n(rearBottom[0])} ${n(rearBottom[1])}`;
    for (const p of pts.slice().reverse()) d += ` L${n(p[0])} ${n(p[1])}`;
    const arch = (x0, x1) => { const a = lower(x0), c = lower(x1); return ` L${n(a[0])} ${n(a[1])} A${n(archR)} ${n(archR)} 0 0 0 ${n(c[0])} ${n(c[1])}`; };
    d += arch(archR, -archR) + arch(-WB + archR, -WB - archR) + ` L${n(rearBottom[0])} ${n(rearBottom[1])}`;
    s += PATH(d, 'body');
    s += PL(b.window.concat([b.window[0]]).map(([x, z]) => [x, Y(x, z)]), 'ink-thin');
    s += L(b.wing[0][0], Y(...b.wing[0]), b.wing[1][0], Y(...b.wing[1]), 'ink');
    for (const st of b.stands) s += L(st[0][0], Y(...st[0]), st[1][0], Y(...st[1]), 'ink-thin');
    const ch = P.HW.chassis;
    const zc = (x) => hR + (hF - hR) * (x + WB) / WB;
    const xa = ch.front, xb = -WB - ch.rear;
    s += PG([[xa, Y(xa, zc(xa))], [xb, Y(xb, zc(xb))], [xb, Y(xb, zc(xb) + ch.thick)], [xa, Y(xa, zc(xa) + ch.thick)]], 'chassis');
    s += wheelSide(0, R, R, k) + wheelSide(-WB, R, R, k);
    const xcg = -model.a;
    let lab = '';
    s += cgSymbol(xcg, Y(xcg, h), 5.5 * k);
    lab += T(xcg, Y(xcg, h) - 9 * k, 'CG', 11 * k, 't-head', 'middle');

    if (o.anti) {
      const qr = model.rear.antiSlope, shareR = 1 - (o.braking ? model.brakeFront : model.driveFront);
      const zEnd = R - qr * WB;
      s += L(0, -R - 4 * k, 0, -128, 'faint dash');
      s += L(-WB, -R, 0, -R, 'faint dot');
      if (shareR > 0.01) {
        const z100 = R + h / shareR;
        s += C(0, -z100, 3 * k, 'fill-bg');
        lab += T(-5 * k, -z100 - 4 * k, '100 %', 11 * k, 't-muted', 'end');
      }
      s += L(-WB, -R, 0, -zEnd, 'accent') + C(-WB, -R, 2.6 * k, 'fill-accent') + C(0, -zEnd, 3 * k, 'fill-accent');
      const pct = o.braking ? model.antiLiftRear : model.antiSquat;
      lab += T(5 * k, -zEnd - 4 * k, fmt(pct, 0) + ' %', 13 * k, 't-accent');
      const qf = model.front.antiSlope;
      const pf = o.braking ? model.antiDive : model.antiLiftFront;
      if (Math.abs(pf) >= 0.5) {
        const zr = R + qf * WB;
        s += L(0, -R, -WB, -zr, 'blue dash');
        lab += T(-WB * 0.5, -(R + qf * WB * 0.5) - 6 * k, (o.braking ? 'front anti-dive ' : 'front anti-lift ') + fmt(pf, 0) + ' %', 10.5 * k, 't-blue', 'middle');
      }
    }
    const dy = 17;
    s += L(-WB, dy, 0, dy, 'faint') + L(-WB, dy - 3 * k, -WB, dy + 3 * k, 'faint') + L(0, dy - 3 * k, 0, dy + 3 * k, 'faint');
    lab += T(-WB / 2, dy + 12 * k, `wheelbase ${WB.toFixed(1)} mm`, 11 * k, 't-muted', 'middle');
    lab += T(vb[0] + vb[2] - 6 * k, vb[1] + 14 * k, 'Front →', 12 * k, 't-head', 'end');
    if (res && Math.abs(o.ax || 0) > 0.01) {
      const dir = o.ax > 0 ? -1 : 1, y0 = Y(xcg, h), L1 = 34;
      const x0 = xcg + dir * 9 * k;
      s += L(x0, y0, x0 + dir * L1, y0, 'warn');
      s += PG([[x0 + dir * (L1 + 6 * k), y0], [x0 + dir * L1, y0 - 3.5 * k], [x0 + dir * L1, y0 + 3.5 * k]], 'fill-warn');
    }
    return svg(vb, s + lab, 'Side view of the car');
  }

  // ------------------------------------------------------------------
  // Caster: side view of the left front wheel
  // ------------------------------------------------------------------
  function casterView(model, o) {
    const F = model.front, st = F.static, h = model.setup.front.rideHeight, R = F.Rt;
    const vb = [-54, -82, 108, 98];
    const k = vb[2] / o.px;
    const X = (p) => p[0], Y = (p) => -(p[2] + h);
    let s = grid(vb, 10) + ground(vb[0], vb[0] + vb[2], 0, k);
    s += C(X(st.W), Y(st.W), R, 'tyre') + C(X(st.W), Y(st.W), R * 0.66, 'rim') + C(X(st.W), Y(st.W), 1.6 * k, 'fill-ink');
    const a = F.a, O = st.O;
    const p1 = [O[0] - a[0] * 13, -(O[2] - a[2] * 13 + h)], p2 = [O[0] + a[0] * 13, -(O[2] + a[2] * 13 + h)];
    s += L(p1[0], p1[1], p2[0], p2[1], 'arm');
    const kp = st.kp, kt = st.kpTop;
    s += PG([[O[0] - 4, Y(O) + 2], [O[0] + 4, Y(O) + 2], [X(kt) + 4, Y(kt) - 1], [X(kt) - 4, Y(kt) - 1]], 'hub');
    const k3 = st.kW, tG = (-h - kp[2]) / k3[2], G = [kp[0] + k3[0] * tG, 0];
    const tT = (74 - h - kp[2]) / k3[2], Tp = [kp[0] + k3[0] * tT, -74];
    s += L(G[0], 0, Tp[0], Tp[1], 'accent');
    s += L(G[0], 0, G[0], -74, 'faint dash');
    s += C(X(kp), Y(kp), 2.3 * k, 'pivot') + C(X(kt), Y(kt), 2.3 * k, 'pivot');
    const rA = 56, ang = Math.atan2(-k3[0], k3[2]);
    const ax = G[0] - Math.sin(ang) * rA, ay = -Math.cos(ang) * rA;
    s += PATH(`M${n(G[0])} ${n(-rA)} A${n(rA)} ${n(rA)} 0 0 ${ang > 0 ? 0 : 1} ${n(ax)} ${n(ay)}`, 'accent-thin');
    let lab = T(G[0] + 4 * k, -rA - 3 * k, 'caster ' + fmt(F.caster) + '°', 12 * k, 't-accent');
    lab += T(Tp[0] - 3 * k, Tp[1] + 9 * k, 'steering axis', 9.5 * k, 't-accent', 'end');
    const Pc = [st.P[0], 0];
    s += contactMark(Pc[0], Pc[1], k) + C(G[0], 0, 2.4 * k, 'fill-bg');
    const ty = 9;
    s += L(Pc[0], ty, G[0], ty, 'accent-thin') + L(Pc[0], ty - 2 * k, Pc[0], ty + 2 * k, 'accent-thin') + L(G[0], ty - 2 * k, G[0], ty + 2 * k, 'accent-thin');
    lab += T(G[0] + 6 * k, ty + 4 * k, 'trail ' + fmt(F.trail, 2) + ' mm', 11 * k, 't-accent');
    lab += T(p2[0] + 3 * k, p2[1] - 4 * k, 'hinge pin ' + fmtS(model.setup.front.kickup, 2) + '°', 9.5 * k, 't-arm');
    lab += T(vb[0] + vb[2] - 3, vb[1] + 11 * k, 'Front →', 11 * k, 't-head', 'end');
    return svg(vb, s + lab, 'Front wheel side view with the steering axis');
  }

  // ------------------------------------------------------------------
  // Top views
  // ------------------------------------------------------------------
  function tyreTop(cx, cy, hx, hy, R, w) {
    const nx = -hy, ny = hx;
    const p = (a, b) => [cx + hx * R * a + nx * w / 2 * b, cy + hy * R * a + ny * w / 2 * b];
    return PG([p(1, 1), p(1, -1), p(-1, -1), p(-1, 1)], 'tyre') + L(cx, cy, cx + hx * R * 0.9, cy + hy * R * 0.9, 'ink-thin');
  }
  /** Steering state for an input 0..1 (fraction of full left lock). */
  function steerState(model, input) {
    const F = model.front;
    const p = F.pDir * F.pMax * input;
    return { p, r: P.steerAt(F, p), F };
  }
  function ackermannOverview(model, input, o) {
    const F = model.front, WB = model.wheelbase, R = F.Rt, w = model.setup.car.tireWidth;
    const { r } = steerState(model, input);
    const sL = r.sL, sR = r.sR;
    const hL = [Math.cos(sL.heading * DEG), Math.sin(sL.heading * DEG)];
    const hR = [Math.cos(-sR.heading * DEG), Math.sin(-sR.heading * DEG)];
    const toS = (x, y) => [-y, -x];
    const fl = [sL.W[0], sL.W[1]], fr = [sR.W[0], -sR.W[1]];
    const yWr = model.rear.static.W[1];
    const inter = (p1, d1, p2, d2) => {
      const det = d1[0] * (-d2[1]) - d1[1] * (-d2[0]);
      if (Math.abs(det) < 1e-9) return null;
      const t = ((p2[0] - p1[0]) * (-d2[1]) - (p2[1] - p1[1]) * (-d2[0])) / det;
      return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
    };
    const nL = [-hL[1], hL[0]], nR = [-hR[1], hR[0]];
    const ciL = inter(fl, nL, [-WB, 0], [0, 1]);
    const ciR = inter(fr, nR, [-WB, 0], [0, 1]);
    const far = Math.max(ciL && ciL[1] > 0 ? ciL[1] : 0, ciR && ciR[1] > 0 ? ciR[1] : 0);
    const reach = Math.min(1500, Math.max(280, far + 70));
    const vb = [-reach, -96, reach + 136, WB + 140];
    const k = vb[2] / o.px;
    let s = grid(vb, 50);
    const ch = P.HW.chassis;
    s += PG([toS(ch.front, ch.halfWidth), toS(ch.front, -ch.halfWidth), toS(-WB - ch.rear, -ch.halfWidth), toS(-WB - ch.rear, ch.halfWidth)], 'chassis');
    s += segClipped(toS(-WB, -yWr - 20), toS(-WB, reach), vb, 'faint dash');
    let lab = '';
    if (input > 0.02) {
      const big = 4000;
      s += segClipped(toS(fl[0], fl[1]), toS(fl[0] + nL[0] * big, fl[1] + nL[1] * big), vb, 'accent-thin dash');
      s += segClipped(toS(fr[0], fr[1]), toS(fr[0] + nR[0] * big, fr[1] + nR[1] * big), vb, 'blue dash');
      if (ciR) { const q = toS(ciR[0], ciR[1]); if (inside(q, vb)) s += C(q[0], q[1], 3.4 * k, 'fill-blue'); }
      if (ciL) { const q = toS(ciL[0], ciL[1]); if (inside(q, vb)) s += C(q[0], q[1], 3.4 * k, 'fill-accent'); }
      const ra = toS(-WB, Math.min(reach - 20, Math.max(ciL ? ciL[1] : 0, ciR ? ciR[1] : 0)));
      lab += T(ra[0] + 6 * k, ra[1] + 16 * k, 'rear-axle line', 10 * k, 't-muted');
    }
    const toeR = model.rear.static.toe * DEG;
    const wheels = [[fl, hL], [fr, hR], [[-WB, yWr], [Math.cos(-toeR), Math.sin(-toeR)]], [[-WB, -yWr], [Math.cos(toeR), Math.sin(toeR)]]];
    for (const [c, hd] of wheels) { const sc = toS(c[0], c[1]); s += tyreTop(sc[0], sc[1], -hd[1], -hd[0], R, w); }
    const st = P.steerAt(F, steerState(model, input).p);
    const qL = toS(fl[0], fl[1]), qR = toS(fr[0], fr[1]);
    lab += T(qL[0], qL[1] - R - 8 * k, fmt(st.left) + '°', 12 * k, 't-accent', 'middle');
    lab += T(qR[0], qR[1] - R - 8 * k, fmt(st.right) + '°', 12 * k, 't-blue', 'middle');
    lab += T(0, -ch.front - 8 * k, '↑ Front', 11 * k, 't-head', 'middle');
    return svg(vb, s + lab, 'Top view of the car turning left');
  }
  function linkageView(model, input, o) {
    const F = model.front, R = F.Rt, w = model.setup.car.tireWidth, H = P.HW.front;
    const { p, r } = steerState(model, input);
    const toS = (x, y) => [-y, -x];
    const mirP = (q) => [q[0], -q[1], q[2]];
    const vb = [-114, -50, 228, 100];
    const k = vb[2] / o.px;
    let s = grid(vb, 10);
    const ch = P.HW.chassis;
    s += PG([toS(ch.front, ch.halfWidth), toS(ch.front, -ch.halfWidth), toS(-50, -ch.halfWidth), toS(-50, ch.halfWidth)], 'chassis');
    const sides = [[r.sL, (q) => q, F.plateBall(p), r.sL.heading], [r.sR, mirP, mirP(F.plateBall(-p)), -r.sR.heading]];
    const pbL = sides[0][2], pbR = sides[1][2], pb0 = F.plateBall(0);
    const by = 13, postX = pb0[0] + H.bellcrank;
    let lab = '';
    for (const sgn of [1, -1]) {
      const post = toS(postX, sgn * by), arm = toS(pbL[0], sgn * by + (pbL[1] - pb0[1]));
      s += L(post[0], post[1], arm[0], arm[1], 'ink-thin') + C(post[0], post[1], 2.4 * k, 'pivot');
    }
    const a = toS(pbL[0], pbL[1]), b = toS(pbR[0], pbR[1]);
    s += L(a[0], a[1], b[0], b[1], 'ink');
    for (const [st, m, pb, hdg] of sides) {
      const W = m(st.W), kp = m(st.kp), ball = m(st.ball);
      const sc = toS(W[0], W[1]);
      s += tyreTop(sc[0], sc[1], -Math.sin(hdg * DEG), -Math.cos(hdg * DEG), R, w);
      const kS = toS(kp[0], kp[1]), bS = toS(ball[0], ball[1]), pS = toS(pb[0], pb[1]);
      s += L(kS[0], kS[1], bS[0], bS[1], 'link') + L(bS[0], bS[1], pS[0], pS[1], 'rod');
      s += C(kS[0], kS[1], 2.6 * k, 'pivot') + C(bS[0], bS[1], 2.2 * k, 'pivot') + C(pS[0], pS[1], 2.2 * k, 'pivot');
    }
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    lab += T(mid[0], mid[1] + 13 * k, 'steering plate', 9.5 * k, 't-muted', 'middle');
    const post = toS(postX, by);
    lab += T(post[0], post[1] - 6 * k, 'bellcranks', 9.5 * k, 't-muted', 'middle');
    const ballL = r.sL.ball, bq = toS(ballL[0], ballL[1]);
    lab += T(bq[0] + 4 * k, bq[1] + 14 * k, 'Ackermann ball', 9.5 * k, 't-arm', 'middle');
    lab += T(vb[0] + vb[2] - 4 * k, vb[1] + 12 * k, '↑ Front', 11 * k, 't-head', 'end');
    return svg(vb, s + lab, 'Steering linkage seen from above');
  }

  function toeView(model, o) {
    const X = 5, WB = model.wheelbase, R = model.front.Rt, w = model.setup.car.tireWidth;
    const toS = (x, y) => [x, -y];   // top view, front to the right
    const vb = [-WB - 64, -122, WB + 128, 244];
    const k = vb[2] / o.px;
    let s = grid(vb, 20);
    const ch = P.HW.chassis;
    s += PG([toS(ch.front, ch.halfWidth), toS(ch.front, -ch.halfWidth), toS(-WB - ch.rear, -ch.halfWidth), toS(-WB - ch.rear, ch.halfWidth)], 'chassis');
    s += L(vb[0], 0, vb[0] + vb[2], 0, 'faint dash');
    let lab = '';
    for (const it of [{ C: model.front, x: 0 }, { C: model.rear, x: -WB }]) {
      const y = it.C.static.W[1], toe = it.C.static.toe;
      for (const sgn of [1, -1]) {
        const ang = -sgn * toe * X * DEG;      // toe-in points the front of the wheel at the centreline
        const c = toS(it.x, sgn * y);
        s += L(c[0] - R * 1.5, c[1], c[0] + R * 1.5, c[1], 'faint dot');
        s += tyreTop(c[0], c[1], Math.cos(ang), -Math.sin(ang), R, w);
        const ly = sgn > 0 ? c[1] - w / 2 - 8 * k : c[1] + w / 2 + 16 * k;
        lab += T(c[0], ly, toe >= 0 ? fmt(toe, 2) + '° in' : fmt(-toe, 2) + '° out', 11.5 * k, 't-accent', 'middle');
      }
    }
    return svg(vb, s + lab, 'Toe seen from above');
  }

  // ------------------------------------------------------------------
  // Roll: one axle seen from behind under lateral load
  // ------------------------------------------------------------------
  function rollView(model, axle, res, o) {
    const E = o.E, Cn = model[axle], R = Cn.Rt, w = model.setup.car.tireWidth;
    const h = model.setup[axle].rideHeight, S0 = Cn.static;
    const vb = [-132, -138, 264, 158];
    const k = vb[2] / o.px;
    const idx = axle === 'front' ? 0 : 2;
    const cL = res.corners[idx], cR = res.corners[idx + 1];
    const phi = res.roll * DEG * E;
    const dhA = E * (axle === 'front' ? res.frontHeightChange : res.rearHeightChange);
    const tf = (y, z) => [y * Math.cos(phi) - z * Math.sin(phi), h + dhA + y * Math.sin(phi) + z * Math.cos(phi)];
    const S = (q) => [-q[0], -q[1]];
    let s = grid(vb, 10) + ground(vb[0], vb[0] + vb[2], 0, k);
    s += L(0, 0, 0, -132, 'faint dash');
    const shell = [[-95, 8], [-95, 50], [-86, 64], [-60, 104], [60, 104], [86, 64], [95, 50], [95, 8]];
    s += PL(shell.map(([y, z]) => S(tf(y, z))), 'faint dash');
    const ch = P.HW.chassis;
    s += PG([S(tf(-ch.halfWidth, 0)), S(tf(ch.halfWidth, 0)), S(tf(ch.halfWidth, ch.thick)), S(tf(-ch.halfWidth, ch.thick))], 'chassis');
    let lab = '', parts = '';
    const maxN = Math.max(cL.grams, cR.grams, 1), sc = 44 / Math.max(700, maxN);
    for (const [c, sgn] of [[cL, 1], [cR, -1]]) {
      const yP = sgn * Cn.table.at(c.travel, 'yP');
      const gam = c.camberGround * DEG;
      const lift = c.lifted ? 1.5 * E : 0;
      const W = [yP + sgn * Math.sin(gam) * R, R * Math.cos(gam) + lift];
      const sv = [0, sgn * Math.cos(gam), -Math.sin(gam)];
      parts += wheelFront([0, W[0], W[1]], sv, R, w, S);
      // linkage: hub points follow the wheel's camber, chassis points follow the chassis
      const alpha = -sgn * (c.camberGround - S0.camber) * DEG;
      const hubPt = (p) => { const off = rot2([sgn * (p[1] - S0.W[1]), p[2] - S0.W[2]], sgn * alpha); return [W[0] + off[0], W[1] + off[1]]; };
      const O = hubPt(S0.O), B = hubPt(S0.B);
      const Pin = tf(sgn * Cn.Pin[1], Cn.Pin[2]), U = tf(sgn * Cn.U[1], Cn.U[2]);
      const Wi = [W[0] - sgn * 9 * Math.cos(gam), W[1] + 9 * Math.sin(gam)];
      const [sO, sB, sPin, sU, sWi] = [S(O), S(B), S(Pin), S(U), S(Wi)];
      parts += PG([sO, sB, sWi], 'hub');
      parts += L(sPin[0], sPin[1], sO[0], sO[1], 'arm') + L(sU[0], sU[1], sB[0], sB[1], 'link');
      parts += C(sPin[0], sPin[1], 2 * k, 'pivot-arm') + C(sO[0], sO[1], 2 * k, 'pivot-arm') + C(sU[0], sU[1], 1.8 * k, 'pivot') + C(sB[0], sB[1], 1.8 * k, 'pivot');
      const cp = S([yP, lift]);
      parts += contactMark(cp[0], cp[1], k);
      const bx = S([yP, 0])[0], top = -(2 * R + 16);
      const hBar = c.grams * sc;
      parts += PG([[bx - 4, top], [bx + 4, top], [bx + 4, top - hBar], [bx - 4, top - hBar]], c.lifted ? 'fill-bad' : 'fill-accent');
      lab += T(bx, top - hBar - 4 * k, Math.round(c.grams) + ' g', 12 * k, c.lifted ? 't-bad' : 't-head', 'middle');
      lab += T(bx, -(2 * R) - 4 * k, (sgn > 0 ? 'inside ' : 'outside ') + fmtS(c.camberGround) + '°', 10.5 * k, 't-muted', 'middle');
      if (c.lifted) lab += T(bx, 13 * k, 'lifted', 10.5 * k, 't-bad', 'middle');
      else if (c.onStop) lab += T(bx, 13 * k, 'on droop stop', 10.5 * k, 't-warn', 'middle');
    }
    s += parts;
    const cg = S(tf(0, model.h - h));
    s += cgSymbol(cg[0], cg[1], 5 * k);
    if (Math.abs(o.ay) > 0.01) {
      const dir = o.ay > 0 ? 1 : -1; // left turn: inertia pushes toward the car's right = screen right
      const x0 = cg[0] + dir * 9 * k, x1 = x0 + dir * 28;
      s += L(x0, cg[1], x1, cg[1], 'warn') + PG([[x1 + dir * 6 * k, cg[1]], [x1, cg[1] - 3.5 * k], [x1, cg[1] + 3.5 * k]], 'fill-warn');
      lab += T(x1 + dir * 8 * k, cg[1] + 4 * k, o.ay.toFixed(2) + ' g', 11.5 * k, 't-warn', dir > 0 ? 'start' : 'end');
    }
    lab += T(vb[0] + vb[2] - 5 * k, vb[1] + 13 * k, `roll ${fmt(res.roll, 2)}°`, 12 * k, 't-accent', 'end');
    return svg(vb, s + lab, 'Axle under cornering load');
  }

  // ------------------------------------------------------------------
  // Line chart
  // ------------------------------------------------------------------
  function niceStep(span, target) {
    const raw = span / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }
  function lineChart(o) {
    const W = o.w || 340, H = o.h || 190, m = { l: 44, r: 12, t: 12, b: 34 };
    const all = o.series.flatMap((s) => s.pts).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (!all.length) return '';
    let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
    let y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
    if (o.yInclude) for (const v of o.yInclude) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    if (o.yMinSpan && y1 - y0 < o.yMinSpan) { const c = (y0 + y1) / 2; y0 = c - o.yMinSpan / 2; y1 = c + o.yMinSpan / 2; }
    if (x1 - x0 < 1e-9) x1 = x0 + 1;
    const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    const sx = (x) => m.l + (x - x0) / (x1 - x0) * (W - m.l - m.r);
    const sy = (y) => H - m.b - (y - y0) / (y1 - y0) * (H - m.t - m.b);
    let s = '';
    const ys = niceStep(y1 - y0, 4), xs = niceStep(x1 - x0, 5);
    const dec = (st) => (st >= 1 ? 0 : st >= 0.1 ? 1 : st >= 0.01 ? 2 : 3);
    for (let y = Math.ceil(y0 / ys) * ys; y <= y1 + 1e-9; y += ys) {
      s += L(m.l, sy(y), W - m.r, sy(y), Math.abs(y) < ys / 1e6 ? 'zero' : 'gl');
      s += `<text x="${n(m.l - 6)}" y="${n(sy(y) + 3.5)}" text-anchor="end">${fmt(y, dec(ys))}</text>`;
    }
    for (let x = Math.ceil(x0 / xs) * xs; x <= x1 + 1e-9; x += xs) {
      s += L(sx(x), m.t, sx(x), H - m.b, Math.abs(x) < xs / 1e6 ? 'zero' : 'gl');
      s += `<text x="${n(sx(x))}" y="${n(H - m.b + 15)}" text-anchor="middle">${fmt(x, dec(xs))}</text>`;
    }
    s += L(m.l, H - m.b, W - m.r, H - m.b, 'axis');
    if (o.xLabel) s += `<text x="${n((m.l + W - m.r) / 2)}" y="${n(H - 4)}" text-anchor="middle">${esc(o.xLabel)}</text>`;
    if (o.yLabel) s += `<text x="12" y="${n((m.t + H - m.b) / 2)}" text-anchor="middle" transform="rotate(-90 12 ${n((m.t + H - m.b) / 2)})">${esc(o.yLabel)}</text>`;
    o.series.forEach((se, i) => {
      const pts = se.pts.filter((p) => isFinite(p[0]) && isFinite(p[1]));
      if (pts.length < 2) return;
      s += `<polyline class="ser s${se.c === undefined ? i : se.c}${se.dash ? ' dash' : ''}" points="${pts.map((p) => n(sx(p[0])) + ',' + n(sy(p[1]))).join(' ')}"/>`;
    });
    for (const mk of o.markers || []) {
      if (!isFinite(mk.x) || !isFinite(mk.y)) continue;
      s += `<circle cx="${n(sx(mk.x))}" cy="${n(sy(mk.y))}" r="4.5" class="mk f${mk.c || 0}"/>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'chart')}">${s}</svg>`;
  }

  root.TCDraw = { axleView, sideView, casterView, ackermannOverview, linkageView, toeView, rollView, lineChart, steerState, fmt, fmtS };
})(typeof self !== 'undefined' ? self : this);
