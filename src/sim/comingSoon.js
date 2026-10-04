/**
 * The names the search recognises but cannot fly you to.
 *
 * A search box that answers "no results" to *Ceres*, *Voyager 1* and *asdkjh*
 * alike is lying about two of them. The simulator has 67 named stars, 23
 * galaxies and a dozen worlds; the sky has rather more. So the names of what it
 * does not have yet are written down here, and typing one gets an honest
 * answer — what the thing is, and that it is not in yet — instead of silence
 * or, worse, the nearest entry that happens to share some letters.
 *
 * Nothing here is a destination. An entry is a name, the aliases people
 * actually type, and one line saying what it is. `label` is the badge the row
 * wears: most say *coming soon*, but a constellation or an abstraction is not
 * a place at all and says so rather than promising a visit.
 *
 * Which list an entry belongs in is decided by whether it is a real thing:
 * `COMING_SOON` is astronomy, `FICTION` is not, and typing the latter gets the
 * same nudge as typing nonsense. Neither list can shadow a real destination —
 * `sim/catalog.js` only consults them once the catalogue itself has nothing
 * close — so adding a name here is safe even if the simulator gains it later.
 */

/** One group: a kind, the line they share, and the names. */
const group = (kind, hint, list) =>
  list.map((x) => {
    if (typeof x === 'string') return { name: x, aliases: [], kind, hint, label: 'coming soon' }
    if (Array.isArray(x)) return { name: x[0], aliases: x.slice(1), kind, hint, label: 'coming soon' }
    return { kind, hint, aliases: [], label: 'coming soon', ...x }
  })

/** A group of things that exist but are not somewhere the camera could go. */
const notPlace = (entries) => entries.map((e) => ({ ...e, label: 'not a place' }))

