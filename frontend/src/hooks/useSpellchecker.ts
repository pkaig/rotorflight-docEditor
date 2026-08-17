/* frontend/src/hooks/useSpellchecker.ts
 *
 * Description of responsibility:
 *   Bridges SpellcheckTextarea to the underlying Hunspell-based
 *   dictionary module (spellcheck/dictionary.ts): loads the base
 *   dictionary plus the current workspace's project word list once per
 *   (login, workspace) pair, and exposes checkWord/suggest/addWord.
 *
 * Info:
 *   `ready` is derived during render from comparing the current
 *   (login, workspace) key against the last key that finished loading,
 *   rather than a separate boolean reset inside the effect — so it
 *   correctly reads false immediately on a workspace switch, before
 *   the effect has even had a chance to run.
 */
import { useCallback, useEffect, useState } from "react";
import {
  addProjectWord,
  getSuggestions,
  isCorrect,
  isProjectWord,
  loadProjectWords,
} from "../spellcheck/dictionary";

// Loads the base en_US Hunspell dictionary + the workspace's project word
// list once per (login, workspace) pair. checkWord() resolves on a
// microtask once ready (the underlying speller is already in memory), so
// callers can await it in a loop without real per-word latency.
export function useSpellchecker(login: string | null, workspace: string | null) {
  // Tracks which (login, workspace) pair has finished loading, so "ready"
  // is derived during render (false as soon as the key changes) instead of
  // needing a separate synchronous reset inside the effect below.
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const key = login && workspace ? `${login}:${workspace}` : null;
  const ready = key !== null && readyKey === key;

  useEffect(() => {
    if (!login || !workspace || !key) return;

    let cancelled = false;

    loadProjectWords(login, workspace).then(() => {
      if (!cancelled) setReadyKey(key);
    });

    return () => {
      cancelled = true;
    };
  }, [key, login, workspace]);

  const checkWord = useCallback((word: string) => isCorrect(word), []);
  const suggest = useCallback((word: string) => getSuggestions(word), []);

  const addWord = useCallback(
    async (word: string) => {
      if (!login || !workspace) return;
      await addProjectWord(login, workspace, word);
    },
    [login, workspace],
  );

  return { ready, checkWord, isProjectWord, suggest, addWord };
}
