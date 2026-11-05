/**
 * Client bundle for the prompt tuner.
 *
 * The harness loads a browser plugin through one closure-factory handoff:
 * the artifact calls `window.__ModuleLoader__.load({ id, factory })` and
 * resolves platform modules through the injected `require`. That contract is
 * owned by the harness's own `clientBundle()` preset, which a third-party
 * package cannot import — it lives in the harness monorepo. This config
 * restates just the two pieces a single-package plugin needs: the handoff
 * wrapper (banner/footer/intro) and the external list. Everything else is
 * ordinary bundling.
 *
 * Stylesheets follow the same preset's semantics:
 * - `x.module.css` compiles to a hashed class-name map and injects a tagged
 *   `<style>` when the factory executes.
 * - `x.css?inline` exports compiled text for a plugin-owned lifecycle effect.
 * @module tsdown.config
 */
import { readFile } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { readPackageManifest } from './scripts/package-manifest.ts'

/** The package directory, so virtual ids stay repository-relative. */
const PACKAGE_DIR = import.meta.dirname

/**
 * Name one stylesheet for a virtual module id.
 *
 * The id is package-relative, never absolute: a virtual id is echoed into the
 * emitted bundle as a module comment, and an absolute path would publish the
 * build machine's directory layout in the artifact.
 * @param file - absolute stylesheet path.
 * @returns the package-relative, `/`-separated stylesheet name.
 */
function stylesheetId(file: string): string {
  return relative(PACKAGE_DIR, file).split(sep).join('/')
}

/** Modules the harness seeds into its module table; these stay imports. */
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] as const

const CSS_VIRTUAL_PREFIX = '\0dpt-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dpt-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/**
 * Emit one tagged style injector, plus the class map for a CSS Module.
 * @param id - package name stamped on the tag.
 * @param fileId - physical stylesheet path, used to name and dedupe the tag.
 * @param css - JavaScript expression yielding the stylesheet text.
 * @param classMap - hashed local names for a CSS Module.
 * @returns the module source.
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${css};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=\"' + tagId + '\"]') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/**
 * Read one stylesheet through lightningcss and quote it for a JS expression.
 * @param file - physical stylesheet path.
 * @param cssModules - compile as a CSS Module and return its export map.
 * @returns compiled text and, for a module, the local-to-hashed-name map.
 */
async function compileStylesheet(
  file: string,
  cssModules: boolean,
): Promise<{ css: string; classMap?: Record<string, string> }> {
  const code = await readFile(file)
  const { code: output, exports } = transform({
    filename: file,
    code,
    minify: true,
    ...(cssModules ? { cssModules: { pattern: '[hash]_[local]' } } : {}),
  })
  const classMap: Record<string, string> = {}
  for (const [local, value] of Object.entries(exports ?? {})) classMap[local] = value.name
  return cssModules ? { css: output.toString(), classMap } : { css: output.toString() }
}

export default defineConfig(async () => {
  const manifest = await readPackageManifest(import.meta.dirname)
  const id = manifest.name

  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    // CJS always targets Node, so tsdown ignores platform:'browser'; the
    // browser resolution conditions are stated explicitly instead.
    platform: 'neutral',
    inputOptions: { platform: 'browser' },
    target: 'es2024',
    // The types ship from tsc; a dts here would wrap this banner into a .d.cts.
    dts: false,
    sourcemap: true,
    // Emitted next to lib/host.js, which another invocation owns.
    clean: false,
    deps: {
      neverBundle: (specifier: string) => (PLATFORM_MODULES as readonly string[]).includes(specifier),
      // Anything NOT in the module table must inline: a require() the table
      // cannot answer is a guaranteed runtime throw.
      alwaysBundle: (specifier: string) => !(PLATFORM_MODULES as readonly string[]).includes(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    plugins: [
      {
        // Contract: nothing outside this package may be imported as a value at
        // runtime except the module-table rows above. Cross-plugin value
        // imports would need a specifier the table cannot answer.
        name: 'dpt-bundle-purity',
        resolveId(source: string) {
          if (!source.startsWith('@deepseek-ai/') && !source.startsWith('node:')) return null
          if (source.startsWith('node:')) {
            throw new Error(`client bundle: "${source}" is a Node builtin and cannot run in the browser`)
          }
          throw new Error(
            `client bundle: "${source}" is not a module-table row; the browser cannot resolve it. ` +
              'Import shared types with `import type`, or reach behaviour through a cordis service.',
          )
        },
      },
      {
        name: 'dpt-css-modules',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.module.css') || importer === undefined) return null
          return CSS_VIRTUAL_PREFIX + stylesheetId(new URL(source, `file://${importer}`).pathname) + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          const physical = `${PACKAGE_DIR}/${fileId}`
          this.addWatchFile(physical)
          const { css, classMap } = await compileStylesheet(physical, true)
          return styleInjectionModule(id, fileId, JSON.stringify(css), classMap)
        },
      },
      {
        name: 'dpt-css-text-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith(`.css${INLINE_CSS_QUERY}`) || importer === undefined) return null
          const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
          return (
            INLINE_CSS_VIRTUAL_PREFIX +
            stylesheetId(new URL(stylesheet, `file://${importer}`).pathname) +
            CSS_VIRTUAL_SUFFIX
          )
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(`${PACKAGE_DIR}/${fileId}`)
          const { css } = await compileStylesheet(`${PACKAGE_DIR}/${fileId}`, false)
          return `export default ${JSON.stringify(css)};`
        },
      },
      {
        name: 'dpt-css-global',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.css') || source.endsWith('.module.css') || importer === undefined) return null
          throw new Error(
            `client bundle: ${source} imported by ${importer} must be written ".module.css" ` +
              '(hashed class map) or ".css?inline" (plugin-owned <style> lifecycle)',
          )
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      // The map is served from /plugins/<scope>/client.js.map.
      sourcemapExcludeSources: false,
      banner: (chunk) => {
        const registration = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`
        return registration
      },
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
})
