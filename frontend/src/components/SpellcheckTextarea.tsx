import { useEffect, useRef, useState } from "react";
import { useSpellchecker } from "../hooks/useSpellchecker";
import { tokenizeMarkdown, type WordToken } from "../spellcheck/tokenizeMarkdown";

// Drop-in replacement for a plain <textarea> that highlights misspelled
// words (wavy red underline) and right-click offers suggested corrections
// plus "add to dictionary" — same interaction model as Word/Google Docs/
// most IDEs. Implemented as a transparent-text textarea stacked on top of
// a backdrop <div> that mirrors the same text with misspelled words
// wrapped in <mark> — the classic "highlighted textarea" technique, since
// a native textarea can't style substrings itself.
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
  const { ready, checkWord, isProjectWord, suggest, addWord } =
    useSpellchecker(login, workspace);

  const [misspelled, setMisspelled] = useState<WordToken[]>([]);
  const [popover, setPopover] = useState<{
    word: string;
    start: number;
    end: number;
    x: number;
    y: number;
    suggestions: string[] | null; // null while still loading
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The backdrop must have the exact same content width as the real
  // textarea for their word-wrap to land on the same points. Trying to
  // guarantee that with matching CSS (overflow/scrollbar treatment) turned
  // out to be platform-dependent — some systems give scrollbars real
  // layout width, others use overlay scrollbars that take none, and a
  // "hide the backdrop's own scrollbar" trick doesn't reserve the same
  // gutter on the former. Measuring the textarea's actual rendered content
  // width (clientWidth already excludes whatever its real scrollbar took)
  // and sizing the backdrop to match is correct regardless of platform.
  const [taSize, setTaSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const update = () => setTaSize({ width: el.clientWidth, height: el.clientHeight });
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // Right-click on a misspelled word already moves the caret there (native
  // browser behavior), so selectionStart at contextmenu time is the click
  // position. Only intercept (preventDefault) when it's actually on a
  // flagged word — otherwise let the normal browser context menu through
  // so cut/copy/paste etc. keep working everywhere else.
  function handleContextMenu(e: React.MouseEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const offset = el.selectionStart;

    const hit = misspelled.find((t) => offset >= t.start && offset <= t.end);

    if (!hit || !containerRef.current) {
      setPopover(null);
      return;
    }

    e.preventDefault();

    const rect = containerRef.current.getBoundingClientRect();
    const word = value.slice(hit.start, hit.end);

    setPopover({
      word,
      start: hit.start,
      end: hit.end,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      suggestions: null,
    });

    suggest(word).then((suggestions) => {
      setPopover((prev) =>
        prev && prev.start === hit.start && prev.word === word
          ? { ...prev, suggestions: suggestions.slice(0, 5) }
          : prev,
      );
    });
  }

  // Replaces the flagged word in place using the textarea's own native
  // setRangeText + a dispatched "input" event, rather than computing a new
  // string in JS — this keeps the browser's native undo stack consistent
  // (Ctrl+Z undoes the correction as one step) the way directly setting
  // React state wouldn't.
  function applySuggestion(replacement: string) {
    if (!popover || !textareaRef.current) return;
    const el = textareaRef.current;

    el.focus();
    el.setRangeText(replacement, popover.start, popover.end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));

    setPopover(null);
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
  const borderWidthPx = 1;
  const sharedBox: React.CSSProperties = {
    fontFamily: style?.fontFamily ?? "Consolas, 'Courier New', monospace",
    fontSize: style?.fontSize ?? "14px",
    fontWeight: "normal",
    fontStyle: "normal",
    fontVariantLigatures: "none",
    letterSpacing: "normal",
    wordSpacing: "normal",
    tabSize: 4,
    lineHeight: 1.4,
    padding: style?.padding ?? "1rem",
    borderWidth: `${borderWidthPx}px`,
    borderStyle: "solid",
    borderRadius: style?.borderRadius,
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    // Plain word-boundary wrapping only — no mid-word breaking. break-word
    // lets the browser split a word wherever it decides that word doesn't
    // fit, and that "does it fit" measurement can differ by a sub-pixel
    // between the backdrop <div> and the real <textarea>, flipping the
    // wrap decision on a long line and shifting every line below it out
    // of alignment. Word-boundary-only wrapping has no such judgment call.
    // Trade-off: an unbroken token longer than the line width (e.g. a raw
    // long URL) will overflow horizontally and get clipped by overflow-x:
    // hidden rather than wrap — acceptable for prose, where that's rare.
    wordBreak: "normal",
    overflowWrap: "normal",
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
          top: 0,
          left: 0,
          // Sized to match the textarea's actual measured content box
          // (see the ResizeObserver above) rather than inset:0 — a plain
          // percentage/inset match assumes the textarea's real scrollbar
          // (if the platform renders one) takes the same width as
          // whatever the backdrop is given, which isn't guaranteed.
          // Falls back to 100% only for the first paint before the
          // observer fires.
          width: taSize ? `${taSize.width + borderWidthPx * 2}px` : "100%",
          height: taSize ? `${taSize.height + borderWidthPx * 2}px` : "100%",
          overflow: "hidden",
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
        onClick={() => setPopover(null)}
        onContextMenu={handleContextMenu}
        onKeyUp={() => setPopover(null)}
        spellCheck={false}
        style={{
          ...sharedBox,
          position: "relative",
          width: "100%",
          height: "100%",
          // Natural scrolling — whatever real or overlay scrollbar the
          // platform gives it, the ResizeObserver above measures its
          // actual content width afterward and resizes the backdrop to
          // match, so there's no need to force a permanently-reserved
          // scrollbar gutter here anymore.
          overflowY: "auto",
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
          <div className="spellcheck-popover-word">{popover.word}</div>

          {popover.suggestions === null ? (
            <div className="spellcheck-suggestions-empty">Loading suggestions…</div>
          ) : popover.suggestions.length > 0 ? (
            <div className="spellcheck-suggestions">
              {popover.suggestions.map((s) => (
                <button
                  key={s}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applySuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <div className="spellcheck-suggestions-empty">No suggestions</div>
          )}

          <div className="spellcheck-popover-actions">
            <button onMouseDown={(e) => e.preventDefault()} onClick={handleAddWord}>
              Add to dictionary
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
