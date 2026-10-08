import * as THREE from 'three'
import { STATIONS, PLACES } from './world.js'
import { makeShip } from './flight.js'
import { shipStats } from './ships.js'

/**
 * The story, in two acts. Act One, "Periapsis": a debt, a choice between a
 * fixer and a patrol commander, and the Warden at the lunar south pole.
 * Act Two, "Apoapsis": the Ceres Line moves into the lanes the Hollow left,
 * and is not what it says it is.
 *
 * A mission is a list of steps; each step has an objective line, an
 * optional place it happens in (until you are there, the objective is to
 * get there), something it sets up when you arrive (`enter`), a marker, and
 * a test for done. Events (kills, pickups, docking, arriving, the surface)
 * are counted into the mission's scratch, `g.story.s`, which the tests read.
 *
 * Text may carry control tokens in brackets ([thrust], [dock], ...) that the
 * interface draws as the right key or touch button for the device.
 */
export const CHARACTERS = {
  mara: { name: 'Mara Voss', role: 'Dockmaster, Hearth Station', tone: 'ember' },
  rook: { name: 'Rook', role: 'Fixer, the Shackle', tone: 'ember' },
  chen: { name: 'Cmdr. Elias Chen', role: 'Lunar Compact patrol', tone: 'ion' },
  warden: { name: 'The Warden', role: 'The Hollow', tone: 'ember' },
  hollow: { name: 'Hollow raider', role: 'Open channel', tone: 'ember' },
  okafor: { name: 'Ines Okafor', role: 'Factor, the Ceres Line', tone: 'ion' },
  vex: { name: 'Vex', role: 'Rook\'s gun', tone: 'ember' },
  patrol: { name: 'Compact patrol', role: 'Lunar Compact', tone: 'ion' },
  control: { name: 'Station control', role: 'Traffic', tone: 'ion' },
}

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const dist = (g, at) => g.player.pos.distanceTo(at)
const alive = (g, tag) => g.ships.filter((e) => e.alive && e.tag === tag)
const port = (id) => STATIONS[id].port.at

function spawn(g, hull, team, at, tag, ai, label) {
  const e = makeShip(hull, team, shipStats(hull), at)
  e.tag = tag; e.ai = ai; e.label = label ?? e.stats.name
  const to = g.player.pos.clone().sub(at).normalize()
  e.q.setFromUnitVectors(V(0, 0, -1), to)
  g.ships.push(e)
  return e
}
function raiders(g, n, at, tag, mode = 'attack', skill = 0.45) {
  for (let i = 0; i < n; i++) spawn(g, 'raider', 'hollow', at.clone().add(V((i % 3 - 1) * 150, (i % 2) * 90, Math.floor(i / 3) * 170)), tag, { mode, target: g.player.id, center: at.clone(), radius: 900, home: 'patrol', skill, range: 9000 }, 'Hollow raider')
}
function canisters(g, n, center, tag, spread = 1500) {
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2
    g.canisters.push({ id: `${tag}-${i}`, at: center.clone().add(V(Math.cos(a) * spread * 0.5, (i % 2 ? 1 : -1) * 200, Math.sin(a) * spread * 0.5)), tag })
  }
}
const nearestCan = (g, tag) => g.canisters.find((c) => !c.taken && c.tag === tag)?.at ?? null
const kills = (g, tag) => g.story.s.kills?.[tag] ?? 0

