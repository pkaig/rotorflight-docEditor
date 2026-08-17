/* frontend/src/spellcheck/dictionary.ts
 *
 * Description of responsibility:
 *   Owns the actual Hunspell speller instance: lazily loads and merges
 *   the base en_US dictionary, an en_GB word list, a curated
 *   technical-terms list, and (per workspace) the project's own
 *   project-words.txt/cspell.json vocabulary, and exposes
 *   isCorrect/getSuggestions/addProjectWord for useSpellchecker.ts.
 *
 * Info:
 *   en_GB words are stripped of their Hunspell affix flags and added as
 *   bare literals (parseHunspellDicAsLiterals) rather than merged via
 *   nspell's dictionary() extension method — en_US and en_GB assign
 *   those flag codes independently against their own .aff rule tables,
 *   and feeding en-gb.dic's flagged entries through en.aff's rules
 *   verifiably corrupts the speller into accepting arbitrary gibberish
 *   as correctly spelled. The cost is losing automatic inflection of
 *   GB-only spelling variants, judged an acceptable trade-off.
 *   Dictionary data is fetched from public/dictionaries as static
 *   assets rather than imported from their source npm packages, since
 *   those read from disk at import time or ship pre-compressed, neither
 *   of which works in a plain browser context.
 */
import nspell, { type NSpell } from "nspell";

let spellerPromise: Promise<NSpell> | null = null;
const projectWords = new Set<string>();

function fetchText(url: string): Promise<string> {
  return fetch(url).then((r) => r.text());
}

function parseWordList(text: string): string[] {
  return text
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
}

// A Hunspell .dic file's entries are "word/FLAGS", where FLAGS are codes
// defined by *that dictionary's own* .aff file (prefix/suffix rules,
// capitalization behavior, etc). en_US and en_GB assign those codes
// independently, so feeding en-gb.dic's flagged entries through en.aff's
// rule table (nspell#dictionary() reuses the base speller's affix rules)
// makes nspell misinterpret them — verified this actually breaks the
// speller into accepting arbitrary gibberish as correctly spelled.
// Stripping the flags and adding each word as a bare literal avoids any
// affix reinterpretation: it loses automatic inflection of GB-only
// spelling variants, but that's a fine trade for not corrupting the
// whole dictionary.
function parseHunspellDicAsLiterals(text: string): string[] {
  return text
    .split("\n")
    .slice(1) // first line is the Hunspell word-count header
    .map((line) => line.split("/")[0].trim())
    .filter(Boolean);
}

async function loadBaseSpeller(): Promise<NSpell> {
  const [affText, dicText, enGbDicText, technicalTermsText] =
    await Promise.all([
      fetchText("/dictionaries/en.aff"),
      fetchText("/dictionaries/en.dic"),
      fetchText("/dictionaries/en-gb.dic"),
      fetchText("/dictionaries/technical-terms.txt"),
    ]);

  const speller = nspell(affText, dicText);

  for (const word of parseHunspellDicAsLiterals(enGbDicText)) {
    speller.add(word);
  }

  for (const word of parseWordList(technicalTermsText)) {
    speller.add(word);
  }

  return speller;
}

function getSpeller(): Promise<NSpell> {
  if (!spellerPromise) spellerPromise = loadBaseSpeller();
  return spellerPromise;
}

// Fetches the project's custom dictionary — project-words.txt plus
// cspell.json's own inline "words" list, both from the real
// Rotorflight-docs repo — and layers it on top of the base speller.
export async function loadProjectWords(login: string, workspace: string) {
  const speller = await getSpeller();

  try {
    const res = await fetch(
      `/api/docs/project-words?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
    );
    if (!res.ok) return;

    const { words } = await res.json();
    for (const word of words as string[]) {
      speller.add(word);
      projectWords.add(word.toLowerCase());
    }
  } catch {
    // No project word list yet (new workspace) — base dictionary still works.
  }
}

export async function isCorrect(word: string): Promise<boolean> {
  const speller = await getSpeller();
  return speller.correct(word);
}

export async function getSuggestions(word: string): Promise<string[]> {
  const speller = await getSpeller();
  return speller.suggest(word);
}

export function isProjectWord(word: string): boolean {
  return projectWords.has(word.toLowerCase());
}

// Adds a word to nspell's in-memory dictionary immediately (so it stops
// being flagged right away) and persists it to the workspace's
// project-words.txt via the backend, which feeds into the user's PR diff.
export async function addProjectWord(
  login: string,
  workspace: string,
  word: string,
) {
  const speller = await getSpeller();
  speller.add(word);
  projectWords.add(word.toLowerCase());

  const res = await fetch(
    `/api/docs/project-words/add?login=${encodeURIComponent(
      login,
    )}&workspace=${encodeURIComponent(workspace)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
    },
  );

  if (!res.ok) {
    throw new Error("Failed to save word to project dictionary");
  }
}
