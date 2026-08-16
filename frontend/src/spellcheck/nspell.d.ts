// nspell ships no type declarations of its own.
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
