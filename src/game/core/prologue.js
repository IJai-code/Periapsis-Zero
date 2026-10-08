/** Original fiction. Seconds on an active, visible playback clock, not game time. */
export const PROLOGUE_SECONDS = 120
export const PROLOGUE = [
  { id: 'frontier', start: 0, end: 18, label: 'Earth orbit · 3091', title: 'Everything we needed', shot: 'earth', audio: '01-frontier', captions: [
    [0, 'By 3091, people were born under glass, on Earth, the Moon, and orbital cities.'],
    [8, 'Medicine lengthened lives. Recycled air and lunar water kept them alive. Nothing was free.'],
  ] },
  { id: 'convoy', start: 18, end: 38, label: 'The Hearth corridor · 17 days earlier', title: 'One ordinary crossing', shot: 'convoy', audio: '02-convoy', captions: [
    [0, 'You flew escort for a convoy called the Aster. Six ships. Medical cargo. No weapons declared.'],
    [11, 'Then the navigation relay went silent. Someone had opened a route through the debris field.'],
  ] },
  { id: 'silence', start: 38, end: 58, label: 'Aster flight recorder · signal interrupted', title: 'No warning. No answer.', shot: 'wreck', audio: '03-silence', captions: [
    [0, 'The Hollow came out of that silence. They knew the route, the cargo, and exactly when to strike.'],
    [10, 'You cut your engines and drifted through the wreckage. Your recorder kept running.'],
  ] },
  { id: 'debt', start: 58, end: 78, label: 'Salvage recovery · claim 040000', title: 'Survival has a price', shot: 'rescue', audio: '04-debt', captions: [
    [0, 'Rook found your ship before the patrol did. A tow, a patched hull, a berth at Hearth.'],
    [10, 'Forty thousand credits. That was his price for keeping you alive.'],
  ] },
  { id: 'hearth', start: 78, end: 100, label: 'Hearth Station · Earth-Moon L1', title: 'A place to start again', shot: 'station', audio: '05-hearth', captions: [
    [0, 'Now the lanes are closing. Commander Chen wants the Hollow stopped. Rook wants his investment back.'],
    [11, 'At Hearth, Mara Voss offers something simpler: work, and a chance to fly on your own terms.'],
  ] },
  { id: 'mission', start: 100, end: 120, label: 'Berth 09 · present day', title: 'Your ship. Your choice.', shot: 'kestrel', audio: '06-mission', captions: [
    [0, 'First, prove that your Kestrel can still fly. Clear the berth, run Mara’s checks, and come home.'],
    [10, 'Then earn your way out of debt. Find out who sold the Aster’s route. Decide who deserves the truth.'],
  ] },
]
export const FIRST_MISSION = {
  title: 'Arrival', contact: 'Mara Voss · Hearth dockmaster',
  premise: 'You survived the Aster attack. Rook paid for your recovery, and now you owe him ₡ 40,000. A flight recorder is the only account of what happened.',
  objective: 'Learn to move, stop, navigate, defend yourself, and dock. Then choose your own work in the open lanes.',
  steps: ['Launch from berth 09.', 'Follow Mara’s flight markers and test the ship.', 'Return to Hearth and dock.'],
  reward: '₡ 1,500 · access to your first paid contract',
}
export function prologueAt(seconds) {
  const t = Math.min(PROLOGUE_SECONDS, Math.max(0, Number.isFinite(seconds) ? seconds : 0))
  const chapter = PROLOGUE.find((c) => t < c.end) ?? PROLOGUE[PROLOGUE.length - 1]
  const local = t - chapter.start
  let caption = chapter.captions[0][1]
  for (const [at, text] of chapter.captions) if (local >= at) caption = text
  return { chapter, local, caption, progress: t / PROLOGUE_SECONDS, complete: t >= PROLOGUE_SECONDS }
}
/** Hidden tabs and paused frames do not consume any of the film. */
export function advancePrologue(time, delta, paused, hidden) {
  return paused || hidden ? time : Math.min(PROLOGUE_SECONDS, time + Math.max(0, delta))
}
