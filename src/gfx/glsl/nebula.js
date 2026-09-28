import { NOISE_GLSL } from './noise.js'

/**
 * Nebulae as volumes: glowing gas and the dust in front of it, marched per
 * pixel like the galaxies (`glsl/galaxy.js`), in a frame of the nebula's own
 * whose unit is its radius and whose +z points at the Sun — so each is seen
 * from here the way every photograph of it was taken.
 *
 * The colours are the lines the gas emits, not a palette. Ionised hydrogen
 * shines at 656 nm (H-alpha) with H-beta at 486 nm a third as bright, which a
 * camera without filters records as rose; doubly ionised oxygen at 501 nm is
 * the teal of a planetary nebula's hot interior; ionised nitrogen at 658 nm
 * reddens the Crab's filaments and the Ring's rim; a pulsar wind nebula's
 * synchrotron light is a pale blue continuum; dust lit by a hot star scatters
 * blue for the reason the sky is blue. Each is converted to linear sRGB
 * through the CIE observer, the way the stars' colours are.
 *
 * The shapes are families, seeded per object. An H II region is a cavity a
 * young cluster has blown in its birth cloud, bright where the ionising light
 * meets the cloud's wall; a planetary nebula is a shell a dying star shed,
 * hottest inside; a supernova remnant is a shock front breaking into
 * filaments; a reflection nebula is a passing dust cloud lit by the stars it
 * is passing. What is *not* claimed is the photograph: which filament bends
 * where is noise.
 */
