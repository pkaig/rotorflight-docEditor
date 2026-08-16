Static dictionary data fetched at runtime by the in-browser spell checker
(`src/spellcheck/`). Extracted from npm packages rather than imported as JS,
because `dictionary-en`/`dictionary-en-gb` read their files from disk via
`node:fs/promises` at import time (no browser entry point), and
`@cspell/dict-software-terms`'s main word list ships gzipped/trie-encoded
for cspell's own engine, not as plain Hunspell data nspell can use.

- `en.aff` / `en.dic` — Hunspell en_US, from `dictionary-en`.
- `en-gb.dic` — Hunspell en_GB word list, from `dictionary-en-gb`, added to
  the en_US speller as bare literal words (`dictionary.ts` strips each
  entry's `/FLAGS` suffix before calling `speller.add()`). Do NOT load this
  via `nspell#dictionary()`: that reinterprets en-GB's flagged entries
  through en_US's affix rule table, and the two dictionaries assign flag
  codes independently — verified this actually corrupts the speller into
  accepting arbitrary gibberish as correctly spelled. No `en-gb.aff` is
  needed since flags are stripped rather than interpreted.
- `technical-terms.txt` — curated plain-word subset of
  `@cspell/dict-software-terms` (computing acronyms, networking terms,
  software tools, web services — the package's plain `.txt` files, not its
  gzipped main `softwareTerms.txt.gz`, and with wildcard entries like
  `*Auth*` dropped since nspell only takes literal words).

See the matching `*.LICENSE` files for each source's license.
