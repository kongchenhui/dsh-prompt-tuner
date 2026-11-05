/**
 * Inline SVG icons for the composer control.
 *
 * They are local to this package rather than taken from ui-primitives because
 * the plugin imports no harness client value module; a `require()` the module
 * table cannot answer is a runtime throw.
 */
import type { ReactElement } from 'react'

/** Sparkle: the idle "enhance" affordance. */
export function IconSparkle(): ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M7.2 2.1l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <path d="M12.3 9.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="currentColor" />
    </svg>
  )
}

/** Undo: offered once a rewrite has replaced the draft. */
export function IconUndo(): ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M5.6 3.6L2.9 6.3l2.7 2.7"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 6.3h6.1a3.4 3.4 0 010 6.8H6.3" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/**
 * Spinner: the in-flight affordance. The rotation is a class rather than an
 * inline style so the reduced-motion rule can neutralize it.
 * @param props - `className` carries the animation hook.
 */
export function IconSpinner({ className }: { readonly className?: string | undefined }): ReactElement {
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx={8} cy={8} r={5.6} stroke="currentColor" strokeWidth={1.4} opacity={0.25} />
      <path d="M8 2.4a5.6 5.6 0 015.6 5.6" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}
