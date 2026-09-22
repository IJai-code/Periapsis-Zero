import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { live } from '../sim/live.js'
import { MAX_NODE_FRAMES, plan, prediction } from '../sim/predict.js'
import {
  addNode,
  deferNode,
  nodeMagnitude,
  nodes,
  removeNode,
  selectNode,
  selectedNode,
  selectedNodeId,
  setNodeDv,
  setNodeTime,
} from '../sim/nodes.js'
import {
  CENTRE_GRAB_PX,
  GIZMO_RADIUS_PX,
  HANDLES,
  HANDLE_GRAB_PX,
  HANDLE_MIN_SPREAD_PX,
  LINE_GRAB_PX,
  epochOnSegment,
  gainFor,
  lineThreshold,
  modifierFrom,
  chooseEpoch,
  paramOnSegment,
  pixelsToWorld,
  screenAxis,
  viewDepth,
} from '../gfx/gizmo.js'

/**
 * Editing a manoeuvre by hand.
 *
 * Three gestures, all of them coordinate round trips. Clicking the projected
 * path puts a node at the instant that point on the line represents. Pulling
 * one of six handles adds delta-v along one axis of the orbital frame. Dragging
 * the node's centre slides it along the path in time, which re-runs the planned
 * projection under the pointer.
 *
 * Two decisions shape everything else here.
 *
 * The gizmo is drawn and picked in *pixels*, not metres. It is a control, and a
 * control that shrinks to nothing when you zoom out from a lunar orbit is not
 * one. Every size in this file is a screen size converted through
 * `pixelsToWorld` at the node's view depth.
 *
 * And picking is done here rather than through R3F's event system, on a
 * capture-phase listener attached to the canvas's *parent*. Both this and
 * OrbitControls want the same pointerdown, and two listeners on the same
 * element fire in registration order — which React mount order does not
 * guarantee. A capture listener one level up always runs first, so claiming a
 * handle drag is a `stopPropagation` rather than a race. The same trick the
 * camera rig uses to scale the wheel before OrbitControls reads it.
 *
 * The corollary is that a press on the *line* is deliberately not claimed: it
 * might be the beginning of a camera drag. That one is decided on release, by
 * whether the pointer moved.
 */

/** Handle geometry, in screen pixels. */
const HANDLE_LEN_PX = 21
const CENTRE_PX = 8
const MARKER_PX = 6
const GHOST_PX = 5

/** A generous grab on the line while scrubbing — the pointer must not lose it. */
const SCRUB_GRAB_PX = 44

/** How far the pointer may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 4

/**
 * How far ahead of the craft a node must stay, in seconds.
 *
 * The sequencer needs to turn the vehicle before it can burn, and it starts
 * aligning `nodeAlignMargin` seconds early. A node dropped ten seconds ahead is
 * not flyable; it is just not *skipped*, which is the weaker property
 * `setNodeTime` guarantees. This is the editor being polite about it.
 */
const MIN_LEAD = 30

/**
 * How often the node's label text is rebuilt, in seconds.
 *
 * Positions follow every frame; the words do not. Formatting a delta-v and a
 * countdown builds strings, and the render loop builds none below the HUD's own
 * ~9 Hz — the rule the telemetry panels already keep. Ten times a second is
 * faster than a digit can be read changing.
 */
const LABEL_REFRESH = 0.1

const UP_Y = new THREE.Vector3(0, 1, 0)
const AXIS_OF = { prograde: 3, normal: 6, radial: 9 }

/** Opacity of a handle: the positive side reads solid, the negative side hollow. */
const baseOpacity = (sign) => (sign > 0 ? 0.92 : 0.5)

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

