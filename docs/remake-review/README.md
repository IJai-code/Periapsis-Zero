# Product remake review

## Delivered

- Replaced the long marketing landing page with Flight Operations: a pilot record, career briefing, flight school, and surface exploration.
- Added five actionable historical training scenarios tied to the existing simulator licence records and career bonuses. Career saves before entering school, and the simulator has explicit School and Career navigation.
- Redesigned the station interface around an explicit next-flight card and flight-check launch action. Redesigned the flight HUD around a side-mounted current instruction, ten-check progress, readable instruments, and a clear central steering area.
- Captioned film and all game/squadron audio now use only `monume-space-ambient.mp3`, the simulator's supplied background track. Synthetic engines, weapons, alarms and voices produce no audio. Music stops on leaving game modes and does not layer over simulator ambience.
- Sky graphics repair: corrected camera/sky frame ordering; softened real cloud-mask coverage instead of replacing it with synthetic white islands; corrected reversed smoothsteps, normalized interpolated sky directions, removed undefined signed-latitude `pow`, and replaced the Milky Way's log-depth path with a fixed far clip-space background drawn before opaque bodies.

## Reproduced fault

Moving Chrome/Metal captures showed large violet/blue polygons outside Earth's limb. Disabling atmosphere and clouds did not eliminate them; disabling the Milky Way material did. Polynomial noise and signed-math fixes alone did **not** eliminate the artifact. Removing logarithmic-depth interpolation from the far background eliminated it in the reviewed moving captures. The background remains present and local bodies still occlude it through draw ordering.

## Review evidence

- [Desktop operations hub](hub-desktop.png)
- [Phone hub](hub-mobile.png)
- [Desktop school](school-desktop.png)
- [Phone school](school-mobile.png)
- [Simulator training scenario](simulator-training.png)
- [Station](station-desktop.png)
- [Flight instruction layout](flight-desktop.png)
- [Checkpoint guidance](flight-checkpoint.png)
- [Earth shot after repair](earth-after.png)
- [Convoy shot](convoy-after.png)
- [Browser results](browser-results.json)
- [High/Fast tier and music checks](tiers-audio.json)

The browser journey uses actual click/key events: new career, suit, captioned prologue, pause/resume, briefing, boarding, launch, thrust, braking, next checkpoint, school and return to the saved career. It also opens the Orbital training deep link. Phone checks emulate touch and 390px device metrics rather than just resizing a desktop viewport.

## Verification and boundaries

`npm run build`, the complete `verify:all` suite, `npm run smoke` on an unused port, and `node scripts/check-remake.mjs` are the verification commands. Logs alongside this report contain their exit statuses. There is no configured typecheck; the repository uses JavaScript/JSX and its correctness lint gate.

Frame measurements are headless Chrome/Metal on the local machine, not representative user-hardware performance guarantees. No claimed speedup. Reviewed Earth frames had median intervals around 16.7ms; simultaneous suite execution raised tail frame intervals in one run.

This change does not replace authored ship assets, invent seamless planetary travel, or merge the historical simulator and fictional torch-drive game into one physics model. It makes their existing shared career progression visible and navigable. Existing dirty Blender sources and narration-generation leftovers are not part of this delivery.
