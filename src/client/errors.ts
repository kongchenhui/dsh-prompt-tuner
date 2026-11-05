/**
 * Collapse one failure into a single tooltip-sized line.
 *
 * Provider rejections arrive as raw JSON documents (`401 {"type":"error",…}`);
 * the tooltip is a one-line hint, not a log viewer, so a recognizable status
 * prefix is named in the user's language and the payload is flattened and
 * truncated. The caller logs the full text to the console.
 */
import type { Translate } from './types.ts'

/** Longest error text kept for the tooltip. */
export const ERROR_MAX_CHARS = 160

/**
 * Reduce an unknown thrown value to one trimmed line.
 * @param error - whatever the request or the host threw.
 * @param t - translator bound to this plugin's namespace.
 * @returns one line, at most {@link ERROR_MAX_CHARS} characters.
 */
export function conciseError(error: unknown, t: Translate): string {
  const raw = error instanceof Error ? error.message : String(error)
  const text = raw.replace(/\s+/gu, ' ').trim()
  const status = /^(\d{3})\b/u.exec(text)?.[1]
  const named =
    status === '401' || status === '403'
      ? t('errorAuth')
      : status === '429'
        ? t('errorRateLimited')
        : status !== undefined && Number(status) >= 500
          ? t('errorUpstream')
          : undefined
  const body = named === undefined ? text : `${named} · ${text}`
  return body.length <= ERROR_MAX_CHARS ? body : `${body.slice(0, ERROR_MAX_CHARS - 1)}…`
}
