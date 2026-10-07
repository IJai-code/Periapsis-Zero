/** Optional macOS authoring command. CI uses the committed AAC recordings.
 * Synthetic narration: installed Daniel voice, 150 words/minute. Captions
 * define both the script and its timing; silence fills the gaps and tails.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROLOGUE } from '../src/game/core/prologue.js'

const scratch = mkdtempSync(join(tmpdir(), 'pz-prologue-'))
const out = 'public/audio/prologue'
mkdirSync(out, { recursive: true })
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`)
}
const sampleRate = 22050
try {
  for (const c of PROLOGUE) {
    const pcm = Buffer.alloc((c.end - c.start) * sampleRate * 2)
    for (let i = 0; i < c.captions.length; i++) {
      const [at, text] = c.captions[i], file = join(scratch, `${c.id}-${i}.wav`)
      run('/usr/bin/say', ['-v', 'Daniel', '-r', '150', '-o', file, '--file-format=WAVE', '--data-format=LEI16@22050', text])
      const wav = readFileSync(file)
      let data, channels, rate, bits
      for (let p = 12; p + 8 <= wav.length;) {
        const name = wav.toString('ascii', p, p + 4), n = wav.readUInt32LE(p + 4)
        if (name === 'fmt ') { channels = wav.readUInt16LE(p + 10); rate = wav.readUInt32LE(p + 12); bits = wav.readUInt16LE(p + 22) }
        if (name === 'data') data = wav.subarray(p + 8, p + 8 + n)
        p += 8 + n + (n % 2)
      }
      if (!data || channels !== 1 || rate !== sampleRate || bits !== 16) throw new Error(`unexpected PCM format for ${file}`)
      const available = (c.captions[i + 1]?.[0] ?? c.end - c.start) - at
      if (data.length > available * sampleRate * 2) throw new Error(`${c.id} caption ${i} exceeds its ${available}s slot`)
      data.copy(pcm, at * sampleRate * 2)
    }
    const h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
    h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28)
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
    const joined = join(scratch, `${c.id}.wav`)
    writeFileSync(joined, Buffer.concat([h, pcm]))
    const dest = join(out, `${c.audio}.m4a`)
    run('/usr/bin/afconvert', [joined, dest, '-f', 'm4af', '-d', 'aac', '-b', '64000', '-q', '100'])
    console.log(`${dest}: ${c.end - c.start}s, ${readFileSync(dest).length} bytes`)
  }
} finally { rmSync(scratch, { recursive: true, force: true }) }