// Training volumes, not precision docking points. The HUD and completion test
// share the same radius; entering the volume is enough, with no invisible hold.
export const TRAINING_TARGETS = [
  { at: V(0, 250, 2200), radius: 250, label: 'Flight checkpoint' },
  { at: V(1600, 700, 5200), radius: 350, label: 'Long-range checkpoint' },
]
const checkpoint = (i) => ({ at: () => TRAINING_TARGETS[i].at, radius: TRAINING_TARGETS[i].radius, label: TRAINING_TARGETS[i].label })
const reached = (g, i) => dist(g, TRAINING_TARGETS[i].at) <= TRAINING_TARGETS[i].radius
export const TUTORIAL_VERSION = 2
// Version-one saves stored numeric step indices. Preserve what was learned.
const OLD_ARRIVAL_STEPS = [0, 3, 5, 6, 8, 9]
/** The jamming countdown, while it lasts. */
const jam = (g) => { const left = (g.story.jamUntil ?? 0) - g.time; return left > 0 ? ` · jammed ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '' }

export const STORY = [
  {
    id: 'arrival', title: 'Arrival', giver: 'mara', at: 'hearth', pitch: 'Mara Voss wants to see you fly before anyone gives you work.',
    reward: { credits: 1500 },
    intro: [['mara', 'Berth nine, the Kestrel. I heard about the Aster. You made it back. That counts.'], ['mara', 'Mara Voss, dockmaster. Rook owns your debt, not your next decision. First, let us see if that patched ship still flies. Launch when you are ready.']],
    steps: [
      { title: 'Leave your berth', text: 'Launch with [launch].', detail: 'Mara is checking your survival skills. The ship will clear the bay for you.', doneText: 'Berth cleared', done: (g) => g.story.s.launched },
      { title: 'Make the ship move', text: 'Hold [thrust] to accelerate.', detail: 'Stay pointed into open space. Watch the speed number below rise. No target yet.', doneText: 'Thrust check passed', done: (g) => g.mode === 'flight' && g.player.ctrl.throttle > 0.5 && g.player.vel.length() > 30 },
      { title: 'Learn to stop', text: 'Release [thrust], then press [stop] to stop.', detail: 'With assist on, thrusters brake gradually. X also clears an advanced latched throttle. Wait until speed is below 5 m/s.', doneText: 'Braking check passed', done: (g) => g.mode === 'flight' && g.player.ctrl.fa && g.player.ctrl.throttle === 0 && g.player.vel.length() < 5 },
      { title: 'Reach the orange checkpoint', text: 'Steer with [aim], then hold [thrust] toward the diamond.', detail: 'Click the view to steer, or use arrow keys. An edge arrow points toward an off-screen target. Enter the 250 m zone; you do not need to hit its exact centre.', ...checkpoint(0), doneText: 'Checkpoint reached', done: (g) => reached(g, 0) },
      { title: 'Try a short boost', text: 'Hold [thrust] and [boost] together.', detail: 'Boost spends battery and takes longer to brake from. One short burst is enough.', doneText: 'Boost check passed', done: (g) => g.player.boosting },
      { title: 'Read the distance', text: 'Fly toward the next diamond with [thrust].', detail: 'Enter its 350 m zone. Release thrust early if the braking warning appears. Passing through the zone counts immediately.', ...checkpoint(1), doneText: 'Second checkpoint reached', done: (g) => reached(g, 1) },
      { title: 'Understand momentum', text: 'Press [fa] to coast, then [fa] again to restore assist.', detail: 'Assist OFF does not brake when you release thrust. Your velocity continues until thrusters change it.', doneText: 'Flight assist check passed', say: [['mara', 'Off, it is just you and Newton. Switch assist back on before the next check.']], done: (g) => g.story.s.faOff && g.player.ctrl.fa },
      {
        title: 'Choose a contact', text: 'Press [target] until Practice drone is selected.', detail: 'Look for its name and brackets. This drone has no weapons. Next we will test your guns.', doneText: 'Practice drone selected',
        enter: (g) => { if (alive(g, 'm:drone').length || kills(g, 'm:drone')) return; const e = spawn(g, 'raider', 'drone', V(1600, 600, 3600), 'm:drone', { mode: 'patrol', center: V(1600, 600, 3600), radius: 260, speed: 0.25 }, 'Practice drone'); e.stats = { ...e.stats, guns: 0 }; e.hull = 30; e.shield = 20 },
        ship: (g) => alive(g, 'm:drone')[0]?.id, done: (g) => kills(g, 'm:drone') >= 1 || g.byId(g.target)?.tag === 'm:drone',
      },
      { title: 'Defend yourself', text: 'Aim toward the drone and hold [fire].', detail: 'The small lead circle shows where a moving target will be when your shots arrive. Drag-to-steer fallback: K fires.', doneText: 'Weapons check passed',
        enter: (g) => { if (!alive(g, 'm:drone').length && !kills(g, 'm:drone')) STORY[0].steps[7].enter(g) },
        ship: (g) => alive(g, 'm:drone')[0]?.id, done: (g) => kills(g, 'm:drone') >= 1 },
      { title: 'Come home safely', text: 'Return to Hearth’s lit bay and press [dock] when prompted.', detail: 'Release thrust or press X to brake. Docking requires under 70 m/s, within 350 m of the port. The Action prompt confirms when you can dock.', at: () => port('hearth'), label: 'Hearth docking port', radius: 350, doneText: 'Docked safely', done: (g) => g.story.s.docked === 'hearth' },
    ],
    outro: [['mara', 'You can move, stop, navigate, defend yourself, and come home. Flight clearance granted.'], ['mara', 'The lanes are yours now. Take Honest Work here for a guided first delivery, choose a paid job, or visit flight school. Rook owns your debt, not your time.']],
  },
  {
    id: 'honest-work', title: 'Honest Work', giver: 'mara', at: 'hearth', after: 'arrival', pitch: 'A sealed case for Harbor. Your first transfer.',
    reward: { credits: 4000 },
    intro: [['mara', 'Sealed case for Harbor, low Earth orbit. Three hundred thousand kilometres: about six hours under thrust.'], ['mara', 'Watch the flip at the midpoint. It is the best view you will get all week.']],
    steps: [
      { text: 'Open the map with [map] and choose Harbor as your destination', done: (g) => g.dest === 'harbor' || g.place === 'harbor' || g.mode === 'transfer' },
      { text: 'Engage the drive with [transfer]', place: 'harbor', done: (g) => g.place === 'harbor' && g.mode === 'flight' },
      { text: 'Dock at Harbor', place: 'harbor', at: () => port('harbor'), say: [['control', 'Harbor control. Welcome to low Earth orbit, Kestrel. Your bay is lit.']], done: (g) => g.story.s.docked === 'harbor' },
    ],
    outro: [['mara', 'Case delivered. Four thousand is in your account.'], ['mara', 'Next time, the Drift. Salvage. Bring guns.']],
  },
  {
    id: 'scrap', title: 'Scrap', giver: 'mara', at: 'hearth', after: 'honest-work', pitch: 'Salvage in the Drift. The Hollow say it is theirs.',
    reward: { credits: 6000 },
    intro: [['mara', 'Kessler Mining left a fortune in the Drift when they went under. Four canisters with my name on them.'], ['mara', 'The Hollow work that rock. If they come, do not run in a straight line.']],
    steps: [
      { text: 'Transfer to the Drift', place: 'drift', done: (g) => g.place === 'drift' },
      {
        text: (g) => `Scoop the canisters: fly through them under 120 m/s (${g.story.s.got ?? 0} of 4)`, place: 'drift',
        enter: (g) => { if (!g.story.s.placed) { g.story.s.placed = true } canisters(g, 4 - (g.story.s.got ?? 0), V(-2200, 400, -1800), 'm:scrap', 1600) },
        at: (g) => nearestCan(g, 'm:scrap'), done: (g) => (g.story.s.got ?? 0) >= 2,
      },
      {
        text: (g) => `Hollow raiders: destroy them (${kills(g, 'm:raid')} of 3)`, place: 'drift',
        enter: (g) => { raiders(g, 3 - kills(g, 'm:raid'), g.player.pos.clone().add(V(2400, 300, -1500)), 'm:raid'); g.say('hollow', 'That is ours, little bird.'); g.say('mara', 'Shields take the first hits. Keep moving. Target with [target] and lead the marker.') },
        ship: (g) => alive(g, 'm:raid')[0]?.id, done: (g) => kills(g, 'm:raid') >= 3,
      },
      { text: (g) => `Scoop the rest (${g.story.s.got ?? 0} of 4)`, place: 'drift', enter: (g) => { if (!g.canisters.some((c) => c.tag === 'm:scrap' && !c.taken)) canisters(g, 4 - (g.story.s.got ?? 0), V(-2200, 400, -1800), 'm:scrap', 1600) }, at: (g) => nearestCan(g, 'm:scrap'), done: (g) => (g.story.s.got ?? 0) >= 4 },
      { text: 'Bring it home: dock at Hearth', place: 'hearth', at: () => port('hearth'), done: (g) => g.story.s.docked === 'hearth', finish: (g) => { g.ship.cargo.salvage = Math.max(0, (g.ship.cargo.salvage ?? 0) - 4); if (!g.ship.cargo.salvage) delete g.ship.cargo.salvage } },
    ],
    outro: [['mara', 'Not a scratch on the cargo. More than I can say for you.'], ['rook', 'Saw what you did out there, friend. Come and see me at the Shackle, in the Drift. Bring yourself.']],
  },
  {
    id: 'friend', title: 'A Friend of a Friend', giver: 'rook', at: 'shackle', after: 'scrap', pitch: 'A crate for Gateway. Ten thousand off your debt.',
    reward: { credits: 2000, debt: 10000 }, hold: 2,
    intro: [['rook', 'Forty thousand. You know what that is in grey chips? Two crates.'], ['rook', 'Gateway. There is a dead drop behind the solar wings. The patrol scans near their stations, so do not dawdle. Ten off your debt.']],
    start: (g) => { g.ship.cargo.chips = (g.ship.cargo.chips ?? 0) + 2 },
    steps: [
      { text: 'Transfer to Gateway with the crates', place: 'gateway', done: (g) => g.place === 'gateway' },
      {
        text: 'Fly to the dead drop behind Gateway', place: 'gateway', at: () => V(4200, -900, -3000),
        // A cutter is sitting on the drop. It scans whoever comes close.
        enter: (g) => { if (alive(g, 'm:scanner').length) return; const e = spawn(g, 'cutter', 'compact', V(4700, -700, -2400), 'm:scanner', { mode: 'patrol', center: V(4500, -800, -2700), radius: 500, home: 'patrol', skill: 0.55 }, 'Compact cutter'); e.sure = true },
        done: (g) => dist(g, V(4200, -900, -3000)) < 80,
        finish: (g) => { g.ship.cargo.chips = Math.max(0, (g.ship.cargo.chips ?? 0) - 2); if (!g.ship.cargo.chips) delete g.ship.cargo.chips; g.say('rook', 'Drop made. Now get yourself out of there.') },
      },
      { text: 'Lose the patrol: get out of their sight until the heat drops', place: 'gateway', when: (g) => g.heat.level > 0, done: (g) => g.heat.level === 0 },
      { text: 'Back to the Shackle', place: 'drift', at: () => port('shackle'), done: (g) => g.story.s.docked === 'shackle' },
    ],
    events: { heat: (g, ev) => { if (ev.why === 'contraband' && !g.story.s.chen) { g.story.s.chen = true; g.say('chen', 'This is Commander Chen. Whoever you are, that was clumsy.') } } },
    outro: [['rook', 'Ten off. Thirty to go. See? We are friends already.']],
  },
  {
    id: 'down-low', title: 'Down Low', giver: 'rook', at: 'shackle', after: 'friend', pitch: 'A survey core lost at Shackleton. Land and get it.',
    reward: { credits: 8000, debt: 5000 },
    intro: [['rook', 'The ice consortium lost a survey core at the south pole. Lost, as in they do not know I know where it is.'], ['rook', 'Land, take the readings, set a station so it looks legitimate, and come back up. Five off the debt.']],
    steps: [
      { text: 'Transfer to Shackleton, above the lunar south pole', place: 'shackleton', done: (g) => g.place === 'shackleton' },
      { text: 'Fly into the descent corridor and press [dock] to land', place: 'shackleton', at: () => V(0, 0, 0), done: (g) => g.story.s.surface?.complete },
      { text: 'Back to the Shackle with the core', place: 'drift', at: () => port('shackle'), done: (g) => g.story.s.docked === 'shackle' },
    ],
    events: { 'surface-done': (g, ev) => { if (!ev.result?.complete) g.say('rook', 'No core? Go back down. It is not going anywhere.') } },
    outro: [['rook', 'Beautiful. Twenty-five to go.'], ['rook', 'One thing. A patrol commander has been asking about a Kestrel at Gateway. Keep your head down at Hearth.']],
  },
  {
    id: 'chen', title: 'Chen', giver: 'chen', at: 'hearth', after: 'down-low', pitch: 'Commander Chen is waiting in your berth.',
    reward: {},
    intro: [['chen', 'Elias Chen, Lunar Compact. Sit down. The Aster recorder is why I came. Someone sold your convoy’s route.'], ['chen', 'Gateway. Two crates of grey chips, a dead drop, and a Kestrel running dark. I could take your ship today.'], ['chen', 'Or. The Hollow have bled these lanes for a year. Their boss calls himself the Warden. Help me find him, and Gateway never happened.'], ['chen', 'Think about who you owe. Rook will not.']],
    steps: [
      { text: 'Choose: help Chen, or stay with Rook', docked: true, choice: { prompt: 'Who do you fly for?', options: [{ id: 'chen', label: 'Help Chen take down the Hollow' }, { id: 'rook', label: 'Stay with Rook' }] }, done: (g) => Boolean(g.story.choice) },
    ],
    outroFor: (g) => (g.story.choice === 'chen' ? [['chen', 'Good. My wing meets you in the Drift. Find me at Hearth when you are ready.']] : [['chen', 'Your call. I will be seeing you.'], ['rook', 'Heard you had a visitor. Heard you kept your mouth shut. Come and see me.']]),
  },
  {
    id: 'raid', title: 'The Raid', giver: 'chen', at: 'hearth', after: 'chen', when: (g) => g.story.choice === 'chen', pitch: 'Hit the Hollow in the Drift with Chen\'s wing.',
    reward: { credits: 15000 }, quiet: true,
    intro: [['chen', 'Two of mine and me. The Hollow keep pickets round the Shackle. We cut through them and see who comes out to play.']],
    steps: [
      { text: 'Transfer to the Drift', place: 'drift', done: (g) => g.place === 'drift' },
      {
        text: 'Form up with Chen\'s wing', place: 'drift',
        enter: (g) => { for (let i = 0; i < 3; i++) spawn(g, 'wing', 'ally', g.player.pos.clone().add(V(-200 + i * 200, 80, 600)), 'm:wing', { mode: 'escort', slot: i, home: 'escort', skill: 0.7 }, i === 0 ? 'Cmdr. Chen' : 'Compact wingman') },
        ship: (g) => alive(g, 'm:wing')[0]?.id, done: (g) => { const c = alive(g, 'm:wing')[0]; return !c || dist(g, c.pos) < 500 },
      },
      {
        text: (g) => `Destroy the Hollow pickets (${kills(g, 'm:pickets')} of 4)`, place: 'drift',
        enter: (g) => { raiders(g, 4 - kills(g, 'm:pickets'), V(4200, 500, -1600), 'm:pickets', 'patrol', 0.5); g.say('chen', 'Pickets ahead. Weapons free.') },
        ship: (g) => alive(g, 'm:pickets')[0]?.id, at: () => V(4200, 500, -1600), done: (g) => kills(g, 'm:pickets') >= 4,
      },
      {
        text: (g) => `The Warden\'s escort: destroy them (${kills(g, 'm:escort')} of 3)`, place: 'drift',
        enter: (g) => {
          raiders(g, 3 - kills(g, 'm:escort'), V(5200, 900, -2600), 'm:escort', 'attack', 0.6)
          if (!g.story.s.wardenSeen) { g.story.s.wardenSeen = true; const w = spawn(g, 'warden', 'hollow', V(5600, 1100, -3000), 'm:warden', { mode: 'flee', goal: V(-25000, -6000, 20000) }, 'The Warden'); w.ai.passive = true; g.say('warden', 'Chen. And a new friend. Kill them both.') }
        },
        ship: (g) => alive(g, 'm:escort')[0]?.id, done: (g) => kills(g, 'm:escort') >= 3,
      },
    ],
    outro: [['chen', 'He ran. Toward the Moon, by his vector. He has a bolt-hole at the south pole.'], ['chen', 'Rest up. When you are ready, we finish it at Shackleton.']],
  },
  {
    id: 'convoy', title: 'The Convoy', giver: 'rook', at: 'shackle', after: 'chen', when: (g) => g.story.choice === 'rook', pitch: 'A Compact supply barge is leaving Hearth. Rook wants what is in it.',
    reward: { credits: 6000, debt: 15000 }, quiet: true,
    intro: [['rook', 'A Compact barge leaves Hearth with two cutters on it. Medical, rations, and something Chen very much wants kept quiet.'], ['rook', 'Kill the escort, crack the barge, scoop what falls out. You will be hot. Come straight here; we do not mind.']],
    steps: [
      { text: 'Transfer to Hearth', place: 'hearth', done: (g) => g.place === 'hearth' },
      {
        text: (g) => `Destroy the convoy\'s escort (${kills(g, 'm:escort')} of 2)${jam(g)}`, place: 'hearth',
        enter: (g) => {
          if (!g.story.jamUntil) { g.story.jamUntil = g.time + 150; g.say('rook', 'I have jammed their distress call. You have two and a half minutes before Hearth\'s patrol hears a thing.') }
          // Rook does not send you alone.
          if (!alive(g, 'm:vex').length && !g.story.s.vexLost) { spawn(g, 'raider', 'ally', g.player.pos.clone().add(V(220, 60, 400)), 'm:vex', { mode: 'escort', slot: 1, home: 'escort', skill: 0.75 }, 'Vex'); g.say('vex', 'Vex. Rook\'s gun. I take the left cutter, you take the right.') }
          if (!g.story.s.barge) {
            const b = spawn(g, 'freighter', 'compact', V(-2500, 300, 6000), 'm:barge', { mode: 'route', points: [V(-9000, 2000, 24000)], leg: 0, onEnd: 'hold', speed: 0.35, passive: true }, 'Compact supply barge')
            g.story.s.barge = b.id
            for (let i = 0; i < 2 - kills(g, 'm:escort'); i++) spawn(g, 'cutter', 'compact', V(-2400 + i * 300, 450, 5800), 'm:escort', { mode: 'follow', lead: b.id, slot: i, home: 'follow', skill: 0.5 }, 'Convoy escort')
          }
        },
        ship: (g) => alive(g, 'm:escort')[0]?.id, done: (g) => kills(g, 'm:escort') >= 2,
      },
      {
        text: (g) => `Disable the barge: bring its hull under half${jam(g)}`, place: 'hearth', ship: (g) => g.story.s.barge,
        done: (g) => { const b = g.byId(g.story.s.barge); return !b || b.hull < b.stats.hull * 0.5 },
        finish: (g) => { const b = g.byId(g.story.s.barge); if (b) { b.ai.mode = 'hold'; canisters(g, 3, b.pos.clone(), 'm:convoy', 300) } else canisters(g, 3, g.player.pos.clone().add(V(0, 0, -600)), 'm:convoy', 300) },
      },
      { text: (g) => `Scoop the cargo (${g.story.s.got ?? 0} of 3)${jam(g)}`, place: 'hearth', at: (g) => nearestCan(g, 'm:convoy'), done: (g) => (g.story.s.got ?? 0) >= 3 },
      { text: 'Get to the Shackle. They will dock you hot.', place: 'drift', at: () => port('shackle'), done: (g) => g.story.s.docked === 'shackle', finish: (g) => { g.ship.cargo.salvage = Math.max(0, (g.ship.cargo.salvage ?? 0) - 3); if (!g.ship.cargo.salvage) delete g.ship.cargo.salvage } },
    ],
    outro: [['rook', 'Fifteen off. You are nearly a free woman, or man, or whatever you are.'], ['rook', 'The Warden wants to meet you. Shackleton, over the pole. He says he has a proposal. I say bring your guns.']],
  },
  {
    id: 'periapsis', title: 'Periapsis', giver: (g) => (g.story.choice === 'rook' ? 'rook' : 'chen'), at: (g) => (g.story.choice === 'rook' ? 'shackle' : 'hearth'),
    after: (g) => (g.story.choice === 'rook' ? 'convoy' : 'raid'), pitch: 'The Warden. The Moon. The lowest point.',
    reward: { credits: 30000, clearDebt: true }, quiet: true, noPatrol: true,
    introFor: (g) => (g.story.choice === 'rook' ? [['rook', 'Shackleton. Sixty kilometres over the pole. Go and hear him out.'], ['rook', 'And if he is lying, which he is, you know what to do.']] : [['chen', 'Shackleton, sixty kilometres over the south pole. His bolt-hole is down there somewhere.'], ['chen', 'My wing is with you. This ends today.']]),
    steps: [
      { text: 'Transfer to Shackleton', place: 'shackleton', done: (g) => g.place === 'shackleton' },
      {
        text: 'Find the Warden', place: 'shackleton', at: () => V(3000, -400, -6000),
        enter: (g) => {
          const chen = g.story.choice === 'chen'
          if (chen) for (let i = 0; i < 3; i++) spawn(g, 'wing', 'ally', g.player.pos.clone().add(V(-200 + i * 200, 80, 600)), 'm:wing', { mode: 'escort', slot: i, home: 'escort', skill: 0.7 }, i === 0 ? 'Cmdr. Chen' : 'Compact wingman')
          if (!g.story.s.boss) {
            const w = spawn(g, 'warden', 'hollow', V(3000, -400, -6000), 'm:warden', { mode: 'hold', skill: 0.75, brave: true, range: 12000 }, 'The Warden')
            w.ai.passive = true
            g.story.s.boss = true
            raiders(g, 4, V(3400, -200, -5600), 'm:guard', 'hold', 0.6)
          }
        },
        ship: (g) => alive(g, 'm:warden')[0]?.id, done: (g) => { const w = alive(g, 'm:warden')[0]; return !w || dist(g, w.pos) < 3200 },
        finish: (g) => {
          for (const e of g.ships) if (e.tag === 'm:guard' || e.tag === 'm:warden') { e.ai.mode = 'attack'; e.ai.target = g.player.id; e.ai.passive = false }
          if (g.story.choice === 'rook') {
            g.say('warden', 'Little bird. Rook sold you to me a week ago. Nothing personal.')
            g.say('chen', 'Thought you might need a hand. Do not make me regret it.')
            for (let i = 0; i < 2; i++) spawn(g, 'wing', 'ally', g.player.pos.clone().add(V(-400 + i * 800, 300, 2500)), 'm:wing', { mode: 'escort', slot: i, home: 'escort', skill: 0.7 }, i === 0 ? 'Cmdr. Chen' : 'Compact wingman')
          } else g.say('warden', 'Chen\'s little bird. You should have stayed in your cage.')
        },
      },
      {
        text: 'Destroy the Warden', place: 'shackleton', ship: (g) => alive(g, 'm:warden')[0]?.id,
        enter: (g) => { if (!alive(g, 'm:warden').length && !g.story.s.kills?.['m:warden']) { const w = spawn(g, 'warden', 'hollow', g.player.pos.clone().add(V(2500, 300, -2500)), 'm:warden', { mode: 'attack', target: g.player.id, skill: 0.75, brave: true, range: 12000 }, 'The Warden'); w.ai.passive = false } },
        done: (g) => kills(g, 'm:warden') >= 1,
      },
    ],
    outroFor: (g) => (g.story.choice === 'rook'
      ? [['chen', 'That is the Warden done. And Rook, I think, is about to have a very bad day.'], ['rook', 'Friend! I heard. I never doubted you. The debt? Paid. All of it. Let us never speak of it.']]
      : [['chen', 'That is the Warden. Clean work.'], ['chen', 'And Rook\'s ledger came out of the Shackle this morning. You owe nobody anything. Fly what you like.']]),
    epilogue: 'Act One complete. The Hollow are broken and the debt is gone. Mara has news at Hearth: Act Two, Apoapsis, begins there.',
  },

  /* ---------------------------------------------------------------- *
   * Act Two: Apoapsis
   * ---------------------------------------------------------------- */
  {
    id: 'new-money', title: 'New Money', giver: 'mara', at: 'hearth', after: 'periapsis', pitch: 'The Ceres Line wants an escort out of Harbor, and asked for you by name.',
    reward: { credits: 12000 }, quiet: true,
    intro: [['mara', 'The Warden is a week dead and the lanes have never been busier. The Ceres Line bought Harbor\'s docking rights on Monday. Bought them.'], ['mara', 'Now they want an escort for a medical freighter out of Harbor, and they asked for you by name. Go and find out why.']],
    steps: [
      { text: 'Transfer to Harbor', place: 'harbor', done: (g) => g.place === 'harbor' },
      {
        text: 'Meet the Ceres freighter Providence', place: 'harbor',
        enter: (g) => ward(g, V(900, 120, -1300)),
        at: (g) => g.byId(g.story.s.ward)?.pos ?? null, ship: (g) => g.story.s.ward, done: (g) => { const w = g.byId(g.story.s.ward); return Boolean(w) && dist(g, w.pos) < 900 },
        fail: lostWard,
        finish: (g) => {
          g.story.s.goal = driveFrom(g, g.byId(g.story.s.ward).pos)
          ward(g)
          g.say('okafor', 'Ines Okafor, the Ceres Line. Providence carries the only antiviral stock this side of the Moon. Get her to the drive point.')
        },
      },
      {
        text: (g) => { const w = g.byId(g.story.s.ward); return `Escort the Providence to the drive point (hull ${w ? Math.round(w.hull / w.stats.hull * 100) : 0}%)` }, place: 'harbor',
        // After a respawn she is back where the escort left her, under way.
        enter: (g) => { ward(g, V(700, 100, -900)); if (!g.story.s.wave1) { g.story.s.wave1 = true; packOn(g, 3, 'm:pack', V(3000, 700, -3800)) } },
        at: (g) => g.story.s.goal ?? null, ship: (g) => alive(g, 'm:pack')[0]?.id ?? g.story.s.ward,
        done: (g) => {
          const w = g.byId(g.story.s.ward)
          if (!w) return false
          // Two more come from behind once she is halfway and the first pack is down.
          if (!g.story.s.wave2 && w.pos.distanceTo(g.story.s.goal) < 4200 && !alive(g, 'm:pack').length) { g.story.s.wave2 = true; packOn(g, 2, 'm:pack', V(-2600, -500, 3200)); g.say('hollow', 'Ceres freighter. Nothing personal.') }
          return w.ai.leg >= 1 && !alive(g, 'm:pack').length
        },
        fail: lostWard,
        finish: (g) => { const w = g.byId(g.story.s.ward); if (w) w.ai = { mode: 'route', points: [w.pos.clone().add(V(0, 0, -30000))], leg: 0, onEnd: 'despawn', speed: 1, passive: true } },
      },
      { text: 'Dock at Harbor', place: 'harbor', at: () => port('harbor'), done: (g) => g.story.s.docked === 'harbor' },
    ],
    outro: [['okafor', 'Providence is through. The Ceres Line pays its debts, pilot.'], ['mara', 'Funny thing. Providence went into the drive and never came out anywhere I can see. Okafor will have more work for you. Take it, and keep your eyes open.']],
  },
  {
    id: 'ghost-signal', title: 'Ghost Signal', giver: 'okafor', at: 'harbor', after: 'new-money', pitch: 'A Ceres tug went silent in the Drift. Okafor wants its recorder.',
    reward: { credits: 6000 },
    intro: [['okafor', 'A Ceres tug, the Halcyon, went silent in the Drift two days ago. Her flight recorder is company property.'], ['okafor', 'Find her, pull the recorder, bring it to me. Discretion is worth fourteen thousand.']],
    steps: [
      { text: 'Transfer to the Drift', place: 'drift', done: (g) => g.place === 'drift' },
      {
        text: 'Find the derelict Halcyon', place: 'drift', at: () => HALCYON,
        enter: (g) => { if (!alive(g, 'm:halcyon').length) { const e = spawn(g, 'freighter', 'civil', HALCYON.clone(), 'm:halcyon', { mode: 'hold', passive: true }, 'Halcyon (derelict)'); e.q.setFromEuler(new THREE.Euler(0.6, 2.1, 1.1)); e.hull = e.stats.hull * 0.2; e.shield = 0; e.derelict = true } },
        ship: (g) => alive(g, 'm:halcyon')[0]?.id, done: (g) => dist(g, HALCYON) < 600,
      },
      {
        text: (g) => `Hold within 150 m and nearly still to pull the recorder (${Math.round(Math.min(1, pull(g) / 6) * 100)}%)`, place: 'drift', at: () => HALCYON,
        say: [['okafor', 'The recorder is in her spine. Hold close and still; the clamps do the rest.']],
        done: (g) => {
          const s = g.story.s
          if (dist(g, HALCYON) < 150 && g.player.vel.length() < 25) { if (s.pullFrom == null) s.pullFrom = g.time } else s.pullFrom = null
          return pull(g) >= 6
        },
        finish: (g) => { g.story.s.recorder = true; g.say('mara', 'Before you hand that to anyone, play it. I am patching it through to Hearth now.') },
      },
      {
        text: (g) => `Raiders with Hollow paint: destroy them (${kills(g, 'm:ambush')} of 3)`, place: 'drift',
        enter: (g) => { const n = 3 - kills(g, 'm:ambush'); if (n > 0 && !alive(g, 'm:ambush').length) { raiders(g, n, g.player.pos.clone().add(V(-2600, 500, 2400)), 'm:ambush', 'attack', 0.5); g.say('mara', 'Three contacts. Hollow paint, but their transponders say Ceres Line security. Somebody wants that recorder back.') } },
        ship: (g) => alive(g, 'm:ambush')[0]?.id, done: (g) => kills(g, 'm:ambush') >= 3,
      },
      { text: 'Take the recorder to Mara at Hearth, not to Okafor', place: 'hearth', at: () => port('hearth'), done: (g) => g.story.s.docked === 'hearth' },
    ],
    outro: [['mara', 'The Halcyon was not hit by the Hollow. Her recorder logged Ceres Line security codes on the ships that killed her.'], ['mara', 'I compared the Halcyon’s dispatch signature with your Aster recorder. Same relay key. The route was sold through a Ceres shell company before the Hollow ever saw it.'], ['mara', 'And the Providence filed no manifest. The Ceres Line is arming somebody. Six thousand from me; it is not fourteen, but it is clean. Chen needs to hear this.']],
  },
  {
    id: 'loop', title: 'The Loop', giver: 'chen', at: 'hearth', after: 'ghost-signal', pitch: 'Get close to Okafor\'s yacht at Harbor. The way in is a race.',
    reward: { credits: 10000 }, quiet: true,
    intro: [['chen', 'Okafor\'s yacht, the Meridian, sits at Harbor. She runs the Harbor Loop for sport, and the fast ones get invited aboard.'], ['chen', 'Run the Loop in under two minutes. Then get within a hundred and fifty metres of the Meridian, and Mara\'s tracker does the rest.']],
    steps: [
      { text: 'Transfer to Harbor', place: 'harbor', done: (g) => g.place === 'harbor' },
      {
        text: (g) => (g.race?.start != null ? `Harbor Loop: ring ${g.race.next + 1} of ${g.rings.length}` : 'Harbor Loop: fly through the first ring to start the clock') + (g.story.s.best ? ` · best ${g.story.s.best.toFixed(1)} s` : ''), place: 'harbor',
        enter: (g) => { if (!g.race) { g.race = { next: 0, start: null }; g.emit({ type: 'race-ready' }) } },
        at: (g) => g.rings[g.race?.next ?? 0] ?? null, done: (g) => (g.story.s.best ?? Infinity) <= LOOP_PAR,
      },
      {
        text: 'Fly within 150 m of the Meridian', place: 'harbor',
        enter: (g) => { if (!alive(g, 'm:meridian').length) { const e = spawn(g, 'warden', 'civil', MERIDIAN.clone(), 'm:meridian', { mode: 'hold', passive: true }, 'Meridian (Ceres Line)'); e.stats = { ...e.stats, guns: 0 } } },
        at: () => MERIDIAN, ship: (g) => alive(g, 'm:meridian')[0]?.id, done: (g) => dist(g, MERIDIAN) < 150,
        finish: (g) => { g.say('okafor', 'You fly beautifully, pilot. When Chen is finished with you, come and work for me.'); g.say('mara', 'Tracker is on her hull. Come home.') },
      },
      { text: 'Back to Hearth', place: 'hearth', at: () => port('hearth'), done: (g) => g.story.s.docked === 'hearth' },
    ],
    events: {
      'race-done': (g, ev) => {
        const s = g.story.s
        s.best = Math.min(s.best ?? Infinity, ev.time)
        if (ev.time > LOOP_PAR) { g.say('chen', `${ev.time.toFixed(1)} seconds. Not fast enough to be interesting. Go again.`); g.race = { next: 0, start: null } } else g.say('okafor', `${ev.time.toFixed(1)} seconds. Who taught you to fly like that?`)
      },
    },
    outro: [['mara', 'The tracker is live. The Meridian just left Harbor with six strike craft behind her, on a vector for Gateway.'], ['chen', 'Gateway. The Ceres Line wants the Compact\'s only station at the Moon. Not today.']],
  },
  {
    id: 'apoapsis', title: 'Apoapsis', giver: 'chen', at: 'hearth', after: 'loop', pitch: 'The Ceres Line is going for Gateway. Meet them there.',
    reward: { credits: 40000 }, quiet: true,
    introFor: (g) => [['chen', 'Six strike craft and the Meridian, against my wing, Gateway\'s patrol, and you.'], ...(g.story.choice === 'rook' ? [['vex', 'Rook says this one is on the house. Do not get used to it.']] : []), ['chen', 'Apoapsis: the highest point of the orbit, where you are slowest. That is where they think we are. Let us show them.']],
    steps: [
      { text: 'Transfer to Gateway', place: 'gateway', done: (g) => g.place === 'gateway' },
      {
        text: (g) => `Defend Gateway: destroy the Ceres strike craft (${kills(g, 'm:strike')} of 6)`, place: 'gateway',
        enter: (g) => {
          if (!alive(g, 'm:wing').length) for (let i = 0; i < 3; i++) spawn(g, 'wing', 'ally', g.player.pos.clone().add(V(-200 + i * 200, 80, 600)), 'm:wing', { mode: 'escort', slot: i, home: 'escort', skill: 0.7 }, i === 0 ? 'Cmdr. Chen' : 'Compact wingman')
          if (g.story.choice === 'rook' && !alive(g, 'm:vex').length) spawn(g, 'raider', 'ally', g.player.pos.clone().add(V(300, -60, 500)), 'm:vex', { mode: 'escort', slot: 3, home: 'escort', skill: 0.75 }, 'Vex')
          const left = Math.min(3, 6 - kills(g, 'm:strike') - alive(g, 'm:strike').length)
          if (left > 0 && !alive(g, 'm:strike').length) { strike(g, left); g.say('chen', 'Here they come. Weapons free.') }
        },
        ship: (g) => alive(g, 'm:strike')[0]?.id,
        done: (g) => {
          // The second three come in when the first are down.
          if (kills(g, 'm:strike') >= 3 && !alive(g, 'm:strike').length && kills(g, 'm:strike') < 6) { strike(g, 6 - kills(g, 'm:strike')); g.say('mara', 'Second wave, coming round the Moon\'s limb.') }
          return kills(g, 'm:strike') >= 6
        },
      },
      {
        text: 'Destroy the Meridian', place: 'gateway', ship: (g) => alive(g, 'm:flag')[0]?.id,
        enter: (g) => {
          if (!alive(g, 'm:flag').length && !kills(g, 'm:flag')) {
            spawn(g, 'warden', 'hollow', g.player.pos.clone().add(V(3200, 600, -3400)), 'm:flag', { mode: 'attack', target: g.player.id, skill: 0.75, brave: true, range: 12000 }, 'Meridian')
            g.say('okafor', 'Pilot. I offered you a job. This is the other offer.')
          }
        },
        done: (g) => kills(g, 'm:flag') >= 1,
      },
      { text: 'Dock at Gateway', place: 'gateway', at: () => port('gateway'), done: (g) => g.story.s.docked === 'gateway' },
    ],
    outro: [['chen', 'The Meridian is scrap and Okafor is in a Compact cell. The Ceres Line\'s charter is revoked as of this hour.'], ['mara', 'The Aster crew’s families have the record now. Not a rumour, not a company statement. What actually happened. You brought it home.'], ['mara', 'Drinks at Hearth. All of them. And pilot: thank you.']],
    epilogue: 'The story is complete. The Hollow are gone, the Ceres Line is finished, and you owe nobody anything. The lanes, the job board, the market and every station are yours.',
  },
]
const HALCYON = V(-5200, -600, 4200)
const LOOP_PAR = 120
const MERIDIAN = V(2600, 500, -2200)
/**
 * The Providence: found where she is, or brought in at an offset from you
 * (a fresh place after a transfer or a respawn); under way once there is a goal.
 */
