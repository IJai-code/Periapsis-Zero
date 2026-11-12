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
- **The Wanderer.** Be aboard between 20:00 and 21:15, when it passes
  Periapsis Zero (E at the door races the clock there). The core alone does
  not wake the Engine: the door's recording says it must be sung its song,
  five parts hidden on five worlds (fact `wan_song`), and the Engine's own
  recording gives the order, nearest the Lantern out to the dark
  (`wan_order`).

### The Engine's song (the ending's gate)

Five parts, each behind its world's hardest thing, all knowledge (saved):

| Part | Where | Fact |
|---|---|---|
| glass | the Phantom's shrine recording (lock the moon, fly there) | `song_phantom` |
| ember | carved past the fifth ring of the Zero-G cave | `song_hearth` |
| iron | carved on the core's cradle in the Aster's vault (drones) | `song_ashfall` |
| rain | the high pillar's recording, top of the pillar city | `song_verdance` |
| deep | Abe's log aboard the Tern, 300 m over the Nadir | `song_nadir` |

Orbits give the order: Phantom 2900, Hearth 4600, Ashfall 7300, Verdance
10800, Nadir 16500, so glass, ember, iron, rain, deep (`Lore.TALK.engine_song`;
the five words are offered in a fixed muddled order, only the known ones).
A wrong part breaks the song and puts the clock two minutes on, so a
guess near 21:00 costs the morning. With the core and all five parts known
the socket sings, then Rook's choice. Missing parts are named at the
socket, on the pause page and as leads (`LEADS`, first rows). The core
still survives the loop once taken; the vault cradle's carving can be read
from an empty vault.

Once the Wanderer has told you the Engine wants a song (`wan_song`), a
thin pillar of light stands over the place where each part you still lack
is carved (`song_tells.gd`, one billboard quad each, checked once a
second). Learn a part and its light goes out; none show before you know
what to look for, and none after the ending. At the socket each word you
pick is sung as a note (Glass B, Ember A, Iron F#, Rain E, Deep D), so the
right order is a falling scale you can hear.

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
  degrees below the horizon at t = 0). `Wake` plays the eyes opening. The
  true first morning begins 44 s into the loop (`Wake.FIRST_LIGHT`), when
  the Lantern is just over the rim: the eyes open on the launch tower and
  the Kestrel on top of it, the village's lamps and string lights still
  lit, and only then turn to the fire and Mara. The crater's own wall
  keeps the village floor in shadow until the star is high, so the first
  light lands on the rim above it.
