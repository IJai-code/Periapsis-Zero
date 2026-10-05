/**
 * Every world you can land on, as the surface game needs to know it.
 *
 * Mass and radius are the simulator's own (sim/constants.js for the Moon,
 * sim/rails.js for the rest), so gravity here is the same number the
 * simulator flies by. What this file adds is what a person standing there
 * would notice: the ground's style and colour, the air (if any), what hangs
 * in the sky, how far the Sun is, and what is worth finding.
 *
 * Styles drive the terrain generator (sim/expedition.js terrainFor):
 *   cratered   impact craters of every size (scarps on Mercury)
 *   mesa       layered buttes over a sediment plain
 *   ridged     double ridges and fractures in young ice
 *   grooved    bright grooved bands cutting old dark ice
 *   volcanic   calderas, lava plains, an active vent
 *   dunes      long linear dunes of organic sand
 *   tessera    crumpled highland ridges over basalt plains
 *   cells      nitrogen-ice convection cells, water-ice blocks
 *   small      a tiny body: rough, cratered, visibly curved
 *
 * `hopper` worlds have too little gravity for a rover to grip (traction is
 * friction times weight, and on Phobos the weight of a 210 kg rover is 1.2 N):
 * the lander itself hops between sites there, as real small-body missions do.
 *
 * `air` is surface density in kg/m^3 and scale height in metres, for drag.
 * Venus's 65 kg/m^3 is why the Venera landers came down on a drag plate.
 */
import { BODIES, G } from './constants.js'
import { RAILS } from './rails.js'

const AU_SUN = { mercury: 0.387, venus: 0.723, moon: 1, mars: 1.524, phobos: 1.524, deimos: 1.524, io: 5.2, europa: 5.2, ganymede: 5.2, callisto: 5.2, titan: 9.58, pluto: 39.5, halley: 1.2 }