function ward(g, offset) {
  const s = g.story.s
  let w = g.byId(s.ward)
  if ((!w || !w.alive) && offset) {
    w = spawn(g, 'freighter', 'ally', g.player.pos.clone().add(offset), 'm:ward', { mode: 'hold', passive: true }, 'Providence')
    w.stats = { ...w.stats, shield: 1400 }; w.shield = 1400
    s.ward = w.id
    // Brought back after a respawn: a fresh course from here.
    if (s.goal) s.goal = driveFrom(g, w.pos)
  }
  if (w && s.goal) w.ai = { mode: 'route', points: [s.goal.clone()], leg: 0, onEnd: 'hold', speed: 0.6, passive: true }
}
/** The drive point: 8 km on, directly away from the station, so her course never crosses it. */
function driveFrom(g, from) {
  const st = g.stations[0]
  const away = st ? from.clone().sub(st.at).setY(0) : V(1, 0, -1)
  if (away.lengthSq() < 1) away.set(1, 0, -1)
  return from.clone().addScaledVector(away.normalize(), 8000).add(V(0, 900, 0))
}
function lostWard(g) { return kills(g, 'm:ward') > 0 ? 'The Providence was destroyed.' : null }
const pull = (g) => (g.story.s.pullFrom == null ? 0 : g.time - g.story.s.pullFrom)
/** Raiders that go for the escorted ship as well as for you. */
function packOn(g, n, tag, offset) {
  const w = g.byId(g.story.s.ward)
  raiders(g, n, (w?.pos ?? g.player.pos).clone().add(offset), tag, 'attack', 0.5)
  if (w) alive(g, tag).slice(-n).forEach((e, i) => { if (i % 3 === 0) e.ai.target = w.id })
}
/** The Ceres strike craft: raider hulls in company grey, flying for pay. */
function strike(g, n) {
  raiders(g, n, g.player.pos.clone().add(V(4200, 700, -4600)), 'm:strike', 'attack', 0.55)
  for (const e of alive(g, 'm:strike')) e.label = 'Ceres strike craft'
}
const BY_ID = Object.fromEntries(STORY.map((m) => [m.id, m]))
export const mission = (id) => BY_ID[id]
const val = (x, g) => (typeof x === 'function' ? x(g) : x)

