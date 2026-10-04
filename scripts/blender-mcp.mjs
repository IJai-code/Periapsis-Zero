#!/usr/bin/env node
/**
 * A Model Context Protocol server for the Blender add-on on port 9876.
 *
 * The "MCP for Blender" add-on opens a socket inside Blender, but it does not
 * speak MCP: it takes one JSON object per command, `{"type": "...", "params":
 * {...}}`, and answers `{"status": "success", "result": ...}` or
 * `{"status": "error", "message": "..."}`. Claude speaks MCP — JSON-RPC 2.0,
 * one message per line on stdin and stdout. Piping one straight into the other
 * (`nc localhost 9876`) fails: the add-on reads Claude's `initialize` as a
 * command with no type, answers `Unknown command type: None`, and Claude waits
 * sixty seconds for a reply it can recognise and gives up. That was measured
 * against the live add-on, and this file is the translator that sits between.
 *
 * Node's standard library only — no packages to install, nothing downloaded.
 * Run by Claude from `claude_desktop_config.json`:
 *
 *   "blender": { "command": "/usr/local/bin/node",
 *                "args": ["/Users/ishaan/Documents/SpxSim/scripts/blender-mcp.mjs"] }
 *
 * Four tools, all local to this machine. The add-on also offers asset searches
 * and downloads (Poly Haven, Sketchfab and others); they are deliberately not
 * exposed, because this project takes no third-party assets without the
 * owner's say-so (AGENT.md, section 3).
 *
 *   blender_scene_info       what is in the open scene
 *   blender_object_info      one object in detail
 *   blender_execute_python   run Python inside Blender, return what it printed
 *   blender_viewport_shot    a picture of the 3D viewport
 *
 * `blender_execute_python` runs arbitrary code in the user's Blender, which is
 * the point of it and also the reason the add-on listens on 127.0.0.1 only.
 *
 * Self-test against a running Blender:  node scripts/blender-mcp.mjs --selftest
 */

import { createConnection } from 'node:net'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const HOST = process.env.BLENDER_HOST ?? '127.0.0.1'
const PORT = Number(process.env.BLENDER_PORT ?? 9876)
const VERSION = '1.0.0'
/** MCP revisions this server can answer in; the newest first. */
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const log = (...a) => process.stderr.write(`[blender-mcp] ${a.join(' ')}\n`)

/* ------------------------------------------------------------------ *
 * The add-on side: one command, one connection, one JSON reply
 * ------------------------------------------------------------------ */

/**
 * Send one command and wait for its whole reply.
 *
 * The add-on frames nothing: it accumulates bytes until they parse as JSON,
 * and answers with a bare JSON object, so the reply is complete exactly when
 * it parses. A fresh connection per command keeps a stalled or restarted
 * Blender from poisoning the next call.
 */
function blender(type, params = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: HOST, port: PORT })
    let buffer = ''
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      fn(value)
    }
    const timer = setTimeout(
      () => finish(reject, new Error(`Blender did not answer "${type}" within ${timeoutMs / 1000} s`)),
      timeoutMs,
    )
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(JSON.stringify({ type, params })))
    socket.on('data', (chunk) => {
      buffer += chunk
      let reply
      try {
        reply = JSON.parse(buffer)
      } catch {
        return // not all of it yet
      }
      if (reply.status === 'error') finish(reject, new Error(reply.message ?? 'Blender reported an error'))
      else finish(resolve, reply.result)
    })
    socket.on('error', (error) => {
      const hint =
        error.code === 'ECONNREFUSED'
          ? `nothing is listening on ${HOST}:${PORT}. Open Blender and start the MCP add-on's server.`
          : error.message
      finish(reject, new Error(hint))
    })
    socket.on('close', () => finish(reject, new Error(`Blender closed the connection before answering "${type}"`)))
  })
}

/* ------------------------------------------------------------------ *
 * The tools
 * ------------------------------------------------------------------ */

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

let shots = 0

