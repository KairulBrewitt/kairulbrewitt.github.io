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
−/+ steps (hold to repeat) and tap-to-type values. The drawing stays pinned
while you adjust and can switch to a live 3D car you can rotate.

## Physics model

- **Corner kinematics (3D, exact):** lower arm on an inner hinge pin with a
  parallel outer pin; the hub rotates on the outer pin; a fixed-length camber
  link closes the loop; at the front a steering block turns on a kingpin in the
  C-hub, driven by a steering link from a plate that rides on twin bellcranks.
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

Part dimensions are typical of a 190 mm touring car, not a specific kit. They
live in `HW` at the top of `web/js/physics.js`.

## Layout

```
web/            the app (plain HTML/CSS/JS, no build step, works offline)
  js/physics.js   geometry + vehicle solver (also runs in Node)
  js/draw.js      true-scale 2D drawings and charts
  js/draw3d.js    live 3D car
  js/app.js       UI
tests/          physics tests (node --test)
android/        native Android shell that ships web/ inside the APK
```

## Run it

- Browser: open `web/index.html`.
- Tests: `node --test tc-setup-lab/tests/*.test.js` (18 tests, including
  analytic checks and a 250-setup fuzz).
- Android: open `android/` in Android Studio, or
  `cd tc-setup-lab/android && ./gradlew assembleDebug` with the Android SDK
  installed. The APK lands in `app/build/outputs/apk/debug/`.
- CI: copy `ci/tc-setup-lab.yml` to `.github/workflows/` to have GitHub Actions
  run the tests and build the APK (downloadable from the run) on every change.

The Android app is a single `WebView` activity that serves `web/` from the APK
with `WebViewAssetLoader`; it needs no network permission. Release builds need
your own signing config before going to Play.
