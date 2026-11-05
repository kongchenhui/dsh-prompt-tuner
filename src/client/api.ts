/**
 * Host route client: one base path, one JSON-only request helper.
 *
 * The page may be served under a sub-path, so the prefix is derived from
 * `document.baseURI` rather than hard-coded. Every host response is
 * `{ ok: true, ... }` or `{ ok: false, code, message }`, and this helper turns
 * the failure shape into a thrown Error carrying the host's own message.
 */

/** Mount segment appended to whatever base the document was served from. */
const ROUTE_SEGMENT = '/dsh-prompt-tuner'

/** Value shape every host route answers with on success. */
interface SuccessBody {
  readonly ok: true
}

/** Value shape every host route answers with on failure. */
interface FailureBody {
  readonly ok: false
  readonly code?: string
  readonly message?: string
}

/**
 * Resolve the absolute route prefix for this document.
 * @returns the path prefix, without a trailing slash.
 */
export function routeBase(): string {
  try {
    const url = new URL(document.baseURI)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ROUTE_SEGMENT
    return url.pathname.replace(/\/+$/u, '') + ROUTE_SEGMENT
  } catch {
    return ROUTE_SEGMENT
  }
}

/**
 * Call one host route and return its success body.
 * @param path - route suffix, such as `/config`.
 * @param init - fetch options; the caller owns the method and body.
 * @returns the parsed success body.
 * @throws Error carrying the host's message, or the HTTP status when no body arrived.
 */
export async function request<T extends SuccessBody>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(routeBase() + path, init)
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object') throw new Error('响应格式错误')
  const result = body as SuccessBody | FailureBody
  if (!result.ok) {
    const message = 'message' in result && typeof result.message === 'string' ? result.message : '请求失败'
    throw new Error(message)
  }
  return result as T
}
