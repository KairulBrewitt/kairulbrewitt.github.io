/*
 * TC Setup Lab: realistic 3D model (WebGL, three.js)
 * --------------------------------------------------------------
 * A procedural model of the RC Maker SP2, shaped from the drawings in the
 * SP2 manual. All geometry is authored in the solver's chassis frame
 * (mm; x forward from the front axle, y to the left, z up from the chassis
 * underside); one group converts to three.js axes.
 *
 * Every suspension part is placed from the solver's 3D state for its corner
 * (arm angle, hub rotation, steer, rocker angle), and the chassis sits on the
 * pose found by the whole-car equilibrium, so any setup change moves the
 * parts exactly as the kinematics say.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, P = root.TCPhysics;
  if (!THREE || !P) { root.TCModel3D = null; return; }
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------
  // vector helpers (physics arrays)
  // ------------------------------------------------------------------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mir = (p) => [p[0], -p[1], p[2]];
  const mtv = (M, v) => [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]];
  const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

  // ------------------------------------------------------------------
  // procedural textures
  // ------------------------------------------------------------------
  function canvasTexture(w, h, draw, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts && opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  function carbonTexture() {
    // 2x2 twill: tows alternate direction, offset one step per row
    return canvasTexture(256, 256, (g, w) => {
      const n = 8, s = w / n;
      g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const horiz = Math.floor((i + j) / 2) % 2 === 0;
        const x = i * s, y = j * s;
        const gr = horiz ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
        gr.addColorStop(0, '#141417'); gr.addColorStop(0.45, '#3a3b40'); gr.addColorStop(0.55, '#46474d'); gr.addColorStop(1, '#141417');
        g.fillStyle = gr; g.fillRect(x + 0.6, y + 0.6, s - 1.2, s - 1.2);
        g.strokeStyle = 'rgba(255,255,255,0.04)';
        for (let k = 1; k < 4; k++) {
          g.beginPath();
          if (horiz) { g.moveTo(x, y + k * s / 4); g.lineTo(x + s, y + k * s / 4); } else { g.moveTo(x + k * s / 4, y); g.lineTo(x + k * s / 4, y + s); }
          g.stroke();
        }
      }
    }, { srgb: true });
  }
  function boardTexture(blue) {
    // setup board: 10 mm grid, 50 mm major lines (one tile = 200 mm)
    return canvasTexture(1024, 1024, (g, w) => {
      g.fillStyle = blue ? '#0e2f52' : '#d6d9dc'; g.fillRect(0, 0, w, w);
      const px = w / 200;
      for (let mmv = 0; mmv <= 200; mmv += 10) {
        const major = mmv % 50 === 0;
        g.strokeStyle = blue ? (major ? 'rgba(160,210,255,0.55)' : 'rgba(160,210,255,0.22)') : (major ? 'rgba(70,80,90,0.45)' : 'rgba(70,80,90,0.16)');
        g.lineWidth = major ? 2.4 : 1.2;
        g.beginPath(); g.moveTo(mmv * px, 0); g.lineTo(mmv * px, w); g.stroke();
        g.beginPath(); g.moveTo(0, mmv * px); g.lineTo(w, mmv * px); g.stroke();
      }
    }, { srgb: true });
  }
  function treadTexture() {
    return canvasTexture(64, 512, (g, w, h) => {
      g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < 0.5 ? '#7a7a7a' : '#969696'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
      g.fillStyle = '#3c3c3c';
      for (const v of [0.36, 0.5, 0.64]) g.fillRect(0, v * h - 3, w, 6);    // circumferential grooves
    });
  }
  function labelTexture(lines, bg, fg, accent) {
    return canvasTexture(512, 192, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = accent; g.fillRect(0, h - 26, w, 26);
      g.fillStyle = fg; g.textBaseline = 'middle';
      g.font = 'bold 54px sans-serif'; g.fillText(lines[0], 24, 58);
      g.font = '30px sans-serif'; g.fillText(lines[1] || '', 24, 120);
    }, { srgb: true });
  }

  // ------------------------------------------------------------------
  // shapes and geometry helpers
  // ------------------------------------------------------------------
  function roundRect(x0, y0, x1, y1, r) {
    const s = new THREE.Shape();
    r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
    s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }
  function circlePath(cx, cy, r, ShapeType) {
    const p = new (ShapeType || THREE.Path)();
    p.absarc(cx, cy, r, 0, Math.PI * 2, true);
    return p;
  }
  function slotPath(x0, y0, x1, y1) {  // rounded slot as a hole (clockwise)
    const r = Math.min(x1 - x0, y1 - y0) / 2, p = new THREE.Path();
    if (x1 - x0 >= y1 - y0) {
      p.moveTo(x0 + r, y0); p.absarc(x0 + r, (y0 + y1) / 2, r, -Math.PI / 2, Math.PI / 2, true);
      p.lineTo(x1 - r, y1); p.absarc(x1 - r, (y0 + y1) / 2, r, Math.PI / 2, -Math.PI / 2, true);
    } else {
      p.moveTo(x1, y0 + r); p.absarc((x0 + x1) / 2, y0 + r, r, 0, Math.PI, true);
      p.lineTo(x0, y1 - r); p.absarc((x0 + x1) / 2, y1 - r, r, Math.PI, Math.PI * 2, true);
    }
    return p;
  }
  /** Convex hull of two circles (a belt loop or a link plate). */
  function stadium(c1, r1, c2, r2) {
    const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx), a = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
    const s = new THREE.Shape();
    s.absarc(c1[0], c1[1], r1, base + a, base - a + 2 * Math.PI, false);
    s.absarc(c2[0], c2[1], r2, base - a, base + a, false);
    s.closePath();
    return s;
  }
  function gearShape(teeth, rRoot, rTip) {
    const s = new THREE.Shape(), pitch = 2 * Math.PI / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * pitch;
      const pts = [[rRoot, a], [rRoot, a + 0.18 * pitch], [rTip, a + 0.32 * pitch], [rTip, a + 0.58 * pitch], [rRoot, a + 0.72 * pitch]];
      pts.forEach(([r, t], k) => { const x = r * Math.cos(t), y = r * Math.sin(t); if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y); });
    }
    s.closePath();
    return s;
  }
  /** Extrude a shape to exactly [0, depth]: the bevel rounds the edges inward instead of growing the part. */
  /** Outline counter-clockwise, holes clockwise, whichever way they were drawn (mirrored parts flip them). */
  function normShape(shape, curve) {
    const ex = shape.extractPoints(curve || 16), cw = THREE.ShapeUtils.isClockWise;
    const s = new THREE.Shape(cw(ex.shape) ? ex.shape.slice().reverse() : ex.shape);
    s.holes = ex.holes.map((h) => new THREE.Path(cw(h) ? h : h.slice().reverse()));
    return s;
  }
  const EX = (shape0, depth, bevel, curve) => {
    const b = bevel ? Math.min(bevel, depth * 0.3) : 0;
    const shape = normShape(shape0, curve);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: curve || 16,
    });
    if (b) g.translate(0, 0, b);
    return g;
  };
  /** Top-view shape (x, y) extruded up from z0. */
  function plateGeom(shape, t, z0, bevel, curve) { const g = EX(shape, t, bevel, curve); g.translate(0, 0, z0); return g; }
  /** Side-view shape (x, z) extruded along y, from y0 to y0 + t. */
  function sideGeom(shape, t, y0, bevel, curve) {
    const g = EX(shape, t, bevel, curve);
    g.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, y0 + t, 0, 1, 0, 0, 0, 0, 0, 1));
    return g;
  }
  /** Front-view shape (y, z) extruded along x, from x0 to x0 + t. */
  function frontGeom(shape, t, x0, bevel, curve) {
    const g = EX(shape, t, bevel, curve);
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    return g;
  }
  const UPY = new THREE.Vector3(0, 1, 0);
  /** Unit-height cylinder along local y; placeBetween stretches it between two points. */
  const unitCyl = (r, seg) => new THREE.CylinderGeometry(r, r, 1, seg || 14);
  function placeBetween(obj, a, b) {
    const A = V(a), d = V(b).sub(A), L = d.length();
    obj.position.copy(A).addScaledVector(d, 0.5);
    if (L > 1e-9) obj.quaternion.setFromUnitVectors(UPY, d.clone().divideScalar(L));
    obj.scale.set(1, Math.max(L, 1e-3), 1);
  }
  /** Rigid frame (3x3 rows + origin, physics) to an object matrix; mirrorY for right-side corners. */
  const MIRROR = new THREE.Matrix4().makeScale(1, -1, 1);
  function setFrame(obj, R, o, mirrorY) {
    obj.matrixAutoUpdate = false;
    obj.matrix.set(R[0][0], R[0][1], R[0][2], o[0], R[1][0], R[1][1], R[1][2], o[1], R[2][0], R[2][1], R[2][2], o[2], 0, 0, 0, 1);
    if (mirrorY) obj.matrix.premultiply(MIRROR);
    obj.matrixWorldNeedsUpdate = true;
  }
  /** Box beam between two points with a given section; 'up' fixes its roll. */
  function beam(a, b, w, h, mat, up) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, h), mat);
    placeBetween(m, a, b);
    if (up) {
      const d = norm(sub(b, a)), z = norm(sub(up, mul(d, dot(up, d)))), x = cross(d, z);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(x), V(d), V(z)));
    }
    return m;
  }
  function helixGeometry(r, wire, turns, segs) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, a = t * turns * 2 * Math.PI;
      pts.push(new THREE.Vector3(r * Math.cos(a), t - 0.5, r * Math.sin(a)));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, wire, 6, false);
  }

  // ------------------------------------------------------------------
  // materials
  // ------------------------------------------------------------------
  function makeMaterials() {
    const carbonMap = carbonTexture();
    carbonMap.repeat.set(1 / 24, 1 / 24);
    const tread = treadTexture();
    tread.repeat.set(24, 1);
    const S = (o) => new THREE.MeshStandardMaterial(o);
    return {
      carbon: new THREE.MeshPhysicalMaterial({ map: carbonMap, roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
      carbonSide: S({ color: 0x18181a, roughness: 0.7, metalness: 0.1 }),
      alu: S({ color: 0x3e434b, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.3 }),
      aluLight: S({ color: 0xa7acb3, metalness: 1, roughness: 0.26 }),
      orange: S({ color: 0xe8611a, metalness: 0.75, roughness: 0.32 }),
      steel: S({ color: 0xdfe3e8, metalness: 1, roughness: 0.14 }),
      screw: S({ color: 0x9ea3a8, metalness: 1, roughness: 0.3 }),
      screwBlack: S({ color: 0x1b1c1e, metalness: 0.8, roughness: 0.4 }),
      titanium: S({ color: 0xa3a9b0, metalness: 1, roughness: 0.32 }),
      composite: S({ color: 0x1c1d20, metalness: 0.05, roughness: 0.5 }),
      pom: S({ color: 0x0f0f10, metalness: 0, roughness: 0.42 }),
      rubber: S({ color: 0x141414, roughness: 0.93, metalness: 0, bumpMap: tread, bumpScale: 0.6 }),
      wheel: S({ color: 0xf2f1ee, roughness: 0.42, metalness: 0 }),
      belt: S({ color: 0x232325, roughness: 0.85 }),
      foam: S({ color: 0x2c2e31, roughness: 1 }),
      brass: S({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }),
      spring: S({ color: 0x2a2b2e, metalness: 0.9, roughness: 0.3 }),
      aluChassis: S({ color: 0x1a1b1e, metalness: 0.7, roughness: 0.4 }),
      steelChassis: S({ color: 0x3b3d42, metalness: 0.92, roughness: 0.3 }),
      electronics: S({ color: 0x18181b, roughness: 0.5, metalness: 0.1 }),
      heatsink: S({ color: 0x9aa0a8, metalness: 1, roughness: 0.32 }),
      motorCan: S({ color: 0x2b2f35, metalness: 0.9, roughness: 0.3 }),
      wireRed: S({ color: 0xb3261e, roughness: 0.55 }),
      wireBlack: S({ color: 0x111111, roughness: 0.55 }),
      wireBlue: S({ color: 0x1f5fbf, roughness: 0.55 }),
      battery: S({ color: 0x26282c, roughness: 0.55, metalness: 0.1 }),
      batteryLabel: S({ map: labelTexture(['7.4V 2S LiPo', 'hard case · 138 x 47 x 25 mm'], '#26282c', '#e9ecef', '#e8611a'), roughness: 0.5 }),
      motorLabel: S({ map: labelTexture(['540 BRUSHLESS', 'sensored · 13.5T'], '#2b2f35', '#e9ecef', '#3a7bd5'), roughness: 0.4, metalness: 0.5 }),
      board: S({ map: boardTexture(false), roughness: 0.82, metalness: 0 }),
    };
  }
  function blueprintMaterials() {
    return {
      fill: new THREE.MeshBasicMaterial({ color: 0x1d5fa0, transparent: true, opacity: 0.16, depthWrite: false }),
      line: new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.9 }),
      board: new THREE.MeshBasicMaterial({ map: boardTexture(true) }),
    };
  }

  // ------------------------------------------------------------------
  // studio environment for reflections
  // ------------------------------------------------------------------
  function studioEnvironment(renderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: 0x3a3d42, side: THREE.BackSide }));
    room.position.y = 2;
    env.add(room);
    const panel = (w, h, x, y, z, ry, rx, c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c || 0xffffff, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); env.add(m);
    };
    panel(5, 2.2, 0, 4.9, 0, 0, Math.PI / 2, 0xffffff);      // overhead softbox
    panel(3, 2, -4.8, 2, 1, Math.PI / 2, 0, 0xdde6f0);
    panel(3, 2, 4.8, 2.5, -1, -Math.PI / 2, 0, 0xfff1e0);
    panel(4, 0.6, 0, 1.2, 4.9, Math.PI, 0, 0xffffff);         // strip light for long highlights
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(env, 0.02).texture;
    pm.dispose();
    return tex;
  }

  // ------------------------------------------------------------------
  // Viewer
  // ------------------------------------------------------------------
  class Viewer {
    constructor() {
      const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
      r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.2;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer = r;
      this.canvas = r.domElement;
      this.canvas.className = 'gl3d';
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x1b1d20);
      this.envMap = studioEnvironment(r);
      this.scene.environment = this.envMap;
      this.camera = new THREE.PerspectiveCamera(30, 1.6, 5, 6000);
      this.M = makeMaterials();
      this.BP = blueprintMaterials();
      this.style = 'real';
      // lights
      const hemi = new THREE.HemisphereLight(0xeef3ff, 0x3a3632, 0.8);
      this.scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-128 + 170, 430, -230);
      key.target.position.set(-128, 0, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -330; key.shadow.camera.right = 330; key.shadow.camera.top = 260; key.shadow.camera.bottom = -260;
      key.shadow.camera.near = 50; key.shadow.camera.far = 1200;
      key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6; key.shadow.radius = 3;
      this.key = key;
      this.scene.add(key, key.target);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
      fill.position.set(-420, 220, 300);
      this.scene.add(fill);
      const front = new THREE.DirectionalLight(0xfff4e8, 0.7);   // low front light into the suspension
      front.position.set(300, 120, 60);
      this.scene.add(front);
      // setup board
      this.board = new THREE.Mesh(new THREE.BoxGeometry(760, 12, 460), this.M.board);
      this.board.material.map.repeat.set(760 / 200, 460 / 200);
      this.board.receiveShadow = true;
      this.board.position.set(-128, -6, 0);
      this.scene.add(this.board);
      // car root: physics (x, y, z) -> three (x, z, -y)
      this.car = new THREE.Group();
      this.car.matrixAutoUpdate = false;
      this.car.matrix.set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
      this.scene.add(this.car);
      this.sprung = new THREE.Group();
      this.sprung.matrixAutoUpdate = false;
      this.car.add(this.sprung);
      this.staticGroup = null;
      this.corners = [];
      this.keys = { stat: '', corner: '' };
      // camera / controls
      this.view = { yaw: 35, elev: 22, dist: 720, target: [-128, 0, 30] };
      this.goal = null;
      this.dirty = true;
      this._bindControls();
      this._loop = this._loop.bind(this);
      this.running = false;
    }

    attach(container) {
      if (this.canvas.parentNode !== container) container.appendChild(this.canvas);
      if (!this.labelBox) { this.labelBox = document.createElement('div'); this.labelBox.className = 'gl-labels'; this.labelBox.hidden = !this.labels; }
      if (this.labelBox.parentNode !== container) container.appendChild(this.labelBox);
      this.container = container;
      if (!this._ro && root.ResizeObserver) {
        this._ro = new root.ResizeObserver(() => this.resize());
      }
      if (this._ro) { this._ro.disconnect(); this._ro.observe(container); }
      if (!this._onWin) { this._onWin = () => this.resize(); root.addEventListener('resize', this._onWin); }
      this.resize();
      this.start();
    }
    resize() {
      const c = this.container;
      if (!c) return;
      const w = Math.max(200, c.clientWidth || 360);
      let h;
      if (c.closest && c.closest('.expanded')) h = Math.max(200, c.clientHeight || root.innerHeight * 0.7);
      else {
        const raw = getComputedStyle(c).getPropertyValue('--gl-max-h').trim();
        const maxH = /vh$/.test(raw) ? parseFloat(raw) * root.innerHeight / 100 : /px$/.test(raw) ? parseFloat(raw) : Infinity;
        h = Math.round(Math.max(150, Math.min(w / 1.55, maxH)));
      }
      if (this._w === w && this._h === h) return;
      this._w = w; this._h = h;
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this._autoFit) { this.view.dist = this._fitFor(this.view.yaw, this.view.elev); }
      this.dirty = true;
    }
    start() { if (!this.running) { this.running = true; root.requestAnimationFrame(this._loop); } }
    _loop() {
      if (!this.running) return;
      if (!this.canvas.isConnected) { this.running = false; return; }
      if (this.goal) {
        const v = this.view, g = this.goal, k = 0.2;
        const dy = ((g.yaw - v.yaw + 540) % 360) - 180;
        v.yaw += dy * k; v.elev += (g.elev - v.elev) * k; v.dist += (g.dist - v.dist) * k;
        for (let i = 0; i < 3; i++) v.target[i] += (g.target[i] - v.target[i]) * k;
        if (Math.abs(dy) < 0.05 && Math.abs(g.elev - v.elev) < 0.05 && Math.abs(g.dist - v.dist) < 0.5) {
          v.yaw = g.yaw; v.elev = g.elev; v.dist = g.dist; v.target = g.target.slice(); this.goal = null;
        }
        this.dirty = true;
      }
      if (this.dirty && this.canvas.isConnected) { this._render(); this.dirty = false; }
      root.requestAnimationFrame(this._loop);
    }
    _render() {
      const v = this.view, el = Math.max(2, Math.min(89, v.elev)) * DEG, yaw = v.yaw * DEG;
      const t = v.target; // physics coords -> three
      const T = new THREE.Vector3(t[0], t[2], -t[1]);
      const dir = new THREE.Vector3(Math.cos(el) * Math.cos(yaw), Math.sin(el), -Math.cos(el) * Math.sin(yaw));
      this.camera.position.copy(T).addScaledVector(dir, v.dist);
      this.camera.lookAt(T);
      this.renderer.render(this.scene, this.camera);
      this._placeLabels();
    }
    /** Camera distance that fits the whole car in the frame from this direction. */
    _fitFor(yaw, elev) {
      const WB = this.model ? this.model.wheelbase : 257, T = this._fitTarget || [-WB / 2 + 18, 0, 30];
      const y = yaw * DEG, e = Math.max(2, Math.min(89, elev)) * DEG;
      const dir = [Math.cos(e) * Math.cos(y), Math.cos(e) * Math.sin(y), Math.sin(e)];
      const right = [-Math.sin(y), Math.cos(y), 0], up = cross(dir, right);
      const tv = Math.tan(this.camera.fov / 2 * DEG), th = tv * this.camera.aspect;
      let d = 0;
      for (const x of [-WB - 48, 86]) for (const yy of [-98, 98]) for (const z of [0, 72]) {
        const p = sub([x, yy, z], T), zd = dot(p, dir);
        d = Math.max(d, zd + Math.abs(dot(p, right)) / th, zd + Math.abs(dot(p, up)) / tv);
      }
      return d * 1.04;
    }
    /** Point the camera from (yaw, elev), framing the whole car. */
    setView(yaw, elev, animate) {
      const target = (this._fitTarget || this.view.target).slice(), dist = this._fitFor(yaw, elev);
      this._autoFit = true;
      if (animate) this.goal = { yaw, elev, dist, target };
      else { Object.assign(this.view, { yaw, elev, dist, target }); this.goal = null; }
      this.dirty = true;
    }
    _bindControls() {
      const c = this.canvas, ptrs = new Map();
      let last = null;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } last = null; this.goal = null; });
      const end = (e) => { ptrs.delete(e.pointerId); last = null; };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId);
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const v = this.view;
        if (ptrs.size === 1) {
          v.yaw -= (e.clientX - prev.x) * 0.4;
          v.elev = Math.max(2, Math.min(89, v.elev + (e.clientY - prev.y) * 0.3));
        } else if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (last) {
            v.dist = Math.max(140, Math.min(1800, v.dist * last.d / Math.max(10, d)));
            this._autoFit = false;
            // pan in the camera plane
            const s = v.dist / (this._h || 300) * 0.55;
            const yaw = v.yaw * DEG;
            const right = [-Math.sin(yaw), Math.cos(yaw), 0];
            v.target = add(add(v.target, mul(right, -(mx - last.mx) * s)), [0, 0, (my - last.my) * s]);
          }
          last = { d, mx, my };
        }
        this.dirty = true;
        if (this.onCamera) this.onCamera(v);
      });
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.goal = null; this._autoFit = false; this.view.dist = Math.max(140, Math.min(1800, this.view.dist * Math.exp(e.deltaY * 0.001))); this.dirty = true; }, { passive: false });
    }

    // ---------------------------------------------------------------
    // build and update
    // ---------------------------------------------------------------
    update(model, cond) {
      if (!model || !model.ok) return;
      // Rebuild meshes only when their shape changes; otherwise a setup change just moves them.
      const s = model.setup, F = model.front, R = model.rear;
      const r = (v) => (v ? v.map((x) => Math.round(x * 20) / 20) : null);
      const xy = (v) => r(v.slice(0, 2));
      const statKey = JSON.stringify([s.car.model, s.car.chassis, model.wheelbase.toFixed(2), xy(F.U), xy(R.U), xy(F.Pin), xy(R.Pin),
        r(R.plateBall(0) || [0]), s.front.swayBar, s.rear.swayBar]);
      if (statKey !== this.keys.stat) { this._buildStatic(model); this.keys.stat = statKey; this.keys.corner = ''; }
      const hubKey = (C) => {
        const S0 = C.static, loc = (p) => (p ? r(mtv(S0.Rb, sub(p, S0.W))) : null);
        return [loc(S0.O), loc(S0.B), loc(S0.ball), Math.round(len(sub(S0.B, C.U)) / 2) * 2];
      };
      const cornerKey = JSON.stringify([s.car.model, s.car.tireDia, s.car.tireWidth, hubKey(F), hubKey(R)]);
      if (cornerKey !== this.keys.corner) { this._buildCorners(model); this.keys.corner = cornerKey; }
      this.model = model;
      this._pose(model, cond);
      if (this._hl) this._applyHighlight();
      this.dirty = true;
    }

    /**
     * Plane of the laid-down shock. The rocker turns about a fore-aft axis, so its shock eye can sit
     * in any fore-aft plane without changing the motion ratio; this one keeps the shock inside the
     * lower arm's window, clear of the anti-roll-bar ball.
     */
    _shockX(C) { return C.x0 + Math.sign(C.Hw.armU || 1) * 1.5; }

    _dispose(group) {
      if (!group) return;
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (group.parent) group.parent.remove(group);
    }
    _mesh(geom, mat, parent) {
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.realMat = mat;
      m.userData.tag = this._tag || null;
      m.userData.axle = this._axle || null;
      if (parent) parent.add(m);
      if (this.style === 'blueprint') this._blueprintify(m);
      return m;
    }

    _buildStatic(model) {
      this._dispose(this.staticGroup);
      const G = new THREE.Group();
      this.staticGroup = G;
      this.sprung.add(G);
      const M = this.M, s = model.setup, hw = model.hw, ch = hw.chassis, WB = model.wheelbase;
      const F = model.front, R = model.rear;
      const sp2 = !!hw.front.rocker;
      const t = { carbon: 2.2, alu: 1.5, steel: 1.2 }[s.car.chassis] || ch.thick;
      this.plateT = t;
      // ---- chassis plate (outline traced from the manual's top view) ----
      const half = sp2 ? [[24, 12], [6, 28], [-4, 30], [-24, 31.3], [-42, 35.2], [-54, 37.9], [-66, 40.3], [-169, 40.3], [-193, 39.1], [-211, 37.3], [-224, 34.3], [-233, 32], [-WB + 4, 30], [-WB - 6, 28], [-WB - 22, 12]]
        : [[ch.front, 20], [0, ch.halfWidth], [-WB, ch.halfWidth], [-WB - ch.rear, 20]];
      const shp = new THREE.Shape();
      half.forEach(([x, y], i) => { if (i === 0) shp.moveTo(x, y); else shp.lineTo(x, y); });
      for (let i = half.length - 1; i >= 0; i--) shp.lineTo(half[i][0], -half[i][1]);
      shp.closePath();
      const holes = [];
      const hole = (x, y, r) => holes.push(circlePath(x, y, r));
      // arm ball mounts, bulkhead and motor-mount screws
      for (const C of [F, R]) {
        const cs = (C.Hw.cupSpan || 23) / 2;
        for (const sg of [1, -1]) { hole(C.Pin[0] + cs, sg * C.Pin[1], 1.6); hole(C.Pin[0] - cs, sg * C.Pin[1], 1.6); }
        const xa = C.isF ? 0 : -WB;
        for (const dx of [-9, 9]) for (const sg of [1, -1]) hole(xa + dx, sg * 6, 1.6);
      }
      for (const dx of [-148, -112]) hole(dx, 6, 1.6);
      // spur slot / pinion window
      holes.push(slotPath(-152, 7, -105, 11.5));
      if (s.car.chassis === 'steel') {
        // weight-saving pockets of the steel chassis
        for (const [x0, x1] of [[-50, -38], [-60, -46], [-212, -198]]) for (const sg of [1, -1]) holes.push(slotPath(x0, sg > 0 ? 16 : -30, x1, sg > 0 ? 30 : -16));
        for (let x = -190; x <= -70; x += 20) holes.push(slotPath(x, -34, x + 12, -22));
        for (let x = -100; x <= -66; x += 17) holes.push(slotPath(x, 18, x + 9, 34));
      } else if (s.car.chassis === 'alu') {
        for (let x = -180; x <= -80; x += 33) holes.push(slotPath(x, -33, x + 18, -25));
        holes.push(slotPath(-96, 20, -72, 30));
      } else {
        // carbon: battery strap slots and lightening holes
        holes.push(slotPath(-176, -36, -166, -18), slotPath(-86, -36, -76, -18));
        for (let x = -200; x <= -60; x += 28) hole(x, 24, 2.2);
        for (let x = -190; x <= -70; x += 40) hole(x, -6, 2.4);
      }
      shp.holes = holes;
      this._tag = 'chassis'; this._axle = null;
      const plateMat = s.car.chassis === 'steel' ? M.steelChassis : s.car.chassis === 'alu' ? M.aluChassis : [M.carbon, M.carbonSide];
      this._mesh(plateGeom(shp, t, 0, 0.25, 12), plateMat, G);
      const top = t;

      // ---- bulkheads, spool / diff, upper bulkheads, rocker mounts ----
      const zDiff = 26;
      const diffCentre = {};
      this.uMounts = [];
      for (const C of [F, R]) {
        const xa = C.isF ? 0 : -WB, sgnIn = C.isF ? -1 : 1;
        this._axle = C.axle; this._tag = 'chassis';
        diffCentre[C.axle] = [xa, 0, zDiff];
        const prof = new THREE.Shape();
        prof.moveTo(xa - 12, top); prof.lineTo(xa + 12, top); prof.lineTo(xa + 12, 31); prof.quadraticCurveTo(xa + 12, 36, xa + 7, 36);
        prof.lineTo(xa - 7, 36); prof.quadraticCurveTo(xa - 12, 36, xa - 12, 31); prof.closePath();
        prof.holes = [circlePath(xa, zDiff, 5.6), circlePath(xa + sgnIn * 6.5, 9, 1.4), circlePath(xa - sgnIn * 6.5, 9, 1.4)];
        for (const sg of [1, -1]) {
          this._mesh(sideGeom(prof, 6, sg > 0 ? 7 : -13, 0.5), M.alu, G);
          // diff/spool eccentric insert (kit: low position)
          const ecc = this._mesh(new THREE.CylinderGeometry(6.6, 6.6, 1.2, 28), M.orange, G);
          ecc.position.set(xa, sg * 13.6, zDiff);
        }
        // pulley (38 T) and housing
        const pulley = gearShape(38, 17.2, 18.2);
        pulley.holes = [circlePath(0, 0, 3)];
        const yb = C.isF ? 2.75 : -2.75;
        const pg = EX(pulley, 6, 0.3, 4);
        pg.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, xa, 0, 0, -1, yb + 3, 0, 1, 0, zDiff, 0, 0, 0, 1));
        this._mesh(pg, M.aluLight, G);
        for (const f of [-1, 1]) {   // flanges
          const fl = this._mesh(new THREE.CylinderGeometry(19.3, 19.3, 0.6, 40), M.alu, G);
          fl.position.set(xa, yb + f * 3.5, zDiff);
        }
        const hub = this._mesh(new THREE.CylinderGeometry(8, 8, 13, 24), M.alu, G);
        hub.position.set(xa, 0, zDiff);
        for (const sg of [1, -1]) {   // outdrives
          const od = this._mesh(new THREE.CylinderGeometry(5.6, 5.2, 6, 20), M.steel, G);
          od.position.set(xa, sg * 16.5, zDiff);
        }
        // upper bulkhead (carbon) with ears to the upper-arm inner balls and caster inserts
        const ub = roundRect(xa - 12, -17, xa + 12, 17, 4);
        ub.holes = [circlePath(xa - 7, 0, 1.6), circlePath(xa + 7, 0, 1.6)];
        this._mesh(plateGeom(ub, 2.5, 36, 0.2), [M.carbon, M.carbonSide], G);
        for (const sg of [1, -1]) {
          const U = sg > 0 ? C.U : mir(C.U);
          this._tag = 'upper';
          const ear = stadium([xa + sgnIn * 2, sg * 11], 7, [U[0], U[1]], 6);
          ear.holes = [circlePath(U[0], U[1], 2)];
          this._mesh(plateGeom(ear, 2.5, 36, 0.2), [M.carbon, M.carbonSide], G);
          // caster insert, ball stud and ball: placed every frame (inner ball height is a setting)
          const ins = this._mesh(new THREE.CylinderGeometry(4.2, 4.2, 1.4, 20), M.orange, G);
          const stud = this._mesh(unitCyl(1.4), M.steel, G);
          const ball = this._mesh(new THREE.SphereGeometry(2.4, 20, 14), M.steel, G);
          this.uMounts.push({ axle: C.axle, sg, ins, stud, ball });
          this._tag = 'chassis';
        }
        this._tag = 'shock';
        if (C.Hw.rocker) {
          // 2112 shock bulkhead mount: flat plate on the chassis, its post rises through the arm window
          // to the laid-down shock. The rocker turns on a pin carried by two lugs on the bulkhead.
          const rk = C.Hw.rocker, xr = C.x0 + rk.dx, xs = this._shockX(C);
          for (const sg of [1, -1]) {
            const pl = stadium([xs - sgnIn * 1, sg * 15], 6.5, [xs, sg * rk.mountY], 4.2);
            pl.holes = [circlePath(xs, sg * rk.mountY, 1.2)];
            this._mesh(plateGeom(pl, 2, top, 0.3), M.alu, G);
            const post = this._mesh(new THREE.CylinderGeometry(2, 2.3, rk.mountZ - top - 2, 16), M.alu, G);
            post.rotation.x = Math.PI / 2; post.position.set(xs, sg * rk.mountY, (rk.mountZ + top + 2) / 2);
            const pin = this._mesh(new THREE.CylinderGeometry(1.5, 1.5, 12, 12), M.steel, G);
            pin.rotation.z = Math.PI / 2; pin.position.set(xr, sg * rk.y, rk.z);
            for (const dx of [-4.2, 4.2]) {
              const lug = this._mesh(new THREE.BoxGeometry(2.4, rk.y - 11, 7), M.alu, G);
              lug.position.set(xr + dx, sg * (rk.y + 11) / 2, rk.z);
            }
          }
        }
        this._tag = 'steer';
        // rear toe-link mount
        if (C.Hw.toeLink) {
          for (const sg of [1, -1]) {
            const p0 = sg > 0 ? C.plateBall(0) : mir(C.plateBall(0));
            const br = this._mesh(new THREE.BoxGeometry(6, 4, p0[2] - top), M.alu, G);
            br.position.set(p0[0], p0[1] - sg * 2, (p0[2] + top) / 2);
            const b = this._mesh(new THREE.SphereGeometry(2.15, 16, 12), M.steel, G); b.position.set(...p0);
          }
        }
      }
      this.diffCentre = diffCentre;
      this._tag = 'chassis'; this._axle = null;

      // ---- motor mount, layshaft, belts, spur, motor ----
      const xLs = -WB / 2, zLs = 20.5;
      const mmShape = new THREE.Shape();
      mmShape.moveTo(xLs - 40, top); mmShape.lineTo(xLs + 18, top); mmShape.lineTo(xLs + 18, 30);
      mmShape.quadraticCurveTo(xLs + 18, 38.5, xLs + 8, 38.5); mmShape.lineTo(xLs - 34, 38.5); mmShape.quadraticCurveTo(xLs - 42, 38.5, xLs - 42, 30); mmShape.closePath();
      mmShape.holes = [circlePath(xLs, zLs, 5.2), circlePath(xLs - 28.6, zLs, 11.5)];
      this._mesh(sideGeom(mmShape, 4, 10.5, 0.4), M.alu, G);
      const mm2 = roundRect(xLs - 10, top, xLs + 18, 38.5, 4);
      mm2.holes = [circlePath(xLs, zLs, 5.2)];
      this._mesh(sideGeom(mm2, 4, -9.5, 0.4), M.alu, G);
      this._mesh(plateGeom(roundRect(xLs - 12, -9.5, xLs + 18, 14.5, 3), 3, 35.5, 0.3), M.alu, G);
      const lay = this._mesh(new THREE.CylinderGeometry(2.5, 2.5, 24, 14), M.steel, G); lay.position.set(xLs, 1.5, zLs);
      const lp = this._mesh(EX(gearShape(20, 7.0, 7.7), 10, 0, 2).applyMatrix4(new THREE.Matrix4().set(1, 0, 0, xLs, 0, 0, -1, 5, 0, 1, 0, zLs, 0, 0, 0, 1)), M.aluLight, G);
      void lp;
      // belts: convex hull loop around the layshaft pulley and the spool / diff pulley
      for (const [C, yb] of [[F, 2.75], [R, -2.75]]) {
        const xa = C.isF ? 0 : -WB;
        const outer = stadium([xLs, zLs], 8.4, [xa, zDiff], 19.0);
        outer.holes = [(() => { const sIn = stadium([xLs, zLs], 7.6, [xa, zDiff], 18.2); const p = new THREE.Path(sIn.getPoints(40).reverse()); return p; })()];
        this._mesh(sideGeom(outer, 4.2, yb - 2.1, 0, 24), M.belt, G);
      }
      // spur gear (64 pitch) and pinion
      const spur = gearShape(116, 22.6, 23.3);
      spur.holes = [circlePath(0, 0, 2.6), circlePath(9, 0, 3.5), circlePath(-9, 0, 3.5), circlePath(0, 9, 3.5), circlePath(0, -9, 3.5)];
      const sg2 = EX(spur, 1.8, 0, 2);
      sg2.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, xLs, 0, 0, -1, 9.8, 0, 1, 0, zLs, 0, 0, 0, 1));
      this._mesh(sg2, M.composite, G);
      const pin = this._mesh(EX(gearShape(32, 5.9, 6.5), 4, 0, 2).applyMatrix4(new THREE.Matrix4().set(1, 0, 0, xLs - 29.4, 0, 0, -1, 12, 0, 1, 0, zLs, 0, 0, 0, 1)), M.aluLight, G);
      void pin;
      // motor (540, 36 mm can) lying across the car on the left
      const motor = new THREE.Group(); G.add(motor);
      const can = this._mesh(new THREE.CylinderGeometry(17.95, 17.95, 38, 40), [M.motorCan, M.aluLight, M.aluLight], motor);
      can.position.set(xLs - 29.4, 14.5 + 19, zLs);
      const lbl = this._mesh(new THREE.CylinderGeometry(18.05, 18.05, 20, 40, 1, true, -Math.PI * 0.35, Math.PI * 0.7), M.motorLabel, motor);
      lbl.position.copy(can.position);
      const endbell = this._mesh(new THREE.CylinderGeometry(17.5, 17.5, 13, 40), M.alu, motor);
      endbell.position.set(xLs - 29.4, 14.5 + 38 + 6.5, zLs);
      for (let i = 0; i < 18; i++) {   // finned heat-sink ring
        const a = i / 18 * Math.PI * 2;
        const fin = this._mesh(new THREE.BoxGeometry(1.2, 22, 4), M.heatsink, motor);
        fin.position.set(xLs - 29.4 + Math.cos(a) * 19.6, 14.5 + 22, zLs + Math.sin(a) * 19.6);
        fin.rotation.y = -a;
      }
      for (let i = 0; i < 3; i++) {    // solder tabs
        const tab = this._mesh(new THREE.BoxGeometry(5, 3, 1.5), M.brass, motor);
        tab.position.set(xLs - 36 + i * 7, 14.5 + 38 + 14, zLs + 12);
      }
      // fan on the motor mount
      const fanBox = this._mesh(new THREE.BoxGeometry(10, 30, 30), M.electronics, G);
      fanBox.position.set(xLs + 7, 30, top + 15);
      const fanRing = this._mesh(new THREE.TorusGeometry(12.5, 1.2, 8, 30), M.heatsink, G);
      fanRing.position.set(xLs + 12.2, 30, top + 15); fanRing.rotation.y = Math.PI / 2;

      // ---- top decks (2.0 mm carbon) ----
      const tdShape = (x0, x1) => {
        const sh = roundRect(x1, -8.5, x0, 8.5, 6);
        const hs = [];
        for (let x = x1 + 12; x < x0 - 12; x += 22) hs.push(slotPath(x, -3, Math.min(x + 15, x0 - 12), 3));
        sh.holes = hs;
        return sh;
      };
      this._mesh(plateGeom(tdShape(4, xLs + 16), 2, 38.5, 0.2), [M.carbon, M.carbonSide], G);
      this._mesh(plateGeom(tdShape(xLs - 10, -WB - 4), 2, 38.5, 0.2), [M.carbon, M.carbonSide], G);

      // ---- steering rack posts and servo ----
      this.rackPost = [];
      this._tag = 'steer'; this._axle = 'front';
      if (F.steered && F.Hw.bellcrank) {
        // steering posts carrying the rack bellcranks: placed every frame (rack ball position is a setting)
        for (let k = 0; k < 2; k++) this.rackPost.push(this._mesh(new THREE.CylinderGeometry(3, 3, 1, 18), M.orange, G));
      }
      this._tag = 'chassis'; this._axle = null;
      const servo = this._mesh(new THREE.BoxGeometry(20, 40, 18), M.electronics, G);
      servo.position.set(-74, 34, top + 9);
      const tabs = this._mesh(new THREE.BoxGeometry(24, 52, 2), M.electronics, G);
      tabs.position.set(-74, 34, top + 12);
      const servoMount = this._mesh(new THREE.BoxGeometry(26, 6, 14), M.alu, G);
      servoMount.position.set(-74, 11, top + 7);

      // ---- anti-roll bars ----
      this.arb = {};
      for (const C of [F, R]) {
        const dsg = C.isF ? 1 : -1;
        const ballX = C.Pin[0] + (C.Hw.arbArmU || 0);
        const xb = ballX + dsg * 12, zb = 12.5;
        const yEnd = C.Pin[1] + C.Hw.arbArm;
        const d = s[C.axle].swayBar;
        this.arb[C.axle] = { xb, zb, yEnd, ballX };
        this._tag = 'arb'; this._axle = C.axle;
        for (const sg of [1, -1]) {
          const holder = this._mesh(new THREE.BoxGeometry(6, 5, zb + 2 - top), M.alu, G);
          holder.position.set(xb, sg * 22, (zb + 2 + top) / 2);
        }
        if (d > 0) {
          const pts = [[ballX, yEnd, zb], [xb, yEnd - 6, zb], [xb, 22, zb], [xb, -22, zb], [xb, -yEnd + 6, zb], [ballX, -yEnd, zb]].map((p) => V(p));
          const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
          this._mesh(new THREE.TubeGeometry(curve, 60, d / 2, 8, false), M.steel, G);
        }
      }

      this._tag = 'chassis'; this._axle = null;
      // ---- battery, holders, electronics, wiring ----
      const bat = this._mesh(new THREE.BoxGeometry(138.5, 46.5, 24.5), M.battery, G);
      bat.position.set(-125.75, -34.25, top + 12.25);
      const lab = this._mesh(new THREE.PlaneGeometry(124, 40), M.batteryLabel, G);
      lab.position.set(-125.75, -34.25, top + 24.55);
      for (const x of [-53.5, -198]) {
        const hd = this._mesh(new THREE.BoxGeometry(3, 34, 18), [M.carbonSide, M.carbonSide, M.carbonSide, M.carbonSide, M.carbon, M.carbon], G);
        hd.position.set(x, -34, top + 9);
        const post = this._mesh(new THREE.CylinderGeometry(2.5, 2.5, 20, 14), M.aluLight, G);
        post.rotation.x = Math.PI / 2; post.position.set(x, -52, top + 10);
      }
      const esc = this._mesh(new THREE.BoxGeometry(33, 28, 14), M.electronics, G);
      esc.position.set(-193, 28, top + 7);
      for (let i = 0; i < 9; i++) {
        const fin = this._mesh(new THREE.BoxGeometry(1.4, 26, 6), M.heatsink, G);
        fin.position.set(-207 + i * 3.5, 28, top + 17);
      }
      const rx = this._mesh(new THREE.BoxGeometry(17, 18, 11), M.electronics, G);
      rx.position.set(-96, 22, top + 5.5);
      const ant = this._mesh(new THREE.CylinderGeometry(0.4, 0.4, 40, 6), M.wireBlack, G);
      ant.rotation.x = Math.PI / 2; ant.position.set(-91, 28, top + 31);
      const wire = (pts, r, mat) => this._mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V(p))), 24, r, 8, false), mat, G);
      wire([[-180, 22, top + 8], [-176, 10, top + 6], [-170, 2, top + 4], [-165, -14, top + 5]], 1.6, M.wireRed);
      wire([[-180, 26, top + 8], [-174, 14, top + 5], [-168, 0, top + 3.5], [-160, -14, top + 5]], 1.6, M.wireBlack);
      for (let i = 0; i < 3; i++) wire([[-177, 34 + i * 3, top + 9], [-170, 40 + i * 3, top + 14], [xLs - 42 + i * 6, 66, zLs + 12]], 1.2, [M.wireBlue, M.wireBlack, M.wireRed][i]);

      // ---- bumper, bumper mount, body posts ----
      const bump = new THREE.Shape();
      bump.moveTo(44, 70); bump.quadraticCurveTo(72, 66, 82, 30); bump.quadraticCurveTo(87, 0, 82, -30); bump.quadraticCurveTo(72, -66, 44, -70);
      bump.lineTo(44, -56); bump.quadraticCurveTo(62, -52, 68, -22); bump.quadraticCurveTo(71, 0, 68, 22); bump.quadraticCurveTo(62, 52, 44, 56); bump.closePath();
      this._mesh(plateGeom(bump, 10, 4, 1.5, 24), M.foam, G);
      const bm = new THREE.Shape();
      bm.moveTo(8, 16); bm.lineTo(46, 30); bm.lineTo(50, 30); bm.lineTo(50, -30); bm.lineTo(46, -30); bm.lineTo(8, -16); bm.closePath();
      bm.holes = [circlePath(30, 0, 4), circlePath(42, 18, 2), circlePath(42, -18, 2)];
      this._mesh(plateGeom(bm, 2.5, 8, 0.2), [M.carbon, M.carbonSide], G);
      for (const sg of [1, -1]) {
        const fp = this._mesh(new THREE.CylinderGeometry(2.4, 2.6, 50, 16), M.composite, G);
        fp.rotation.x = Math.PI / 2; fp.position.set(26, sg * 26, 10.5 + 25);
        const rp = this._mesh(new THREE.CylinderGeometry(1.8, 1.8, 58, 12), M.composite, G);
        rp.rotation.z = Math.PI / 2; rp.position.set(-WB - 39, sg * 47, 39);
        const rb = this._mesh(new THREE.BoxGeometry(10, 8, 6), M.alu, G);
        rb.position.set(-WB - 8, sg * 47, 38.5);
      }
      // ---- nickel-plated button screws on the top side ----
      const screwG = new THREE.CylinderGeometry(2.7, 2.7, 1.5, 14);
      const screwPos = [];
      for (const xa of [0, -WB]) for (const dx of [-7, 7]) screwPos.push([xa + dx, 0, 38.5 + 0.75]);
      for (const x of [-30, -60, -90, xLs - 20, -170, -200, -230]) screwPos.push([x, 0, 40.5 + 0.75]);
      for (const sp of screwPos) { const sc = this._mesh(screwG, M.screw, G); sc.rotation.x = Math.PI / 2; sc.position.set(...sp); }
    }

    _buildCorners(model) {
      for (const c of this.corners) this._dispose(c.group);
      this.corners = [];
      const M = this.M, s = model.setup;
      for (let i = 0; i < 4; i++) {
        const C = i < 2 ? model.front : model.rear, left = i % 2 === 0, A = s[C.axle];
        const g = new THREE.Group(); this.sprung.add(g);
        const c = { i, C, left, group: g };
        const S0 = C.static, H = C.Hw;
        const armU = H.armU || 0, cs = (H.cupSpan || 23) / 2, aL = H.armLen;
        const ufl = armU >= 0 ? 1 : -1;   // arms sweep toward the axle ends
        this._axle = C.axle; this._tag = 'arm';
        // ---- lower arm in its own frame (u along the pivot axis, v outward, w up) ----
        c.arm = new THREE.Group(); g.add(c.arm);
        // outline traced from the manual's top view of the lower arms (front arm; rear arms mirror u),
        // scaled to this car's hardpoints: inner cups at u = +/-cs, outer pivot at (armU, aL)
        const ku = cs / 11.5, kv = aL / 52.5, au = Math.abs(armU) / 12.5;
        const U2 = (u, v) => new THREE.Vector2(ufl * u * (u > 0 ? Math.max(ku, au) : ku), v * kv);
        const armOutline = [[15.5, -4], [15.5, 4], [15.8, 20], [17.5, 36], [18.6, 44], [17, 52], [15.6, 55.8], [12, 57.4], [8.2, 56], [6.6, 50],
          [2, 41], [-1.5, 35.5], [-4.6, 28], [-6.3, 20], [-8, 12], [-10.2, 6], [-15.5, 4], [-15.5, -4], [-8.5, -4], [-6, 2], [-2, 4.6], [3, 4.6], [6.5, 2], [8.5, -4]];
        const armShape = new THREE.Shape(armOutline.map(([u, v]) => U2(u, v)));
        if (H.rocker) {
          // window between the legs: the shock post rises through it
          armShape.holes = [new THREE.Path([[10.8, 8.5], [11, 32], [7.5, 33.6], [2.5, 33.4], [-0.8, 30], [-2.4, 24], [-3.6, 15], [-2.6, 9.5], [3.5, 7.2]].map(([u, v]) => U2(u, v)).reverse())];
        }
        const armGeom = EX(armShape, 3.5, 0.5, 8);
        armGeom.translate(0, 0, -2.2);
        this._mesh(armGeom, M.composite, c.arm);
        const cupG = EX(roundRect(-4.5, -4.2, 4.5, 4.2, 1.6), 6, 0.5, 6);
        cupG.translate(0, 0, -3.2);
        for (const du of [cs, -cs]) {   // square inner ball cups with the pivot ball inside
          const cup = this._mesh(cupG, M.composite, c.arm); cup.position.set(du, 0, 0);
          const cap = this._mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.8, 16), M.steel, c.arm); cap.rotation.x = Math.PI / 2; cap.position.set(du, 0, 3.2);
        }
        const ob = this._mesh(new THREE.CylinderGeometry(4.8, 4.8, 4.5, 24), M.composite, c.arm);
        ob.rotation.x = Math.PI / 2; ob.position.set(armU, aL, -0.2);
        const hexO = this._mesh(new THREE.CylinderGeometry(3.4, 3.4, 2.2, 6), M.titanium, c.arm);
        hexO.rotation.x = Math.PI / 2; hexO.position.set(armU, aL, -3.4);
        if (H.rocker) {
          const rb = H.rocker.ball;
          const ring = this._mesh(new THREE.CylinderGeometry(4.6, 4.6, 1.2, 24), M.alu, c.arm); ring.rotation.x = Math.PI / 2; ring.position.set(rb[0], rb[1], 1.9);
          const ps = this._mesh(new THREE.CylinderGeometry(1.4, 1.4, rb[2], 10), M.steel, c.arm); ps.rotation.x = Math.PI / 2; ps.position.set(rb[0], rb[1], rb[2] / 2);
          const pb = this._mesh(new THREE.SphereGeometry(2.15, 16, 12), M.steel, c.arm); pb.position.set(rb[0], rb[1], rb[2]);
          // droop screw (2 mm set screw through the arm, against the chassis)
          const dr = this._mesh(new THREE.CylinderGeometry(1.1, 1.1, 5.5, 6), M.screwBlack, c.arm); dr.rotation.x = Math.PI / 2; dr.position.set(ufl * 16.3 * Math.max(ku, au), rb[1], -0.6);
        }
        const ab = this._mesh(new THREE.SphereGeometry(2.4, 14, 10), M.steel, c.arm); ab.position.set(H.arbArmU || 0, H.arbArm, (H.arbArmZ || 2));
        const abs = this._mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 10), M.steel, c.arm); abs.rotation.x = Math.PI / 2; abs.position.set(H.arbArmU || 0, H.arbArm, 1.1);
        // ---- upright, steering arm, axle and wheel in the hub frame (origin = wheel centre) ----
        this._tag = 'hub';
        c.hub = new THREE.Group(); g.add(c.hub);
        const loc = (p) => mtv(S0.Rb, sub(p, S0.W));
        const lO = loc(S0.O), lB = loc(S0.B);
        const housing = this._mesh(new THREE.CylinderGeometry(8.6, 8.6, 9, 28), M.alu, c.hub); housing.position.set(0, -8.5, 0);
        c.hub.add(beam([lO[0], lO[1] + 2, lO[2] + 3], [0, -8, -5], 7, 5, M.alu, [1, 0, 0]));
        c.hub.add(beam([0, -8, 5], [lB[0], lB[1] + 1, lB[2] - 3], 6, 4.5, M.alu, [1, 0, 0]));
        for (const p of [lO, lB]) {
          const boss = this._mesh(new THREE.CylinderGeometry(4.2, 4.2, 5, 18), M.alu, c.hub); boss.position.set(p[0], p[1], p[2]);
          const bl = this._mesh(new THREE.SphereGeometry(2.45, 16, 12), M.steel, c.hub); bl.position.set(p[0], p[1], p[2]);
        }
        c.hub.children.forEach((o) => { if (o.isMesh) { o.castShadow = true; o.userData.realMat = o.material; o.userData.tag = 'hub'; o.userData.axle = C.axle; } });
        if (S0.ball) {
          const lS = loc(S0.ball);
          this._tag = 'steer';
          const armShape2 = stadium([0, -6], 6, [lS[0], lS[1]], 4.2);
          const armPlate = EX(armShape2, 2.5, 0.2, 10);
          armPlate.translate(0, 0, lS[2] - 4.2);
          this._mesh(armPlate, [M.carbon, M.carbonSide], c.hub);
          const sb = this._mesh(new THREE.SphereGeometry(2.15, 16, 12), M.steel, c.hub); sb.position.set(...lS);
        }
        this._tag = 'wheel';
        const axle = this._mesh(new THREE.CylinderGeometry(2.5, 2.5, 21, 14), M.steel, c.hub); axle.position.set(0, 1.5, 0);
        const hex = this._mesh(new THREE.CylinderGeometry(6.4, 6.4, 4, 6), M.screwBlack, c.hub); hex.position.set(0, 4.4, 0);
        const nut = this._mesh(new THREE.CylinderGeometry(4.4, 4.4, 3.4, 12), M.orange, c.hub); nut.position.set(0, 10.4, 0);
        // wheel (white dish) and rubber tyre, lathed about the spin axis (local y)
        const R = model.setup.car.tireDia / 2, W = model.setup.car.tireWidth, rr = 26.2;
        const tp = [[rr, -W / 2], [R - 3.5, -W / 2], [R - 0.8, -W / 2 + 1.2], [R, -W / 2 + 4], [R, W / 2 - 4], [R - 0.8, W / 2 - 1.2], [R - 3.5, W / 2], [rr, W / 2]].map(([r, y]) => new THREE.Vector2(r, y));
        this._mesh(new THREE.LatheGeometry(tp, 56), M.rubber, c.hub);
        const rp = [[rr + 0.3, -W / 2 - 0.6], [rr - 1.2, -W / 2 - 0.6], [rr - 1.4, W / 2 - 1.5], [rr + 0.3, W / 2 + 0.6]].map(([r, y]) => new THREE.Vector2(r, y));
        this._mesh(new THREE.LatheGeometry(rp, 48), M.wheel, c.hub);
        const face = new THREE.Shape(); face.absarc(0, 0, rr - 1.2, 0, Math.PI * 2, false);
        const fh = [circlePath(0, 0, 3)];
        for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; fh.push(circlePath(Math.cos(a) * 15.5, Math.sin(a) * 15.5, 6.2)); }
        face.holes = fh;
        const fg = EX(face, 2.2, 0.4, 24);
        fg.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 6.5, 0, -1, 0, 0, 0, 0, 0, 1));
        this._mesh(fg, M.wheel, c.hub);
        // ---- links (stretched between points every frame) ----
        this._tag = 'upper';
        c.upper = new THREE.Group(); g.add(c.upper);
        c.upperLen = len(sub(S0.B, C.U));
        {
          const L = c.upperLen, bulge = 5;
          const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(L / 2, bulge, 0), new THREE.Vector3(L, 0, 0));
          const sec = roundRect(-1.8, -3, 1.8, 3, 1.2);
          const ug = new THREE.ExtrudeGeometry(sec, { steps: 24, bevelEnabled: false, extrudePath: curve });
          this._mesh(ug, M.alu, c.upper);
          for (const x of [0, L]) { const cupm = this._mesh(new THREE.CylinderGeometry(4, 4, 6, 18), M.alu, c.upper); cupm.position.set(x, 0, 0); cupm.rotation.x = Math.PI / 2; }
          const adj = this._mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 6), M.titanium, c.upper); adj.position.set(L - 7, 0, 3.4);
          const stop = this._mesh(new THREE.CylinderGeometry(1.25, 1.25, 14, 8), M.screw, c.upper); stop.position.set(L - 11, 0, 9);
          stop.rotation.x = Math.PI / 2;
        }
        const link = (r, mat) => this._mesh(unitCyl(r, 10), mat, g);
        this._tag = 'drive';
        c.drive = link(1.7, M.steel);
        c.driveCupIn = this._mesh(new THREE.SphereGeometry(4.2, 14, 10), M.steel, g);
        if (H.rocker) {
          this._tag = 'push';
          c.push = link(1.3, M.steel);
          c.pushCup = this._mesh(new THREE.SphereGeometry(3, 12, 10), M.pom, g);
          // rocker in its pivot frame (axis along x); holes along the pushrod arm
          const rk = H.rocker, hd = norm(rk.holeDir), hs = rk.holes, sa = rk.shockArm;
          const tip = mul(hd, hs.high + 2.5);
          const rs = new THREE.Shape();
          const o2 = [[0, 0], [tip[1], tip[2]], [sa[1], sa[2]]];
          const hull = (pts, r) => { const sh = new THREE.Shape(); const steps = 40; const ang = []; for (const p of pts) for (let k = 0; k < steps; k++) { const a = k / steps * Math.PI * 2; ang.push([p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]); } ang.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const lo = [], up = []; const crs = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); for (const p of ang) { while (lo.length >= 2 && crs(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let k = ang.length - 1; k >= 0; k--) { const p = ang[k]; while (up.length >= 2 && crs(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } const hp = lo.slice(0, -1).concat(up.slice(0, -1)); hp.forEach((p, k) => { if (k === 0) sh.moveTo(p[0], p[1]); else sh.lineTo(p[0], p[1]); }); sh.closePath(); return sh; };
          const rshape = hull(o2, 4);
          rshape.holes = [circlePath(0, 0, 1.5)].concat(['low', 'mid', 'high'].map((h) => circlePath(hd[1] * hs[h], hd[2] * hs[h], 1.05)));
          void rs;
          this._tag = 'rocker';
          c.rocker = new THREE.Group(); g.add(c.rocker);
          this._mesh(frontGeom(rshape, 3, -1.5, 0.3, 10), M.aluLight, c.rocker);
          this._tag = 'shock';
          c.shockBody = this._mesh(new THREE.CylinderGeometry(3.9, 3.9, 1, 24), M.alu, g);
          c.shockCap = this._mesh(new THREE.CylinderGeometry(4.4, 4.4, 1, 24), M.orange, g);
          c.shockShaft = link(1.2, M.steel);
          c.spring = this._mesh(helixGeometry(4.3, 0.5, 5, 160), M.spring, g);
          c.collar = this._mesh(new THREE.CylinderGeometry(4.9, 4.9, 1, 24), M.orange, g);
          c.eye = this._mesh(new THREE.SphereGeometry(2.4, 12, 10), M.pom, g);
          c.eyePin = link(1.2, M.steel);
        } else {
          this._tag = 'shock';
          c.strut = link(4.5, M.alu);
        }
        if (S0.ball) {
          this._tag = 'steer';
          c.rod = link(1.6, M.titanium);
          c.rodCups = [0, 1].map(() => this._mesh(new THREE.CylinderGeometry(3.1, 3.1, 7, 14), M.pom, g));
        }
        this._tag = 'arb';
        c.arbLink = link(1.1, M.titanium);
        this.corners.push(c);
      }
      this._tag = 'steer'; this._axle = 'front';
      // steering rack plate and bellcranks (moved every frame)
      this._dispose(this.rackGroup);
      this.rackGroup = new THREE.Group(); this.sprung.add(this.rackGroup);
      this.rackPlate = this._mesh(new THREE.BoxGeometry(1, 1, 1), M.aluLight, this.rackGroup);
      this.bellcranks = [0, 1].map(() => this._mesh(new THREE.BoxGeometry(1, 1, 1), M.alu, this.rackGroup));
      this.rackBalls = [0, 1].map(() => this._mesh(new THREE.SphereGeometry(2.15, 14, 10), M.steel, this.rackGroup));
      this.servoHorn = this._mesh(new THREE.BoxGeometry(1, 1, 1), M.orange, this.rackGroup);
      this.servoLink = this._mesh(unitCyl(1.2, 10), M.titanium, this.rackGroup);
      this._tag = null; this._axle = null;
      if (this.style === 'blueprint') this.sprung.traverse((o) => { if (o.isMesh) this._blueprintify(o); });
      this._fit(model);
    }
    _fit(model) {
      const WB = model.wheelbase;
      this._fitTarget = [-WB / 2 + 19, 0, 28];
      if (!this._fitted) { this._fitted = true; this.model = model; this.setView(this.view.yaw, this.view.elev, false); }
    }

    _pose(model, cond) {
      const res = cond.res, E = cond.E || 1, WB = model.wheelbase, s = model.setup;
      const hF = s.front.rideHeight, hR = s.rear.rideHeight;
      // chassis pose: roll about x, pitch about y, heave; static rake from the two ride heights
      const phi = E * res.roll * DEG, th = E * res.pitch * DEG + Math.atan((hF - hR) / WB);
      const z0 = hF + E * (res.heave + res.pitch * DEG * model.a);
      const m = new THREE.Matrix4().makeRotationY(-th).premultiply(new THREE.Matrix4().makeRotationX(0));
      const mr = new THREE.Matrix4().makeRotationX(phi);
      const mt = new THREE.Matrix4().makeTranslation(0, 0, z0);
      this.sprung.matrix.copy(mt.multiply(mr.multiply(m)));
      this.sprung.matrixWorldNeedsUpdate = true;
      // corners
      const p = cond.p || 0;
      for (const c of this.corners) {
        const C = c.i < 2 ? model.front : model.rear, left = c.left;   // this model's solver, not the one the meshes were built from
        const pSide = C.isF ? (left ? p : -p) : 0;
        const travel = Math.max(C.table.sLo, Math.min(C.table.sHi + 6, (res.corners[c.i].travel || 0) * E));
        const thA = C.thetaForTravel(Math.min(travel, C.table.sHi), pSide);
        const st = (isFinite(thA) && C.state(thA, pSide)) || C.static;
        const mm = left ? (q) => q : mir;
        setFrame(c.arm, st.armM, C.Pin, !left);
        setFrame(c.hub, st.Rb, st.W, !left);
        // upper arm: local x from inner ball to hub ball, bulging toward the car centre
        const U = mm(C.U), B = mm(st.B);
        const X = norm(sub(B, U));
        // bow toward the middle of the car (rearward at the front, forward at the rear)
        let Y = cross([0, 0, 1], X); if (dot(Y, [C.isF ? -1 : 1, 0, 0]) < 0) Y = mul(Y, -1); Y = norm(Y);
        const Z = cross(X, Y);
        const sc = len(sub(B, U)) / c.upperLen;
        c.upper.matrixAutoUpdate = false;
        c.upper.matrix.set(X[0] * sc, Y[0], Z[0], U[0], X[1] * sc, Y[1], Z[1], U[1], X[2] * sc, Y[2], Z[2], U[2], 0, 0, 0, 1);
        // driveshaft from the diff outdrive to the wheel centre
        const dc = this.diffCentre[C.axle], od = [dc[0], left ? 19 : -19, dc[2]], W = mm(st.W);
        placeBetween(c.drive, od, add(W, mul(mm(st.s), -6)));
        c.driveCupIn.position.set(...od);
        if (st.rocker) {
          const rk = st.rocker;
          placeBetween(c.push, mm(rk.ball), mm(rk.push));
          c.pushCup.position.set(...mm(rk.ball));
          setFrame(c.rocker, rk.Rr, rk.pivot, !left);
          // laid-down shock: body pinned on the 2112 post, shaft to the rocker's lower eye
          const xs = this._shockX(C), eyeR = mm(rk.shock);
          const top = mm([xs, C.shockTop[1], C.shockTop[2]]), eye = [xs, eyeR[1], eyeR[2]];
          const d = norm(sub(eye, top)), Ls = len(sub(eye, top));
          const bodyLen = Math.min(15, Ls * 0.5);
          const bodyEnd = add(top, mul(d, bodyLen));
          placeBetween(c.shockBody, add(top, mul(d, 1)), bodyEnd);
          placeBetween(c.shockCap, add(top, mul(d, -1.5)), add(top, mul(d, 2)));
          placeBetween(c.shockShaft, bodyEnd, eye);
          const collarAt = add(top, mul(d, bodyLen * 0.6));
          placeBetween(c.collar, collarAt, add(collarAt, mul(d, 1.6)));
          placeBetween(c.spring, add(collarAt, mul(d, 1.6)), add(eye, mul(d, -2.4)));
          c.eye.position.set(...eye);
          placeBetween(c.eyePin, eyeR, eye);
        } else if (c.strut) {
          placeBetween(c.strut, mm(st.shockLow), mm(C.shockTop));
        }
        if (c.rod && st.ball) {
          const a = mm(st.ball), b = mm(C.plateBall(pSide));
          placeBetween(c.rod, a, b);
          const dd = norm(sub(b, a));
          placeBetween(c.rodCups[0], a, add(a, mul(dd, 6)));
          placeBetween(c.rodCups[1], add(b, mul(dd, -6)), b);
        }
        // anti-roll bar link: bar end above the arm ball down to the ball
        const ar = this.arb && this.arb[C.axle];
        if (ar) {
          const ballW = mm(st.arbPt);
          placeBetween(c.arbLink, [ballW[0], ballW[1], ar.zb], ballW);
        }
      }
      for (const um of this.uMounts || []) {
        const U0 = (um.axle === 'front' ? model.front : model.rear).U, U = um.sg > 0 ? U0 : mir(U0);
        um.ins.position.set(U[0], U[1], 39.2);
        placeBetween(um.stud, [U[0], U[1], 38.5], U);
        um.ball.position.set(U[0], U[1], U[2]);
      }
      // steering rack: plate rides on the bellcranks
      const F = model.front;
      if (!F.steered || !F.Hw.bellcrank) return;
      const pb0 = F.plateBall(0), pbL = F.plateBall(p), pbR = mir(F.plateBall(-p));
      this.rackPost.forEach((post, k) => placeBetween(post, [pb0[0] + F.Hw.bellcrank, k ? -13 : 13, this.plateT], [pb0[0] + F.Hw.bellcrank, k ? -13 : 13, pb0[2] - 2]));
      const mid = mul(add(pbL, pbR), 0.5);
      this.rackPlate.position.set(mid[0], mid[1], mid[2] - 2.5);
      this.rackPlate.scale.set(8, Math.abs(pbL[1] - pbR[1]) + 6, 3);
      this.rackBalls[0].position.set(...pbL); this.rackBalls[1].position.set(...pbR);
      [1, -1].forEach((sg, k) => {
        const post = [pb0[0] + F.Hw.bellcrank, sg * 13, mid[2] - 2.5];
        const end = [pbL[0], sg * 13 + (pbL[1] - pb0[1]), mid[2] - 2.5];
        placeBetween(this.bellcranks[k], post, end);
        this.bellcranks[k].scale.x = 6; this.bellcranks[k].scale.z = 2.5;
      });
      const hornC = [-74, 20, this.plateT + 21];
      const ang = (pbL[1] - pb0[1]) / 9;
      const hornTip = [hornC[0] + 10 * Math.cos(ang), hornC[1] + 10 * Math.sin(ang) - 2, hornC[2]];
      placeBetween(this.servoHorn, hornC, hornTip); this.servoHorn.scale.x = 4; this.servoHorn.scale.z = 2;
      placeBetween(this.servoLink, hornTip, [mid[0] - 2, mid[1], mid[2] - 1]);
    }

    // ---------------------------------------------------------------
    // highlight the parts a setting moves, and live numbers over the wheels
    // ---------------------------------------------------------------
    /** Make the parts with these tags glow for a moment (axle: 'front' | 'rear' | null for both). */
    flash(tags, axle) {
      if (!tags || !tags.length) return;
      this._hl = { tags: new Set(tags), axle: axle || null };
      this._applyHighlight();
      clearTimeout(this._hlT);
      this._hlT = setTimeout(() => { this._hl = null; this._applyHighlight(); }, 1500);
    }
    _hlMaterial(base) {
      if (Array.isArray(base)) return base.map((b) => this._hlMaterial(b));
      this._hlCache = this._hlCache || new Map();
      let h = this._hlCache.get(base);
      if (!h) {
        if (base.isMeshBasicMaterial) h = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.42, depthWrite: false });
        else { h = base.clone(); h.emissive = new THREE.Color(0xff6a10); h.emissiveIntensity = 0.75; }
        this._hlCache.set(base, h);
      }
      return h;
    }
    _applyHighlight() {
      const hl = this._hl, bp = this.style === 'blueprint';
      if (!this.BP.lineHi) this.BP.lineHi = new THREE.LineBasicMaterial({ color: 0xffb070 });
      this.car.traverse((o) => {
        if (!o.isMesh) return;
        const u = o.userData;
        const on = !!(hl && u.tag && hl.tags.has(u.tag) && (!hl.axle || !u.axle || u.axle === hl.axle));
        const base = bp ? this.BP.fill : (u.realMat || o.material);
        o.material = on ? this._hlMaterial(base) : base;
        if (u.edges) u.edges.material = on ? this.BP.lineHi : this.BP.line;
      });
      this.dirty = true;
    }
    /** Text over each wheel (FL, FR, RL, RR); null hides them. */
    setLabels(texts) {
      this.labels = texts || null;
      if (this.labelBox) this.labelBox.hidden = !this.labels;
      this.dirty = true;
    }
    _placeLabels() {
      const box = this.labelBox;
      if (!box || !this.labels || !this.corners.length) return;
      if (box.children.length !== 4) { box.innerHTML = ''; for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'gl-label'; box.appendChild(d); } }
      const R = this.model ? this.model.setup.car.tireDia / 2 : 32, v = new THREE.Vector3();
      this.corners.forEach((c, i) => {
        const el = box.children[i], t = this.labels[i];
        if (t && el.textContent !== t) el.textContent = t;
        v.setFromMatrixPosition(c.hub.matrixWorld);
        v.y += R + 7;
        v.project(this.camera);
        const vis = t && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.style.display = vis ? '' : 'none';
        if (!vis) return;
        el.style.left = ((v.x + 1) / 2 * this._w).toFixed(1) + 'px';
        el.style.top = ((1 - v.y) / 2 * this._h).toFixed(1) + 'px';
      });
    }

    // ---------------------------------------------------------------
    // blueprint style
    // ---------------------------------------------------------------
    _blueprintify(m) {
      if (!m.userData.realMat) m.userData.realMat = m.material;
      m.material = this.BP.fill;
      if (!m.userData.edges) {
        const eg = new THREE.EdgesGeometry(m.geometry, 28);
        const ls = new THREE.LineSegments(eg, this.BP.line);
        ls.raycast = () => {};
        m.add(ls);
        m.userData.edges = ls;
      }
      m.userData.edges.visible = true;
      m.castShadow = false;
    }
    setStyle(style) {
      if (style === this.style) return;
      this.style = style;
      const bp = style === 'blueprint';
      this.scene.background = new THREE.Color(bp ? 0x0b2742 : 0x1b1d20);
      this.scene.environment = bp ? null : this.envMap;
      this.board.material = bp ? this.BP.board : this.M.board;
      this.key.castShadow = !bp;
      this.car.traverse((o) => {
        if (!o.isMesh) return;
        if (bp) this._blueprintify(o);
        else { o.material = o.userData.realMat || o.material; if (o.userData.edges) o.userData.edges.visible = false; o.castShadow = true; }
      });
      if (this.labelBox) this.labelBox.classList.toggle('bp', bp);
      if (this._hl) this._applyHighlight();
      this.dirty = true;
    }
  }

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(root.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }
  let instance = null;
  root.TCModel3D = {
    supported,
    get() { if (!instance && supported()) { try { instance = new Viewer(); } catch (e) { instance = null; } } return instance; },
  };
})(typeof self !== 'undefined' ? self : this);
