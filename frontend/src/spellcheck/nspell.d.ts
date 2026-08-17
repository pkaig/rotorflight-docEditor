/* frontend/src/spellcheck/nspell.d.ts
 *
 * Description of responsibility:
 *   Hand-written type declarations for the `nspell` package, which
 *   ships none of its own.
 *
 * Info:
 *   Only declares the subset of nspell's API this app actually calls
 *   (correct/suggest/add/remove/dictionary) — not a complete
 *   third-party type definition.
 */
declare module "nspell" {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
    dictionary(dic: string | Uint8Array): NSpell;
  }

  export default function nspell(
    aff: string | Uint8Array,
    dic?: string | Uint8Array,
  ): NSpell;
}
