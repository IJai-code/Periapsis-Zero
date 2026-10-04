import { live } from '../sim/live.js'
import { mission, currentPhase } from '../sim/mission.js'
import { requestedPreset } from '../sim/presets.js'
import { SHIP } from '../sim/constants.js'
import { activeSite } from '../sim/launchsite.js'

/**
 * What a plate says under it.
 *
 * A picture of a spacecraft is a picture of a spacecraft. A picture of a
 * spacecraft that says *Apollo 8 · T+00:02:31 · 21 December 1968 · 62 km over
 * the Atlantic* is a record of something, and the difference costs four lines
 * of text. Everything here is read from the same state the instruments read,
 * at the instant the frame was taken, so the caption cannot drift from the
 * picture the way a hand-written one would.
 *
 * It is drawn on the image rather than beside it because the file is what
 * travels: it gets posted, quoted, pasted into a message, and a caption that
 * lives in a web page does not survive any of that.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Mission elapsed time, as a count reads it. Pure, so `verify-plate` can hold it. */
export function metLabel(t) {
  if (!Number.isFinite(t)) return null
  const sign = t < 0 ? '−' : '+'
  const a = Math.abs(Math.round(t))
  const two = (n) => String(n).padStart(2, '0')
  return `T${sign}${two(Math.floor(a / 3600))}:${two(Math.floor((a % 3600) / 60))}:${two(a % 60)}`
}

/**
 * Height above whichever body the flight is actually over, read from the same
 * place the instrument strip reads it so the plate and the panel cannot
 * disagree — `live.lunar` once the Moon is the primary, `live.elements` before.
 */
/** A height above a named body, in units a person can picture. Pure. */
export function heightLabel(alt, lunar = false) {
  if (!Number.isFinite(alt) || alt < 0) return null
  const over = lunar ? 'over Luna' : 'over Terra'
  if (alt < 1000) return `${Math.round(alt)} m ${over}`
  if (alt < 1e6) return `${(alt / 1000).toFixed(alt < 1e5 ? 1 : 0)} km ${over}`
  return `${Math.round(alt / 1000).toLocaleString('en-GB')} km ${over}`
}

/** What the flight is over now: the same choice the instrument strip makes. */
function height() {
  const lunar = Boolean(SHIP.lunar) && Number.isFinite(live.lunar?.altitude)
  return heightLabel(lunar ? live.lunar.altitude : live.elements?.altitude, lunar)
}

/** The lines, in the order a plate reads them. */
export function captionLines() {
  const preset = requestedPreset()
  const title = preset ? preset.title.replace(' · ', ': ') : `${SHIP.name} · ${activeSite().name}`
  const facts = [metLabel(mission.t), DATE.format(live.date)].filter(Boolean)
  const h = height()
  if (h) facts.push(h)
  const phase = currentPhase()?.label ?? currentPhase()?.id
  if (phase) facts.push(String(phase).toLowerCase())
  return { title, facts: facts.join('   ·   ') }
}

/**
 * Lay the caption on the frame and hand the file to the browser.
 *
 * The plate is drawn in device pixels of the captured image, so the type is the
 * same size relative to the picture whatever resolution it was taken at, and
 * it sits inside a margin scaled the same way.
 */
export function captionPhotograph(dataUrl, { download = true } = {}) {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)

    const { title, facts } = captionLines()
    // One unit of the picture's own scale, so a 4K plate and a 1080 one look
    // alike rather than one of them looking like it was captioned by a giant.
    const u = img.height / 1000
    const pad = 34 * u
    const base = c.height - pad

    // A gradient foot, so the type has something to sit on whatever is behind.
    const foot = g.createLinearGradient(0, c.height - 150 * u, 0, c.height)
    foot.addColorStop(0, 'rgba(8,9,11,0)')
    foot.addColorStop(1, 'rgba(8,9,11,0.72)')
    g.fillStyle = foot
    g.fillRect(0, c.height - 150 * u, c.width, 150 * u)

    g.textBaseline = 'alphabetic'
    g.fillStyle = 'rgba(240,233,225,0.94)'
    g.font = `${22 * u}px "JetBrains Mono", ui-monospace, monospace`
    g.fillText(title, pad, base - 26 * u)

    g.fillStyle = 'rgba(214,196,168,0.70)'
    g.font = `${13 * u}px "JetBrains Mono", ui-monospace, monospace`
    g.fillText(facts, pad, base)

    // The mark, opposite, quiet.
    g.textAlign = 'right'
    g.fillStyle = 'rgba(214,196,168,0.42)'
    g.font = `${11 * u}px "JetBrains Mono", ui-monospace, monospace`
    g.fillText('PERIAPSIS ZERO · periapsiszero.dev', c.width - pad, base)
    g.textAlign = 'left'

    const out = c.toDataURL('image/png')
    if (!download) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const a = document.createElement('a')
    a.href = out
    a.download = `periapsis-${stamp}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  img.onerror = () => console.error('[periapsis] the photograph could not be laid out')
  img.src = dataUrl
}
