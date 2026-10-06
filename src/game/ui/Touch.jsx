import { useRef } from 'react'
import { play } from '../audio.js'

/**
 * Tablet controls: a flight stick on the left, a throttle and the guns on
 * the right, and the action button that docks, lands or transfers.
 */
export function Touch({ controls: c, game: g, onOverlay }) {
  const stick = useRef(null), knob = useRef(null), throttle = useRef(null)
  const startStick = (e) => { c.touch.active = true; moveStick(e) }
  const moveStick = (e) => {
    const r = stick.current.getBoundingClientRect(), t = e.touches ? e.touches[0] : e
    let x = (t.clientX - (r.left + r.width / 2)) / (r.width / 2), y = -(t.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m }
    c.touch.x = x; c.touch.y = y
    knob.current.style.transform = `translate(${x * 42}px, ${-y * 42}px)`
  }
  const endStick = () => { c.touch.active = false; c.touch.x = c.touch.y = 0; knob.current.style.transform = '' }
  const setThrottle = (e) => {
    const r = throttle.current.getBoundingClientRect(), t = e.touches ? e.touches[0] : e
    const v = Math.max(-0.3, Math.min(1, 1 - (t.clientY - r.top) / r.height * 1.3))
    c.throttleSet = v
  }
  const hold = (key) => ({ onTouchStart: (e) => { e.preventDefault(); c.touch[key] = true }, onTouchEnd: () => { c.touch[key] = false }, onMouseDown: () => { c.touch[key] = true }, onMouseUp: () => { c.touch[key] = false } })
  const tap = (action) => ({ onClick: () => { c.actions.push(action); play('click') } })
  const prompt = g.prompt
  return <div className="gm-touch">
    <div className="tc-stick" ref={stick} onTouchStart={startStick} onTouchMove={moveStick} onTouchEnd={endStick} onMouseDown={startStick} onMouseUp={endStick}><i ref={knob} /></div>
    <div className="tc-right">
      <div className="tc-throttle" ref={throttle} onTouchStart={setThrottle} onTouchMove={setThrottle}><i style={{ height: `${Math.max(0, g.player.ctrl.throttle) * 100}%` }} /><span>Throttle</span></div>
      <div className="tc-buttons">
        <button className="tc-fire" {...hold('fire')}>Fire</button>
        <button className="tc-boost" {...hold('boost')}>Boost</button>
        <button className="tc-roll" {...tap('roll-left')} aria-label="Barrel roll left">⟲ Roll</button>
        <button className="tc-roll" {...tap('roll-right')} aria-label="Barrel roll right">Roll ⟳</button>
        <button {...tap('target')}>Target</button>
        <button {...tap('stop')}>Stop</button>
        {prompt && !prompt.blocked && <button className="tc-action" {...tap(prompt.action === 'transfer' ? 'transfer' : 'dock')}>{prompt.text}</button>}
      </div>
    </div>
    <div className="tc-top">
      <button onClick={() => onOverlay('map')}>Map</button>
      <button onClick={() => onOverlay('log')}>Jobs</button>
      {!g.skirmish && <button onClick={() => onOverlay('hail')}>Wave</button>}
      <button {...tap('fa')}>{g.player.ctrl.fa ? 'Assist on' : 'Assist off'}</button>
      <button onClick={() => onOverlay('pause')}>Menu</button>
    </div>
  </div>
}
