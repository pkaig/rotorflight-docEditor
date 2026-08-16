import { useEffect, useRef, useState } from "react";
import { useSpellchecker } from "../hooks/useSpellchecker";
import { tokenizeMarkdown, type WordToken } from "../spellcheck/tokenizeMarkdown";

// Drop-in replacement for a plain <textarea> that highlights misspelled
// words (wavy red underline) and offers to add them to the project's
// cspell word list on click. Implemented as a transparent-text textarea
// stacked on top of a backdrop <div> that mirrors the same text with
// misspelled words wrapped in <mark> — the classic "highlighted textarea"
// technique, since a native textarea can't style substrings itself.
export function SpellcheckTextarea({
  value,
  onChange,
  style,
  login,
  workspace,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  style?: React.CSSProperties;
  login: string | null;
  workspace: string | null;
}) {
  const { ready, checkWord, isProjectWord, addWord } = useSpellchecker(
    login,
    workspace,
  );

  const [misspelled, setMisspelled] = useState<WordToken[]>([]);
  const [popover, setPopover] = useState<{
    word: string;
    start: number;
    end: number;
    x: number;
    y: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-tokenize + re-check on a debounce so typing stays smooth on longer docs.
  useEffect(() => {
    if (!ready) {
      setMisspelled([]);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      const tokens = tokenizeMarkdown(value);
      const cache = new Map<string, boolean>();
      const flagged: WordToken[] = [];

      for (const token of tokens) {
        const key = token.word.toLowerCase();
        let ok = cache.get(key);
        if (ok === undefined) {
          ok = isProjectWord(token.word) || (await checkWord(token.word));
          cache.set(key, ok);
        }
        if (!ok) flagged.push(token);
      }

      if (!cancelled) setMisspelled(flagged);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, ready, checkWord, isProjectWord]);

  // Stale offsets after an edit would misalign highlights until the next
  // debounced pass resolves; safest to just close any open popover.
  useEffect(() => {
    setPopover(null);
  }, [value]);

  function syncScroll() {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }

  function handleClick(e: React.MouseEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const offset = el.selectionStart;

    const hit = misspelled.find((t) => offset >= t.start && offset <= t.end);

    if (!hit || !containerRef.current) {
      setPopover(null);
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    setPopover({
      word: value.slice(hit.start, hit.end),
      start: hit.start,
      end: hit.end,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  async function handleAddWord() {
    if (!popover) return;
    const word = popover.word;

    // Reflect immediately: drop every occurrence of this word from the
    // current highlight set rather than waiting on the next debounce pass.
    setMisspelled((prev) =>
      prev.filter((t) => t.word.toLowerCase() !== word.toLowerCase()),
    );
    setPopover(null);

    try {
      await addWord(word);
    } catch (err) {
      console.error("Failed to add word to project dictionary:", err);
    }
  }

  const backdropParts: React.ReactNode[] = [];
  let cursor = 0;
  const sorted = [...misspelled].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.start < cursor) continue; // guard against overlapping tokens
    if (t.start > cursor) backdropParts.push(value.slice(cursor, t.start));
    backdropParts.push(
      <mark className="spell-error" key={`${t.start}-${t.end}`}>
        {value.slice(t.start, t.end)}
      </mark>,
    );
    cursor = t.end;
  }
  if (cursor < value.length) backdropParts.push(value.slice(cursor));

  // Same box model AND same glyph-metrics-affecting properties on both
  // layers so text wraps identically and lines up pixel-for-pixel.
  // <textarea> is a form control — browsers don't reliably inherit
  // typography properties (font smoothing, ligatures, letter-spacing) into
  // form controls the way they do into a plain <div>, so those are pinned
  // explicitly here instead of relying on inheriting the app's global CSS
  // (which sets -webkit-font-smoothing/text-rendering on :root). Left
  // implicit, the two layers can render glyphs at very slightly different
  // widths, which compounds line over line into a growing vertical drift.
  const borderWidth = "1px";
  const sharedBox: React.CSSProperties = {
    fontFamily: style?.fontFamily ?? "monospace",
    fontSize: style?.fontSize ?? "14px",
    fontWeight: "normal",
    fontStyle: "normal",
    fontVariantLigatures: "none",
    letterSpacing: "normal",
    wordSpacing: "normal",
    tabSize: 4,
    lineHeight: 1.4,
    padding: style?.padding ?? "1rem",
    borderWidth,
    borderStyle: "solid",
    borderRadius: style?.borderRadius,
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", flex: 1, minHeight: 0 }}
    >
      <div
        ref={backdropRef}
        className="spellcheck-backdrop"
        aria-hidden="true"
        style={{
          ...sharedBox,
          position: "absolute",
          inset: 0,
          overflowY: "scroll",
          overflowX: "hidden",
          borderColor: "#ccc",
          background: style?.background ?? "white",
          color: "#000",
          pointerEvents: "none",
        }}
      >
        {backdropParts}
        {/* trailing newline is otherwise invisible, so wrapping can lag one line behind */}
        {value.endsWith("\n") ? " " : null}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={onChange}
        onScroll={syncScroll}
        onClick={handleClick}
        onKeyUp={() => setPopover(null)}
        spellCheck={false}
        style={{
          ...sharedBox,
          position: "relative",
          width: "100%",
          height: "100%",
          overflowY: "scroll",
          overflowX: "hidden",
          borderColor: "transparent",
          background: "transparent",
          color: "transparent",
          caretColor: "black",
        }}
      />

      {popover && (
        <div
          className="spellcheck-popover"
          style={{ left: popover.x, top: popover.y }}
        >
          <span>
            Add <strong>{popover.word}</strong> to project dictionary?
          </span>
          <div className="spellcheck-popover-actions">
            <button onMouseDown={(e) => e.preventDefault()} onClick={handleAddWord}>
              Add
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPopover(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
