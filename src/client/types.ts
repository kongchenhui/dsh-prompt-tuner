/**
 * Wire and prop shapes shared by the browser half.
 *
 * The plugin imports no harness client package, so the slot props it receives
 * are described structurally here: the harness passes `useInput`,
 * `inputActions`, and `t`, and this module states the slice of each the
 * components actually read. A harness-side change to those surfaces therefore
 * surfaces as a type error in this package rather than a runtime `undefined`.
 */

/** One provider and the models it advertises. */
export interface CatalogProvider {
  readonly id: string
  readonly name: string
  readonly models: readonly CatalogModel[]
}

/** One selectable model. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
}

/** The persisted model pair; both empty means "follow the conversation". */
export interface ModelChoice {
  readonly provider: string
  readonly model: string
}

/** Persisted settings, as the host projects them. */
export interface Settings {
  readonly prompt: string
  readonly model: ModelChoice
  readonly maxOutputTokens: number
}

/** One `GET /config` answer. */
export interface ConfigResponse {
  readonly ok: true
  readonly settings: Settings
  readonly defaults: Settings
  readonly settingsPath: string
}

/** One `GET /models` answer. */
export interface ModelsResponse {
  readonly ok: true
  readonly providers: readonly CatalogProvider[]
}

/** One `POST /rewrite` answer. */
export interface RewriteResponse {
  readonly ok: true
  readonly text: string
  readonly route: ModelChoice
}

/** The composer's draft state, as the slot exposes it. */
export interface InputState {
  readonly draft: string
  readonly phase: string
}

/** The `inputActions` slice this control uses. */
export interface InputActions {
  /** Replace the composer draft. */
  setDraft(text: string): void
}

/** Translator bound to this plugin's namespace. */
export type Translate = (key: string, params?: Record<string, string>) => string

/** Standard slot props the composer control receives. */
export interface ComposerSlotProps {
  readonly useInput?: (<T>(selector: (state: InputState) => T) => T) | undefined
  readonly inputActions?: InputActions | undefined
  readonly t: Translate
}

/** Standard slot props the settings page receives. */
export interface SettingsSlotProps {
  readonly t: Translate
}
