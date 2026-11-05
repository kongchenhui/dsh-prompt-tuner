/**
 * Host half of the composer prompt tuner.
 *
 * Owns the persisted settings file and the model call that rewrites a draft.
 * The browser half renders the composer control and the settings page and
 * reaches this half over one HTTP route.
 *
 * No harness package is imported: messages, streams, and tool results are
 * plain values here, so this module keeps working across harness versions.
 */
import { createHandler, ROUTE_PATH } from './http.ts'
import { createSettingsStore } from './settings.ts'
import type { HostContext } from './rewrite.ts'

/** Loader row name. */
export const name = 'prompt-tuner'

/** The host context slice this plugin uses. */
interface PluginContext extends HostContext {
  inject(
    services: readonly string[],
    callback: (child: PluginContext & { webServer: WebServer; effect: Effect }) => void,
  ): void
  effect(callback: () => unknown, label?: string): unknown
}

/** Register one prefix route. */
interface WebServer {
  register(route: { kind: 'prefix'; path: string; handler: (req: never, res: never) => Promise<void> }): () => void
}

/** Cordis effect disposer plumbing. */
type Effect = (callback: () => unknown, label?: string) => unknown

/**
 * Mount the settings route.
 * @param ctx - host plugin context.
 */
export function apply(ctx: PluginContext): void {
  const store = createSettingsStore(ctx.logger)

  ctx.inject(['webServer'], (child) => {
    child.effect(
      () =>
        child.webServer.register({
          kind: 'prefix',
          path: ROUTE_PATH,
          handler: createHandler(ctx, store),
        }),
      'prompt-tuner: http route',
    )
  })
}
