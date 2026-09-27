import { currentPhase, mission } from './mission.js'
import { live } from './live.js'
import { FEED, roundTrip, signalLost } from './broadcast.js'
import { ACTIVE_VESSEL } from './vessels.js'
import { INDEX } from './system.js'

/**
 * The air-to-ground loop: who says what, and when.
 *
 * A script of transmissions keyed to the flight — to a phase and a number of
 * seconds into it, or to a point in the count — and a scheduler that plays it
 * out against the flight as it is actually flown. Three voices: the capsule
 * communicator on the ground (`ground`), the spacecraft (`crew`, and `partner`
 * for the other spacecraft on a rendezvous), and the public affairs officer
 * narrating from the ground (`pao`), who in the count is Launch Control.
 *
 * Where a line is Apollo's own it says so in a comment, with the ground
 * elapsed time it was spoken at from the mission transcripts; the rest are
 * written in the procedure-and-callsign register those transcripts use, and
 * say nothing a transcript would not. A line that states a figure states the
 * simulator's figure — the orbit Eagle actually reached here, not the one in
 * the Mission Report.
 *
 * The scheduler follows the loop's two physical rules. Nothing gets through
 * while the Moon is between the spacecraft and the Earth: a transmission due
 * then waits, and the queue plays out at acquisition of signal, which is what
 * a real far-side pass sounds like. And an answer from the spacecraft to the
 * ground comes a round trip of light after the question ends — 2.6 s from the
 * Moon, milliseconds from orbit — so the pause in every lunar exchange is here
 * because the distance is.
 *
 * Driven by the page's own timer, never by the render loop: it builds strings.
 */

const nmi = (m) => (m / 1852).toFixed(1)

/*
 * ── the scripts ───────────────────────────────────────────────────────
 *
 * { phase, after }  seconds into a phase
 * { T }             a point in the count, seconds from liftoff (negative)
 * lines             [who, text] pairs, spoken in order; text may be a function
 * pace              for count lines: how late a line may start and still be
 *                   worth saying, s. A count read out late is wrong, not late.
 */

/** Launch Control's minute, for a count long enough to have one. */
const THE_MINUTE = [
  { T: -60, lines: [['pao', 'T-minus sixty seconds and counting.']] },
  { T: -50, lines: [['pao', 'Fifty seconds. The launch vehicle is on internal power.']] },
  { T: -40, lines: [['pao', 'Forty seconds and counting. All is still go.']] },
  { T: -30, lines: [['pao', 'T-minus thirty seconds and counting.']] },
  { T: -20, lines: [['pao', 'Twenty seconds and counting.']] },
  { T: -15, lines: [['pao', 'Fifteen seconds. Guidance is internal.']] },
  ...['Ten', 'Nine', 'Eight', 'Seven', 'Six', 'Five', 'Four'].map((n, i) => ({
    T: -10 + i,
    pace: 0.6,
    lines: [['pao', `${n},`]],
  })),
  { T: -3, pace: 0.6, lines: [['pao', 'Ignition sequence start.']] },
  { T: -1, pace: 0.5, lines: [['pao', 'One,']] },
  { T: 0, pace: 0.6, lines: [['pao', 'Zero. All engines running.']] },
]

/** An Earth ascent: the calls every Saturn V flight made, by callsign. */
function earthAscent(craft) {
  return [
    ...THE_MINUTE,
    { phase: 'LIFTOFF', after: 1.5, lines: [['pao', `Liftoff. We have liftoff of ${craft}.`]] },
    { phase: 'LIFTOFF', after: 9, lines: [['crew', 'Tower clear.'], ['ground', 'Roger, tower clear.']] },
    { phase: 'PITCH_KICK', after: 0.5, lines: [['crew', 'Roll and pitch program.'], ['ground', 'Roger, roll and pitch.']] },
    { phase: 'GRAVITY_TURN', after: 25, lines: [['ground', `${craft}, Houston. You're looking good.`], ['crew', 'Roger.']] },
    { phase: 'STAGING', after: 0.3, lines: [['crew', 'Staging.'], ['ground', `Roger, ${craft}. Good thrust.`]] },
    { phase: 'MECO', after: 0.5, lines: [['crew', 'Shutdown.']] },
    { phase: 'COAST', after: 3, lines: [['ground', `${craft}, Houston. You are go for orbit.`], ['crew', 'Roger. Go for orbit.']] },
  ]
}

