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

## The tools

- `Signalscope` and `SignalSource`: the song's parts, the beacons, the
  drones' chatter, the Phantom's tone.
- `Translator` reads `Lore.SONGLINES` (verses that answer verses); verses
  read are kept (`reach_read`).
- `ShipLog` (L), `ReachMap` (M), the photo (P), all in `Reach`.

For screenshots (`scripts/godot-webshot.mjs`): `#reach/view:<body>:<landmark>
[:metres[:degrees[:loop seconds]]]` or `:top`; `#reach/map`;
`#reach/songline:<id>`; `#reach/at:<loop seconds>`.

## Controls

On foot: WASD, mouse, Space jump and jetpack, Shift sprint (jetpack down in
free fall), E interact, F flashlight, X signalscope (wheel or Z/C to change
frequency), M map, L ship log, P photograph, Esc pause (every key).

In the ship: WASD and Space/Shift thrust, mouse to turn, Q/E roll, T lock a
target, hold F to match its velocity, M map, L log, X signalscope, E leave
the seat. No Ctrl keys (browsers close tabs on Ctrl+W).

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