/** Recognised, real, and not in the simulator yet. */
export const COMING_SOON = [
  ...group('dwarf', 'Dwarf planet', [
    { name: 'Ceres', aliases: ['1 ceres'], hint: 'Dwarf planet · 940 km across, in the asteroid belt' },
    { name: 'Eris', aliases: ['136199 eris'], hint: 'Dwarf planet · as big as Pluto, three times as far' },
    { name: 'Haumea', hint: 'Dwarf planet · spun into an egg, with a ring' },
    { name: 'Makemake', hint: 'Dwarf planet · Kuiper belt' },
    { name: 'Gonggong', hint: 'Dwarf planet · a reddened body out past Neptune' },
    { name: 'Quaoar', hint: 'Dwarf planet · Kuiper belt, with a ring of its own' },
    { name: 'Sedna', hint: 'Dwarf planet · an 11,000-year orbit reaching 900 AU' },
    { name: 'Orcus', hint: 'Dwarf planet · Pluto’s orbital twin, out of phase' },
  ]),

  ...group('moon', 'Moon', [
    { name: 'Triton', hint: 'Neptune’s moon · retrograde, with nitrogen geysers' },
    { name: 'Enceladus', hint: 'Saturn’s moon · plumes of ocean water from its south pole' },
    { name: 'Charon', hint: 'Pluto’s moon · half its size; the two orbit each other' },
    { name: 'Mimas', hint: 'Saturn’s moon · the Herschel crater makes it a death star' },
    { name: 'Iapetus', hint: 'Saturn’s moon · one hemisphere black, the other white' },
    { name: 'Rhea', hint: 'Saturn’s moon · the second largest of its moons' },
    { name: 'Dione', hint: 'Saturn’s moon · ice cliffs hundreds of metres high' },
    { name: 'Tethys', hint: 'Saturn’s moon · split by the Ithaca Chasma' },
    { name: 'Hyperion', hint: 'Saturn’s moon · a sponge, tumbling chaotically' },
    { name: 'Phoebe', hint: 'Saturn’s moon · captured, and going the wrong way' },
    { name: 'Miranda', hint: 'Uranus’ moon · a 20 km cliff, the tallest known' },
    { name: 'Titania', hint: 'Uranus’ moon · the largest of them' },
    { name: 'Oberon', hint: 'Uranus’ moon · cratered and dark' },
    { name: 'Ariel', hint: 'Uranus’ moon · the brightest of them' },
    { name: 'Umbriel', hint: 'Uranus’ moon · the darkest of them' },
    { name: 'Nereid', hint: 'Neptune’s moon · one of the most eccentric orbits known' },
    { name: 'Proteus', hint: 'Neptune’s moon · as large as a body can be and stay lumpy' },
    ['Nix', 'nyx'],
    { name: 'Hydra', hint: 'Pluto’s moon · and the constellation, the longest in the sky' },
    'Styx',
    'Kerberos',
    'Amalthea',
    'Himalia',
    'Metis',
    'Thebe',
    'Dysnomia',
  ]),

  ...group('comet', 'Comet', [
    { name: 'Hale–Bopp', aliases: ['hale bopp', 'c 1995 o1'], hint: 'Comet · the great comet of 1997, back in about 4385' },
    { name: 'Hyakutake', hint: 'Comet · passed 0.1 AU from Earth in 1996' },
    { name: 'NEOWISE', aliases: ['c 2020 f3'], hint: 'Comet · naked-eye in July 2020' },
    { name: 'Shoemaker–Levy 9', aliases: ['shoemaker levy 9', 'sl9'], hint: 'Comet · broke up and struck Jupiter in 1994' },
    { name: 'Churyumov–Gerasimenko', aliases: ['67p', 'churyumov gerasimenko', 'rosettas comet'], hint: 'Comet · the rubber duck Rosetta orbited' },
    { name: 'ʻOumuamua', aliases: ['oumuamua', '1i'], hint: 'Interstellar object · the first one seen, in 2017' },
    { name: 'Borisov', aliases: ['2i borisov', '2i'], hint: 'Interstellar comet · the second such visitor, in 2019' },
    { name: 'Encke', hint: 'Comet · the shortest period known, 3.3 years' },
    { name: 'Tempel 1', hint: 'Comet · Deep Impact put a hole in it in 2005' },
  ]),

  ...group('comet', 'Asteroid', [
    { name: 'Vesta', hint: 'Asteroid · the brightest of them, and nearly a planet' },
    { name: 'Pallas', hint: 'Asteroid · the third largest, on a tilted orbit' },
    { name: 'Hygiea', hint: 'Asteroid · round enough to argue about' },
    { name: 'Psyche', hint: 'Asteroid · largely metal; a mission is on its way' },
    { name: 'Bennu', hint: 'Asteroid · OSIRIS-REx brought a sample home in 2023' },
    { name: 'Ryugu', hint: 'Asteroid · sampled by Hayabusa2 in 2019' },
    { name: 'Itokawa', hint: 'Asteroid · a rubble pile, sampled in 2005' },
    { name: 'Apophis', hint: 'Asteroid · passes inside the geostationary belt in 2029' },
    { name: 'Eros', aliases: ['433 eros'], hint: 'Asteroid · NEAR Shoemaker landed on it in 2001' },
    { name: 'Dimorphos', hint: 'Asteroid moon · DART changed its orbit in 2022' },
    { name: 'Asteroid belt', aliases: ['the belt', 'main belt'], hint: 'The belt between Mars and Jupiter · mostly empty space' },
    { name: 'Trojans', aliases: ['trojan asteroids', 'jupiter trojans'], hint: 'Asteroid swarms at Jupiter’s L4 and L5' },
  ]),

  ...group('craft', 'Spacecraft', [
    { name: 'Voyager 1', aliases: ['voyager'], hint: 'Spacecraft · the farthest human object, 25 billion km out' },
    { name: 'Voyager 2', hint: 'Spacecraft · the only visit to Uranus and Neptune' },
    { name: 'Pioneer 10', aliases: ['pioneer'], hint: 'Spacecraft · first through the asteroid belt and past Jupiter' },
    { name: 'Pioneer 11', hint: 'Spacecraft · first past Saturn' },
    { name: 'New Horizons', hint: 'Spacecraft · flew past Pluto in 2015 and Arrokoth in 2019' },
    { name: 'Cassini', aliases: ['cassini huygens'], hint: 'Spacecraft · 13 years at Saturn, into it in 2017' },
    { name: 'Huygens', hint: 'Lander · the only landing on Titan, 2005' },
    { name: 'Juno', hint: 'Spacecraft · in polar orbit of Jupiter since 2016' },
    { name: 'Galileo', hint: 'Spacecraft · orbited Jupiter 1995–2003' },
    { name: 'Parker Solar Probe', aliases: ['parker'], hint: 'Spacecraft · 6.9 million km from the Sun, at 690,000 km/h' },
    { name: 'Solar Orbiter', hint: 'Spacecraft · photographs the Sun’s poles' },
    { name: 'Rosetta', hint: 'Spacecraft · orbited a comet and landed on it' },
    { name: 'Philae', hint: 'Lander · the first landing on a comet, 2014' },
    { name: 'OSIRIS-REx', aliases: ['osiris rex'], hint: 'Spacecraft · returned 122 g of Bennu to Utah' },
    { name: 'Dawn', hint: 'Spacecraft · orbited Vesta, then Ceres' },
    { name: 'Hayabusa2', aliases: ['hayabusa'], hint: 'Spacecraft · sampled Ryugu with an impactor' },
    { name: 'Lucy', hint: 'Spacecraft · on its way to the Jupiter Trojans' },
    { name: 'DART', hint: 'Spacecraft · deliberately hit an asteroid in 2022' },
    { name: 'Europa Clipper', hint: 'Spacecraft · launched 2024, at Europa in 2030' },
    { name: 'JUICE', aliases: ['jupiter icy moons explorer'], hint: 'Spacecraft · for Ganymede, arriving 2031' },
    { name: 'BepiColombo', hint: 'Spacecraft · reaches Mercury orbit in 2026' },
    { name: 'Perseverance', aliases: ['percy'], hint: 'Rover · Jezero crater since 2021, caching samples' },
    { name: 'Curiosity', hint: 'Rover · Gale crater since 2012' },
    { name: 'Opportunity', hint: 'Rover · 14 years and 45 km on Meridiani' },
    { name: 'Spirit', hint: 'Rover · Gusev crater, 2004–2010' },
    { name: 'Sojourner', hint: 'Rover · the first on Mars, 1997' },
    { name: 'Ingenuity', hint: 'Helicopter · 72 flights in the Martian air' },
    { name: 'InSight', hint: 'Lander · listened to Mars quakes, 2018–2022' },
    { name: 'Viking 1', aliases: ['viking'], hint: 'Lander · the first working landing on Mars, 1976' },
    { name: 'Tianwen-1', aliases: ['tianwen', 'zhurong'], hint: 'Orbiter and rover · China at Mars since 2021' },
    { name: 'Chang’e', aliases: ['change 5', 'change 6', 'yutu'], hint: 'Lunar missions · sample returns, including the far side' },
    { name: 'Chandrayaan-3', aliases: ['chandrayaan', 'vikram', 'pragyan'], hint: 'Lander · near the Moon’s south pole, 2023' },
    { name: 'Lunar Reconnaissance Orbiter', aliases: ['lro'], hint: 'Orbiter · mapped the Moon to half a metre' },
    { name: 'Apollo 13', hint: 'Mission · an explosion at 322,000 km, and a way home' },
    { name: 'Apollo 12', hint: 'Mission · landed beside Surveyor 3, 1969' },
    { name: 'Apollo 17', hint: 'Mission · the last landing, and the longest, 1972' },
    { name: 'Gemini', hint: 'Programme · the first rendezvous and docking · also the constellation' },
    { name: 'Space Shuttle', aliases: ['shuttle', 'sts', 'columbia', 'challenger', 'discovery', 'atlantis', 'endeavour'], hint: '135 flights, 1981–2011' },
    { name: 'Vostok 1', aliases: ['vostok', 'gagarin'], hint: 'The first human flight, 12 April 1961' },
    { name: 'Soyuz', hint: 'The longest-serving crewed spacecraft, flying since 1967' },
    { name: 'Dragon', aliases: ['crew dragon', 'cargo dragon'], hint: 'Capsule · crew and cargo to the station' },
  ]),

  ...group('craft', 'Telescope', [
    { name: 'James Webb Space Telescope', aliases: ['jwst', 'james webb', 'webb'], hint: 'Telescope · 6.5 m, in the infrared, at Earth–Sun L2' },
    { name: 'Chandra', hint: 'Telescope · X-ray, in a 64-hour orbit' },
    { name: 'Spitzer', hint: 'Telescope · infrared, 2003–2020' },
    { name: 'Kepler', hint: 'Telescope · found 2,700 planets by watching them transit' },
    { name: 'TESS', hint: 'Telescope · surveys the whole sky for transits' },
    { name: 'Gaia', hint: 'Telescope · measured 1.8 billion stars in three dimensions' },
    { name: 'Vera Rubin Observatory', aliases: ['vera rubin', 'lsst'], hint: 'Telescope · photographs the whole southern sky every few nights' },
    { name: 'Nancy Grace Roman Space Telescope', aliases: ['roman'], hint: 'Telescope · a Hubble-sized field 100 times wider' },
    { name: 'Event Horizon Telescope', aliases: ['eht'], hint: 'An Earth-sized array · imaged M87* and Sgr A*' },
    { name: 'ALMA', hint: '66 dishes at 5,000 m in the Atacama' },
    { name: 'Very Large Array', aliases: ['vla'], hint: '27 dishes on rails in New Mexico' },
    { name: 'Arecibo', hint: 'The 305 m dish, 1963–2020' },
    { name: 'Keck', hint: 'Twin 10 m telescopes on Maunakea' },
    { name: 'Very Large Telescope', aliases: ['vlt'], hint: 'Four 8.2 m telescopes at Paranal' },
    { name: 'Planck', hint: 'Telescope · mapped the microwave background, whose sky you can see here' },
  ]),

  ...group('craft', 'Satellite or station', [
    { name: 'Sputnik 1', aliases: ['sputnik'], hint: 'The first satellite, 4 October 1957' },
    { name: 'Explorer 1', hint: 'The first American satellite, and the Van Allen belts' },
    { name: 'Skylab', hint: 'The first American station, 1973–1979' },
    { name: 'Mir', hint: 'Station · 15 years in orbit, 1986–2001' },
    { name: 'Salyut', hint: 'The first stations of all, from 1971' },
    { name: 'Tiangong', hint: 'China’s station · three modules, crewed since 2021' },
    { name: 'Lunar Gateway', aliases: ['gateway'], hint: 'Station · planned for a near-rectilinear halo orbit of the Moon' },
    { name: 'Starlink', hint: 'Thousands of satellites in low orbit' },
    { name: 'GPS', aliases: ['navstar', 'gnss'], hint: '31 satellites at 20,200 km' },
    { name: 'Van Allen belts', aliases: ['van allen', 'radiation belts'], hint: 'Trapped particles, 1,000–60,000 km up' },
  ]),

  ...group('planet', 'Exoplanet', [
    { name: 'Proxima Centauri b', aliases: ['proxima b'], hint: 'Exoplanet · in the habitable zone of the nearest star' },
    { name: 'TRAPPIST-1e', aliases: ['trappist 1e'], hint: 'Exoplanet · one of seven Earth-sized worlds, 40 light-years out' },
    { name: 'Kepler-452b', hint: 'Exoplanet · an older, larger Earth 1,800 light-years away' },
    { name: 'Kepler-186f', hint: 'Exoplanet · Earth-sized, in the habitable zone' },
    { name: '51 Pegasi b', aliases: ['51 peg b', 'dimidium'], hint: 'Exoplanet · the first found round a Sun-like star, 1995' },
    { name: 'HD 189733 b', hint: 'Exoplanet · a hot Jupiter with 8,000 km/h winds' },
    { name: 'WASP-12b', hint: 'Exoplanet · being pulled into an egg and eaten by its star' },
    { name: 'K2-18b', hint: 'Exoplanet · water vapour in a hydrogen atmosphere' },
    { name: 'LHS 1140 b', hint: 'Exoplanet · a rocky world 49 light-years away' },
    { name: 'Barnard’s Star b', aliases: ['barnards star b'], hint: 'Exoplanet · at the second-nearest star system' },
    { name: '55 Cancri e', hint: 'Exoplanet · a lava world orbiting in 18 hours' },
    { name: 'Beta Pictoris b', hint: 'Exoplanet · photographed inside its dust disc' },
    { name: 'HR 8799', hint: 'Four planets, all directly photographed' },
  ]),

  ...group('star', 'Star', [
    { name: 'Sirius B', hint: 'White dwarf · Earth-sized, as heavy as the Sun' },
    { name: 'Adhara', hint: 'Star · the brightest source of far-ultraviolet in the sky' },
    { name: 'Wezen', hint: 'Star · a supergiant 1,600 light-years away' },
    { name: 'Mirfak', hint: 'Star · brightest in Perseus' },
    { name: 'Alnair', hint: 'Star · brightest in Grus' },
    { name: 'Peacock', aliases: ['alpha pavonis'], hint: 'Star · brightest in Pavo' },
    { name: 'Shaula', hint: 'Star · the scorpion’s sting' },
    { name: 'Kaus Australis', hint: 'Star · brightest in Sagittarius' },
    { name: 'Nunki', hint: 'Star · in the archer’s bow' },
    { name: 'Rasalhague', hint: 'Star · brightest in Ophiuchus' },
    { name: 'Alphecca', aliases: ['gemma'], hint: 'Star · brightest in Corona Borealis' },
    { name: 'Kochab', hint: 'Star · the pole star of the Egyptians' },
    { name: 'Denebola', hint: 'Star · the lion’s tail' },
    { name: 'Alphard', hint: 'Star · the solitary one, in Hydra' },
    { name: 'Hamal', hint: 'Star · brightest in Aries' },
    { name: 'Alpheratz', hint: 'Star · shared between Pegasus and Andromeda' },
    { name: 'Mirach', hint: 'Star · a signpost to the Andromeda Galaxy' },
    { name: 'Almach', hint: 'Star · a gold and blue pair in a small telescope' },
    { name: 'Schedar', hint: 'Star · brightest in Cassiopeia' },
    { name: 'Enif', hint: 'Star · the horse’s nose' },
    { name: 'Markab', hint: 'Star · a corner of the Square of Pegasus' },
    { name: 'Menkalinan', hint: 'Star · an eclipsing pair in Auriga' },
    { name: 'Miaplacidus', hint: 'Star · second brightest in Carina' },
    { name: 'Avior', hint: 'Star · a giant and its hot companion' },
    { name: 'Naos', hint: 'Star · one of the hottest visible stars, 40,000 K' },
    { name: 'Suhail', hint: 'Star · a supergiant in Vela' },
    { name: 'Alhena', hint: 'Star · in Gemini’s foot' },
    { name: 'Cor Caroli', hint: 'Star · Charles’ heart, in Canes Venatici' },
    { name: 'Izar', hint: 'Star · a famous gold-and-blue double' },
    { name: 'Mira', hint: 'Variable star · the first found, brightening 250-fold' },
    { name: 'Delta Cephei', hint: 'Variable star · the one that measures the universe' },
    { name: 'Mu Cephei', aliases: ['garnet star', 'herschels garnet star'], hint: 'Star · a red hypergiant, one of the largest known' },
    { name: 'UY Scuti', hint: 'Star · among the largest known, 1,700 times the Sun' },
    { name: 'Stephenson 2-18', hint: 'Star · a candidate for the largest known' },
    { name: 'R136a1', hint: 'Star · the most massive known, 200 Suns, in the Tarantula' },
    { name: 'Pistol Star', hint: 'Star · near the Galactic Centre, 1.6 million Suns bright' },
    { name: 'Eta Carinae B', aliases: ['homunculus'], hint: 'The nebula thrown off by Eta Carinae in 1843' },
    { name: 'Cygnus X-1', hint: 'Black hole · 21 solar masses, feeding on a supergiant' },
    { name: 'Tabby’s Star', aliases: ['tabbys star', 'kic 8462852', 'boyajians star'], hint: 'Star · dips in brightness nobody fully explains' },
    { name: 'Methuselah', aliases: ['hd 140283'], hint: 'Star · about as old as the galaxy itself' },
    { name: 'Teegarden’s Star', aliases: ['teegardens star'], hint: 'Star · 12 light-years away, with two planets' },
    { name: 'Luyten’s Star', aliases: ['luytens star'], hint: 'Star · 12 light-years away, near Procyon' },
    { name: 'Van Maanen’s Star', aliases: ['van maanens star'], hint: 'The nearest solitary white dwarf, 14 light-years away' },
    { name: 'Ross 154', hint: 'Star · a flare star 9.7 light-years away' },
    { name: 'Ross 248', hint: 'Star · in 36,000 years it will be the nearest to the Sun' },
    { name: 'Luhman 16', hint: 'Brown dwarfs · a pair 6.5 light-years away' },
    { name: 'Gliese 876', hint: 'Star · four planets, 15 light-years away' },
    { name: 'Groombridge 34', hint: 'Star · a red pair 11.6 light-years away' },
  ]),

  ...group('nebula', 'Nebula', [
    { name: 'Trifid Nebula', aliases: ['m20'], hint: 'Nebula · split in three by dust, beside the Lagoon' },
    { name: 'Omega Nebula', aliases: ['swan nebula', 'm17'], hint: 'Nebula · a bright swan in Sagittarius' },
    { name: 'Dumbbell Nebula', aliases: ['m27'], hint: 'Planetary nebula · two lobes in Vulpecula' },
    { name: 'Cat’s Eye Nebula', aliases: ['cats eye nebula', 'ngc 6543'], hint: 'Planetary nebula · shells inside shells' },
    { name: 'Tarantula Nebula', aliases: ['ngc 2070', '30 doradus'], hint: 'Nebula · the most violent one known, in the Large Magellanic Cloud' },
    { name: 'Flame Nebula', aliases: ['ngc 2024'], hint: 'Nebula · beside Alnitak in Orion’s belt' },
    { name: 'Heart Nebula', aliases: ['ic 1805'], hint: 'Nebula · in Cassiopeia, beside the Soul' },
    { name: 'California Nebula', aliases: ['ngc 1499'], hint: 'Nebula · a long streak in Perseus' },
    { name: 'Cone Nebula', hint: 'Nebula · a pillar seven light-years long' },
    { name: 'Witch Head Nebula', hint: 'Reflection nebula · lit by Rigel' },
    { name: 'Iris Nebula', aliases: ['ngc 7023'], hint: 'Reflection nebula · blue petals in Cepheus' },
    { name: 'Bubble Nebula', aliases: ['ngc 7635'], hint: 'Nebula · blown by one hot star' },
    { name: 'Rho Ophiuchi', hint: 'The nearest star-forming cloud, 400 light-years away' },
    { name: 'Barnard’s Loop', aliases: ['barnards loop'], hint: 'A 300 light-year arc round all of Orion' },
    { name: 'Coalsack', hint: 'Dark nebula · the black patch beside the Southern Cross' },
    { name: 'Pipe Nebula', hint: 'Dark nebula · a silhouette against the Galactic bulge' },
    { name: 'Cassiopeia A', aliases: ['cas a'], hint: 'Supernova remnant · the youngest in the Galaxy' },
    { name: 'Vela Supernova Remnant', aliases: ['vela snr', 'pencil nebula'], hint: 'Supernova remnant · 11,000 years old, with a pulsar' },
    { name: 'SN 1987A', hint: 'Supernova · the nearest since 1604, in the Large Magellanic Cloud' },
    { name: 'Boomerang Nebula', hint: 'The coldest known place, 1 K' },
    { name: 'Crab Pulsar', aliases: ['pulsar', 'neutron star'], hint: 'Neutron star · 30 turns a second, inside the Crab Nebula' },
    { name: 'Magnetar', aliases: ['sgr 1806 20'], hint: 'Neutron star · a magnetic field a thousand trillion times Earth’s' },
  ]),

  ...group('cluster', 'Star cluster', [
    { name: 'Double Cluster', aliases: ['double cluster in perseus', 'h persei', 'ngc 869'], hint: 'Two open clusters side by side in Perseus' },
    { name: 'Beehive Cluster', aliases: ['m44', 'praesepe'], hint: 'Open cluster · 600 light-years away in Cancer' },
    { name: 'Wild Duck Cluster', aliases: ['m11'], hint: 'Open cluster · a dense triangle in Scutum' },
    { name: 'Jewel Box', aliases: ['ngc 4755', 'kappa crucis cluster'], hint: 'Open cluster · coloured supergiants beside the Southern Cross' },
    { name: 'Butterfly Cluster', aliases: ['m6'], hint: 'Open cluster · in Scorpius' },
    { name: 'Ptolemy Cluster', aliases: ['m7'], hint: 'Open cluster · naked-eye since antiquity' },
    { name: 'Trapezium', hint: 'The four young stars lighting the Orion Nebula' },
    { name: 'M15', aliases: ['messier 15'], hint: 'Globular cluster · one of the densest known' },
    { name: 'M5', aliases: ['messier 5'], hint: 'Globular cluster · 12 billion years old' },
    { name: 'M3', aliases: ['messier 3'], hint: 'Globular cluster · half a million stars' },
    { name: 'M4', aliases: ['messier 4'], hint: 'Globular cluster · the nearest, beside Antares' },
    { name: 'M22', aliases: ['messier 22'], hint: 'Globular cluster · bright, in Sagittarius' },
    { name: 'Arches Cluster', hint: 'The densest cluster in the Galaxy, near its centre' },
    { name: 'Southern Pleiades', aliases: ['ic 2602', 'theta carinae cluster'], hint: 'Open cluster · naked-eye in Carina' },
  ]),

  ...group('galaxy', 'Galaxy', [
    { name: 'Antennae Galaxies', aliases: ['ngc 4038', 'antennae'], hint: 'Two galaxies colliding, with tails of stars' },
    { name: 'Cartwheel Galaxy', hint: 'Galaxy · a ring blown out by a head-on collision' },
    { name: 'Black Eye Galaxy', aliases: ['m64', 'evil eye galaxy'], hint: 'Galaxy · a dark dust band across its core' },
    { name: 'Sunflower Galaxy', aliases: ['m63'], hint: 'Galaxy · many short, flocculent arms' },
    { name: 'Needle Galaxy', aliases: ['ngc 4565'], hint: 'Galaxy · seen exactly edge-on' },
    { name: 'Hoag’s Object', aliases: ['hoags object'], hint: 'Galaxy · a perfect ring round a core, unexplained' },
    { name: 'Stephan’s Quintet', aliases: ['stephans quintet'], hint: 'Five galaxies, four of them interacting' },
    { name: 'Leo Triplet', aliases: ['m66 group'], hint: 'Three galaxies in Leo' },
    { name: 'Cygnus A', hint: 'Galaxy · radio jets half a million light-years long' },
    { name: '3C 273', hint: 'Quasar · the first identified, and the brightest' },
    { name: 'TON 618', hint: 'Quasar · a black hole of 40 billion Suns' },
    { name: 'IC 1101', hint: 'Galaxy · among the largest known' },
    { name: 'GN-z11', aliases: ['gn z11'], hint: 'Galaxy · seen 400 million years after the Big Bang' },
    { name: 'JADES-GS-z14-0', aliases: ['jades gs z14 0'], hint: 'The most distant galaxy confirmed, at 290 million years' },
    { name: 'Bullet Cluster', hint: 'Two clusters through each other · the case for dark matter' },
    { name: 'Hubble Ultra Deep Field', aliases: ['hudf', 'hubble deep field', 'deep field'], hint: 'Ten thousand galaxies in a tenth of a Moon’s width' },
    { name: 'Einstein Cross', aliases: ['q2237 0305'], hint: 'One quasar, lensed into four images' },
    { name: 'Great Attractor', hint: 'The mass our whole neighbourhood is falling toward' },
    { name: 'Boötes Void', aliases: ['bootes void', 'the great void'], hint: 'A 330 million light-year hole with almost nothing in it' },
    { name: 'Sloan Great Wall', hint: 'A sheet of galaxies 1.4 billion light-years long' },
    { name: 'Hercules–Corona Borealis Great Wall', aliases: ['hercules corona borealis great wall'], hint: 'The largest structure claimed, 10 billion light-years across' },
  ]),

  ...notPlace(group('region', 'Not a place', [
    { name: 'Wormhole', aliases: ['einstein rosen bridge'], hint: 'A solution of general relativity · no evidence any exists' },
    { name: 'Dark matter', hint: 'Five sixths of the mass · unseen, and not a place to stand' },
    { name: 'Dark energy', hint: 'What accelerates the expansion · everywhere, not somewhere' },
    { name: 'Gravitational waves', aliases: ['gravitational wave', 'ligo'], hint: 'Ripples in spacetime · first detected in 2015' },
    { name: 'Big Crunch', aliases: ['heat death', 'end of the universe'], hint: 'Possible futures · the expansion currently says otherwise' },
    { name: 'Multiverse', hint: 'A hypothesis, and not an observable one' },
    { name: 'Lagrange points', aliases: ['lagrange point', 'l1', 'l2', 'l4', 'l5'], hint: 'The five balance points of a two-body system' },
    { name: 'Kessler syndrome', hint: 'A cascade of orbital debris · a risk, not a destination' },
    { name: 'Aurora', aliases: ['northern lights', 'aurora borealis', 'aurora australis'], hint: 'Solar particles in Earth’s upper air' },
    { name: 'Solar eclipse', aliases: ['eclipse', 'lunar eclipse', 'total eclipse'], hint: 'An alignment · the Sun, Moon and Earth are all here to watch it from' },
    { name: 'Zodiacal light', hint: 'Sunlight on dust along the ecliptic' },
  ])),

  ...notPlace(group('region', 'Constellation · a pattern on the sky, not a place', [
    'Andromeda', 'Antlia', 'Apus', 'Aquarius', 'Aquila', 'Ara', 'Aries', 'Auriga',
    'Boötes', 'Caelum', 'Camelopardalis', 'Cancer', 'Canes Venatici', 'Canis Major',
    'Canis Minor', 'Capricornus', 'Carina', 'Cassiopeia', 'Centaurus', 'Cepheus',
    'Cetus', 'Chamaeleon', 'Circinus', 'Columba', 'Coma Berenices', 'Corona Australis',
    'Corona Borealis', 'Corvus', 'Crater', ['Crux', 'southern cross'], 'Cygnus',
    'Delphinus', 'Dorado', 'Draco', 'Equuleus', 'Eridanus', 'Fornax', 'Grus',
    'Hercules', 'Horologium', 'Hydrus', 'Indus', 'Lacerta', 'Leo', 'Leo Minor',
    'Lepus', 'Libra', 'Lupus', 'Lynx', 'Lyra', 'Mensa', 'Microscopium', 'Monoceros',
    'Musca', 'Norma', 'Octans', 'Ophiuchus', 'Orion', 'Pavo', 'Pegasus', 'Perseus',
    'Phoenix', 'Pictor', 'Pisces', 'Piscis Austrinus', 'Puppis', 'Pyxis', 'Reticulum',
    'Sagitta', 'Sagittarius', 'Scorpius', 'Sculptor', 'Scutum', 'Serpens', 'Sextans',
    { name: 'Taurus', hint: 'Constellation · the Pleiades, the Hyades and the Crab Nebula all lie in it' }, 'Telescopium', 'Triangulum', 'Triangulum Australe', 'Tucana',
    { name: 'Ursa Major', aliases: ['big dipper', 'the plough', 'great bear'], hint: 'Constellation · all seven stars of the Plough are here, from Dubhe to Alkaid' },
    ['Ursa Minor', 'little dipper'],
    'Vela', 'Virgo', 'Volans', 'Vulpecula',
    { name: 'Zodiac', aliases: ['star sign', 'horoscope'], hint: 'The twelve constellations the Sun passes through' },
    { name: 'Milky Way band', aliases: ['galactic plane', 'the galactic equator'], hint: 'The Galaxy’s disc seen edge-on · it is the sky you are already under' },
  ])),
]