- The Rim Run's rings, numbers and beam are drawn from the Kestrel's seat
  (or during a run), never on foot: the waking sky is the village's own.
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
- `NightSky` (on Hearth's planet): a falling stone now and then through
  the sky's own stars — no aurora, so the night is black and the stones
  show. Drawn only at night and only while Hearthstone is the frame's
  body.
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

Everything that sounds is in tune with that one tune. The music is in
D major at standard pitch (the flight track is in the same key). Effects
with a pitch (`Sfx.TONAL`) are written on the notes D, E, F#, A and B, and
any pitch change asked of them is snapped to that scale by `Sfx.tuned()`;
the beacons, the quantum hum and radio chatter in `reach_sounds.gd` follow
the same rule. Vibrato in `reach_music.py` must add up phase sample by
sample (multiplying a wobbling frequency by time drifts badly out of tune
on long notes). Tock's music box at the Nadir is a sixth part of the tune
(`musicbox`), heard on the signalscope and in the finale.

Coming down fast through air, the Kestrel glows (`entry_glow.gd`, one
additive shell on the ship): nothing below 70 m/s, full at 260 m/s in
thick air, bright at the bow and streaked behind, hidden in space and in
still air. It is a look only and changes no flight numbers.

Up close the world answers to you. Boots sound like what they are on
(`Explorer.footing()`: grass on the green worlds, grit on the others,
planks on anything built where people live, ringing plate elsewhere), left
and right never quite alike. Where there is air there is wind past the
helmet, gusting, louder with speed; where there is none the only sound is
the pilot's own breath, quicker as the tank runs down. The view breathes a
few millimetres when you stand still. Grass leans away from your feet and
presses down where you tread (`Grass.walker`). Within nine metres the
ground gets a second, finer layer of its scans (grain and grit at the scale
of a boot) and its dark, damp patches catch the light.

### Ashfall's dangers

Eight pits of sinking ash lie on the ways across Ashfall's crater, the same
places every morning, never on the vault's door, the bridge or Vex's camp
(AshfallSite._sinks). Each is drawn into the ground's own shader as a slow
dark spiral with embers on its arms and at its heart (`pits` in
planet.gdshader, `Planet.set_pits`), so it follows the slope and reads on
the night side; dust lifts off it and it hisses close to. In one, the ash
pulls you down (`Explorer.sunk`): slowly while you keep moving, nearly twice
as fast standing still (about 4.5 s at the heart), legs held to 30% speed
when deep; each jump wrenches you up 0.35 m; under to the chin, you die
("The ash swallowed you"). Out of it you climb back up.

Four of Rook's drones fly over the crater now: two over the vault and the
wreck as before, two wider ones sweeping the ways in. One that holds you in
its light for 0.8 s calls the others; they leave their loops and come after
you at 9 m/s, above and behind, firing whenever they see you. They give up
after 6 s without sight of you, 160 m from home, or once you are in the
Kestrel, and fly back to their loops. Every hit flashes red and jolts the
view. `--ashtest` checks the pits and the hunt.

### The Zero-G cave, guided

Near the cave with rings still to fly, the visor marks the next ring
("Ring n of 5", as Isa's rings are marked) and the mouth says what to do.

### The giant and the mist

A banded giant hangs in the sky over every world, far beyond the Reach's
edge and too far to fly to (sky.gdshader, `giant`): lit from the Lantern,
its night side nearly black against the nebulae, a thin bright limb, one
pale storm. It is placed once over the village's fire, the way you face on
waking (`giant_dir`). It costs no draws (it is in the sky pass); beat
`reach/giant` looks up at it.

Low mist (Weather, `_mist`): 56 soft sheets in the hollows round the camera
on the worlds with air, one draw, laid again after the camera has moved
35 m (the lowest of three tries each, so it pools), always a little, more at
dawn and dusk, thick in a front. The web renderer cannot read depth behind a
transparent sheet, so each sheet is sunk a fifth of its height and faded at
its foot instead of softened against the ground.

### The Engine's door, the first time

The comet is the first place the log sends you (after the old mine) and the
last (the ending). The first trip is to play the recording beside the sealed
door; the door opens only 20:00 to 21:15 on its nearest pass. Without the
core, E at the door only says what it needs (no skipping ahead, which would
throw the loop away); carrying it, the first E explains and a second skips
ahead to 20:00. `--helptest` checks both.

### Gather and build (outpost.gd)

Every world carries ore, the same 34 deposits each loop (`Outpost.lodes`:
half within a walk of a landmark, the rest anywhere above the sea): ferrite
everywhere, lumen mostly on airless worlds, resin where there is air. Hold
the left mouse on a deposit to cut it (5 units, 0.42 s each; it shrinks as
it empties and is back next loop). B opens the build kit: 1 to 9 choose a
piece, R or the wheel turns it, the left mouse stands it where the green
ghost is, X takes down the piece you look at for a full refund. Decks join
in 4 m squares, walls stand on a deck's nearest edge, stairs lead up to it.
The kit: lamp, beacon (a mark on the visor from anywhere on that world), hab
(air, power and patching at its lock), landing pad, extractor (a unit of
ferrite every 24 s of the loop, 14 at most, emptied with E), deck, wall,
stairs, crate. The pack and everything built are in the save
(`reach_pack`, `reach_built`) and outlast the loop: the loop takes the day
back, not the work. 90 pieces at most; only the ruling world's pieces and
deposits exist as nodes, and their lights burn within 60 m. Models come
from `art/game-outpost/build.py` (Blender, headless) into
`game/art/outpost/`. Beat `reach/build` stands a small outpost by the fire
without touching the save; `reach/mine` and `reach/minein` look at the old
mine.

Cost, measured in the browser build by the village fire: a seven-piece
outpost in view is 391 draws against 300 without (60 fps, worst frame
16 ms, no hitches). Deposits and the small pieces (lamp, stairs, crate) cast
no shadows, deposits stop drawing at 150 m and pieces at 420 m; before that
pass the same outpost was 447 draws. Skylight (`_air`): the ambient runs
0.34 at night to 0.85 by day so shaded walls show their material.

The old mine: its model's mound used to strew boulders through the tunnel
(art/godot/reach_sites.py), burying the recorder; they are kept clear of it
now, the tunnel sits wholly on the levelled ground, and its mouth and far
end are lit.

### Weather (weather.gd)

Hearthstone and Verdance have weather. Fronts come over at the same minutes
of every loop (`Weather.FRONTS`: Hearthstone a shower from 6:40 and a storm
from 16:50 into the end; Verdance three), so a shower you were caught in is
one you can plan round. Cloud gathers 70 s ahead of the rain and lingers
after: the cloud deck thickens and greys (`WorldLook.overcast`), the
Lantern's light drops by up to 80%, the ambient goes grey and flat, the
haze closes the distance in and takes the sky. Rain is one draw: 2400
streaks in a 26 m box round the camera, placed in the shader from a seed
and the shower's drift (shaders/reach/rain.gdshader), so the rain stays in
the world as you walk or fly through it. A ray overhead a few times a second
finds a roof or the canopy: nothing falls within 3 m then and the sound
changes from open rain to rain drumming on a roof. The ground wets in 25 s
and dries over minutes (`Planet.soak`: darker, shining). In rain of 0.8 and
over there is lightning every 11 to 26 s, a doubled flash and the thunder
0.6 to 3.5 s behind it. Above the cloud (45% to 90% of the air's height) it
all fades out, and the ending has its own sky. All three sounds are made at
start-up. Weather only scales what the scene has already set that frame
(`Weather.step` runs after `_air`). Beats `reach/rain` and `reach/storm`
hold a front overhead for looking at it. In flight, air rushing over the
hull is heard with speed in thick air (`EntryGlow.rushing`).

## The Nadir

A black hole past the Wanderer's farthest swing (ReachSystem `nadir`, orbit
16.5 km, horizon 36 m, sphere 2.6 km), with the gleam (a river of living light
drinking the Lantern) pouring into it. Its own story, side by side with the
Engine's: Tock, the Ferreira family's robot, has kept a relay buoy lit at the
lip for 104 years; the Tern holds station 300 m over the horizon where Pip
(11) keeps watch and, for her, the Founders left Hearth this morning; Abe's
log says the gleam is why the Lantern dims, and that it flees the Engine's
song. Carry Tock's count down and Pip's "come home" back up, and he falls to
them. Facts `hearth_nadir` (Okafor), `nad_*`; leads in `NADIR_LEADS`, shown
first while you are there.

- **Time runs slow:** `ReachSystem.dilation` = 1 + 5 (300 / r)^2 near it (1.4
  at the buoy, 6 at the Tern, hundreds at the edge), multiplied into the loop
  clock; the HUD shows the clock and the factor. Inside 45 m: `loop.die("nadir")`.
- **Decks:** the Tern and buoy face away from the hole; `ReachSystem.decks`
  sets gravity there to 6 m/s^2 (direction kept). The Tern's cabin has air
  (`Nadir.air_at`). The autopilot to the Nadir stops over the buoy.
- **Graphics:** `black_hole.gdshader` on a 1250 m sphere: Schwarzschild ray
  march near the hole (steps by tier, 72 to 28), weak-field bend further out,
  the disk with Keplerian shear and beaming, the background read from the
  screen texture where the bent ray points; drawn last (`render_priority`).
  `gleam.gdshader`: camera-facing ribbons, additive.
- **Models:** `art/godot/nadir_sites.py` (tern, buoy, tock_body, tock_head).
- **Looking:** `#reach/nadir` (buoy), `nadir:tern`, `nadir:ternview`,
  `nadir:far`, `nadir:sky`. Check: `--nadirtest --talkauto`.

## The first-run film

`ReachIntro` (game/scripts/reach/reach_intro.gd), 70 s, live in the engine,
one unbroken camera: the Nadir and its disk, down the gleam toward the
Lantern, round Hearthstone's night side as the star rises over the limb and
into the crater, the morning raced through, the collapse and nova, the
title, then the eyes open by the fire. Its score is `intro` in
art/audio/reach_music.py, cut to the film's times; the film runs on the
music's clock (the wall clock if the browser holds the sound back).

- The camera is a time-parameterised Catmull-Rom spline through keys that
  are a body and an offset from it (`_build`), turned into the current
  frame each drawn frame. The frame is pinned to Hearthstone (focus on the
  sleeping explorer) so no world wakes mid-flight.
- The flight's hour is the first of `T0S` whose path stays 5 km clear of
  every other world (a far world's coarse mesh shows its facets up close).
- Anti-lag: the nova shell is built at load (the zoo compiles it), the
  meteor storm rests during the film, and `--introprof` prints any frame
  over 40 ms with its film time. Plays once (Flow progress `intro_seen`),
  never after a load slower than `FILM_SLOW_MS`; `#reach/intro` replays it.

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

Loading is measured the same way, because an unresponsive page is worse
than a slow one. On the web the Reach is made in stages with a frame
between (one planet at a time, the village's roads then buildings then
people then grass in four batches, then each other world), the shader
warm-up spreads its materials over frames, and the browser's loading
screen stays up until the frame is ready. The title's backdrop builds only
Hearthstone, and a `#reach` link skips the title altogether: the address
is read before the first scene is made, so the one world you cannot see is
not built twice. Under a 6× CPU throttle the longest single block is
11.3 s on the title and 8.0 s straight into the Reach (it was 38.5 s).

The loop's reset is timed every time it runs (`LOOP reset` in the log):
1.7 ms, so the wipe never costs a frame. The song lights and the entry
glow add at most six draws; with them on, the web build holds 60 fps with
a worst frame of 16 ms and no hitches at the pad, over the song lights and
across the loop's end.

The close-up pass costs no draws: the grain is three more samples of
textures already bound, only inside nine metres; the grass push is one
uniform a frame; the wind and breath loops are made once at 11 kHz in
14 ms. Looking straight down in Hearth's grass, standing and walking, the
web build holds 60 fps, worst frame 16 ms, no hitches.
