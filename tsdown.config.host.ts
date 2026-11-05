/**
 * Host bundle for the prompt tuner.
 *
 * The harness imports this module from `lib/index.js` and calls its `apply`.
 * Nothing outside Node's own modules and this package's files is a runtime
 * dependency, so the build inlines everything else.
 * @module tsdown.config.host
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/host/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // Node builtins stay imports; the package has no other runtime dependency.
    neverBundle: (specifier: string) => specifier.startsWith('node:'),
    alwaysBundle: (specifier: string) => !specifier.startsWith('node:'),
  },
})