const SCRIPTS = {
  apollo8: [
    ...earthAscent('Apollo 8'),
    // 002:27:22 — Collins: "Apollo 8. You are Go for TLI." Borman's reply followed.
    { phase: 'TLI_ALIGN', after: 4, lines: [['ground', 'Apollo 8, Houston. You are go for TLI.'], ['crew', 'Roger. Understand. We are go for TLI.']] },
    { phase: 'TLI_BURN', after: 0.5, lines: [['crew', 'Ignition.']] },
    { phase: 'TLI_BURN', after: 40, lines: [['ground', 'Apollo 8, Houston. Thrust is good. Everything is looking good.']] },
    { phase: 'TRANS_LUNAR', after: 4, lines: [['crew', 'Cutoff.'], ['ground', 'Roger, cutoff. You are on your way to the Moon.']] },
    { phase: 'MCC_BURN', after: 0.5, lines: [['crew', 'Midcourse correction burn.']] },
    { phase: 'LUNAR_APPROACH', after: 4, lines: [['ground', 'Apollo 8, Houston. You are go for LOI.'], ['crew', 'Roger. Go for LOI.']] },
    // 068:04:07 — Carr, then Anders and Lovell, the last exchange before the far side.
    { phase: 'LOI_ALIGN', after: 3, lines: [['ground', 'Safe journey, guys.'], ['crew', 'Thanks a lot, troops.'], ['crew', "We'll see you on the other side."]] },
    // 069:15:xx — Lovell at acquisition of signal after the burn, with the orbit it made.
    {
      phase: 'LUNAR_ORBIT',
      after: 1,
      lines: [
        ['crew', () => `Houston, Apollo 8. Burn complete. Our orbit ${nmi(live.lunar.apogee)} by ${nmi(live.lunar.perigee)}.`],
        ['ground', () => `Apollo 8, Houston. Roger. ${nmi(live.lunar.apogee)} by ${nmi(live.lunar.perigee)}. Good to hear your voice.`],
      ],
    },
    { phase: 'TEI_ALIGN', after: 3, lines: [['ground', 'Apollo 8, Houston. You are go for TEI.'], ['crew', 'Roger. Go for TEI.']] },
    // 089:34:16 — Lovell at acquisition of signal after TEI, on Christmas morning.
    {
      phase: 'TRANS_EARTH',
      after: 1,
      lines: [
        ['crew', 'Houston, Apollo 8. Please be informed, there is a Santa Claus.'],
        ['ground', "That's affirmative. You are the best ones to know."],
      ],
    },
    { phase: 'EI_BURN', after: 0.5, lines: [['crew', 'Corridor correction burn.']] },
    { phase: 'SM_SEP', after: 1, lines: [['crew', 'CM/SM sep.'], ['ground', 'Roger, sep. You are go for entry.']] },
    { phase: 'RE_ENTRY', after: 1, lines: [['pao', 'Apollo 8 is at entry interface, four hundred thousand feet, and heading for the Pacific.']] },
    { phase: 'DROGUE', after: 0.5, lines: [['crew', 'Drogues.'], ['ground', 'Roger, drogues.']] },
    { phase: 'MAIN_CHUTES', after: 1, lines: [['crew', 'Three good chutes.'], ['pao', 'Three good main parachutes over the Pacific.']] },
    { phase: 'SPLASHDOWN', after: 1, lines: [['crew', 'Splashdown.'], ['pao', 'Apollo 8 has splashed down.']] },
  ],

  apollo11: [
    // 124:15:xx — Evans, and Aldrin's reply: the clearance before the count.
    { T: -58, lines: [['ground', 'Eagle, Houston. You are cleared for takeoff.'], ['crew', "Roger. Understand. We're number one on the runway."]] },
    {
      T: -30,
      lines: [['pao', () => `Thirty seconds to lunar liftoff. Columbia is ${(rangeToTarget() / 1852).toFixed(0)} nautical miles away, coming over the horizon.`]],
    },
    // 124:21:5x — Aldrin reading the checklist down to ignition.
    { T: -9, pace: 1.5, lines: [['crew', 'Nine, eight, seven, six, five, abort stage, engine arm, ascent, proceed.']] },
    // 124:22:0x — Aldrin, the ascent's first seconds.
    { phase: 'LUNAR_LIFTOFF', after: 1, lines: [['crew', 'Beautiful.']] },
    { phase: 'LUNAR_LIFTOFF', after: 4, lines: [['crew', 'Twenty-six, thirty-six feet per second up.']] },
    { phase: 'LUNAR_ASCENT', after: 2, lines: [['crew', 'Be advised of the pitchover. Very smooth.']] },
    { phase: 'LUNAR_ASCENT', after: 28, lines: [['crew', "Very quiet ride. There's that one crater down there."]] },
    // 124:23:xx — Evans at one minute.
    { phase: 'LUNAR_ASCENT', after: 50, lines: [['ground', "Eagle, Houston. One minute, and you're looking good."], ['crew', 'Roger.']] },
    { phase: 'LUNAR_ASCENT', after: 170, lines: [['ground', "Eagle, Houston. Three minutes, and you're looking good."]] },
    { phase: 'LUNAR_ASCENT', after: 300, lines: [['ground', 'Eagle, Houston. You are go at five minutes.'], ['crew', 'Roger.']] },
    { phase: 'LUNAR_INSERTION', after: 1, lines: [['crew', 'Shutdown.'], ['ground', 'Roger, Eagle. Shutdown.']] },
    {
      phase: 'LUNAR_INSERTION',
      after: 10,
      lines: [['crew', () => `We're in orbit, ${nmi(live.lunar.perigee)} by ${nmi(live.lunar.apogee)}.`], ['partner', 'Roger, Eagle. Columbia has you.']],
    },
    { phase: 'LM_CSI', after: 0.5, lines: [['crew', 'CSI burn.']] },
    { phase: 'LM_CDH', after: 0.5, lines: [['crew', 'CDH burn.']] },
    { phase: 'LM_TPI', after: 0.5, lines: [['crew', 'TPI burn.'], ['partner', 'Roger, Eagle. I have you in sight.']] },
    { phase: 'LM_BRAKING', after: 2, lines: [['crew', 'Braking.'], ['partner', 'Looking good from here.']] },
    { phase: 'LM_STATION_KEEP', after: 2, lines: [['crew', 'Station-keeping.'], ['partner', 'Roger. Ready when you are.']] },
    { phase: 'LM_DOCKING', after: 2, lines: [['crew', 'Here we come.']] },
    { phase: 'DOCKED', after: 0.5, lines: [['partner', 'Capture.'], ['ground', 'Roger, we copy docking.']] },
  ],

  artemis: [
    ...earthAscent('Orion'),
    { phase: 'LUNAR_APPROACH', after: 3, lines: [['ground', 'Orion, Houston. We have you on the lunar approach. All systems look good.'], ['crew', 'Copy, Houston.']] },
    { phase: 'HALO_CAPTURE', after: 2, lines: [['ground', 'Orion, Houston. You are go for the capture sequence.'], ['crew', 'Go for capture, copy.']] },
    { phase: 'NODE_ALIGN', after: 0.5, lines: [['crew', 'Maneuvering to burn attitude.']] },
    { phase: 'NODE_BURN', after: 0.5, lines: [['crew', 'Ignition.']] },
    { phase: 'NRHO_COAST', after: 3, lines: [['ground', 'Orion, Houston. Welcome to the near-rectilinear halo orbit.'], ['crew', 'Thanks, Houston. What a view.']] },
    { phase: 'NRHO_STATION_KEEP', after: 0.5, lines: [['crew', 'Orbit maintenance burn.']] },
  ],
}

