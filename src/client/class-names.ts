/**
 * Class-name composition over CSS Module maps.
 *
 * A CSS Module's generated map is `Record<string, string>`, and under
 * `noUncheckedIndexedAccess` every lookup is `string | undefined` — a key the
 * stylesheet no longer declares reads as `undefined`, and interpolating that
 * into a template literal renders the text "undefined" into `class`. Joining
 * through one helper drops the missing keys and keeps the behaviour honest.
 */

/**
 * Join the truthy class names among the given values.
 * @param tokens - module class names, conditionals, or `undefined`.
 * @returns the space-joined class attribute value.
 */
export function classNames(...tokens: readonly (string | false | null | undefined)[]): string {
  return tokens.filter((token): token is string => typeof token === 'string' && token !== '').join(' ')
}
