/**
 * A small client for Supabase Realtime: rooms with broadcast and presence,
 * over one websocket, with nothing installed. It speaks the Phoenix channel
 * protocol Realtime is built on (vsn 1.0.0, JSON objects), which is all the
 * game needs: a room per squadron code, positions and shots broadcast a few
 * times a second, and presence for who is in it.
 *
 * Runs in a browser or under Node 22 (global WebSocket), so the gate can
 * put two clients in one room.
 */
export function connectRoom({ url, key, room, id, meta = {}, onMessage, onPresence, onStatus }) {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`)
  const topic = `realtime:${room}`
  let ref = 0, joined = false, closed = false
  const queue = []
  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); else queue.push(msg) }
  const next = () => String(++ref)
  const roster = new Map()
  let beat = null
  const status = (s, why) => onStatus?.(s, why)
  ws.onopen = () => {
    const r = next()
    send({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: id }, private: false } }, ref: r, join_ref: r })
    while (queue.length) ws.send(JSON.stringify(queue.shift()))
    beat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: next() }), 25000)
  }
  ws.onmessage = (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.topic !== topic) return
    if (m.event === 'phx_reply' && !joined) {
      if (m.payload?.status === 'ok') { joined = true; status('joined'); send({ topic, event: 'presence', payload: { type: 'presence', event: 'track', payload: { id, ...meta } }, ref: next() }) }
      else status('error', m.payload?.response?.reason ?? 'join refused')
      return
    }
    if (m.event === 'broadcast') { (api.onMessage ?? onMessage)?.(m.payload?.event, m.payload?.payload); return }
    if (m.event === 'presence_state') { roster.clear(); for (const [k, v] of Object.entries(m.payload ?? {})) roster.set(k, v.metas?.[0] ?? {}); (api.onPresence ?? onPresence)?.(new Map(roster)); return }
    if (m.event === 'presence_diff') {
      for (const k of Object.keys(m.payload?.leaves ?? {})) roster.delete(k)
      for (const [k, v] of Object.entries(m.payload?.joins ?? {})) roster.set(k, v.metas?.[0] ?? {})
      ;(api.onPresence ?? onPresence)?.(new Map(roster))
      return
    }
    if (m.event === 'phx_error' || m.event === 'phx_close') status('error', m.event)
  }
  ws.onclose = () => { clearInterval(beat); if (!closed) status('closed') }
  ws.onerror = () => status('error', 'connection failed')
  const api = {
    onMessage: null, onPresence: null,
    /** Send to everyone else in the room. */
    broadcast(event, payload) { if (joined) send({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: next() }) },
    get joined() { return joined },
    roster: () => new Map(roster),
    close() { closed = true; clearInterval(beat); try { send({ topic, event: 'phx_leave', payload: {}, ref: next() }); ws.close() } catch { /* gone */ } },
  }
  return api
}