/** Missions that could start at this station now. */
export function storyOffers(g, station) {
  return STORY.filter((m) => available(g, m) && val(m.at, g) === station)
}
/** Every mission waiting somewhere, for the "what next" line. */
export function storyNext(g) {
  return STORY.filter((m) => available(g, m)).map((m) => ({ id: m.id, title: m.title, giver: val(m.giver, g), at: val(m.at, g) }))
}
function available(g, m) {
  const st = g.story
  if (st.done.includes(m.id) || st.active === m.id) return false
  const after = val(m.after, g)
  if (after && !st.done.includes(after)) return false
  if (m.when && !m.when(g)) return false
  return true
}

export function startStory(g, id) {
  const m = BY_ID[id]
  if (!m || !available(g, m) || g.story.active) return 'Not now.'
  if (m.hold) {
    const used = Object.values(g.ship.cargo).reduce((n, v) => n + v, 0)
    if (g.player.stats.cargo - used < m.hold) return `Needs ${m.hold} free hold.`
  }
  g.story.active = id
  g.story.step = 0
  g.story.s = {}
  if (id === 'arrival') g.story.tutorialVersion = TUTORIAL_VERSION
  if (m.start) m.start(g)
  applyFlags(g, m)
  for (const [who, text] of val(m.introFor, g) ?? m.intro ?? []) g.say(who, text)
  g.story.s.introduced = true
  g.emit({ type: 'mission-start', id })
  return null
}

