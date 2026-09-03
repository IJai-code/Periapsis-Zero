/**
 * Unpacks the .7z archives NASA ships alongside its models.
 *
 * Several downloads arrive compressed rather than as loose .glb — the ISS in
 * particular. Run this once after adding archives, then `npm run models:scan`
 * to pick up whatever appeared.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import sevenBin from '7zip-bin'

const ROOT = 'public/models'
const archives = []

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full)
    // Multi-volume sets are driven from the .001 part; 7za pulls in the rest.
    else if (/\.7z$|\.7z\.001$/.test(name)) archives.push(full)
  }
}
walk(ROOT)

if (!archives.length) {
  console.log('no .7z archives found under', ROOT)
  process.exit(0)
}

try {
  fs.chmodSync(sevenBin.path7za, 0o755)
} catch {
  /* already executable */
}

for (const archive of archives) {
  const dir = path.dirname(archive)
  try {
    execFileSync(sevenBin.path7za, ['x', path.basename(archive), '-o.', '-y'], {
      cwd: dir,
      stdio: 'pipe',
      timeout: 600000,
    })
    console.log('  extracted', archive)
  } catch (err) {
    console.log('  FAILED   ', archive, '->', String(err.message).split('\n')[0].slice(0, 80))
  }
}
console.log('\nnow run: npm run models:scan')
