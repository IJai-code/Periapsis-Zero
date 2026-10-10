# Periapsis Zero in Godot

Decided 2026-10-10. The game moves to Godot 4.7 (`game/`). The desktop build
uses Forward+, the full renderer. The browser later plays Godot's web export
of the same game (Compatibility renderer, lighter). The three.js game stays
live until the Godot one is better. The Simulator stays on the web as the
companion. App stores and signing are paused.

## Why

- **First impressions.** Players decide in the first minute. A flat menu, a
  "Start mission" button and toy-like ships lose them.
- **Onboarding.** The opening must be played, not read. It shows what
  happened, what you want and how to fly, the way an open-world game's
  prologue does.
- **Art first.** The first Godot render (the convoy over Earth) proved the
  engine is not the limit: the lighting is good and the procedural ships
  still look like toys. The models come first.

## Art

Sources are mixed:

| Source | Licence | Used for |
| --- | --- | --- |
| Poly Haven, ambientCG | CC0 | Textures and skies |
| MakeHuman's Blender add-on (MPFB) | CC0 | Human bodies |
| Sketchfab | CC BY | Hero ships and interiors |

The Sketchfab picks are original designs only, no fan art of films or other
games. Each one is credited in game/CREDITS.md and on the site. Everything is
rebuilt in Blender to one look: shared materials, the four-colour palette,
consistent wear and decals. The shortlist is docs/art-shortlist.html.

## The opening, played

1. **Title.** A live 3D scene, not a page with buttons.
2. **The Aster.** You are crew on the convoy freighter. Walk the corridors
   (learn to move and look), meet Renn and the captain, and see Earth through
   the windows.
3. **Launch.** Board the Kestrel and fly escort in formation (learn to fly).
4. **The ambush.** The Hollow hit the convoy. Target, fire and roll (learn to
   fight). The captain's last line: "They knew our route."
5. **The breakup.** The Aster comes apart around you, and you fly out
   through it.
6. **Hearth.** You wake at Hearth. Mara hands you the 40,000-credit salvage
   bill, and the two goals are stated plainly: pay the debt, and find who
   sold the Aster.
7. **The concourse.** Walk the station and choose your first job.

Throughout: one objective on screen, a waypoint and a route, a "Mission
Passed" moment, and systems unlocked as the story reaches them.

## Order of work

1. **Art.** Import the picks, unify their look, and choose the hero ships.
   Human pilot and crew from MPFB, with animations.
2. **Core.** Flight model, cameras, combat and its impact (hits, kills,
   explosions, shake), ported from src/game/core.
3. **The opening,** steps 1 to 7 above.
4. **Hearth and Act One,** ported mission by mission. Squadron and the shared
   sky join over the same Supabase rooms, so Godot and web pilots meet.
5. **Builds.** CI exports desktop builds and the web build;
   periapsiszero.dev offers the download and the browser version.

## Status, 10 October 2026

The prologue is playable and live at /play/: title, the Aster's corridor
(walk), the escort and ambush (fly and fight), the Aster's loss, and the
arrival at Hearth with both goals stated. It hands over to the web game's
Act One.

Next, in order:

1. **Better ship models** to replace the procedural ones.
2. **People:** MakeHuman crew with animation.
3. **The bridge**, where you meet the captain.
4. **Desktop downloads.** The Mac export needs a rebuild with ETC2/ASTC.
5. **Port Hearth and Act One** into Godot.

## Working notes

- **Web build:** `node scripts/godot-build.mjs web`, then upload
  build/play as the `play` release asset (see .github/workflows/deploy.yml).
- **Test links:** /play/index.html#flight/ambush (also #corridor,
  #arrival, #flight/strike) jumps straight to a chapter.

- **Asset sync:** `node scripts/godot-sync.mjs` fills game/assets
  (gitignored), with Blender decoding the Draco GLBs. Then run
  `Godot --headless --path game --import`.
- **Render check:** `Godot --path game -- --shot out.png --frames 90`.
- **Planets:** drawn at 1/200 scale and 1/200 the distance. At true scale
  the camera's depth range breaks culling.
