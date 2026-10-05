import * as THREE from 'three'
import { STATIONS, PLACES } from './world.js'
import { makeShip } from './flight.js'
import { shipStats } from './ships.js'

/**
 * The story: Act One, "Periapsis".
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
/** The jamming countdown, while it lasts. */
const jam = (g) => { const left = (g.story.jamUntil ?? 0) - g.time; return left > 0 ? ` · jammed ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '' }

export const STORY = [
  {
    id: 'arrival', title: 'Arrival', giver: 'mara', at: 'hearth', pitch: 'Mara Voss wants to see you fly before anyone gives you work.',
    reward: { credits: 1500 },
    intro: [['mara', 'Berth nine, the Kestrel. You are Rook\'s new pilot.'], ['mara', 'Mara Voss, dockmaster. Before anyone on this station gives you work, I want to see you fly. Launch when you are ready.']],
    steps: [
      { text: 'Launch from the berth with [launch]', done: (g) => g.story.s.launched },
      { text: 'Aim with [aim] and throttle up with [thrust]. Fly through the marker.', at: () => V(0, 250, 2200), say: [['mara', 'Point the nose where you want to go. The throttle stays where you leave it.']], done: (g) => dist(g, V(0, 250, 2200)) < 70 },
      { text: 'Hold [boost] and race to the next marker', at: () => V(1600, 700, 5200), say: [['mara', 'Boost runs on a battery. Use it, then let it recharge.']], done: (g) => dist(g, V(1600, 700, 5200)) < 90 },
      { text: 'Turn flight assist off with [fa] and feel the drift. Then turn it back on.', say: [['mara', 'With assist on, the thrusters hold the velocity you ask for. Off, it is just you and Newton.']], done: (g) => g.story.s.faOff && g.player.ctrl.fa },
      {
        text: 'Target the practice drone with [target] and shoot it with [fire]', say: [['mara', 'Bolts take time to arrive. Aim at the lead marker, not the drone.']],
        enter: (g) => { const e = spawn(g, 'raider', 'drone', V(1600, 600, 3600), 'm:drone', { mode: 'patrol', center: V(1600, 600, 3600), radius: 260, speed: 0.25 }, 'Practice drone'); e.stats = { ...e.stats, guns: 0 }; e.hull = 30; e.shield = 20 },
        ship: (g) => alive(g, 'm:drone')[0]?.id, done: (g) => kills(g, 'm:drone') >= 1,
      },
      { text: 'Fly back to Hearth\'s docking port, slow down, and press [dock]', at: () => port('hearth'), say: [['mara', 'The port is the lit bay on the station\'s face. Come in under seventy metres a second.']], done: (g) => g.story.s.docked === 'hearth' },
    ],
    outro: [['mara', 'You will do.'], ['mara', 'Rook has fixed you a debt, I hear. Forty thousand. Honest work is on the job board, and I have a run to Harbor if you want it.']],
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
    intro: [['chen', 'Elias Chen, Lunar Compact. Sit down.'], ['chen', 'Gateway. Two crates of grey chips, a dead drop, and a Kestrel running dark. I could take your ship today.'], ['chen', 'Or. The Hollow have bled these lanes for a year. Their boss calls himself the Warden. Help me find him, and Gateway never happened.'], ['chen', 'Think about who you owe. Rook will not.']],
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
          if (!g.story.jamUntil) { g.story.jamUntil = g.time + 90; g.say('rook', 'I have jammed their distress call. You have ninety seconds before Hearth\'s patrol hears a thing.') }
          if (!g.story.s.barge) {
            const b = spawn(g, 'freighter', 'compact', V(-2500, 300, 6000), 'm:barge', { mode: 'route', points: [V(-9000, 2000, 24000)], leg: 0, onEnd: 'hold', speed: 0.35, passive: true }, 'Compact supply barge')
            g.story.s.barge = b.id
            for (let i = 0; i < 2 - kills(g, 'm:escort'); i++) spawn(g, 'cutter', 'compact', V(-2400 + i * 300, 450, 5800), 'm:escort', { mode: 'follow', lead: b.id, slot: i, home: 'follow', skill: 0.65 }, 'Convoy escort')
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
    epilogue: 'Act One complete. The Hollow are broken, the debt is gone, and the lanes are yours. More is coming.',
  },
]
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
  if (here && step.done(g)) {
    step.finish?.(g)
    g.story.step++
    s.entered = false
    g.emit({ type: 'objective-done' })
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
  return { text, at: step.at?.(g) ?? null, ship: step.ship?.(g) ?? null, mission: m.title }
}
