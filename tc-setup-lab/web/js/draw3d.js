/*
 * TC Setup Lab: live 3D car
 * Builds the whole car from the solver: every corner's arm, camber link,
 * hub, steering link and wheel come from the 3D kinematics at that corner's
 * wheel travel, and the chassis sits on the pose (heave, roll, pitch) found
 * by the whole-car equilibrium. Drawn as an SVG with a perspective camera
 * and painter's-algorithm depth sorting, so it needs no 3D library and
 * works offline.
 */
(function (root) {
  'use strict';
  const P = root.TCPhysics;
  const DEG = Math.PI / 180;
  const n = (v) => (Math.round(v * 10) / 10).toString();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mir = (p) => [p[0], -p[1], p[2]];

  const VIEWS = {
    iso: { yaw: 38, elev: 24 },
    front: { yaw: 0, elev: 7 },
    side: { yaw: 90, elev: 4 },
    rear: { yaw: 180, elev: 7 },
    top: { yaw: 90, elev: 88 },
  };

  /** Corner geometry (chassis frame) at a wheel travel and plate displacement. */
  function cornerGeom(model, i, travel, p) {
    const C = i < 2 ? model.front : model.rear;
    const left = i % 2 === 0;
    const pSide = C.isF ? (left ? p : -p) : 0;
    const s = Math.max(C.table.sLo, Math.min(C.table.sHi, travel));
    const th = C.thetaForTravel(s, pSide);
    const st = (isFinite(th) && C.state(th, pSide)) || C.static;
    const m = left ? (q) => q : mir;
    const a = m(C.a);
    const g = {
      C, left, st,
      pinF: m(add(C.Pin, mul(C.a, 11))), pinB: m(sub(C.Pin, mul(C.a, 11))),
      oF: m(add(st.O, mul(C.a, 9))), oB: m(sub(st.O, mul(C.a, 9))),
      U: m(C.U), B: m(st.B), W: m(st.W), s: m(st.s), P: m(st.P), O: m(st.O),
      shockLow: m(st.shockLow), shockTop: m(C.shockTop), a,
    };
    if (C.steered) {
      g.kp = m(st.kp); g.kpTop = m(st.kpTop); g.ball = m(st.ball); g.plate = m(C.plateBall(pSide));
    }
    return g;
  }

  function render(model, cond, o) {
    o = Object.assign({ px: 360, yaw: 38, elev: 24, E: 1 }, o);
    const res = cond.res, E = o.E, WB = model.wheelbase, setup = model.setup;
    const hF = setup.front.rideHeight, hR = setup.rear.rideHeight;
    const dh = E * res.heave, phi = E * res.roll * DEG, th = E * res.pitch * DEG;
    // chassis frame -> world (ground at z = 0), small-angle rotation of the sprung mass
    const toWorld = (q) => {
      const base = hR + (hF - hR) * (q[0] + WB) / WB;
      return [q[0] - th * q[2], q[1] - phi * q[2], q[2] + base + dh + phi * q[1] + th * (q[0] + model.a)];
    };
    // camera
    const target = [-WB / 2, 0, 34];
    const yaw = o.yaw * DEG, el = Math.max(1, Math.min(89, o.elev)) * DEG;
    const dist = 860;
    const cam = add(target, mul([Math.cos(el) * Math.cos(yaw), Math.cos(el) * Math.sin(yaw), Math.sin(el)], dist));
    const f = norm(sub(target, cam));
    let r = cross(f, [0, 0, 1]);
    if (Math.hypot(...r) < 1e-6) r = [0, 1, 0];
    r = norm(r);
    const u = cross(r, f);
    const F = 1150;
    const proj = (w) => {
      const d = sub(w, cam);
      const zv = Math.max(40, dot(d, f));
      return [F * dot(d, r) / zv, -F * dot(d, u) / zv, zv];
    };
    // frame the camera on the car's bounding box so it fills the panel from any angle
    const zTop = o.loads ? 2 * model.front.Rt + 64 : 72;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const bx of [-WB - 46, 62]) for (const by of [-100, 100]) for (const bz of [0, zTop]) {
      const q = proj([bx, by, bz]);
      x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
    }
    const ASPECT = 1.75, pad = 1.06;
    let w = (x1 - x0) * pad, hgt = (y1 - y0) * pad;
    if (w / hgt < ASPECT) w = hgt * ASPECT; else hgt = w / ASPECT;
    const vb = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - hgt / 2, w, hgt];
    const k = vb[2] / o.px;
    const prims = [];
    const poly = (pts, cls, z) => { const pr = pts.map(proj); prims.push({ z: z !== undefined ? z : pr.reduce((s, p) => s + p[2], 0) / pr.length, d: `<polygon points="${pr.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" class="${cls}"/>` }); };
    const line = (a, b, cls, bias) => { const pa = proj(a), pb = proj(b); prims.push({ z: (pa[2] + pb[2]) / 2 + (bias || 0), d: `<line x1="${n(pa[0])}" y1="${n(pa[1])}" x2="${n(pb[0])}" y2="${n(pb[1])}" class="${cls}"/>` }); };
    const dotP = (a, rr, cls, bias) => { const pa = proj(a); prims.push({ z: pa[2] + (bias || 0), d: `<circle cx="${n(pa[0])}" cy="${n(pa[1])}" r="${n(rr * F / pa[2])}" class="${cls}"/>` }); };

    // ground grid (always behind everything)
    let groundSvg = '';
    const gx0 = -WB - 100, gx1 = 100, gy = 150;
    for (let x = Math.ceil(gx0 / 50) * 50; x <= gx1; x += 50) { const a = proj([x, -gy, 0]), b = proj([x, gy, 0]); groundSvg += `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" class="gridline3"/>`; }
    for (let y = -gy; y <= gy; y += 50) { const a = proj([gx0, y, 0]), b = proj([gx1, y, 0]); groundSvg += `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" class="gridline3"/>`; }

    // chassis plate, towers, CG
    const ch = model.hw.chassis;
    const plate = [[ch.front, ch.halfWidth, ch.thick], [ch.front, -ch.halfWidth, ch.thick], [-WB - ch.rear, -ch.halfWidth, ch.thick], [-WB - ch.rear, ch.halfWidth, ch.thick]].map(toWorld);
    const plateZ = plate.map(proj).reduce((s, p) => s + p[2], 0) / 4;
    prims.push({ z: plateZ + 400, d: `<polygon points="${plate.map(proj).map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" class="plate3"/>` });
    for (const C of [model.front, model.rear]) {
      const x = C.shockTop[0], ty = C.shockTop[1] + 8;
      poly([[x, -38, ch.thick], [x, -ty, 64], [x, ty, 64], [x, 38, ch.thick]].map(toWorld), 'tower3');
    }
    const cg = toWorld([-model.a, 0, model.h - (hR + (hF - hR) * (WB - model.a) / WB)]);
    dotP(cg, 5, 'cg3', -30);

    // corners
    const travel = res.corners.map((c) => c.travel * E);
    const corners = [0, 1, 2, 3].map((i) => cornerGeom(model, i, travel[i], cond.p || 0));
    const tw = setup.car.tireWidth;
    for (const g of corners) {
      const Wd = (q) => toWorld(q);
      // lower arm (wishbone plate between the two hinge pins)
      poly([g.pinF, g.oF, g.oB, g.pinB].map(Wd), 'arm3');
      line(Wd(g.U), Wd(g.B), 'link3', -2);
      line(Wd(g.shockLow), Wd(g.shockTop), 'shock3', -1);
      // hub
      if (g.C.steered) {
        poly((g.C.Hw.upperOnKingpin ? [g.O, g.B, add(g.W, mul(g.s, -9))] : [g.O, g.kp, g.kpTop, g.B]).map(Wd), 'hub3');
        line(Wd(g.ball), Wd(g.plate), 'rod3', -2);
        line(Wd(g.kp), Wd(g.ball), 'link3', -2);
      } else {
        poly([g.O, g.B, add(g.W, mul(g.s, -9))].map(Wd), 'hub3');
      }
      // wheel: tread quads + both faces, back faces culled
      const W = Wd(g.W), sAx = norm(sub(Wd(add(g.W, g.s)), W));
      const R = g.C.Rt;
      const e1 = norm(cross(sAx, [0, 0, 1])), e2 = cross(e1, sAx);
      const N = 22, outer = [], inner = [];
      for (let j = 0; j < N; j++) {
        const t = j / N * 2 * Math.PI;
        const rad = add(mul(e1, Math.cos(t) * R), mul(e2, Math.sin(t) * R));
        outer.push(add(add(W, rad), mul(sAx, tw / 2)));
        inner.push(add(add(W, rad), mul(sAx, -tw / 2)));
      }
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        const mid = mul(add(add(outer[j], outer[j2]), add(inner[j], inner[j2])), 0.25);
        const nrm = sub(mid, W);
        if (dot(nrm, sub(cam, mid)) <= 0) continue;
        poly([outer[j], outer[j2], inner[j2], inner[j]], 'tread3');
      }
      for (const [face, sg] of [[outer, 1], [inner, -1]]) {
        const c = add(W, mul(sAx, sg * tw / 2));
        if (dot(mul(sAx, sg), sub(cam, c)) <= 0) continue;
        poly(face, 'side3');
        const rim = face.map((q) => add(c, mul(sub(q, c), 0.66)));
        const pr = rim.map(proj);
        prims.push({ z: pr.reduce((s, p) => s + p[2], 0) / pr.length - 0.5, d: `<polygon points="${pr.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" class="rim3"/>` });
      }
    }
    if (model.front && cond.p !== undefined) {
      const fl = corners[0], fr = corners[1];
      line(toWorld(fl.plate), toWorld(fr.plate), 'steer3', -2);
    }
    // wheel loads as columns above the contact patches
    const loads = [];
    if (o.loads) {
      res.corners.forEach((c, i) => {
        const g = corners[i];
        const base = toWorld(g.P);
        const top = add(base, [0, 0, 8 + c.grams * 0.07]);
        const b0 = add(base, [0, 0, 2 * g.C.Rt + 6]);
        const t0 = add(top, [0, 0, 2 * g.C.Rt + 6]);
        const pa = proj(b0), pb = proj(t0);
        prims.push({ z: Math.min(pa[2], pb[2]) - 200, d: `<line x1="${n(pa[0])}" y1="${n(pa[1])}" x2="${n(pb[0])}" y2="${n(pb[1])}" class="${c.lifted ? 'loadbar3 bad' : 'loadbar3'}" style="stroke-width:${n(9 * F / pa[2])}"/>` });
        loads.push({ x: pb[0], y: pb[1] - 6 * k, txt: Math.round(c.grams) + ' g', bad: c.lifted });
      });
    }
    prims.sort((a, b) => b.z - a.z);
    let s = groundSvg + prims.map((p) => p.d).join('');
    for (const l of loads) s += `<text x="${n(l.x)}" y="${n(l.y)}" font-size="${n(12 * k)}" text-anchor="middle" class="${l.bad ? 't-bad' : 't-head'}" style="stroke-width:${n(3.6 * k)}px">${esc(l.txt)}</text>`;
    return `<svg class="dg dg3" viewBox="${vb.map(n).join(' ')}" role="img" aria-label="Live 3D view of the car. Drag to rotate.">${s}</svg>`;
  }

  root.TCDraw3D = { render, VIEWS };
})(typeof self !== 'undefined' ? self : this);
