/**
 * The lint, as a gate: undefined names, same-scope use before definition,
 * duplicate keys and the other mistakes a build compiles happily and a page
 * throws on (eslint.config.js has the rules and the bugs that earned them).
 */
import { ESLint } from 'eslint'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })
const results = await eslint.lintFiles(['.'])
const errors = results.reduce((n, r) => n + r.errorCount, 0)
if (errors) {
  const formatter = await eslint.loadFormatter('stylish')
  console.log(await formatter.format(results.filter((r) => r.errorCount)))
  console.log(`verify-lint: ${errors} error(s) in ${results.filter((r) => r.errorCount).length} file(s)`)
  process.exit(1)
}
console.log(`verify-lint: ${results.length} files, no errors`)