/** The range to the other spacecraft, m, for a line that states it. */
function rangeToTarget() {
  if (INDEX.target === undefined) return 0
  const s = live.sim.state
  const o = INDEX.ship * 6
  const c = INDEX.target * 6
  return Math.hypot(s[c] - s[o], s[c + 1] - s[o + 1], s[c + 2] - s[o + 2])
}

export const SCRIPT = SCRIPTS[ACTIVE_VESSEL] ?? SCRIPTS.apollo8

/* ---------------------------------------------------------------- *
 * The scheduler
 * ---------------------------------------------------------------- */

/**
 * How late a phase-keyed line may be and still be said, in simulated seconds.
 * A preset handed over part-way into a phase, or a coast crossed at a day a
 * second, skips the lines it passed rather than reading them out in a burst.
 */
const STALE = 20

/** Speech rate the captions assume, words a second — the loop's measured pace. */
const WORDS_PER_SECOND = 2.6

/** Seconds a line is on screen: how long it takes to say, and a breath. */
export function lineSeconds(text) {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1.4, words / WORDS_PER_SECOND + 0.5)
}

/** Who a voice is, as the caption names it. */
export function speakerName(who, feed = FEED) {
  if (who === 'ground') return feed.ground
  if (who === 'crew') return feed.craft
  if (who === 'partner') return feed.partner ?? 'Spacecraft'
  /*
   * The count and the liftoff belong to Launch Control, at the Cape; Houston
   * takes the flight once the vehicle has cleared the tower, and from then on
   * the narration is Mission Control's. On the Moon it was Houston's all along.
   */
  const id = currentPhase().id
  return !feed.epoch && (id === 'PRE_LAUNCH' || id === 'LIFTOFF') ? 'Launch Control' : 'Mission Control'
}

