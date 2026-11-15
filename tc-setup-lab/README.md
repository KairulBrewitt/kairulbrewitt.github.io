# TC Setup Lab

An interactive suspension-geometry tool for 1/10 electric touring cars, built as
a proof of concept for an Android app. Every number and drawing comes from a
3D kinematic model of the car, so changing one part (a camber-link hole, a
shim, a ball-stud spacer) changes everything it really affects.

## What it covers

| Topic | You adjust | You see |
|---|---|---|
| Camber & roll centre | static camber, ride height, camber-link inner height/position, hub spacer, inner pin height | instant centre and roll-centre construction, camber gain, RC migration, link length, outside-tyre camber in a 1.5 g corner |
| Caster | C-hub caster, kick-up, KPI, lock | total caster, trail, scrub radius, camber on lock, diagonal load jacking |
| Ackermann | lock, Ackermann ball, plate ball, steering-arm length | inside/outside angles vs ideal, Ackermann %, turning circle, linkage top view |
| Toe & bump steer | front toe, rear toe blocks, ball spacers | toe vs travel for both axles, steering link against the IC lines |
| Anti-squat | rear pin angle, front kick-up, CG height, front diff | anti-squat/anti-dive %, pitch, squat, chassis clearance |
| Droop & roll | droop, ride height | roll, wheel loads, front LLTD, lift-off g, camber to the track |
| Springs & bars | spring, shock positions, bar wire | motion ratio, wheel rate, ride frequency, roll-stiffness split |
| Car | weight, balance, CG, wheelbase, tyres, spacers | corner weights, track, 190 mm width check |

Adjust with sliders, a thumbwheel (roll it like a turnbuckle) or a dial, plus
−/+ steps (hold to repeat) and tap-to-type values. The live view stays pinned
while you adjust.

## The 3D car

The live view is a realistic WebGL model of the SP2 (three.js, bundled, works
offline), built from RC Maker's manual drawings, which are to scale, and from
photos of the kit for colours and finish.

How the drawings are used:

- **Orthographic views** (bottom and top of the car, side view of a bulkhead,
  top view of the upper arm) are scaled from known dimensions (wheelbase,
  pulley flange, tower spacing) and traced: the chassis plate outline and all
  66 holes, the top deck, the bulkhead outline, the lower arm, the upper arm.
- **Perspective figures** are matched by fitting each figure's camera to the
  exact chassis plate; the model is then rendered through that camera and
  overlaid on the drawing, and part outlines (motor mount) and heights (top
  deck, layshaft) are back-projected through it.

What is modelled from them:

- Chassis plate with countersunk screws; 9.8 mm top-deck spine with S-curved
  forks to the bulkheads; bulkheads with rear ear, towers, nose, claw, toothed
  diff-height eccentric and insert; motor mount; layshaft over the plate's
  spur windows with the spur on the right; 38 T pulleys and belts.
- Carbon lower arms with ball-cup pucks; triangular upper wishbones on the
  bulkhead towers with the threaded camber adjuster to a tall upper ball cup
  carrying the up-stop screw; uprights with bearing housing and universal
  joint; bronze dog-bone rockers on the bulkhead noses; pushrods; coaxial
  shocks to the 2112 posts; low anti-roll bars in hook holders; steering rack
  (slotted bellcrank arms, translating bar); servo on the floating mount; rear
  toe links.
- Oval foam bumper with carbon brace and body posts; rear body bars; battery
  holders. Black anodised aluminium and carbon with bronze accents.

Every suspension part is placed from the solver: each corner's arm, hub, upper
arm, steering or toe link, pushrod, rocker, shock and bar link come from that
corner's 3D state, and the chassis sits on the heave, roll and pitch from the
whole-car solve. Change a setting and the parts it moves glow for a moment;
live numbers (camber, toe, steering angle, motion ratio or corner weight) float
over the wheels.

- Drag to orbit, pinch or scroll to zoom, two fingers to pan, double-tap to
  reset; 3/4, front, side, rear and top presets.
- **Blueprint**: translucent parts with every edge drawn, like a 3D technical
  drawing.
- **Expand**: full-screen car, with the travel / steering / g slider still
  under it.
- Chassis plate (carbon, aluminium, spring steel) and rocker hole are settings.
- Where WebGL is unavailable the app falls back to the SVG car.

Not from factory CAD: the manual's drawings are about 2-6 px per mm, so
outlines are accurate to roughly half a millimetre on large parts. Where a
drawing and the photos disagree with a physical constraint (the deck must clear
the layshaft belt), the constraint wins. Electronics, wheels and tyres are
generic, as they are not part of the kit.

## Cars

The app opens on an **RC Maker SP2** in kit trim. A generic C-hub touring car
is also available on the Car tab. Switching car loads that car's kit setup, and
you can undo the switch.

