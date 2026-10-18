# Periapsis Zero: the Reach

The game from 16 October 2026: Periapsis Zero's people, ships and crime story,
inside an Outer Wilds-style mystery. A tiny hand-made solar system you can fly
across in a minute and walk around in five. Real orbits. A 22-minute loop that
ends when the star collapses. Knowledge is the only thing you keep.

## The premise

3091. The convoy freighter Aster took a secret route through the Reach, a
pocket system round a dying star called the Lantern, reached through the
Fold. The Hollow were waiting. The Aster went down on Ashfall; your Kestrel
crash-landed on Hearthstone, where a small mining village (Hearth) pulled you
out and patched her.

Every 22 minutes the Lantern collapses into a point the old charts call
**Periapsis Zero**, everything falls into it, and you wake at Hearth's
campfire, the morning you first woke there. Only you remember. Your ship's
log keeps what you learn.

Why you loop, who sold the route, what the Aster was really carrying and
what the Choir (the people who were here before) built: the player finds out
by going places and reading, listening and looking. Nothing else carries
from loop to loop.

## The people

- **You, "Kestrel".** First person throughout: a suit (oxygen, jetpack
  fuel, health), a flashlight, a signalscope, a translator for Choir text.
- **Mara Voss.** Hearth's launch master and the Reach's oldest settler.
  Plays the banjo at the campfire. Hale's oldest friend.
- **Okafor.** Keeps the observatory. Reads a little Choir; gave you the
  translator. Plays the flute at the Lookout on Hearthstone's rim.
- **Renn Ayers.** The Aster's engineer. Sold the route to Rook for her
  brother's debt; launched a pod before the attack. Hiding on Verdance.
  Plays the harmonica.
- **Vex.** A salvager working the Aster wreck on Ashfall. Hand drums.
- **Captain Elias Hale.** Dead with the Aster. His bridge recorder still
  pings on Ashfall.
- **Rook.** Never seen: a voice on the Hollow's channel. Paid for the route
  because the Aster's "vaccine" crates held a Choir core.
- **The Choir.** Gone thousands of years. Their writing is spiral
  songlines. They built the Engine.

## The Reach

All bodies orbit the Lantern on Kepler rails (no moons, so frames stay
simple). Each body pulls only within its sphere of influence; outside, the
Lantern pulls (patched conics). The world is drawn in the frame of the body
you are in, that body fixed at the origin; planets do not spin, so a day
lasts one orbit.

| Body | Radius | Orbit | Period | What it is |
|---|---|---|---|---|
| The Lantern | 600 m | | | The star. Collapses at 22:00. |
| The Phantom | 70 m | 2,900 m | 6 min | A quantum moonlet: moves when unobserved. |
| Hearthstone | 280 m | 4,600 m | 12 min | Home: pines, a lake, Hearth village. |
| Ashfall | 170 m | 7,300 m | 23 min | Grey and cratered; the Aster wreck. |
| Verdance | 440 m | 10,800 m | 42 min | Jungle, pillars, waterfalls, floating rock. |
| The Wanderer | 90 m | 1,150 to 13,500 m | 23 min | A comet; the Engine. Grazes the Lantern at 20:30. |

## The loop