/**
 * The loop's state. `current` is the transmission on the air, or null; the UI
 * captions it, and `onTransmit` hears each one begin and end.
 */
export const radio = {
  current: null,
  queue: [],
  fired: new Set(),
  lastPhase: '',
  lastT: -Infinity,
  signal: true,
  /** Wall-clock second the current transmission ends, and the next may start. */
  until: 0,
  /** Wall-clock second the next line may start at: a reply waits for light. */
  gate: 0,
  onTransmit: null,
  /**
   * Whether a line is still being said aloud. A synthesiser reads at its own
   * pace, so the caption holds until it has finished — for up to four seconds
   * past the line's own estimate, after which the loop moves on regardless.
   */
  busy: null,
  /** Mute switch: the scheduler still runs, so a muted loop does not replay later. */
  enabled: true,
}

/** Forget what has been said: a new flight, or a page that has reset. */
export function resetRadio() {
  radio.current = null
  radio.queue.length = 0
  radio.fired.clear()
  radio.lastPhase = ''
  radio.lastT = -Infinity
  radio.until = 0
  radio.gate = 0
  radio.signal = true
}

function enqueue(entry, now) {
  let previous = null
  // Spacecraft to spacecraft: an exchange with the other craft and not the
  // ground is VHF between the two, and needs no line of sight to the Earth.
  const toGround = entry.lines.some(([w]) => w === 'ground')
  const toPartner = entry.lines.some(([w]) => w === 'partner')
  for (const [who, text] of entry.lines) {
    const said = typeof text === 'function' ? text() : text
    // A count call-out — a line given a `pace` — is read on its second or not
    // at all; any other line keyed to the count is dialogue, and waits its turn.
    const counted = entry.T !== undefined && entry.pace !== undefined
    radio.queue.push({
      who,
      text: said,
      // Named now, not when shown: Launch Control does not become Mission
      // Control halfway through saying "one".
      speaker: speakerName(who),
      // A reply to the ground waits a round trip of light after the question.
      reply: previous === 'ground' && who === 'crew',
      // Count lines have a deadline; a late count is a wrong count. And they
      // cut in: the count is read on the second, whatever is still being said.
      deadline: counted ? now + entry.pace : Infinity,
      urgent: counted,
      vhf: who === 'partner' || (who === 'crew' && toPartner && !toGround),
      onboard: false,
    })
    previous = who
  }
}