export const NEBULA_GLSL = /* glsl */ `
${NOISE_GLSL}

uniform vec3 uCam;
uniform float uSteps;
uniform float uGain;
uniform float uJitterSeed;
uniform float uSeed;
uniform float uOct;
uniform vec4 uStars[9];   // embedded stars: position (unit frame), brightness
uniform int uNStars;

// Emission lines as linear sRGB, peak channel 1, computed from the CIE 1931
// observer by gfx/stars.js lineRGB; the continua (synchrotron, scattered and
// direct starlight) from the same Planck path the stars use.
uniform vec3 H_ALPHA;
uniform vec3 H_BETA;
uniform vec3 O_III;
uniform vec3 N_II;
uniform vec3 SYNCHROTRON;
uniform vec3 REFLECTION;
uniform vec3 STARLIGHT;

/** Balmer emission as a camera sees it: H-alpha with H-beta at a third. */
vec3 balmer() { return H_ALPHA + H_BETA * 0.33; }

float fbmN(vec3 p, float f, float fp) { return fbmAA(p, f, int(uOct), fp, 0.55); }
float ridN(vec3 p, float f, float fp) { return ridgedAA(p, f, int(uOct), fp, 0.55); }

/**
 * Ionised gas: sheets and filaments at every scale — a ridged fractal,
 * sharpened, which is where shocks and ionisation fronts crease the gas — in
 * log-normal clumps, as interstellar density is distributed.
 */
float hiiGas(vec3 q, float fp) {
  float rid = ridN(q, 3.2, fp);
  float fb = fbmN(q * 1.3 + 5.0, 3.0, fp);
  return (0.08 + 2.4 * pow(rid, 2.6)) * exp(1.3 * fb - 0.3);
}

/** How hard the embedded stars light a point: inverse square, softened. */
float starLight(vec3 p) {
  float lit = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= uNStars) break;
    vec3 d = p - uStars[i].xyz;
    lit += uStars[i].w / (dot(d, d) + 0.03);
  }
  return lit;
}

/** H II emission: Balmer everywhere the gas is lit, oxygen where the light is hardest. */
vec3 hiiColour(float lit) {
  float o3 = smoothstep(8.0, 60.0, lit);
  return mix(H_ALPHA + H_BETA * 0.33, O_III * 0.7 + H_BETA * 0.3 + vec3(0.25), o3 * 0.7);
}

void sampleNebula(vec3 p, float fp, out vec3 e, out float k) {
  e = vec3(0.0);
  k = 0.0;
  float r = length(p);
  vec3 q = p + uSeed;
  float turb = fbmN(q, 2.4, fp);
  float fine = fbmN(q * 1.7 + 11.0, 6.0, fp);
#if LOOK == 1
  // Orion: a blister. The Trapezium has hollowed a cavity on the near face of
  // its cloud; the lit wall of that cavity is the nebula — brightest round
  // the stars (the Huygens region, oxygen-teal and white), spreading into
  // rose wings along the ridge of the cloud behind. The Dark Bay pushes in
  // from one side, dust lanes lie across the near face.
  vec3 c = vec3(0.06, 0.1, 0.22);
  vec3 w = p - c + 0.15 * vec3(turb, fine, turb);
  float rc = length(w * vec3(1.0, 1.2, 1.5));
  float ridge = exp(-pow((w.y - 0.55 * w.x * w.x + 0.05) / (0.2 + 0.12 * turb), 2.0)) * exp(-pow(w.x / 0.8, 2.0));
  float bowl = exp(-rc * rc / 0.12) + ridge * 0.9 + 0.15 * (1.0 - smoothstep(0.3, 1.0, r));
  float lit = starLight(p);
  float gas = hiiGas(q, fp) * bowl * (0.6 - 0.4 * p.z);
  e = hiiColour(lit) * gas * min(lit, 60.0) * 0.045;
  vec2 bay = (p.xy - vec2(0.32, 0.02)) * mat2(0.94, 0.34, -0.34, 0.94);
  float tongue = exp(-pow(bay.x / (0.2 + 0.08 * turb), 2.0) - pow(bay.y / 0.12, 2.0)) * smoothstep(-0.1, 0.25, p.z);
  float lanes = pow(ridN(q * vec3(1.0, 2.2, 1.0), 1.6, fp), 3.0) * smoothstep(0.05, 0.5, p.z + 0.2 * turb);
  k = (tongue * 24.0 + lanes * 9.0) * (1.0 - smoothstep(0.7, 1.0, r));
#elif LOOK == 2
  // The Eagle: an ionised cavity with the Pillars of Creation standing into it,
  // dense columns of dust whose tips the cluster above is boiling away.
  float lit = starLight(p);
  float body = (1.0 - smoothstep(0.3, 1.0, r + 0.3 * turb));
  e = hiiColour(lit) * hiiGas(q, fp) * body * min(lit, 60.0) * 0.03;
  float dust = 0.0;
  float rim = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec3 base = vec3(-0.34 + 0.3 * fi, -0.95, -0.05 + 0.08 * fi);
    float top = -0.05 + 0.18 * fi - 0.1 * fi * fi + 0.12;
    vec3 ax = normalize(vec3(0.12 - 0.08 * fi, 1.0, 0.05));
    vec3 d = p - base;
    float h = clamp(dot(d, ax), 0.0, top - base.y);
    float along = h / (top - base.y);
    float rad = mix(0.13, 0.06, along) * (1.0 + 0.35 * turb) + 0.025 * fine;
    float dist = length(d - ax * h);
    float inside = 1.0 - smoothstep(rad * 0.7, rad, dist);
    dust += inside * (0.6 + 0.8 * fine);
    rim += exp(-pow((dist - rad) / (0.018 + 0.01 * along), 2.0)) * (0.4 + along * along * 1.6) * step(-0.05, dot(d, vec3(0.0, 0.3, 0.7)));
  }
  e += (H_ALPHA + H_BETA * 0.33 + vec3(0.3, 0.2, 0.1)) * rim * 1.2;
  k = dust * 30.0;
#elif LOOK == 3
  // A great H II region cut by a dust lane: the Lagoon, the North America.
  float lit = starLight(p);
  float body = 1.0 - smoothstep(0.35, 1.0, length(p * vec3(1.0, 1.6, 1.3)) + 0.35 * turb);
  e = hiiColour(lit) * hiiGas(q, fp) * body * (0.35 + min(lit, 40.0) * 0.03) * 0.9;
  float lane = exp(-pow(dot(p + 0.25 * vec3(turb, fine, turb), normalize(vec3(0.6, 1.0, 0.25))) / (0.07 + 0.08 * max(turb, 0.0)), 2.0))
    * (0.5 + smoothstep(-0.3, 0.5, fbmN(q * 2.0 + 7.0, 2.0, fp)));
  float glob = pow(smoothstep(0.35, 0.75, fbmN(q * 3.1, 3.0, fp)), 3.0);
  k = (lane * 9.0 + glob * 9.0) * (1.0 - smoothstep(0.7, 1.0, r));
#elif LOOK == 4
  // Carina: lobes of glowing gas, a V of dark lanes, and Eta Carinae's
  // Homunculus — its two lobes of 1840s ejecta — as a small bright knot.
  float lobes = 0.0;
  lobes += exp(-dot(p - vec3(-0.3, 0.1, 0.0), p - vec3(-0.3, 0.1, 0.0)) / 0.2);
  lobes += 0.8 * exp(-dot(p - vec3(0.35, -0.15, 0.1), p - vec3(0.35, -0.15, 0.1)) / 0.16);
  lobes += 0.6 * exp(-dot(p - vec3(0.05, 0.45, -0.1), p - vec3(0.05, 0.45, -0.1)) / 0.12);
  float lit = starLight(p);
  e = hiiColour(lit) * hiiGas(q, fp) * lobes * (0.4 + min(lit, 40.0) * 0.03) * (1.0 - smoothstep(0.7, 1.0, r));
  vec3 hp = p - vec3(0.02, 0.05, 0.1);
  float hom = exp(-dot(hp * vec3(1.0, 0.55, 1.0), hp * vec3(1.0, 0.55, 1.0)) / 0.0006);
  e += vec3(1.0, 0.8, 0.6) * hom * 4.0;
  vec3 wp = p + 0.2 * vec3(turb, fine, 0.0);
  float vlane = exp(-pow(abs(wp.x) * 1.4 - (wp.y + 0.35) * 0.9, 2.0) / (0.01 + 0.02 * max(fine, 0.0))) * smoothstep(-0.5, -0.3, wp.y)
    * (0.4 + smoothstep(-0.3, 0.4, fbmN(q * 2.5, 2.0, fp)));
  k = (vlane * 14.0 + pow(smoothstep(0.4, 0.8, fbmN(q * 2.6, 2.5, fp)), 3.0) * 16.0) * (1.0 - smoothstep(0.7, 1.0, r));
#elif LOOK == 5
  // The Rosette: a thick shell round the cluster that blew it, dark globules
  // on its inner face.
  float sh = smoothstep(0.3, 0.55, r + 0.15 * turb) * (1.0 - smoothstep(0.7, 0.98, r + 0.2 * turb));
  float lit = starLight(p);
  e = hiiColour(lit * 0.4) * hiiGas(q, fp) * sh * 1.2 + O_III * 0.04 * exp(-r / 0.3);
  float glob = pow(smoothstep(0.45, 0.8, fbmN(q * 4.0, 3.5, fp)), 2.0) * smoothstep(0.3, 0.45, r) * (1.0 - smoothstep(0.55, 0.7, r));
  k = glob * 30.0;
#elif LOOK == 6
  // The Ring: a barrel seen down its axis. Hot, doubly ionised oxygen fills it
  // blue-green; the rim, cooler and further from the star, is nitrogen red.
  float rho = length(p.xy * vec2(1.0, 1.22));
  float barrel = exp(-pow((rho - 0.6 - 0.05 * turb) / 0.13, 2.0)) * exp(-pow(p.z / 0.75, 2.0));
  float inner = exp(-pow(rho / 0.5, 2.0)) * exp(-pow(p.z / 0.55, 2.0));
  float halo = exp(-pow((r - 0.85) / 0.12, 2.0)) * 0.12;
  float fil = 0.7 + 0.6 * fine;
  e = N_II * barrel * fil * 1.3 + H_ALPHA * barrel * 0.4 + (O_III * 0.55 + H_BETA * 0.25 + vec3(0.25)) * inner * (0.7 + 0.5 * fine) + N_II * halo;
  k = barrel * pow(smoothstep(0.3, 0.7, fbmN(q * 5.0, 6.0, fp)), 2.0) * 4.0;
#elif LOOK == 7
  // The Helix: two rings at an angle to each other, oxygen inside, and on the
  // inner edge the cometary knots — dense globules with tails pointing away
  // from the star.
  float rho = length(p.xy);
  vec3 p2 = vec3(p.x, p.y * cos(0.5) - p.z * sin(0.5), p.y * sin(0.5) + p.z * cos(0.5));
  float ring1 = exp(-pow((rho - 0.55 - 0.06 * turb) / 0.12, 2.0)) * exp(-pow(p.z / 0.4, 2.0));
  float ring2 = exp(-pow((length(p2.xy) - 0.8 - 0.05 * turb) / 0.1, 2.0)) * exp(-pow(p2.z / 0.35, 2.0)) * 0.6;
  float inner = exp(-pow(rho / 0.45, 2.0)) * exp(-pow(p.z / 0.4, 2.0));
  // Knots: cells in angle and radius on the inner rim, each a head and a tail.
  float ang = atan(p.y, p.x) * 18.0;
  float cid = floor(ang);
  vec3 h = pz_hash33(vec3(cid, 3.0, uSeed));
  float rk = 0.42 + 0.06 * h.x;
  float da = (fract(ang) - 0.5) * rho * 0.35;
  float head = exp(-(da * da + pow(rho - rk, 2.0)) / 0.0006) * step(0.4, h.y);
  float tail = exp(-da * da / 0.0004) * smoothstep(rk, rk + 0.01, rho) * exp(-(rho - rk) / 0.08) * step(0.4, h.y);
  e = (H_ALPHA * 0.9 + N_II * 0.4) * (ring1 + ring2) * (0.6 + 0.8 * fine) + (O_III * 0.45 + H_BETA * 0.2 + vec3(0.15)) * inner * (0.7 + 0.5 * fine) + balmer() * tail * 0.8;
  k = head * 40.0 * exp(-p.z * p.z / 0.1);
#elif LOOK == 8
  // The Crab: a pulsar wind nebula. Synchrotron light fills the ellipsoid,
  // pale blue; the thermal filaments of the 1054 ejecta cage it in red and
  // orange.
  vec3 ep = p * vec3(1.0, 1.45, 1.35);
  float er = length(ep);
  float cloud = (1.0 - smoothstep(0.2, 1.0, er + 0.15 * turb)) * (0.75 + 0.5 * fine);
  float fil = pow(ridN(q * 1.3, 2.4, fp), 3.0) * smoothstep(0.35, 0.8, er) * (1.0 - smoothstep(0.85, 1.05, er + 0.1 * turb));
  e = SYNCHROTRON * cloud * 0.55 + (N_II * 0.8 + H_ALPHA * 0.5 + vec3(1.0, 0.55, 0.1) * 0.35) * fil * 3.0;
  // The pulsar: 30 turns a second, a point of light at the heart.
  e += STARLIGHT * exp(-dot(p, p) / 0.0004) * 6.0;
  k = fil * 0.8;
#elif LOOK == 9
  // The Veil: a thin, broken shock shell twenty thousand years old — oxygen
  // teal on its leading edge, hydrogen red behind.
  float shell = exp(-pow((r - 0.86 - 0.05 * turb) / 0.035, 2.0));
  float filament = pow(ridN(q * 1.6, 3.0, fp), 2.5);
  float cover = smoothstep(-0.1, 0.35, fbmN(q * 0.7, 1.2, fp));
  float edge = r - 0.86;
  e = (mix(balmer() * 1.1, O_III * 1.2, smoothstep(-0.03, 0.03, edge + 0.02 * fine))) * shell * filament * cover * 2.5;
#elif LOOK == 10
  // The Horsehead: a dark pillar standing against IC 434's glowing sheet,
  // the ionisation front the stars of Orion's belt are driving into the cloud.
  float sheet = smoothstep(-0.9, -0.2, p.z) * (1.0 - smoothstep(-0.2, 0.05, p.z));
  float striae = 0.6 + 0.8 * smoothstep(-0.3, 0.6, fbmN(q * vec3(4.0, 0.6, 1.0), 2.0, fp));
  float front = smoothstep(-0.15, 0.1, p.x + 0.12 * turb);
  e = balmer() * sheet * striae * front * 1.2 * (1.0 - smoothstep(0.55, 0.95, length(p.xy) + 0.15 * turb));
  // The cloud bank below, and the head rising out of it.
  float bank = smoothstep(0.05, -0.25, p.x + 0.1 * turb) * (1.0 - smoothstep(0.1, 0.3, abs(p.z + 0.1))) * (1.0 - smoothstep(0.6, 0.95, length(p.xy)));
  vec2 nk = p.xy - vec2(-0.05, 0.05);
  float neck = exp(-pow(nk.x / 0.1, 2.0) - pow((nk.y) / 0.3, 2.0));
  vec2 hd = (p.xy - vec2(0.12, 0.33)) * mat2(0.8, -0.6, 0.6, 0.8);
  float head = exp(-pow(hd.x / 0.2, 2.0) - pow(hd.y / 0.08, 2.0));
  float horse = max(neck, head) * (1.0 - smoothstep(0.1, 0.25, abs(p.z)));
  k = (bank + horse * 1.2) * 45.0 * (0.8 + 0.4 * fine);
  e += vec3(1.0, 0.6, 0.35) * horse * smoothstep(0.4, 0.9, fine) * 0.05;
#elif LOOK == 11
  // The Pleiades: not a nebula of their own but a dust cloud the cluster is
  // drifting through, lit by its hot stars — blue, streaked along the
  // magnetic field threading the cloud.
  float haze = (1.0 - smoothstep(0.3, 1.0, r)) * pow(smoothstep(-0.2, 0.6, fbmN(q * vec3(1.0, 3.5, 1.0), 2.0, fp)), 1.5);
  float lit = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= uNStars) break;
    vec3 d = p - uStars[i].xyz;
    lit += uStars[i].w / (dot(d, d) + 0.004);
  }
  e = REFLECTION * haze * lit * 0.018;
  k = haze * 0.4;
#endif
  // Nothing reaches the box that bounds the march.
  float win = 1.0 - smoothstep(0.88, 1.0, r);
  e *= win;
  k *= win;
}

/** The unit box, entry and exit. */
vec2 unitBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-1.0 - ro) * inv;
  vec3 t1 = (1.0 - ro) * inv;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

float nebJitter(vec2 px) {
  vec3 p3 = fract(vec3(px.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 marchNebula(vec3 ro, vec3 rd, float jitter) {
  vec2 hit = unitBox(ro, rd);
  if (hit.x >= hit.y || hit.y <= 0.0) return vec4(0.0);
  float t = max(hit.x, 0.0);
  float tEnd = hit.y;
  float dt = (tEnd - t) / uSteps;
  t += dt * jitter;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps || t >= tEnd) break;
    vec3 p = ro + rd * t;
    vec3 e;
    float kk;
    sampleNebula(p, dt, e, kk);
    vec3 k = vec3(0.75, 1.0, 1.32) * kk;
    vec3 att = exp(-k * dt);
    vec3 through = mix(vec3(dt), (1.0 - att) / max(k, vec3(1e-6)), step(vec3(1e-4), k * dt));
    L += T * e * through;
    T *= att;
    t += dt;
    if (T.g < 0.004) break;
  }
  // Embedded stars, drawn where the ray passes them. The Pleiades' are the
  // named stars, drawn by the star layer already; here they only light the dust.
#if LOOK != 11
  for (int i = 0; i < 9; i++) {
    if (i >= uNStars) break;
    vec3 s = uStars[i].xyz - ro;
    float along = dot(s, rd);
    if (along <= 0.0) continue;
    float miss = length(s - rd * along);
    L += STARLIGHT * uStars[i].w * exp(-miss * miss / 0.00005) * 0.4;
  }
#endif
  return vec4(L * uGain, 1.0 - T.g);
}
`