const TOOLS = [
  {
    name: 'blender_scene_info',
    description: 'Describe the scene open in Blender: its objects, their types and positions, and the active camera.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => text(await blender('get_scene_info')),
  },
  {
    name: 'blender_object_info',
    description: 'Detailed information about one object in the open Blender scene: transform, materials, mesh statistics.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The object name, exactly as Blender shows it' } },
      required: ['name'],
      additionalProperties: false,
    },
    run: async ({ name }) => text(await blender('get_object_info', { name })),
  },
  {
    name: 'blender_execute_python',
    description:
      'Run Python inside the open Blender session (bpy is available) and return what it printed. ' +
      'Changes the user\'s scene if the code does; print() anything you want back.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python source to execute in Blender' } },
      required: ['code'],
      additionalProperties: false,
    },
    // Builds and exports can take a while; a minute and a half before giving up.
    run: async ({ code }) => {
      const result = await blender('execute_code', { code }, 90_000)
      return text(result?.result ?? '(the code ran and printed nothing)')
    },
  },
  {
    name: 'blender_viewport_shot',
    description: 'A PNG of Blender\'s 3D viewport as it currently looks.',
    inputSchema: {
      type: 'object',
      properties: { max_size: { type: 'integer', description: 'Longest side in pixels (default 800)', minimum: 64, maximum: 2048 } },
      additionalProperties: false,
    },
    run: async ({ max_size = 800 } = {}) => {
      const filepath = join(tmpdir(), `pz-blender-${process.pid}-${++shots}.png`)
      const result = await blender('get_viewport_screenshot', { max_size, filepath, format: 'png' })
      if (result?.error) throw new Error(result.error)
      try {
        const data = (await readFile(filepath)).toString('base64')
        return { content: [{ type: 'image', data, mimeType: 'image/png' }] }
      } finally {
        await unlink(filepath).catch(() => {})
      }
    },
  },
]
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

/* ------------------------------------------------------------------ *
 * The MCP side: JSON-RPC 2.0, one message per line
 * ------------------------------------------------------------------ */

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(message) {
  const { id, method, params } = message
  const isRequest = id !== undefined && id !== null
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'periapsis-blender', version: VERSION },
        instructions:
          'Tools for the Blender session open on this machine, through the MCP add-on on port 9876. ' +
          'Periapsis Zero builds its shipped models from scripts under art/; work done live here should be copied back into those scripts.',
      })
    }
    case 'ping':
      return isRequest && reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    case 'tools/call': {
      const tool = BY_NAME.get(params?.name)
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        return reply(id, await tool.run(params.arguments ?? {}))
      } catch (error) {
        // A tool failure is a result the model should read, not a protocol error.
        return reply(id, { content: [{ type: 'text', text: `Blender: ${error.message}` }], isError: true })
      }
    }
    default:
      // Notifications (no id) need no answer; unknown requests get the
      // standard "method not found".
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`)
  }
}

async function serve() {
  log(`v${VERSION} forwarding to Blender at ${HOST}:${PORT}`)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(null, -32700, 'Parse error')
      continue
    }
    // Requests are handled concurrently: a slow Python run must not hold up a ping.
    for (const m of Array.isArray(message) ? message : [message]) {
      handle(m).catch((error) => {
        log('handler failed:', error.message)
        if (m.id !== undefined) fail(m.id, -32603, error.message)
      })
    }
  }
}

/* ------------------------------------------------------------------ *
 * Self-test: talk to the running Blender directly, read-only
 * ------------------------------------------------------------------ */

async function selftest() {
  const scene = await blender('get_scene_info')
  console.log(`scene "${scene?.name}" with ${scene?.object_count} objects`)
  const out = await blender('execute_code', { code: 'import bpy; print(bpy.app.version_string)' })
  console.log(`Blender ${String(out?.result).trim()}`)
}

if (process.argv.includes('--selftest')) {
  selftest().catch((error) => {
    console.error(`self-test failed: ${error.message}`)
    process.exit(1)
  })
} else {
  serve()
}