/** What a made-up place is told. */
export const NOT_REAL = 'Made up, not in this universe. Try searching for something real.'

/**
 * Recognised, and not real. Typing one of these gets the same nudge as typing
 * nonsense, because there is nowhere to go — but it is answered rather than
 * ignored, since someone who types *Tatooine* into a simulator of the actual
 * sky is owed the joke.
 */
export const FICTION = [
  ['Tatooine', 'twin suns'],
  ['Death Star', 'the death star'],
  'Alderaan',
  'Coruscant',
  'Hoth',
  'Endor',
  'Naboo',
  'Kamino',
  'Mustafar',
  ['Millennium Falcon', 'falcon'],
  ['USS Enterprise', 'enterprise', 'starship enterprise'],
  ['Arrakis', 'dune'],
  'Gallifrey',
  'Krypton',
  ['Pandora', 'pandora avatar'],
  'Trisolaris',
  'Cybertron',
  'Gargantua',
  ['Nibiru', 'planet x', 'planet nine'],
  'Asgard',
  'Middle Earth',
  ['Mos Eisley', 'mos espa'],
  ['Hyperspace', 'warp drive', 'warp speed', 'lightspeed'],
  ['Aliens', 'alien', 'ufo', 'extraterrestrials', 'little green men'],
].map((x) => {
  const [name, ...aliases] = Array.isArray(x) ? x : [x]
  return { name, aliases, kind: 'region', label: 'not real', hint: NOT_REAL }
})
