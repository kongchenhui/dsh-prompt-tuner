/**
 * Windows path encoding for the Explorer handoff.
 *
 * These vectors are the harness's own pinned expectations
 * (`packages/util/native-command/tests/path-opener.spec.ts`): Explorer splits
 * its command line at commas and equals signs, and rejects percent-encoded
 * non-ASCII, so the encoding is the whole contract.
 */
import { describe, expect, it } from 'vitest'
import { canOpenNativePath, explorerTarget, isWsl } from '../src/host/opener.ts'

describe('explorerTarget', () => {
  it.each([
    ['C:\\work\\plain.txt', 'file:///C:/work/plain.txt'],
    ['C:\\work\\my report.txt', 'file:///C:/work/my%20report.txt'],
    ['C:\\work\\key=value.txt', 'file:///C:/work/key%3Dvalue.txt'],
    ['C:\\work\\dir,comma', 'file:///C:/work/dir%2Ccomma'],
    ["C:\\work\\o'reilly, & 100%.txt", "file:///C:/work/o'reilly%2C%20&%20100%25.txt"],
    ['\\\\?\\C:\\work\\a,b.txt', 'file:///C:/work/a%2Cb.txt'],
  ])('encodes %s', (input, expected) => {
    expect(explorerTarget(input)).toBe(expected)
  })

  it('keeps non-ASCII characters literal, because Explorer rejects their escapes', () => {
    expect(explorerTarget('C:\\用户\\设置.json')).toBe('file:///C:/用户/设置.json')
  })

  it('escapes both separators Explorer splits on', () => {
    const target = explorerTarget('C:\\a,b=c\\x.json')
    expect(target).not.toContain(',')
    expect(target).toContain('%2C')
    expect(target).toContain('%3D')
  })
})

describe('host facts', () => {
  it('reports a desktop opener on macOS and Windows', () => {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(canOpenNativePath()).toBe(true)
    }
  })

  it('treats a non-WSL kernel as desktop Linux', () => {
    if (process.platform !== 'linux') return
    expect(isWsl()).toBe(process.env.WSL_DISTRO_NAME !== undefined || isWsl())
  })
})