- 0:00 wake at the campfire (eyes open, the fire, Mara's banjo).
- The Lantern brightens and reddens through the loop; from 20:00 it
  flickers; at 21:00 its music starts.
- 22:00 the Lantern collapses: gravity toward it spikes, everything is
  pulled in, white-blue flash, wake.
- Dying (impact, suffocation, the Hollow drones) also ends the loop.

## The mystery (ship log)

Facts are grouped by place and linked as rumours. Each loop the player can
follow a different thread.

- **Hearth.** The loop itself; Mara and the launch codes; Okafor: the
  Lantern is dying, the Choir left songlines everywhere; the village cave's
  songline: "the Engine sleeps on the wanderer".
- **Verdance.** Renn's camp: she sold the route; the Aster's cargo was not
  vaccine. The Choir's pillar city: the Engine repeats the last 22 minutes
  until it is given a core.
- **Ashfall.** Hale's recorder (distress frequency): the crates held a
  Choir core found on the Moon. Vex: the Hollow drones are Rook's. The vault
  code is in Hale's log; the core is in the vault.
- **The Phantom.** Moves when not observed; a photograph holds it. Its
  shrine: the Engine's door opens only at the Wanderer's periapsis.
- **The Wanderer.** Carry the core there within one loop and be aboard at
  20:30, when it passes Periapsis Zero. Give the Engine the core. The end.

## The places (game/scripts/reach)

Each place is a `Site` under its body's `Planet`: solid only while that body
is the frame's, drawn only near it, processed only on it, put back each
morning (`reset_loop`). Pieces come from Blender scripts (art/godot/
hearth_village.py, reach_sites.py) and are stood on the sphere along its
up.

- `Village` (Hearthstone): the campfire, cabins, tower, observatory,
  lookout, the mine and its songline; Mara, Fen, Tull, Isa, Okafor.
- `VerdanceSite`: Renn's camp, the falls and pool, the pod, the pillar
  city and its climb.
- `AshfallSite`: the hull, the bridge (`aster_bridge.glb` in its hull) and
  Hale's recorder, the vault, its door and keypad, the core, Vex, the fires,
  two `HollowDrone`s.
- `PhantomSite`: the shrine. `QuantumMoon` moves the Phantom round its
  orbit whenever it goes from seen to unseen, unless a photo holds it.
- `WandererSite`: the Engine, its door (open 20:00 to 21:15), the socket.
  `Reach.finish` plays `ReachEnding`.

Bodies don't spin, so where the Lantern stands over a place depends on its
longitude: Verdance's places sit where it is up for most of the loop;
Hearth has two days a loop; Ashfall one.

## Hearth's valley

The village is on the floor of a crater (Worlds.raw_height: floor 2 m, wall
from 110 to 134 m out, crest 46 m) with the river from the falls (azimuth
40) to the pond (110). Pieces come from art/godot/hearth_valley.py: pines
(pine_a/b/c near, pine_far beyond 220 m, all in Planet's multimeshes),
cliff segments every 25 degrees of the wall, stilt houses, the launch tower
(tower2) with its lift shaft 11 m toward the village (TowerLift), the
observatory (observatory2) with the Museum inside, paths (Site.path),
lamps and the signpost. Trunks and rocks are solid through one physics body
per planet (Planet._solid_on). Stairs carry a hidden ramp ('collide_only').
The Kestrel rests on the tower (Village.ship_rest); Okafor gives the codes.

## Night, fire and the end

- Hearth wakes before dawn (the village is where the Lantern is 12
  degrees below the horizon at t = 0). `Wake` plays the eyes opening.
- `FireRest`: sit at any `Campfire`; marshmallows; sleep runs
  `ReachSystem.warp` at 30 until a key or 20:50.
- `ReachLoop._collapse`: `Lantern.nova()` (a shell, nova.gdshader, drawn
  through worlds), white when it reaches the camera, then `Memories.play`
  (pictures from `Memories.capture`: every 40 s, on arrival, after
  conversations, photos), then `wake`.
- `Fold` (off the Lantern's node, fixed): billboard clouds (fold.gdshader);
  `Reach._air` tints the space inside it.
- The sky is art/sky/space-hearth.jpg in shaders/reach/sky.gdshader
  (no TIME: a sky using it is relit every frame).
- `NightSky` (on Hearth's planet): four curtains of aurora
  (aurora.gdshader, additive, `night` fades them) and a falling stone now
  and then. Drawn only at night and only while Hearthstone is the frame's
  body. `-- --noaurora` leaves it dark, for measuring.
- `Lamp`: a village of 29 lights would be 29 lights on everything in the
  valley. Up close the OmniLight3D burns; further off it is a soft halo.
  `Reach._process` pumps the register five times a second and breathes the
  lit ones. The campfire's own light is culled the same way.
- Mara's banjo loops quietly at the fire (the file is a phrase: the loop is
  set at run time), so the village has a sound to walk home by.

## Taking off

Space on the deck is not a push: it lights her. The first lift of each
morning is the full ride (ReachShip.launch, LaunchFx): held on the tower
for a moment while the engines come up, then 19 m in 2.5 s with the nose
easing back 11°, watched from the tower for the first two thirds (the
deck and the valley falling away under her, the plume and the dust) and
from the seat for the last second, at 18 m/s, with the gear folding into
the hull. Any lift after it is short (half a second, no cut), so flying is
never a cutscene. The climb is a scripted kinematic pose rather than
forces, so it cannot jitter.

Everything a lift-off draws — the dust, the smoke, the scorched deck, the
cockpit seen from outside, the valley from the tower and from high above —
is drawn once behind the morning's black (Reach._prewarm): a browser
compiles a material the first time it is drawn, and the first draw must
not be ignition.

## The tools

- `Signalscope` and `SignalSource`: the song's parts, the beacons, the
  drones' chatter, the Phantom's tone.
- `Translator` reads `Lore.SONGLINES` (verses that answer verses); verses
  read are kept (`reach_read`).
- `ShipLog` (L), `ReachMap` (M), the photo (P), all in `Reach`.

For screenshots (`scripts/godot-webshot.mjs`): `#reach/view:<body>:<landmark>
[:metres[:degrees[:loop seconds]]]` or `:top`; `#reach/map`;
`#reach/songline:<id>`; `#reach/at:<loop seconds>`; `#reach/launch` (boards
and lifts off) and `#reach/cockpit`.

The page reports `window.pzPerf` (draws, primitives, process time, worst
frame, hitches) and, once a lift-off has run, `window.pzLaunch` (when it
started, how long the ride took, its worst frame and where in the ride).
`--launchtest` checks the ride without a browser.

## Controls

On foot: WASD, mouse, Space jump (hold to charge) and jetpack, Shift sprint
(jetpack down in the air), E interact, F flashlight, X signalscope (wheel or
Z/C to change frequency), M map, L ship log, P photograph, Esc pause (every
key, in the title's style: ReachPause).

In water (Hearth's pond, Verdance's seas): WASD swim, Space up, Shift dive.
The suit floats you with your head out; under it the view goes green-blue
and sound is muffled (a low-pass on the master bus), and there is a splash
going in and rings where you move.

In the ship: W/S forward and back, A/D sideways, Space/Shift up and down,
mouse to turn, Q/E roll, T lock the world in the middle of the view, G the
autopilot to it, hold F to match its velocity, R flight assist, V the
outside view, right mouse to look about the cockpit, E leave the seat
(landed). No Ctrl keys (browsers close tabs on Ctrl+W).

Flight assist (on by default) works against the world ahead of her (the
locked one, the one she is low over, or the one her nose points at): drift
across her heading is taken out, so pointing at Verdance goes to Verdance;
a fall at a world is held to what she can stop from in the height left; and
under 320 m with nothing pressed she hovers, levels her wings and holds
still, Shift sinking her at a pace that slows to 1.6 m/s at the ground. The
autopilot flies to a point over the locked world at the speed she can still
stop from, round the Lantern or any world in the way, and holds her there.
`--landtest` and `--aptest <world>` check both.

Turning: the mouse sets a turn rate (eased per frame, so frame and
physics-tick timing never shows), reached at TURN_ACCEL; thrust spools
over ~0.1 s. Terrain: a sphere swept along her velocity (`_terrain`, every
third tick) gives `_danger`; with the assist on, `_avoid` brakes and lifts
and the HUD edges go red. `--walltestfly` flies at the crater wall both
ways.

She boards through a hatch in her belly, behind the seat, from either side:
it swings down into a ramp, you climb the ladder in its well past the ship
log's terminal and sit. Parked and empty she is frozen in place, so nothing
walking into her (or onto her wing) moves her. The cockpit's two screens
are drawn live (KestrelScreens): a horizon against the world below, speed,
height and sink, the lock and closing speed, what the assist is doing, and
a landing screen low down; the status screen lists hull, gear, assist and
the keys.

## Look and feel

Warm space-punk: charcoal, campfire orange, pine green, bone. Procedural
skies (no panorama textures). Trajectory and orbit lines glow like
hand-drawn ink and pulse at periapsis. Music made in code: one tune played
by banjo, flute, harmonica and drums in sync with the loop, so travellers'
signals harmonise when heard together.

## Performance

Built for the browser's Compatibility renderer first: one sun light, the
flashlight and the ship's lamp; planets as cube-spheres (high detail only
for the body you are on); plants as multimeshes; no screen-space effects
in the browser. 60 fps on a Chromebook-class GPU is the target.

A browser submits every draw call through WebGL on the CPU, so the budget
is draw calls rather than triangles: trees and props are chunked 2×2 on a
cube face (not 3×3), the light renderer draws one shadow cascade at 145 m
instead of two at 220 m, and the air is ray-marched in 4 samples instead
of 6. `Reach._count_draws` (`-- --count`) prints what the scene asks for
by world; `scripts/godot-webshot.mjs` prints what a frame actually used.

`Site.merge_pieces` (the village calls it once, when everything is
placed) groups the static pieces that repeat — houses of a kind, cliff
segments, benches, lamps — into one multimesh per mesh, with the scanned
surface materials baked into a copy of the mesh. Hearthstone: 352 mesh
submissions down to 147 plus a few dozen multimeshes (166 fewer objects),
and shadow casters 341 → 136.
Anything with a script under it (the lift's car, the orrery, people) is
left alone; `-- --nomerge` draws it the old way, for an A/B.