SP2 values are tagged in the app:

- **KIT**: published by RC Maker in the SP2 manual or on the product pages:
  caster 4° front / −2.5° rear (upper bulkhead inserts), arm-mount shims
  1.0 mm front / 1.5 mm rear, 1 mm shims under the upper hub balls, 0.5 mm
  shims under the steering-arm, toe-link and rack balls, 1.1 mm anti-roll
  bars, 4.0 mm wheel hexes, front spool and rear gear diff, a steering lock
  of about 27° inside / 17° outside, pushrods in the lowest rocker hole, and a
  2.2 mm carbon chassis (1.5 mm aluminium and 1.2 mm spring-steel options).
- **CAL**: not published, solved so the model reproduces a published kit
  number. The steering-arm ball offset is set so the kit lock gives 27°/17°.
- **SP1**: the 257 mm wheelbase is the SP1 figure; RC Maker doesn't list it for
  the SP2.
- **EST**: not published, typical values (ride height, camber, toe, CG,
  weight split, spring rates, link pivot positions). The rest of the hidden
  geometry is shaped to the SP2's layout and tuned to plausible behaviour:
  190 mm width, roll centres above ground, near-zero front bump steer with the
  kit spacers, slight rear toe-in in bump.

Kit data the model doesn't use (shock oils 350/400 cSt, 4.5/4.25-coil XS
springs, droop 23.6/22.6 mm and up-stop 23 mm on an axle gauge, upper arms
≈57.5/56 mm, link gaps) is listed on the setup sheet. Part positions live in
`HW_SP2` and the kit setup in `CARS.sp2` in `web/js/physics.js`; measured
values from a real car can replace the estimates there.

## Physics model

- **Corner kinematics (3D, exact):** lower arm on an inner hinge pin; the hub
  rotates about the arm's outer pivot; a fixed-length upper link (camber link
  or SP2 upper arm) closes the loop; the hub turns on a kingpin, driven by a
  steering link from a rack/plate on twin bellcranks at the front and, on the
  SP2, by a fixed toe link at the rear. On the SP2 the kingpin is the line
  through the two hub balls and caster is measured on the chassis. SP2 shocks
  are driven by a fixed-length pushrod from the lower arm to a rocker on the
  bulkhead; the rocker angle is solved in closed form, so the motion ratio
  follows the chosen rocker hole (lowest = stiffest, as in the manual).
  Each constraint is solved in closed form (rotation about a known axis).
- **Static setup like on the setup board:** for every geometry change the
  solver finds the arm angle for the ride height and the turnbuckle lengths for
  the requested camber and toe.
- **Derived values** come from velocities of hub-fixed points: front-view
  instant centre and roll centre, camber gain, bump steer, track change,
  side-view anti geometry (inboard drive and brakes, so the force acts at the
  wheel centre), shock and bar motion ratios, caster, trail, scrub radius,
  Ackermann.
- **Whole car (quasi-static):** chassis heave, roll and pitch are solved so the
  wheel loads balance weight, cornering and acceleration. Each corner is a tyre
  spring in series with the suspension (spring through the motion-ratio table,
  anti-roll bar, droop stop), plus link jacking from lateral and drive/brake
  forces. Each axle's lateral force follows the CG position and is shared
  between its tyres by load.
- Not modelled: dampers, tyre slip and other dynamics, body aero, compliance.

Part dimensions for each car live in `HW_SP2` and `HW_GENERIC` in
`web/js/physics.js`.

## Layout

```
web/            the app (plain HTML/CSS/JS, no build step, works offline)
  js/physics.js   geometry + vehicle solver (also runs in Node)
  js/draw.js      true-scale 2D drawings and charts
  js/model3d.js   realistic WebGL SP2, posed by the solver
  js/draw3d.js    SVG 3D car (fallback without WebGL)
  js/app.js       UI
  vendor/         three.js r158 (MIT)
tests/          physics tests (node --test)
android/        native Android shell that ships web/ inside the APK
```

## Run it

- Browser: open `web/index.html`.
- Tests: `node --test tc-setup-lab/tests/*.test.js` (23 tests, including
  analytic checks, SP2 kit and rocker checks and a 250-setup fuzz over both
  cars).
- Android: open `android/` in Android Studio, or
  `cd tc-setup-lab/android && ./gradlew assembleDebug` with the Android SDK
  installed. The APK lands in `app/build/outputs/apk/debug/`.
- CI: copy `ci/tc-setup-lab.yml` to `.github/workflows/` to have GitHub Actions
  run the tests and build the APK (downloadable from the run) on every change.

The Android app is a single `WebView` activity that serves `web/` from the APK
with `WebViewAssetLoader`; it needs no network permission. Release builds need
your own signing config before going to Play.