/**
 * One tick of the loop. `now` is wall-clock seconds; `live` pace is read from
 * `rate`, the simulated seconds per wall second, so a coast crossed at speed
 * says nothing about it. Returns the transmission that began this tick, if any.
 */
export function radioTick(now, rate = 1) {
  const phase = currentPhase().id
  const phaseT = mission.phaseT
  const t = mission.t
  const quick = rate > 10
  // The clock ran backwards: the flight was reset, and everything can be said again.
  if (t < radio.lastT - 5) resetRadio()

  // Phase-keyed lines.
  for (let i = 0; i < SCRIPT.length; i++) {
    const entry = SCRIPT[i]
    if (radio.fired.has(i)) continue
    if (entry.phase !== undefined) {
      if (entry.phase !== phase || phaseT < entry.after) continue
      radio.fired.add(i)
      if (!quick && phaseT - entry.after <= STALE) enqueue(entry, now)
    } else if (entry.T !== undefined) {
      // Only a flight with a count reads one, and only as it is crossed.
      if (!(t >= entry.T)) continue
      radio.fired.add(i)
      const crossedNow = radio.lastT < entry.T && t - entry.T < (entry.pace ?? 2) + 0.25
      if (!quick && crossedNow) enqueue(entry, now)
    }
  }
  radio.lastT = t
  if (phase !== radio.lastPhase) radio.lastPhase = phase

  // The Moon in the way: announced by the ground, and it holds the queue.
  const lost = signalLost()
  if (lost === radio.signal) {
    radio.signal = !lost
    if (!quick && phase !== 'LUNAR_PRE_LAUNCH') {
      radio.queue.unshift({
        who: 'pao',
        text: lost ? `${FEED.craft} has gone behind the Moon. We have loss of signal.` : `We have acquisition of signal from ${FEED.craft}.`,
        speaker: speakerName('pao'),
        reply: false,
        deadline: Infinity,
        urgent: false,
      })
    }
  }

  // The air: one transmission at a time — except that the count cuts in.
  const cutIn = radio.queue.length > 0 && radio.queue[0].urgent && radio.current !== null
  if (radio.current && (cutIn || (now >= radio.until && !(radio.busy?.() && now < radio.until + 4)))) {
    const ended = radio.current
    radio.current = null
    radio.gate = now
    radio.onTransmit?.('end', ended)
  }
  if (radio.current || !radio.enabled) return null
  while (radio.queue.length) {
    const next = radio.queue[0]
    if (now > next.deadline) {
      radio.queue.shift()
      continue
    }
    /*
     * Nothing on the air-to-ground loop crosses the far side; the narration
     * can, and so can the two spacecraft talking to each other on VHF. The
     * public did not hear those live — they come from the recorders on board,
     * released after the flight, and the caption says so.
     */
    if (lost && next.who !== 'pao' && !next.vhf) return null
    next.onboard = lost && next.vhf
    const wait = next.reply ? roundTrip() : next.urgent ? 0 : 0.25
    if (now < radio.gate + wait) return null
    radio.queue.shift()
    radio.current = next
    // Held for as long as it takes to say; the next call-out of the count cuts
    // in on its own second if this one is still going.
    radio.until = now + lineSeconds(next.text)
    radio.onTransmit?.('start', next)
    return next
  }
  return null
}
