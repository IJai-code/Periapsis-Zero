# Periapsis Zero: the game

The site is a game. The simulator is a tool beside it.

## The pitch

**2091. The Moon is the frontier, L1 is the boomtown, and you owe the wrong
people forty thousand credits.**

An open-world crime story in cislunar space: the real Earth, the real Moon,
the stations between them. You arrive at Hearth Station with a tired ship and
a debt. You can haul cargo, race, hunt pirates and run salvage honestly, or
take the jobs nobody asks questions about and have the Lunar Compact's patrol
on your tail. Missions with characters carry the story; between them the
whole map is yours.

The touchstone is the shape of a Rockstar open world (a city you can do
anything in, a story that pulls you through it, a wanted level that makes
crime a chase), set in space with the physics kept honest.

## What stays real

- **Places.** Earth and the Moon at their true sizes and distance
  (384,400 km). Hearth sits at Earth-Moon L1, Harbor in a 420 km orbit,
  Gateway in the Moon's halo orbit, Shackleton base at the lunar south pole.
- **Local flight is Newtonian.** Six-axis thrusters, momentum you have to
  kill. Flight assist (on by default) fires the thrusters to hold the
  velocity you ask for; turn it off and you drift. Near a station, relative
  motion over minutes is all that matters, so gravity is left out locally
  (Clohessy-Wiltshire: the drift it would add is centimetres).
- **Travel is a real transfer, with time compressed.** A torch drive at
  0.3 g flies a brachistochrone: burn halfway, flip, brake. L1 to the Moon is
  about two and a half hours of ship time; the game compresses it to
  seconds and the game clock moves on. Deadlines are in game time.
- **Landing is the surface game**: the lander, the rover, real gravity.

## The loop

1. **Dock** at a station: job board, market, shipyard, outfitting, repair,
   and whoever on the station has work for you.
2. **Take something on**: a story mission, a job, a trade run.
3. **Fly it**: undock, local flight, transfer to the destination, local
   flight again; fight, collect, race, deliver, land.
4. **Get paid**, upgrade, buy the next ship, and push the story on.

## The wanted level (Heat)

Five chevrons. Contraband found by a patrol scan, shooting at the patrol or
at civilians, or ramming them, raises it. At one chevron a cutter orders you
to stop and fine you; ignore it and it becomes a chase. Higher heat brings
more cutters, then interceptors, and from four chevrons a patrol in range
inhibits your drive so you cannot transfer away. It falls when no patrol has
seen you for a while. Paying the fine at a Compact station clears one or
two; the Shackle, the pirate rock in the Drift, will make it go away for a
price.

## Places

| Place | Where | What it is |
| --- | --- | --- |
| Hearth Station | Earth-Moon L1 | The boomtown. Start here. Mara Voss runs the docks. |
| Harbor | 420 km above Earth | The respectable hub. Shipyard, the Harbor Loop race. |
| The Drift | 2,400 km from Hearth | Wreckage of a mining venture: salvage, raiders. |
| The Shackle | Inside the Drift | A hollowed rock. Black market. Rook. |
| Gateway | The Moon's halo orbit | Lunar Compact patrol command. Commander Chen. |
| Shackleton | Lunar south pole | Surface base; jobs here are landings. |

## People

- **Mara Voss**, dockmaster at Hearth. Gives you your first honest work and
  expects you to fail.
- **Rook**, the fixer at the Shackle. Holds your debt. Friendly about it.
- **Commander Elias Chen**, Lunar Compact patrol. Patient, and he remembers.
- **The Hollow**, raiders out of the Drift, led by someone called the Warden.
- **Ines Okafor**, factor for the Ceres Line, the shipping company that moves
  into the lanes once the Hollow are gone. Generous, and lying.
- **Vex**, Rook's gun. Flies with you on Rook's side of the story.

## Act One: Periapsis

1. **Arrival.** Learn to fly at Hearth: thrust, turn, boost, flight assist,
   dock. (The tutorial.)
2. **Honest Work.** A courier run to Harbor: the map and the transfer drive.
3. **Scrap.** Salvage in the Drift; the Hollow arrive. Shields and guns.
4. **A Friend of a Friend.** Rook's crate to Gateway, past a patrol scan.
   Your first chase.
5. **Down Low.** Land at Shackleton and recover a survey core.
6. **Chen.** The Commander has you cornered and makes an offer. Choose.
7. **The Raid** (with Chen) or **The Convoy** (with Rook).
8. **Periapsis.** The Warden runs for the Moon; the chase ends at the lowest
   point of the orbit.

## Act Two: Apoapsis

Both sides of the choice come back together: Chen is on your side either way,
and on Rook's side Vex flies with you too.

9. **New Money.** The Ceres Line asks for you by name: escort the freighter
   Providence out of Harbor through two raider packs. If she is destroyed, the
   mission fails and can be taken again.
10. **Ghost Signal.** Okafor wants a dead tug's flight recorder from the
    Drift. Hold still beside the wreck to pull it; "Hollow" raiders with Ceres
    transponders come for it. Take it to Mara, not to Okafor.
11. **The Loop.** Run the Harbor Loop in under two minutes to be invited
    close to Okafor's yacht, the Meridian, and tag it with Mara's tracker.
12. **Apoapsis.** The Ceres Line goes for Gateway: two waves of strike craft
    and the Meridian, against Chen's wing and Gateway's patrol.

After the finale the open world carries on: jobs, trade, ships, upgrades.

## The hangar

Docked, the ship sits on a pad inside the station's bay (art/game-hangar,
built in art/lib/craft.py): robot arms, catwalks, crates, a crane, lamps, and
the door open on the sky with Earth or the Moon beyond it. The bay is level
with the nearest world, so launching leaves with the horizon square.

## Devices

- **Computer**: keyboard and mouse. The whole game.
- **Tablet**: touch controls (a flight stick, throttle and buttons on
  screen). The whole game.
- **Phone**: the screen is too small to fly and read a job board at once.
  Phones get the simulator, and are told why.

## Sound

Music is the owner's track, looped, with its own volume. Effects (guns,
hits, boost, docking clamps) are short, synthesised, and have their own
switch.