/** A loaded save mid-mission picks the mission up where it was. */
export function storyOnLoad(g) {
  const m = BY_ID[g.story.active]
  if (!m) { g.story.active = null; return }
  g.story.s = g.story.s ?? {}
  if (m.id === 'arrival' && g.story.tutorialVersion !== TUTORIAL_VERSION) {
    g.story.step = OLD_ARRIVAL_STEPS[g.story.step] ?? 0
    // Spoken-line indices changed too. Do not suppress the current instruction.
    g.story.s.said = {}
    g.story.tutorialVersion = TUTORIAL_VERSION
  }
  g.story.s.entered = false
  applyFlags(g, m)
  if (!g.story.s.introduced) { for (const [who, text] of val(m.introFor, g) ?? m.intro ?? []) g.say(who, text); g.story.s.introduced = true }
}
function applyFlags(g, m) {
  g.story.noInterdict = Boolean(m.quiet || m.noInterdict || m.id === 'arrival' || m.id === 'honest-work')
  g.story.noAmbient = Boolean(m.quiet)
  g.story.noPatrol = Boolean(m.noPatrol)
}

export function storyEvent(g, ev) {
  const m = BY_ID[g.story.active]
  if (!m) return
  const s = g.story.s ?? (g.story.s = {})
  switch (ev.type) {
    case 'undocked': s.launched = true; break
    case 'fa': if (!ev.on) s.faOff = true; break
    case 'dock': s.docked = ev.station; break
    case 'launch': s.docked = null; break
    case 'arrive': case 'respawn': s.entered = false; break
    case 'pickup': if (ev.tag?.startsWith('m:')) s.got = (s.got ?? 0) + 1; break
    case 'explode': { const e = g.byId(ev.ship); if (e?.tag) { s.kills = s.kills ?? {}; s.kills[e.tag] = (s.kills[e.tag] ?? 0) + 1 } break }
    case 'surface-done': s.surface = ev.result ?? { complete: false }; break
  }
  m.events?.[ev.type]?.(g, ev)
}

