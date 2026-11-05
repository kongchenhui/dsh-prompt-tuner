/**
 * The one HTTP route the browser half calls.
 *
 * Every answer is JSON, and a business failure is answered with HTTP 200 plus
 * `{ ok: false, code, message }`: the page renders the message, so a transport
 * status would only hide it behind a generic "HTTP 500". The exception is a
 * cancelled rewrite, which has nobody left to answer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listCatalog, rewrite } from './rewrite.ts'
import { openSettingsFile } from './opener.ts'
import { DEFAULTS, type SettingsStore } from './settings.ts'
import type { HostContext } from './rewrite.ts'

/** Route prefix the browser half calls. */
export const ROUTE_PATH = '/dsh-prompt-tuner'

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 1_000_000

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Read one JSON request body.
 * @param req - incoming request.
 * @returns the parsed object, or `{}` for an empty body.
 * @throws with code BODY_TOO_LARGE or BAD_BODY.
 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求体过大'), { code: 'BODY_TOO_LARGE' })
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_BODY' })
  }
}

/**
 * Project one thrown value onto the failure envelope.
 * @param error - whatever the handler threw.
 */
function failure(error: unknown): { ok: false; code: string; message: string } {
  const raw: unknown =
    error instanceof Error || (error !== null && typeof error === 'object')
      ? (error as { code?: unknown }).code
      : undefined
  return {
    ok: false,
    code: typeof raw === 'string' ? raw : 'FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Build the route handler.
 * @param ctx - host context.
 * @param store - settings store.
 * @returns a request handler for the prefix route.
 */
export function createHandler(ctx: HostContext, store: SettingsStore) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/u, '')
    try {
      if (path === `${ROUTE_PATH}/open` && req.method === 'POST') {
        // The connection owns this request; a page that navigates away cancels
        // the handoff instead of leaving it running unseen.
        const abort = new AbortController()
        const onClose = (): void => {
          abort.abort()
        }
        res.on('close', onClose)
        try {
          await openSettingsFile(store.file, () => store.write({}), abort.signal)
          if (!res.writableEnded && !res.destroyed) sendJson(res, 200, { ok: true })
        } catch (error) {
          if (abort.signal.aborted || res.writableEnded || res.destroyed) return
          throw error
        } finally {
          res.off('close', onClose)
        }
        return
      }
      if (path === ROUTE_PATH || path === `${ROUTE_PATH}/config`) {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            settings: await store.read(),
            defaults: DEFAULTS,
            /** Sent so the page can show where the file lives. */
            settingsPath: store.file,
          })
          return
        }
        if (req.method === 'POST') {
          sendJson(res, 200, { ok: true, settings: await store.write(await readBody(req)) })
          return
        }
        sendJson(res, 405, { ok: false, code: 'METHOD', message: '仅支持 GET 与 POST' })
        return
      }
      if (path === `${ROUTE_PATH}/models` && req.method === 'GET') {
        sendJson(res, 200, { ok: true, providers: await listCatalog(ctx) })
        return
      }
      if (path === `${ROUTE_PATH}/rewrite` && req.method === 'POST') {
        // The abort controller follows the connection: a page that cancels the
        // fetch closes the request, which stops the model call here too.
        const abort = new AbortController()
        const onClose = (): void => {
          abort.abort()
        }
        res.on('close', onClose)
        try {
          const body = await readBody(req)
          const result = await rewrite(ctx, store, body.text, abort.signal)
          if (!res.writableEnded && !abort.signal.aborted) sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          // A cancelled rewrite has nobody left to answer; writing to a closed
          // connection would only throw again.
          if (abort.signal.aborted || res.writableEnded || res.destroyed) return
          throw error
        } finally {
          res.off('close', onClose)
        }
        return
      }
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: `未知路径 ${path}` })
    } catch (error) {
      if (res.writableEnded || res.destroyed) return
      ctx.logger?.warn?.(`[prompt-tuner] ${error instanceof Error ? error.message : String(error)}`)
      sendJson(res, 200, failure(error))
    }
  }
}
