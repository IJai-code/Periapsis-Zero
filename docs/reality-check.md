# Reality check: what stands between Periapsis Zero and a lot of players

Written 24 October 2026, after the Rim Run and meteor storm release. Blunt
on purpose. Numbers are measured unless marked as an estimate.

## The short version

The game itself is now decent: five small worlds, real orbits, a
22-minute loop, a story that can be finished, flying that feels good, and
36 automated checks that pass. What will stop it being popular is
everything around the game: how heavy it is to start, how few people can
find it, how it presents itself, and how close it sits to Outer Wilds.
Polishing grass will not move the numbers. These will.

## 1. The first visit is a 112 MB download (measured)

- The browser downloads **102 MB of game data plus a 10 MB engine**
  (compressed) before anything moves. On a 20 Mbit/s connection that is
  about 45 seconds, and on a school or café connection, minutes. Typical
  browser games are 10 to 30 MB. Most first-time visitors leave during a
  long load: this is very likely the biggest single loss of players.
- **People are 45 MB of it**, almost half: ten characters at about 2.8 MB
  each (mostly face-expression data), each with its own copy of the same
  skin, eye, teeth and clothing textures. The web build also shipped the
  desktop-only high-detail person textures; that is fixed in this release
  (the game data went from 102.9 to 96.3 MB, measured).
- **Every release makes returning players download it all again** (the
  data file changes, and the host only caches for ten minutes). Releasing
  several times a day costs every regular player a full re-download each
  time.
- **What would fix it:** a small first pack (title, Hearthstone, the people
  on it) under about 40 MB, the rest streamed in the background while you
  play the first minutes; one shared set of person textures; fewer,
  batched releases. This is a few days of careful work and the most
  valuable engineering left.

## 2. Nobody can find it

- It exists on one website. There is no itch.io page, no Steam page, no
  CrazyGames or Poki listing, no trailer, no short clips, no subreddit or
  Discord. A great game with no discovery channel gets almost no players.
- **What would fix it, in order of effort:** an itch.io page (an afternoon,
  and it has a real audience for browser and exploration games); a
  60-second trailer and 15-second clips cut from the game's own views
  (the meteor storm, the Rim Run, landing on the comet, the end-of-loop
  supernova); posts to r/outerwilds, r/godot, r/indiegames, r/WebGames
  with those clips; a Steam page with a wishlist button only once the
  trailer exists.
- These need your accounts and your decision; they are not things to do
  for you.

## 3. It says it is four products

- The front page offers the game, a download, an orbital simulator, a
  flight school with Apollo missions, a combat mode (Squadron) and
  "thirteen worlds" of surface expeditions. A new visitor cannot tell what
  this is in five seconds, and three of those are older projects.
- **What would fix it:** the front page is the Reach and nothing else: one
  picture, one sentence, one button. The simulator and Squadron move to a
  small "more from this project" link. (Not changed: it is your call what
  to keep in front.)

## 4. It is very close to Outer Wilds

- A 22-minute loop ending in a supernova, waking at a campfire under a
  nebula, marshmallow-style rests, a signalscope with an instrument per
  traveller, an ancient race's spiral writing, a quantum moon held by a
  photograph, a comet with a sealed core. Outer Wilds players are the
  natural audience, and they will notice every one of these. "Browser
  Outer Wilds" is a hook, but "Outer Wilds clone" is the review.
- **What would fix it:** keep the loop, own the rest. The pieces that are
  already yours are the strongest: the Aster's crew and the betrayal story,
  real orbital flight with a cockpit you fly from, the Kestrel, Hearth's
  people, the meteor mornings, the Rim Run. Lead with those in every
  description and clip, and over time replace the most recognisable
  borrowings (the spiral writing and the photograph trick first) with
  mechanics of your own.

## 5. The first minutes are slow and dark

- A new player wakes at night (the screen is mostly black apart from the
  fire), reads a goal card, walks to Mara and talks. Nothing exciting
  happens until they find the launch codes and fly, which takes several
  minutes. Browser players decide in about one.
- **What would fix it:** get them into the cockpit within the first two
  minutes (Mara hands over the codes; the observatory can come later), and
  let the first thing they see be the sky lit up, not a dark yard.

## 6. No way to know what players do

- There is no measurement at all: no count of visits, how many finish
  loading, how far anyone gets, where they quit. Every decision above is a
  guess until there is.
- **What would fix it:** privacy-friendly, cookie-free analytics (Plausible
  or GoatCounter) on the site and a few anonymous events from the game
  (loaded, first flight, first landing, finished). Your decision, as it
  sends data off the page.

## 7. Smaller but real

- **Memory:** the web build uses about 800 MB of video memory; Chromebooks
  and older laptops (a large share of browser players) may crash or crawl.
- **Phones:** the game needs keyboard and mouse, and the site says so
  honestly, but that rules out most mobile traffic. Touch controls would be
  a large project; not worth it before the points above.
- **The code is public** on GitHub: anyone can copy the game. Your call.
- **Shareability:** nothing in the game asks to be shared. Rim Run times,
  photographs and starstone counts are natural things to share (this
  release adds a "copy a challenge" for Rim Run times).

## What I would do next, in order

1. Split the download: a small first pack, the rest streamed (biggest win).
2. Make the front page the Reach alone.
3. Two minutes to the cockpit for a new player.
4. itch.io page, trailer and clips (needs you).
5. Analytics (needs your yes).
6. Replace the most Outer Wilds-like pieces with your own.