/** Each tick in flight: run the step's setup once in the right place, test it, move on. */
export function storyTick(g) {
  const m = BY_ID[g.story.active]
  if (!m) return
  const s = g.story.s
  let step = m.steps[g.story.step]
  // Skip steps whose `when` does not hold (a chase that never started).
  while (step && step.when && !step.when(g)) { g.story.step++; s.entered = false; step = m.steps[g.story.step] }
  if (!step) return complete(g, m)
  const here = !step.place || g.place === step.place
  if (here && !s.entered && g.mode === 'flight') {
    s.entered = true
    step.enter?.(g)
    if (!s.said?.[g.story.step]) { s.said = { ...s.said, [g.story.step]: true }; for (const [who, text] of step.say ?? []) g.say(who, text) }
  }
  if (step.choice) { g.choice = step.choice; } else g.choice = null
  const why = here && step.fail?.(g)
  if (why) return storyFail(g, why)
  if (here && step.done(g)) {
    step.finish?.(g)
    g.story.step++
    s.entered = false
    g.emit({ type: 'objective-done', text: step.doneText ?? 'Objective complete', mission: m.id, step: g.story.step - 1 })
    if (g.story.step >= m.steps.length) complete(g, m)
  }
}
export function chooseStory(g, option) {
  const m = BY_ID[g.story.active]
  const step = m?.steps[g.story.step]
  if (!step?.choice) return
  g.story.choice = option
  g.choice = null
  g.story.step++
  if (g.story.step >= m.steps.length) complete(g, m)
}

