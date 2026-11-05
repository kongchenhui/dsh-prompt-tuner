/**
 * Persisted settings: the file layout, the projection onto the current shape,
 * and the atomic write.
 *
 * The store owns one JSON document under the harness home. Every read is
 * projected onto {@link Settings}, so a document written by an older version —
 * or hand-edited into an unexpected shape — still yields a usable value rather
 * than throwing at a render site.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The one rewriting prompt, used for every run. */
export const DEFAULT_PROMPT = [
  '你是一名提示词工程师兼校对员。请把用户草稿改写成可直接交给 AI 的提示词，并修正其中的错别字、标点、语法、术语与前后矛盾。',
  '要求：',
  '- 保留原始意图、约束、专有名词、代码、路径与数字，不得编造事实或新增未提及的需求；',
  '- 补齐必要的目标、上下文、约束、输出格式与验收标准，措辞精炼无冗余；',
  '- 使用与原文相同的语言；',
  '- 只输出改写后的提示词正文，不要解释，不要加引号或代码块。',
].join('\n')

/** One model pair; both empty means "follow the current conversation". */
export interface ModelChoice {
  readonly provider: string
  readonly model: string
}

/** The settings shape every read is projected onto. */
export interface Settings {
  readonly prompt: string
  readonly model: ModelChoice
  readonly maxOutputTokens: number
}

/** Defaults written on first use. */
export const DEFAULTS: Settings = Object.freeze({
  prompt: DEFAULT_PROMPT,
  model: Object.freeze({ provider: '', model: '' }),
  maxOutputTokens: 1024,
})

/** Harness home, without taking a dependency on the home-paths package. */
export function dshHome(): string {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/** The one settings file the page names and writes. */
export function settingsPath(): string {
  return join(dshHome(), 'prompt-tuner', 'settings.json')
}

/**
 * Project whatever is stored onto the current shape: one prompt, one model pair.
 *
 * The token budget is not capped: what one model accepts and another rejects
 * cannot be decided here, so the value the user typed is the value sent, and an
 * over-large request fails at the provider with its own message. The projection
 * only rejects values that are not a usable count at all.
 * @param raw - parsed JSON, possibly from an older or hand-edited document.
 * @returns a complete settings value.
 */
export function normalize(raw: unknown): Settings {
  const value = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const stored = value.model !== null && typeof value.model === 'object' ? (value.model as Record<string, unknown>) : {}
  const provider = typeof stored.provider === 'string' ? stored.provider.trim() : ''
  const model = typeof stored.model === 'string' ? stored.model.trim() : ''
  const tokens = Number(value.maxOutputTokens)
  return {
    prompt: typeof value.prompt === 'string' && value.prompt.trim() !== '' ? value.prompt : DEFAULTS.prompt,
    model: provider !== '' && model !== '' ? { provider, model } : { provider: '', model: '' },
    maxOutputTokens: Number.isSafeInteger(tokens) && tokens > 0 ? tokens : DEFAULTS.maxOutputTokens,
  }
}

/** The logger slice the store reports through. */
export interface StoreLogger {
  warn?(message: string): void
}

/** Read and write one settings document. */
export interface SettingsStore {
  /** Absolute path of the document this store owns. */
  readonly file: string
  /** Read and project the document; a missing or unreadable file yields defaults. */
  read(): Promise<Settings>
  /** Write the whole document atomically; omitted fields keep their stored value. */
  write(patch: Partial<Settings>): Promise<Settings>
}

/**
 * Create the settings store.
 * @param logger - receives a warning when the document cannot be parsed.
 * @returns a store bound to the configured harness home.
 */
export function createSettingsStore(logger?: StoreLogger): SettingsStore {
  const file = settingsPath()

  const read = async (): Promise<Settings> => {
    try {
      return normalize(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      if (error !== null && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return normalize(null)
      }
      logger?.warn?.(`[prompt-tuner] settings unreadable, using defaults: ${String(error)}`)
      return normalize(null)
    }
  }

  const write = async (patch: Partial<Settings>): Promise<Settings> => {
    const current = await read()
    // The route hands over a parsed JSON object; a patch is a partial by
    // contract, so an absent key means "keep what is stored".
    const input = patch
    const next = normalize({
      prompt: 'prompt' in input ? input.prompt : current.prompt,
      model: 'model' in input ? input.model : current.model,
      maxOutputTokens: 'maxOutputTokens' in input ? input.maxOutputTokens : current.maxOutputTokens,
    })
    const temp = `${file}.tmp`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    // Rename is atomic within one filesystem, so a reader never observes a
    // half-written document.
    await rename(temp, file)
    return next
  }

  return { file, read, write }
}
