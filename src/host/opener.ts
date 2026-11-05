/**
 * Desktop handoff for the settings document.
 *
 * This is a faithful port of the harness's own `openNativeTextFile`. The
 * harness cannot be imported here (its native-command package is not resolvable
 * from a profile, and this package deliberately imports no harness module), so
 * the rules that opener encodes are restated rather than reached through a
 * service:
 *
 * - Windows hands the path to `explorer.exe` as one escaped file-URI argv
 *   element, because Explorer performs the same default-application resolution
 *   a double-click performs — including a default recorded only in the
 *   per-user `UserChoiceLatest` key, where an in-process association query
 *   finds none. Explorer also splits its command line at commas and equals
 *   signs, so both are escaped or the shell opens a different target (or the
 *   user's Documents folder) without reporting it.
 * - macOS names the text-editor intent explicitly, so a `.json` association
 *   with some other application cannot consume the gesture.
 * - The child must never start hidden: a hidden start hides the editor window
 *   the user just asked to see, which reads as "nothing happened".
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { release as osRelease } from 'node:os'
import { pathToFileURL } from 'node:url'

/** Whether one environment marker is set to a non-empty value. */
function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** Whether the settings document is already on disk. */
export async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Distinguish WSL from desktop Linux using its process and kernel markers.
 * @returns true when this Linux host is WSL.
 */
export function isWsl(): boolean {
  if (present(process.env.WSL_DISTRO_NAME) || present(process.env.WSL_INTEROP)) return true
  return osRelease().toLowerCase().includes('microsoft')
}

/**
 * Encode one Windows path as the target Explorer can receive intact.
 *
 * Explorer splits its own command line at commas and equals signs, so a raw
 * path loses everything after the first separator. Both are escaped; nothing
 * else is, because Explorer rejects percent-encoded non-ASCII in a file URI and
 * opens Documents instead, while it resolves those characters when they arrive
 * literally.
 * @param windowsPath - absolute Windows path.
 * @returns the target to hand Explorer as one argv element.
 */
export function explorerTarget(windowsPath: string): string {
  const href = pathToFileURL(windowsPath, { windows: true }).href
  // A run of escapes whose every byte starts above ASCII is one non-ASCII character.
  return href
    .replace(/(?:%[89A-F][0-9A-F])+/giu, (escaped) => {
      try {
        return decodeURIComponent(escaped)
      } catch {
        return escaped
      }
    })
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D')
}

/** Windows startup visibility for one launched command. */
export type LaunchWindow = 'hidden' | 'visible'

/**
 * Run one host command without a shell, capturing output and honoring abort.
 *
 * `window` is the Windows startup visibility: `hidden` for background commands,
 * `visible` for a GUI handoff. Passing `hidden` for the Explorer handoff is the
 * single most important line here — a hidden start also hides the editor window
 * the user just asked to see.
 * @param command - executable path or PATH name.
 * @param args - argv entries, never a shell string.
 * @param signal - caller lifetime; abort terminates the child.
 * @param window - Windows startup visibility.
 * @returns captured stdout and stderr on exit 0.
 */
export function runNativeCommand(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  window: LaunchWindow,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', signal, windowsHide: window === 'hidden' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            Object.assign(new Error(error.message, { cause: error }), {
              code: (error as NodeJS.ErrnoException).code,
              stdout,
              stderr,
            }),
          )
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

/**
 * Hand one target to Explorer, accepting its delegated-handoff exit code.
 *
 * Explorer exits 1 after passing the request to the desktop process already
 * running, so exit 1 means the shell took it. Every other failure and every
 * cancellation still rejects.
 * @param args - Explorer argv: the encoded target to open it.
 * @param signal - caller lifetime; abort terminates the command.
 */
export async function runExplorer(args: readonly string[], signal: AbortSignal): Promise<void> {
  try {
    // SW_HIDE would also hide Explorer's window, not just console windows.
    await runNativeCommand('explorer.exe', args, signal, 'visible')
  } catch (error) {
    signal.throwIfAborted()
    if (!(error instanceof Error) || !('code' in error) || (error as { code?: unknown }).code !== 1) throw error
  }
}

/**
 * Whether opening a path can plausibly reach a desktop on this host.
 *
 * macOS and Windows always carry a desktop opener; Linux does when it is WSL
 * (the Windows desktop takes the path) or a display server is announced. A
 * headless host answers false, which lets the page show the path as text
 * instead of offering a button that would spawn `xdg-open` into nothing.
 * @returns true when handing a path to the native opener can work at all.
 */
export function canOpenNativePath(): boolean {
  const platform = process.platform
  if (platform === 'darwin' || platform === 'win32') return true
  if (platform !== 'linux') return false
  return isWsl() || present(process.env.DISPLAY) || present(process.env.WAYLAND_DISPLAY)
}

/** Translate a WSL path before handing it to the Windows desktop. */
async function openWslPath(path: string, signal: AbortSignal): Promise<void> {
  const translated = await runNativeCommand('wslpath', ['-w', path], signal, 'hidden')
  signal.throwIfAborted()
  const windowsPath = translated.stdout.replace(/[\r\n]+$/u, '')
  if (windowsPath === '') throw new Error('wslpath returned no Windows path')
  await runExplorer([explorerTarget(windowsPath)], signal)
}

/**
 * Open one text document in the desktop's editor.
 * @param path - absolute path in this host's filesystem.
 * @param signal - caller lifetime; abort terminates the native command.
 */
export async function openNativeTextFile(path: string, signal: AbortSignal): Promise<void> {
  const platform = process.platform
  if (platform === 'darwin') {
    // `-t` forces the text editor; the plain open verb would use the association.
    await runNativeCommand('open', ['-t', path], signal, 'hidden')
    return
  }
  if (platform === 'win32') {
    await runExplorer([explorerTarget(path)], signal)
    return
  }
  if (platform === 'linux') {
    if (isWsl()) {
      await openWslPath(path, signal)
      return
    }
    await runNativeCommand('xdg-open', [path], signal, 'hidden')
    return
  }
  throw Object.assign(new Error(`当前平台 ${platform} 不支持原生打开器`), { code: 'NO_OPENER' })
}

/**
 * Materialize the settings file when absent and open it in the desktop's editor.
 *
 * An existing document is opened as it stands: rewriting it first would race an
 * editor that already holds it open, and on Windows the temp-file rename then
 * fails with EPERM/EBUSY before any opener runs, so the gesture would report a
 * save failure instead of opening the file the user asked for.
 * @param file - absolute settings document path.
 * @param materialize - writes the document when it is absent.
 * @param signal - caller lifetime; aborting it stops the handoff.
 */
export async function openSettingsFile(
  file: string,
  materialize: () => Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (!canOpenNativePath()) {
    throw Object.assign(new Error('当前部署没有可用的桌面打开器（无图形会话）'), { code: 'NO_DESKTOP' })
  }
  if (!(await exists(file))) await materialize()
  await openNativeTextFile(file, signal)
}