function complete(g, m) {
  const r = m.reward ?? {}
  if (r.credits) { g.credits += r.credits; g.stats.earned += r.credits }
  if (r.debt) g.debt = Math.max(0, g.debt - r.debt)
  if (r.clearDebt) g.debt = 0
  g.story.done.push(m.id)
  g.story.active = null
  g.story.step = 0
  g.story.noInterdict = g.story.noAmbient = g.story.noPatrol = false
  g.story.jamUntil = 0
  for (const [who, text] of val(m.outroFor, g) ?? m.outro ?? []) g.say(who, text)
  g.emit({ type: 'mission-complete', id: m.id, title: m.title, reward: r, epilogue: m.epilogue })
  g.choice = null
  try { g.__autosave?.() } catch { /* fine */ }
}

export function storyFail(g, reason) {
  const m = BY_ID[g.story.active]
  if (!m) return
  // Mission cargo goes with the failure.
  if (m.id === 'friend' && g.ship.cargo.chips) { g.ship.cargo.chips = Math.max(0, g.ship.cargo.chips - 2); if (!g.ship.cargo.chips) delete g.ship.cargo.chips }
  g.story.active = null
  g.story.step = 0
  g.story.s = {}
  g.story.noInterdict = g.story.noAmbient = g.story.noPatrol = false
  g.story.jamUntil = 0
  g.choice = null
  g.emit({ type: 'mission-failed', id: m.id, title: m.title, reason })
}
export function abandonStory(g) { storyFail(g, 'Abandoned.') }

/** The HUD's objective: what to do, and where. */
export function storyObjective(g) {
  const m = BY_ID[g.story.active]
  if (!m) return null
  const step = m.steps[g.story.step]
  if (!step) return null
  const text = val(step.text, g)
  if (g.mode === 'docked' && !step.docked && g.story.step > 0) return { text: 'Launch with [launch]', mission: m.title }
  if (step.place && g.place !== step.place) return { text: `Transfer to ${PLACES[step.place].name}: [map], then [transfer]`, place: step.place, mission: m.title }
  return { text, at: step.at?.(g) ?? null, ship: step.ship?.(g) ?? null, mission: m.title,
    title: step.title, detail: step.detail, label: step.label ?? 'Objective', radius: step.radius,
    lesson: m.id === 'arrival' ? g.story.step + 1 : null, lessons: m.id === 'arrival' ? m.steps.length : null }
}