export const WORLDS = {
  moon: {
    id: 'moon', name: 'Moon', site: 'The southern highlands', geology: 'Impact basins · airless regolith', seed: 1107, style: 'cratered', tile: 'moon',
    ground: { dust: '#8c8780', rock: '#55524e', accent: '#b7b1a6', bump: 0.07 }, rockTint: '#6d6863',
    parent: { id: 'earth', look: 'earth', radius: 6371e3, distance: 384400e3 },
    anomaly: { name: 'Cold trap', note: 'A pit that has not seen sunlight in two billion years. If there is ice here, it is the oldest water you will ever touch.' },
    samples: ['Rim breccia', 'Basalt fragment', 'Glass beads', 'Anorthosite'],
  },
  mars: {
    id: 'mars', name: 'Mars', site: 'The canyon country', geology: 'Layered mesas · basalt and dust', seed: 2209, style: 'mesa', tile: 'mars',
    ground: { dust: '#b8693c', rock: '#6a3523', accent: '#d39a6a', bump: 0.06 }, rockTint: '#6b3f2c',
    air: { rho: 0.020, scale: 11100, colour: '#d6a982', near: 1400, far: 16000 },
    anomaly: { name: 'Layered outcrop', note: 'Fine beds laid flat, the way still water lays them. Something here was a lake.' },
    samples: ['Lower-bed sediment', 'Oxidized outcrop', 'Basalt cobble', 'Hematite spherules'],
  },
  phobos: {
    id: 'phobos', name: 'Phobos', site: 'Stickney\'s rim', geology: 'Grooves and rubble · carbon-dark dust', seed: 4401, style: 'small', tile: 'phobos', hopper: true,
    ground: { dust: '#5e5852', rock: '#3f3b37', accent: '#8a7e70', bump: 0.08 }, rockTint: '#4a4540',
    parent: { id: 'mars', look: 'mars', radius: 3389.5e3, distance: 9376e3 },
    anomaly: { name: 'Groove chain', note: 'A line of pits as straight as a ruler. Mars is pulling this moon apart, and this is where it shows.' },
    samples: ['Carbon-dark dust', 'Boulder chip', 'Impact glass', 'Martian ejecta'],
  },
  mercury: {
    id: 'mercury', name: 'Mercury', site: 'The north polar plains', geology: 'Craters and scarps · scorched regolith', seed: 5501, style: 'cratered', tile: 'moon', scarps: true,
    ground: { dust: '#7d7873', rock: '#4a4744', accent: '#d2cbbd', bump: 0.07 }, rockTint: '#5d5955',
    anomaly: { name: 'Hollows', note: 'Bright, shallow pits with no rims, still growing as the ground boils away into space.' },
    samples: ['Low-reflectance crust', 'Impact melt', 'Sulfide grain', 'Hollow-floor material'],
  },
  venus: {
    id: 'venus', name: 'Venus', site: 'Alpha Regio', geology: 'Tesserae · basalt under 92 bar', seed: 6601, style: 'tessera', tile: 'venus', survival: 480,
    ground: { dust: '#7a5d3e', rock: '#4c3b2c', accent: '#b9844a', bump: 0.05 }, rockTint: '#5a4634',
    air: { rho: 65, scale: 15900, colour: '#c7924a', near: 60, far: 2400, sky: 'venus' },
    anomaly: { name: 'Tessera ridge', note: 'The oldest ground on Venus, folded like crumpled paper. Older than the lava that buried everything else.' },
    samples: ['Basalt crust', 'Weathered sulfate', 'Ridge felsic rock', 'Tessera fragment'],
  },
  io: {
    id: 'io', name: 'Io', site: 'Loki Patera', geology: 'Lava lakes · sulfur frost', seed: 7701, style: 'volcanic', tile: 'io',
    ground: { dust: '#d4c06a', rock: '#5a4a2c', accent: '#b4492a', bump: 0.05 }, rockTint: '#4a3d28',
    parent: { id: 'jupiter', look: 'jupiter', radius: 69911e3, distance: 421.7e6 },
    anomaly: { name: 'Lava lake', note: 'Molten rock at 1,300 °C, crusting over and sinking again. The most volcanic place in the solar system.' },
    samples: ['Sulfur frost', 'Sulfur dioxide ice', 'Pyroclastic glass', 'Fresh silicate lava'],
  },
  europa: {
    id: 'europa', name: 'Europa', site: 'The fractured plains', geology: 'Double ridges · young surface ice', seed: 3313, style: 'ridged', tile: 'europa',
    ground: { dust: '#d9e1e2', rock: '#9fb4bd', accent: '#7c4a32', bump: 0.035 }, rockTint: '#b6c4c8',
    parent: { id: 'jupiter', look: 'jupiter', radius: 69911e3, distance: 671.0e6 },
    anomaly: { name: 'Plume vent', note: 'Salt on the ice around a crack. Water from the ocean below has been here, recently.' },
    samples: ['Fracture deposit', 'Clean surface ice', 'Ridge ice', 'Sea salt'],
  },
  ganymede: {
    id: 'ganymede', name: 'Ganymede', site: 'Uruk Sulcus', geology: 'Grooved bands · old dark ice', seed: 8801, style: 'grooved', tile: 'ganymede',
    ground: { dust: '#9a9387', rock: '#5d574f', accent: '#d8dcdc', bump: 0.05 }, rockTint: '#6e685f',
    parent: { id: 'jupiter', look: 'jupiter', radius: 69911e3, distance: 1070.4e6 },
    anomaly: { name: 'Groove fault', note: 'Bright ice torn open along a fault. The only moon with its own magnetic field, and this is its crust breaking.' },
    samples: ['Bright groove ice', 'Dark terrain regolith', 'Crater ray ice', 'Aurora-altered frost'],
  },
  callisto: {
    id: 'callisto', name: 'Callisto', site: 'Valhalla\'s outer rings', geology: 'Craters on craters · dark lag', seed: 9901, style: 'cratered', tile: 'ganymede', dense: true,
    ground: { dust: '#6e665c', rock: '#3f3a34', accent: '#d4d6d4', bump: 0.06 }, rockTint: '#4c463f',
    parent: { id: 'jupiter', look: 'jupiter', radius: 69911e3, distance: 1882.7e6 },
    anomaly: { name: 'Ring scarp', note: 'One wall of a basin three thousand kilometres across. The oldest unaltered ground anywhere.' },
    samples: ['Dark lag deposit', 'Crater-rim ice', 'Ejecta block', 'Primordial rock'],
  },
  titan: {
    id: 'titan', name: 'Titan', site: 'The Shangri-La dunes', geology: 'Organic dunes · methane rain', seed: 11101, style: 'dunes', tile: 'titan',
    ground: { dust: '#7a5a34', rock: '#a69a86', accent: '#4a3a24', bump: 0.04 }, rockTint: '#8e8574',
    air: { rho: 5.3, scale: 21000, colour: '#c08a44', near: 120, far: 3600, sky: 'titan' },
    parent: { id: 'saturn', look: 'saturn', radius: 58232e3, distance: 1221.9e6 },
    anomaly: { name: 'Methane lake shore', note: 'A shoreline of liquid methane. Rain, rivers, lakes: the only other world with all three.' },
    samples: ['Organic dune sand', 'Water-ice cobble', 'Shoreline evaporite', 'Tholin crust'],
  },
  pluto: {
    id: 'pluto', name: 'Pluto', site: 'Sputnik Planitia', geology: 'Nitrogen-ice cells · water-ice blocks', seed: 12201, style: 'cells', tile: 'pluto',
    ground: { dust: '#ddd1c2', rock: '#b9a690', accent: '#8a4f36', bump: 0.04 }, rockTint: '#c2b19c',
    parent: { id: 'charon', look: 'charon', radius: 606e3, distance: 19591e3 },
    anomaly: { name: 'Glacier edge', note: 'Nitrogen ice flowing, slowly, as a glacier does. A world this cold should be frozen still; it is not.' },
    samples: ['Nitrogen ice', 'Water-ice bedrock', 'Methane frost', 'Tholin dust'],
  },
  halley: {
    id: 'halley', name: 'Halley\'s Comet', site: 'The nucleus', geology: 'Dust over ice · active jets', seed: 13301, style: 'small', tile: 'phobos', hopper: true,
    ground: { dust: '#34302d', rock: '#211f1d', accent: '#7a756e', bump: 0.08 }, rockTint: '#2a2725',
    anomaly: { name: 'Active jet', note: 'Ice turning straight to gas in the sunlight and blasting dust into space. The tail you see from Earth starts here.' },
    samples: ['Dust grain', 'Ice chunk', 'Crust flake', 'Organic crust'],
  },
  deimos: {
    id: 'deimos', name: 'Deimos', site: 'The smooth plains', geology: 'Buried craters · fine dust', seed: 4402, style: 'small', tile: 'phobos', hopper: true, free: true,
    ground: { dust: '#7a7066', rock: '#4f4740', accent: '#a4998c', bump: 0.06 }, rockTint: '#5d554d',
    parent: { id: 'mars', look: 'mars', radius: 3389.5e3, distance: 23463e3 },
    anomaly: { name: 'Bright streak', note: 'Fresh dust slid down a slope, uncovering the rock beneath for the first time.' },
    samples: ['Fine dust', 'Bright streak dust', 'Boulder chip', 'Buried rock'],
  },
}

for (const w of Object.values(WORLDS)) {
  const body = BODIES[w.id] ?? RAILS.find((b) => b.id === w.id)
  w.radius = body.radius
  w.gravity = G * body.mass / body.radius ** 2
  w.escape = Math.sqrt(2 * w.gravity * w.radius)
  w.sunAU = AU_SUN[w.id] ?? 1
  // Kept for the code that predates the catalogue.
  w.atmosphere = w.air?.rho ?? 0
  w.color = w.ground.dust
}

/** The campaign, in order. Deimos is free-play only. */
export const CAMPAIGN_ORDER = ['moon', 'mars', 'phobos', 'mercury', 'venus', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'pluto', 'halley']
export const LANDABLE = Object.keys(WORLDS)
export const isLandable = (id) => Boolean(WORLDS[id])