export function NodeEditor({ line, planLine, host }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)

  const gizmo = useRef()
  const centre = useRef()
  const handles = useRef([])
  const markers = useRef([])
  const ghost = useRef()
  const ghostText = useRef()
  const nodeLabel = useRef()
  const nodeText = useRef()

  /** Everything mutable that must not be re-created per frame. */
  const s = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      hits: [],
      epochs: new Float64Array(64),
      gaps: new Float64Array(64),
      segments: new Int32Array(64),
      params: new Float64Array(64),
      /** Which projection each candidate came from, parallel to the arrays above. */
      owners: new Array(64).fill(null),
      /** The drawn segment and position along it that the last pick chose. */
      picked: { segment: -1, param: 0, projection: prediction },
      ndc: new THREE.Vector2(),
      centreLocal: new THREE.Vector3(),
      centreWorld: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      handleWorld: new THREE.Vector3(),
      screen: new THREE.Vector3(),
      axis2: new THREE.Vector2(),
      local: new THREE.Vector3(),
      /** Live pointer, in client pixels. */
      pointer: { x: 0, y: 0, moved: false, inside: false },
      /** A press that has not yet been decided: a click, or a camera drag. */
      pending: null,
      /** An active handle pull or time scrub. */
      drag: null,
      /** Which handle the pointer is over, -1 for none. */
      hoverHandle: -1,
      /** Placement written by the frame loop, read by the pick handlers. */
      placed: { ok: false, radius: 0, slot: -1 },
      /** Seconds since the label text was last rebuilt. */
      labelClock: LABEL_REFRESH,
    }),
    [],
  )

  const kit = useMemo(() => {
    const cone = new THREE.ConeGeometry(0.4, 1, 18)
    const ball = new THREE.SphereGeometry(1, 20, 14)
    const mat = (color, opacity) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        // Always reachable. A control the planet can swallow is a control the
        // pilot has to fight the camera to use, and the picking here ignores
        // depth anyway — so drawing it on top keeps what is grabbable and what
        // is visible the same set.
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    return {
      cone,
      ball,
      handleMats: HANDLES.map((h) => mat(h.color, baseOpacity(h.sign))),
      centreMat: mat('#ffffff', 0.9),
      markerMat: mat('#e8823c', 0.75),
      ghostMat: mat('#dfe3e6', 0.8),
    }
  }, [])

  useEffect(
    () => () => {
      kit.cone.dispose()
      kit.ball.dispose()
      for (const m of kit.handleMats) m.dispose()
      kit.centreMat.dispose()
      kit.markerMat.dispose()
      kit.ghostMat.dispose()
    },
    [kit],
  )

  /* ------------------------------------------------------------------ *
   * Picking
   * ------------------------------------------------------------------ */

  /**
   * Which slot of the planned projection a node's recorded frame sits in.
   *
   * Matched by id rather than by position. `plan.applied` lists only the nodes
   * that actually fired inside the projected span, in firing order, so the nth
   * node in the plan is not generally the nth entry here — and the whole point
   * of the frames is that they belong to a specific burn.
   */
  const slotFor = (node) => {
    if (!node) return -1
    for (let i = 0; i < plan.applied.length && i < MAX_NODE_FRAMES; i++) {
      if (plan.applied[i] === node.id) return i
    }
    return -1
  }

  const toNdc = (px, py) => {
    s.ndc.set(
      ((px - size.left) / size.width) * 2 - 1,
      -((py - size.top) / size.height) * 2 + 1,
    )
    return s.ndc
  }

  /** Screen position of a world point, in client pixels. */
  const toScreen = (world) => {
    s.screen.copy(world).project(camera)
    s.screen.set(
      size.left + ((s.screen.x + 1) / 2) * size.width,
      size.top + ((1 - s.screen.y) / 2) * size.height,
      s.screen.z,
    )
    return s.screen
  }

  /** Fill `s.centreWorld` / `s.dir`-ready state for slot `i`. */
  const readFrame = (i) => {
    const f = i * 12
    s.centreLocal.set(plan.nodeFrames[f], plan.nodeFrames[f + 1], plan.nodeFrames[f + 2])
    s.centreWorld.copy(s.centreLocal).add(host.current.position)
  }

  const axisOf = (slot, axis, sign, out) => {
    const o = slot * 12 + AXIS_OF[axis]
    return out
      .set(plan.nodeFrames[o], plan.nodeFrames[o + 1], plan.nodeFrames[o + 2])
      .multiplyScalar(sign)
  }

  /**
   * Handles and centre ball of the selected node, in client pixels.
   *
   * Recomputed rather than cached from the frame loop. A pointerdown arrives
   * between frames, and between frames the origin can have moved tens of
   * thousands of kilometres at high time compression — a stale handle position
   * would mean the gizmo is grabbable where it *was*.
   */
  const pickGizmo = (px, py) => {
    const node = selectedNode()
    const slot = slotFor(node)
    if (slot < 0 || !host.current) return null
    readFrame(slot)

    const depth = viewDepth(s.centreWorld, camera)
    if (depth <= camera.near) return null
    const radius = pixelsToWorld(GIZMO_RADIUS_PX, depth, camera.fov, size.height)

    const middle = toScreen(s.centreWorld)
    if (middle.z > 1) return null
    const cx = middle.x
    const cy = middle.y

    for (let i = 0; i < HANDLES.length; i++) {
      const h = HANDLES[i]
      axisOf(slot, h.axis, h.sign, s.dir)
      s.handleWorld.copy(s.centreWorld).addScaledVector(s.dir, radius)
      const at = toScreen(s.handleWorld)
      if (at.z > 1) continue // behind the camera
      // Foreshortened past the point of being distinguishable — see
      // HANDLE_MIN_SPREAD_PX. Refused rather than mis-picked.
      const sx = at.x - cx
      const sy = at.y - cy
      if (sx * sx + sy * sy < HANDLE_MIN_SPREAD_PX * HANDLE_MIN_SPREAD_PX) continue
      const gx = at.x - px
      const gy = at.y - py
      if (gx * gx + gy * gy <= HANDLE_GRAB_PX * HANDLE_GRAB_PX) {
        screenAxis(s.axis2, s.centreWorld, s.dir, camera, size.width, size.height)
        return {
          kind: 'handle',
          index: i,
          node,
          speed: plan.nodeSpeeds[slot],
          ax: s.axis2.x,
          ay: s.axis2.y,
        }
      }
    }

    const mx = cx - px
    const my = cy - py
    if (mx * mx + my * my <= CENTRE_GRAB_PX * CENTRE_GRAB_PX) {
      return { kind: 'centre', node }
    }
    return null
  }

  /** Another node's marker, so it can be selected by clicking it. */
  const pickMarker = (px, py) => {
    if (!host.current) return null
    const current = selectedNodeId()
    for (let i = 0; i < plan.applied.length && i < MAX_NODE_FRAMES; i++) {
      if (plan.applied[i] === current) continue
      readFrame(i)
      const at = toScreen(s.centreWorld)
      if (at.z > 1) continue
      const gx = at.x - px
      const gy = at.y - py
      if (gx * gx + gy * gy <= CENTRE_GRAB_PX * CENTRE_GRAB_PX) return plan.applied[i]
    }
    return null
  }

  /**
   * Where on the ballistic path the pointer is, as seconds from now.
   *
   * `grab` widens the tolerance for a scrub in progress, where losing the line
   * mid-gesture would drop the node rather than move it.
   */
  /**
   * Score one drawn path's hits into the candidate arrays.
   *
   * Every candidate is scored twice: when it happens, and how far from the
   * pointer it is drawn. The second is measured in screen pixels rather than
   * taken from the raycaster's own 3D miss distance, because "the bit of line
   * under the cursor" is a statement about pixels, and at a crossing the two
   * criteria disagree.
   */
  const gather = (object, projection, px, py, grab, from) => {
    s.raycaster.params.Line2 = { threshold: lineThreshold(object.material.linewidth, grab) }
    s.raycaster.setFromCamera(toNdc(px, py), camera)
    // Popped, not truncated: `length = 0` makes V8 drop the backing store and
    // the raycaster's pushes allocate a new one on every pointer move.
    while (s.hits.length > 0) s.hits.pop()
    object.raycast(s.raycaster, s.hits)

    let n = from
    for (let i = 0; i < s.hits.length && n < s.epochs.length; i++, n++) {
      const hit = s.hits[i]
      s.local.copy(hit.pointOnLine).sub(host.current.position)
      const u = paramOnSegment(projection.points, hit.faceIndex, s.local.x, s.local.y, s.local.z)
      s.segments[n] = hit.faceIndex
      s.params[n] = u
      s.owners[n] = projection
      s.epochs[n] = epochOnSegment(projection, hit.faceIndex, u)
      const at = toScreen(hit.pointOnLine)
      const gx = at.x - px
      const gy = at.y - py
      s.gaps[n] = Math.sqrt(gx * gx + gy * gy)
    }
    return n
  }

  /**
   * Where on either drawn path the pointer is, as seconds from that path's own
   * start.
   *
   * Both paths are offered and the nearest pixel decides. The planned one is
   * why this exists: a second burn is planned on the orbit the first one
   * produces, and that orbit is drawn only in amber. Reading such a click off
   * the cyan line would put the node on a trajectory the craft is no longer
   * going to fly. Before the first burn the two coincide and agree anyway.
   */
  const pickLine = (px, py, grab = LINE_GRAB_PX, continuing = null) => {
    if (!line || !host.current) return null
    let n = gather(line, prediction, px, py, grab, 0)
    if (planLine && planLine.visible) n = gather(planLine, plan, px, py, grab, n)
    if (n === 0) return null
    const k = chooseEpoch(s.epochs, s.gaps, n, continuing)
    if (k < 0) return null
    s.picked.segment = s.segments[k]
    s.picked.param = s.params[k]
    s.picked.projection = s.owners[k]
    return s.epochs[k]
  }

  /**
   * An epoch on a drawn path, as absolute simulated time.
   *
   * Through that path's own `t0` rather than the live clock. The two are
   * refreshed on different triggers — the cyan one on a fifth-of-a-second
   * clock, the amber one whenever the plan changes — so their epochs are
   * measured from instants that far apart, which at orbital speed is 1.5 km of
   * misplacement for a node.
   */
  const absolute = (epoch, projection) => (projection ? projection.t0 : live.sim.t) + epoch

  /* ------------------------------------------------------------------ *
   * Gestures
   * ------------------------------------------------------------------ */

  useEffect(() => {
    const canvas = gl.domElement
    const parent = canvas.parentElement ?? canvas

    const endDrag = () => {
      if (s.drag && s.drag.kind === 'scrub') deferNode(s.drag.node, false)
      s.drag = null
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragEnd)
      window.removeEventListener('pointercancel', onDragEnd)
    }

    function onDragMove(e) {
      const d = s.drag
      if (!d) return
      e.preventDefault()

      if (d.kind === 'scrub') {
        const epoch = pickLine(e.clientX, e.clientY, SCRUB_GRAB_PX, d.epoch)
        if (epoch === null) return
        d.epoch = epoch
        setNodeTime(d.node, absolute(epoch, s.picked.projection), live.sim.t, MIN_LEAD)
        return
      }

      /**
       * A modifier pressed mid-drag re-baselines rather than rescaling.
       * Rescaling from the original anchor would multiply the delta already
       * accumulated and jump the value by hundreds of metres per second at the
       * exact moment the pilot asked for finer control.
       */
      const mod = modifierFrom(e)
      if (mod !== d.modifier) {
        d.modifier = mod
        d.gain = gainFor(d.speed, mod)
        d.base = d.node[d.axis]
        d.x = e.clientX
        d.y = e.clientY
      }
      const along = (e.clientX - d.x) * d.ax + (e.clientY - d.y) * d.ay
      setNodeDv(d.node, d.axis, d.base + along * d.gain * d.sign)
    }

    function onDragEnd() {
      endDrag()
    }

    const onDown = (e) => {
      if (e.target !== canvas || e.button !== 0) return
      // The matrices these picks read are composed during render, so they are a
      // frame old by the time an event arrives. Cheap to bring current, and the
      // alternative is a gizmo that is grabbable slightly beside itself.
      camera.updateMatrixWorld(true)
      host.current?.updateMatrixWorld(true)

      const hit = pickGizmo(e.clientX, e.clientY)
      if (hit) {
        // Claimed: a handle or the centre is a drag by nature, and the camera
        // must not also start one. Stopping here, one element above the canvas,
        // means OrbitControls never sees the press at all.
        e.stopPropagation()
        e.preventDefault()
        if (hit.kind === 'centre') {
          // Held out of the plan for the duration: the amber line then draws the
          // path this node slides along rather than the one it produces.
          deferNode(hit.node, true)
          s.drag = { kind: 'scrub', node: hit.node, epoch: hit.node.t - live.sim.t }
        } else {
          const h = HANDLES[hit.index]
          const mod = modifierFrom(e)
          s.drag = {
            kind: 'handle',
            node: hit.node,
            axis: h.axis,
            sign: h.sign,
            ax: hit.ax,
            ay: hit.ay,
            speed: hit.speed,
            modifier: mod,
            gain: gainFor(hit.speed, mod),
            base: hit.node[h.axis],
            x: e.clientX,
            y: e.clientY,
          }
        }
        window.addEventListener('pointermove', onDragMove)
        window.addEventListener('pointerup', onDragEnd)
        window.addEventListener('pointercancel', onDragEnd)
        return
      }

      /**
       * Not claimed. A press on the line or on another node's marker might be
       * the start of a camera drag, and swallowing it would make the trajectory
       * a dead zone you cannot orbit through. Decided on release instead.
       */
      const marker = pickMarker(e.clientX, e.clientY)
      const epoch = marker === null ? pickLine(e.clientX, e.clientY) : null
      s.pending =
        marker !== null || epoch !== null
          ? {
              marker,
              epoch,
              // Captured now: hovering between press and release re-picks, and
              // the path under the pointer then is not the one pressed on.
              from: s.picked.projection,
              x: e.clientX,
              y: e.clientY,
            }
          : null
    }

    const onUp = (e) => {
      const p = s.pending
      s.pending = null
      if (!p || e.button !== 0) return
      const tx = e.clientX - p.x
      const ty = e.clientY - p.y
      if (tx * tx + ty * ty > CLICK_SLOP * CLICK_SLOP) return
      if (p.marker !== null) {
        selectNode(p.marker)
        return
      }
      const node = addNode(Math.max(absolute(p.epoch, p.from), live.sim.t + MIN_LEAD))
      selectNode(node.id)
    }

    const onMove = (e) => {
      s.pointer.x = e.clientX
      s.pointer.y = e.clientY
      s.pointer.inside = true
      s.pointer.moved = true
    }
    const onLeave = () => {
      s.pointer.inside = false
      s.pointer.moved = true
    }

    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') return selectNode(null)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedNodeId()
        if (id !== null) {
          e.preventDefault()
          removeNode(id)
        }
      }
    }

    parent.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointermove', onMove, { passive: true })
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)
    return () => {
      parent.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
      endDrag()
      s.pending = null
    }
  }, [camera, gl, host, line, size, s])

  /* ------------------------------------------------------------------ *
   * Placement
   * ------------------------------------------------------------------ */

  useFrame((_, delta) => {
    const g = gizmo.current
    const h = host.current
    if (!g || !h) return

    /**
     * Matrices brought current by hand, rather than by running late.
     *
     * The obvious arrangement — a priority above the camera rig's zero, so the
     * gizmo is placed against a camera that has already moved — is the one
     * arrangement R3F forbids: any subscriber with a positive priority takes
     * over the render loop, and nothing calls `gl.render` any more. Driver's
     * nearest-surface pass learned that the expensive way and its comment says
     * so. So this runs at zero, in unspecified order against the rig, and
     * composes what it needs itself. The worst case is a gizmo sized against
     * where the camera was one frame ago, which is a sub-pixel error on a
     * control the pilot is looking straight at.
     */
    camera.updateMatrixWorld(true)
    h.updateMatrixWorld(true)

    const node = selectedNode()
    const slot = slotFor(node)
    s.placed.slot = slot

    /* --- markers for every planned burn --- */
    for (let i = 0; i < MAX_NODE_FRAMES; i++) {
      const m = markers.current[i]
      if (!m) continue
      const shown = i < plan.applied.length && plan.applied[i] !== selectedNodeId()
      m.visible = shown
      if (!shown) continue
      readFrame(i)
      m.position.copy(s.centreLocal)
      m.scale.setScalar(
        pixelsToWorld(MARKER_PX, viewDepth(s.centreWorld, camera), camera.fov, size.height),
      )
    }

    /* --- the gizmo on the selected node --- */
    g.visible = slot >= 0
    s.placed.ok = false
    if (slot >= 0) {
      readFrame(slot)
      const depth = viewDepth(s.centreWorld, camera)
      if (depth <= camera.near) {
        g.visible = false
      } else {
        const radius = pixelsToWorld(GIZMO_RADIUS_PX, depth, camera.fov, size.height)
        const len = pixelsToWorld(HANDLE_LEN_PX, depth, camera.fov, size.height)
        s.placed.ok = true
        s.placed.radius = radius

        g.position.copy(s.centreLocal)
        if (centre.current) {
          centre.current.scale.setScalar(
            pixelsToWorld(CENTRE_PX, depth, camera.fov, size.height),
          )
        }

        const total = nodeMagnitude(node) || 1
        // Scalars, not the vector: `toScreen` hands back one shared instance,
        // so holding on to it and projecting a handle would silently compare
        // the handle against itself and report a spread of zero.
        const middle = toScreen(s.centreWorld)
        const cx = middle.x
        const cy = middle.y
        for (let i = 0; i < HANDLES.length; i++) {
          const mesh = handles.current[i]
          if (!mesh) continue
          const hd = HANDLES[i]
          axisOf(slot, hd.axis, hd.sign, s.dir)
          mesh.position.copy(s.dir).multiplyScalar(radius)
          mesh.quaternion.setFromUnitVectors(UP_Y, s.dir)
          mesh.scale.set(len * 0.62, len, len * 0.62)

          /**
           * An axis pointing at the camera cannot be grabbed, and says so. A
           * ghost handle is a handle you can see is there and can see is not
           * available — which is what tells the pilot to orbit a little rather
           * than to keep clicking.
           */
          s.handleWorld.copy(s.centreWorld).addScaledVector(s.dir, radius)
          const at = toScreen(s.handleWorld)
          const sx = at.x - cx
          const sy = at.y - cy
          if (sx * sx + sy * sy < HANDLE_MIN_SPREAD_PX * HANDLE_MIN_SPREAD_PX) {
            kit.handleMats[i].opacity = 0.12
            continue
          }

          /**
           * Brightness carries the burn. An axis with delta-v on it reads solid
           * on the side it is pulling toward and stays hollow on the other, so
           * a glance at the gizmo says what the node does without reading the
           * panel — and the handles themselves never move, which is what keeps
           * them grabbable.
           */
          const share = Math.min(1, Math.abs(node[hd.axis]) / total)
          const engaged = Math.sign(node[hd.axis]) === hd.sign ? share : 0
          // Hover is always the brightest thing on the gizmo, so the ladder has
          // to stay under it: an engaged handle reaches its own base opacity and
          // no further. The first version added a bonus on top and came out at
          // 1.27, which the shader clamps — leaving the *hovered* handle looking
          // dimmer than the one beside it.
          kit.handleMats[i].opacity =
            s.hoverHandle === i ? 1 : baseOpacity(hd.sign) * (0.65 + 0.35 * engaged)
        }

        s.labelClock += delta
        if (nodeText.current && s.labelClock >= LABEL_REFRESH) {
          s.labelClock = 0
          const dv = nodeMagnitude(node)
          nodeText.current.textContent =
            `${dv.toFixed(dv < 100 ? 1 : 0)} m/s · T−${formatTime(node.t - live.sim.t)}`
        }
      }
    }
    if (nodeLabel.current) nodeLabel.current.visible = s.placed.ok

    /* --- hover, only when the pointer has actually moved --- */
    if (s.pointer.moved && !s.drag) {
      s.pointer.moved = false
      const gh = ghost.current
      s.hoverHandle = -1
      let showGhost = false

      if (s.pointer.inside) {
        const over = pickGizmo(s.pointer.x, s.pointer.y)
        if (over?.kind === 'handle') s.hoverHandle = over.index
        else if (!over) {
          const epoch = pickLine(s.pointer.x, s.pointer.y)
          if (epoch !== null && gh) {
            // On the drawn chord, where the pointer is — not snapped to a sample by
            // an assumed stride, which stopped being true when samples started
            // following the curve.
            const o = s.picked.segment * 3
            const u = s.picked.param
            const P = (s.picked.projection || prediction).points
            gh.position.set(
              P[o] + (P[o + 3] - P[o]) * u,
              P[o + 1] + (P[o + 4] - P[o + 1]) * u,
              P[o + 2] + (P[o + 5] - P[o + 2]) * u,
            )
            s.centreWorld.copy(gh.position).add(h.position)
            gh.scale.setScalar(
              pixelsToWorld(GHOST_PX, viewDepth(s.centreWorld, camera), camera.fov, size.height),
            )
            if (ghostText.current) ghostText.current.textContent = `T−${formatTime(epoch)}`
            showGhost = true
          }
        }
      }
      if (gh) gh.visible = showGhost
      gl.domElement.style.cursor =
        s.hoverHandle >= 0 ? 'grab' : showGhost ? 'copy' : ''
    }
  }, 0)

  return (
    <>
      {Array.from({ length: MAX_NODE_FRAMES }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => (markers.current[i] = el)}
          visible={false}
          renderOrder={900}
          geometry={kit.ball}
          material={kit.markerMat}
        />
      ))}

      <group ref={ghost} visible={false}>
        <mesh renderOrder={900} geometry={kit.ball} material={kit.ghostMat} />
        <Html center zIndexRange={[18, 8]} style={{ pointerEvents: 'none' }}>
          <div className="translate-y-4 font-mono text-[9px] tracking-[0.18em] whitespace-nowrap text-hud/70 uppercase">
            <span ref={ghostText}>—</span>
          </div>
        </Html>
      </group>

      <group ref={gizmo} visible={false}>
        <mesh ref={centre} renderOrder={902} geometry={kit.ball} material={kit.centreMat} />
        {HANDLES.map((hd, i) => (
          <mesh
            key={hd.id}
            ref={(el) => (handles.current[i] = el)}
            renderOrder={901}
            geometry={kit.cone}
            material={kit.handleMats[i]}
          />
        ))}
        <group ref={nodeLabel}>
          <Html center zIndexRange={[19, 9]} style={{ pointerEvents: 'none' }}>
            <div className="translate-y-6 font-mono text-[9px] tracking-[0.18em] whitespace-nowrap text-amber-200/85 uppercase">
              <span ref={nodeText}>—</span>
            </div>
          </Html>
        </group>
      </group>
    </>
  )
}
