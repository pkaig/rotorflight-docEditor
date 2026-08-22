/* frontend/src/App.tsx
 *
 * Description of responsibility:
 *   The root application component: owns top-level state (auth,
 *   workspace selection, editor content, sidebar tree UI) and wires
 *   together every major hook (useAuth, useDocEditor, useGitPR,
 *   useDocTrees, useWorkspaces, useAutosave, useUpstreamStatus) and
 *   panel component (Tree, EditorPanel, Preview, ChangesPanel, PRPanel,
 *   ConflictResolver) into the full editing layout.
 *
 * Info:
 *   There is exactly one useGitPR() instance for the whole app, created
 *   here and passed down — useDocEditor and PRPanel used to each create
 *   their own (hooks don't share state across call sites), so notifying
 *   "a file was saved" never reached the instance actually feeding the
 *   rendered Changes panel. findFirstImage() walks the already-loaded
 *   sidebar tree (no extra fetch) to find a folder's first image for
 *   the new-file "example image" seeding in EditorPanel.tsx, using a
 *   case-insensitive sort since the default JS sort would otherwise put
 *   an uppercase-led filename before a lowercase one regardless of
 *   actual alphabetical order.
 */
import "./App.css";
import { version as APP_VERSION } from "../package.json";
import { useState, useEffect, useRef } from "react"; // <-- UPDATED
import { SplitScrollbar } from "./components/SplitScrollbar";
import { useEditorPreviewScrollSync } from "./hooks/useEditorPreviewScrollSync";
import { useDiffPreviewScrollSync } from "./hooks/useDiffPreviewScrollSync";
import rfHeliLogo from "./assets/RFHeli.svg";
import PreviewErrorBoundary from "./components/PreviewErrorBoundary";
import Preview from "./components/Preview";
import newDocTemplate from "../templates/newDocTemplate.mdx?raw";
import { EditorPanel } from "./components/EditorPanel";
import { AddImageModal } from "./components/AddImageModal";
import { useUpstreamStatus } from "./hooks/useUpstreamStatus";

import { useAutosave } from "./hooks/useAutosave";
import { useGitPR } from "./hooks/useGitPR";
import { PRPanel } from "./components/PRPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import UnifiedDiffViewer from "./components/UnifiedDiffViewer";
import ConflictResolver from "./components/ConflictResolver";
import { isConflictFile } from "./components/conflictUtils";

import {
  MaintenanceModal,
  ForceUpdateModal,
  UpdateAvailableModal,
} from "./components/versionModals";

import { Tree, type TreeNode } from "./components/Tree";
import { useAuth } from "./hooks/useAuth";
import { useDocTrees } from "./hooks/useDocTrees";
import { useDocEditor } from "./hooks/useDocEditor";
import { useDragResize } from "./hooks/useDragResize";
import { WorkspaceSelector } from "./components/WorkspaceSelector";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { validateWorkspaceName } from "./utils/validateWorkspaceName";
import { slugifyFileName } from "./utils/slugifyFileName";
import { PreviewToolbar, type TopToolKey } from "./components/PreviewToolbar";
import {
  findImageLines,
  extractMarkdownImagePath,
  removeImageReference,
} from "./utils/findImageLines";
import {
  insertImageReference,
  convertMarkdownImagesToJsx,
} from "./utils/insertImageReference";
import { ImageInsertChoiceModal } from "./components/ImageInsertChoiceModal";
import { ChooseExistingImageModal } from "./components/ChooseExistingImageModal";
import { AdmonitionEntryModal } from "./components/AdmonitionEntryModal";
import {
  findAdmonitionBlock,
  buildAdmonitionBlock,
  type AdmonitionBlock,
} from "./utils/admonitions";
import { TableEntryModal } from "./components/TableEntryModal";
import {
  findTableBlock,
  buildMarkdownTable,
  type TableBlock,
} from "./utils/tables";
import { TabsEntryModal } from "./components/TabsEntryModal";
import {
  findTabsBlock,
  buildTabsBlock,
  ensureTabsImports,
  removeTabsImportsIfUnused,
  type TabsBlock,
} from "./utils/tabs";
import { relativePosixPath } from "./utils/relativePosixPath";

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;

type EditorStatus = {
  type: "blocked" | "forceUpdate" | "updateAvailable" | "ok";
  message?: string;
  current?: string;
  latest?: string;
  downloadUrl?: string;
} | null;

// Shape of docEditorStatus.json, the remote version-gate config fetched via
// the backend's /api/version proxy.
interface DocEditorStatusConfig {
  blocked: boolean;
  blockMessage?: string;
  latestVersion: string;
  minSupportedVersion: string;
  updateMessage?: string;
  downloadUrl?: string;
}

type ConflictData = {
  file: string;
  workspace: string;
  workspaceText: string;
  upstreamText: string;
} | null;

// Looks up folderPath within the already-loaded tree (no extra fetch — the
// sidebar already has this data) and returns the alphabetically-first image
// in its img/ subfolder, if any, for the "example image" section new pages
// get seeded with.
function findFirstImage(nodes: TreeNode[], folderPath: string): string | null {
  function findNode(list: TreeNode[]): TreeNode | null {
    for (const n of list) {
      if (n.path === folderPath) return n;
      if (n.children) {
        const found = findNode(n.children);
        if (found) return found;
      }
    }
    return null;
  }

  const folder = findNode(nodes);
  const imgFolder = folder?.children?.find(
    (c) => c.type === "dir" && c.name === "img",
  );
  const images = (imgFolder?.children ?? [])
    .filter((c) => c.type === "file" && IMAGE_RE.test(c.name))
    .map((c) => c.name)
    // Plain .sort() is case-sensitive (all uppercase-first names sort
    // before any lowercase-first one), which doesn't match what a user
    // would consider "first" — e.g. "Bluejay_Complete.png" beating
    // "arming-1.png" purely because 'B' < 'a' in ASCII.
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return images[0] ?? null;
}

// Looks up an img/ folder directly by its own path (unlike findFirstImage
// above, which looks up a *parent* folder and finds its img/ child) and
// lists the image files already in it, so AddImageModal can warn before
// silently overwriting one — the upload endpoint has no such check itself,
// so without this the only way to tell was watching whether the preview
// changed after uploading.
function listImageNames(nodes: TreeNode[], imgFolderPath: string): string[] {
  function findNode(list: TreeNode[]): TreeNode | null {
    for (const n of list) {
      if (n.path === imgFolderPath) return n;
      if (n.children) {
        const found = findNode(n.children);
        if (found) return found;
      }
    }
    return null;
  }

  const imgFolder = findNode(nodes);
  return (imgFolder?.children ?? [])
    .filter((c) => c.type === "file" && IMAGE_RE.test(c.name))
    .map((c) => c.name);
}

// Walks the whole workspace tree (not just one img/ folder, unlike
// listImageNames above) for the Images toolbar's "Choose image" picker —
// reusing an image from elsewhere in the project only needs to know
// where every image actually is, regardless of which doc's img/ folder
// it lives in.
function findAllImages(
  nodes: TreeNode[],
): { name: string; path: string }[] {
  const results: { name: string; path: string }[] = [];

  function walk(list: TreeNode[]) {
    for (const n of list) {
      if (n.type === "file" && IMAGE_RE.test(n.name)) {
        results.push({ name: n.name, path: n.path });
      }
      if (n.children) walk(n.children);
    }
  }

  walk(nodes);
  return results;
}

/* -------------------------------------------------------
   ROOT APPLICATION COMPONENT
------------------------------------------------------- */

export default function App() {
  /* AUTH */
  const {
    user,
    login,
    isAuthenticated,
    authStep,
    userCode,
    verificationUri,
    authError,
    appInstalled,
    appInstallUrl,
    startGitHubLogin,
    logout,
  } = useAuth();

  /* WORKSPACE SELECTION */
  const [workspace, setWorkspace] = useState<string | null>(null);

  /* WORKSPACE LIST */
  const { workspaces, loadWorkspaces } = useWorkspaces(login);

  /* VERSION GATE */
  const [editorStatus, setEditorStatus] = useState<EditorStatus>(null);

  /* DOCUMENT TREES (LOCAL ONLY) */
  const { localTrees, loadingLocal, refreshLocalWorkspace } = useDocTrees(
    login,
    workspaces,
    isAuthenticated,
  );

  /* CHANGE TRACKING + PR FLOW — must come before useDocEditor below, since
     notifyFileSaved gets passed into it. This is the single useGitPR()
     instance for the whole app; useDocEditor and PRPanel used to each
     create their own independent one (hooks don't share state across call
     sites), so notifying "a file was saved" never reached the instance
     actually feeding the rendered Changes panel. */
  const {
    banner,
    activePR,
    submitPR,
    submitting,
    changes,
    notifyFileSaved,
    notifyFileRenamed,
    notifyFileDeleted,
    notifyFileCreated,
    clearBanner,
    loadChangesFromMirror,
    prState,
    newCommentNotice,
    dismissCommentNotice,
  } = useGitPR({
    login: login || "",
    workspace,
  });

  /* EDITOR STATE */
  const {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    loadDoc,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveState,
    saveDocument,
  } = useDocEditor(login, workspace, notifyFileSaved);

  /* UI STATE */
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [newFileImageName, setNewFileImageName] = useState<string | null>(null);
  const [showAddImageModal, setShowAddImageModal] = useState(false);
  const [addImageFolder, setAddImageFolder] = useState<string | null>(null);
  const [addImageExistingNames, setAddImageExistingNames] = useState<string[]>([]);
  // Routes AddImageModal's onUploaded to the right follow-up: the
  // sidebar's own "+" flow just refreshes the tree, "insert" also
  // splices a reference into the doc at the captured cursor position.
  const [imageModalContext, setImageModalContext] = useState<
    "sidebar" | "insert"
  >("sidebar");
  // Captured when "Insert" is clicked, before the modal (which steals
  // focus) opens — selectionStart survives the focus change, but reading
  // it fresh after upload would just see wherever focus last was instead.
  const insertCursorOffsetRef = useRef<number | null>(null);

  // Images toolbar: "move"/"remove" put the preview into "click an image
  // to pick it" mode. Owned here (not in PreviewToolbar) because it has
  // to coordinate a click on previewPanelRef with, for Move, a live
  // drop-indicator tracking the cursor over the *rendered* preview
  // (mapped back to a source line via each element's data-source-line —
  // see rehypeSourceLines.ts) rather than making the user go pick a line
  // in the raw Editor text.
  const [imagesMode, setImagesMode] = useState<"move" | "remove" | null>(null);
  const [pendingMove, setPendingMove] = useState<{ sourceLine: number } | null>(
    null,
  );
  // Insert reuses the exact same drop-indicator mechanism as Move (see
  // the shared tracking effect below) — the only difference is what
  // happens on confirm: Move relocates an existing line, Insert opens
  // ImageInsertChoiceModal at the picked line instead.
  const [pendingInsertPick, setPendingInsertPick] = useState(false);
  const [insertAtLine, setInsertAtLine] = useState<number | null>(null);
  const [showImageInsertChoice, setShowImageInsertChoice] = useState(false);
  const [showChooseExistingImage, setShowChooseExistingImage] = useState(false);
  const [moveIndicator, setMoveIndicator] = useState<{
    line: number;
    y: number;
  } | null>(null);
  const moveIndicatorRef = useRef<{ line: number; y: number } | null>(null);

  // Admonitions toolbar — Insert shares the exact same drop-indicator
  // mechanism as the images toolbar's Insert (same tracking effect,
  // below); Modify/Remove instead put the preview into "click an
  // existing admonition to pick it" mode, parsed via
  // findAdmonitionBlock's data-source-line-based lookup.
  const [admonitionsMode, setAdmonitionsMode] = useState<
    "modify" | "remove" | null
  >(null);
  const [pendingAdmonitionInsertPick, setPendingAdmonitionInsertPick] =
    useState(false);
  const [admonitionInsertAtLine, setAdmonitionInsertAtLine] = useState<
    number | null
  >(null);
  const [editingAdmonition, setEditingAdmonition] =
    useState<AdmonitionBlock | null>(null);
  const [showAdmonitionEntry, setShowAdmonitionEntry] = useState(false);

  // Table toolbar — same shape as Admonitions above: Insert shares the
  // drop-indicator, Modify/Remove click an existing table (parsed via
  // findTableBlock's data-source-line-based lookup on the <table>
  // element itself).
  const [tableMode, setTableMode] = useState<"modify" | "remove" | null>(
    null,
  );
  const [pendingTableInsertPick, setPendingTableInsertPick] = useState(false);
  const [tableInsertAtLine, setTableInsertAtLine] = useState<number | null>(
    null,
  );
  const [editingTable, setEditingTable] = useState<TableBlock | null>(null);
  const [showTableEntry, setShowTableEntry] = useState(false);

  // Tabs toolbar — same shape again, but Tabs is JSX (<Tabs>/<TabItem>),
  // not a plain HTML element or remark-directive block, so it only
  // makes sense in .mdx docs — handleTabsInsert below guards that,
  // rather than letting Insert silently produce JSX a .md file can't
  // actually render on the real site.
  const [tabsMode, setTabsMode] = useState<"modify" | "remove" | null>(null);
  const [pendingTabsInsertPick, setPendingTabsInsertPick] = useState(false);
  const [tabsInsertAtLine, setTabsInsertAtLine] = useState<number | null>(
    null,
  );
  const [editingTabs, setEditingTabs] = useState<TabsBlock | null>(null);
  const [showTabsEntry, setShowTabsEntry] = useState(false);

  // Which of PreviewToolbar's top-level tool rows (if any) is open —
  // owned here rather than inside PreviewToolbar itself so the
  // click-outside effect below can close it once an action finishes and
  // nothing's actively pending anymore.
  const [activeTopTool, setActiveTopTool] = useState<TopToolKey | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  // Guards "+ Add Workspace" while a delete is still in flight — opening
  // the modal before delete-workspace's own loadWorkspaces() call resolves
  // let the sidebar's later re-render (removing the just-deleted
  // workspace's row, which still had focus from the click that started the
  // delete) steal focus back out of the modal's name field right after it
  // had already grabbed it, leaving the input unresponsive for however
  // long that pending request took to settle.
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);

  // In-page replacement for window.confirm() across the whole app — see
  // ConfirmDialog.tsx's header comment for why: a native confirm() dialog
  // turned out to be the actual trigger behind a real, reproducible
  // Windows-only bug where the app lost keyboard focus afterward and
  // couldn't reliably reclaim it programmatically by any means tried
  // (BrowserWindow.focus(), the alwaysOnTop-toggle workaround for
  // Windows' foreground lock), recoverable only by an actual alt-tab away
  // and back. Rendering the confirmation in-page instead means there's no
  // native OS dialog, and thus no OS-level focus handoff, to go wrong.
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string;
    danger?: boolean;
    // Plain informational notices (e.g. "Tabs need .mdx") have nothing
    // to actually confirm — showing a Cancel button next to a message
    // with no real choice would be misleading, so this hides it and
    // leaves just the single dismiss button.
    hideCancel?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    // Runs (in addition to closing the dialog) when the user declines —
    // e.g. the MD->MDX prompt uses this to remember the decline for the
    // rest of the session instead of nagging again on every open.
    onCancel?: () => void;
  } | null>(null);
  // Paths the user has already said "no" to converting to MDX for, so the
  // prompt doesn't re-ask every time the same .md file is reopened within
  // this session.
  const skipMdxPromptRef = useRef<Set<string>>(new Set());
  // handleConvertMdToMdx's slowest step (notifyFileRenamed -> scan-local-
  // changes, which diffs the whole workspace against the mirror) can take
  // several seconds — without this, clicking "Yes" on the MD->MDX prompt
  // looked like it did nothing until the file suddenly reappeared as .mdx.
  const [convertingMdToMdx, setConvertingMdToMdx] = useState(false);
  const { checking, updating } = useUpstreamStatus(login);
  // Collapsing the sidebar just shrinks .sidebar's width — the editor and
  // preview columns are already flex:1/50%-50% of whatever space is left
  // in .main-layout, so they expand to fill the freed space automatically
  // with no width math needed here.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Editor/preview share one scrollbar (see SplitScrollbar below) instead
  // of each panel keeping its own — useEditorPreviewScrollSync needs the
  // real DOM nodes to read/drive scrollTop and to measure image
  // positions against.
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const { fraction: scrollFraction, setFraction: setScrollFraction, thumbSize: scrollThumbSize } =
    useEditorPreviewScrollSync(content, editorTextareaRef, previewPanelRef);

  // Diff view <-> preview: a separate, simpler (percentage-only, not
  // image-anchored) sync — see useDiffPreviewScrollSync for why it can't
  // reuse the pair above. Only active while Show Diff is open.
  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  useDiffPreviewScrollSync(diffScrollRef, previewPanelRef, showDiff, currentDocPath);

  // Dragging SplitScrollbar's track (not its thumb, which scrolls
  // instead) resizes the editor/preview split, clamped to 50% ± 25%.
  const editorPreviewRowRef = useRef<HTMLDivElement | null>(null);
  const { editorPercent, startDrag: startColumnResize } = useDragResize(
    editorPreviewRowRef,
    50,
  );

  // Images toolbar — Move/Update: click delegation on previewPanelRef
  // (already exists for scroll-sync) makes every rendered <img>
  // selectable while a mode is active, without Preview.tsx needing its
  // own per-image click handlers.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel || !imagesMode) return;

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName !== "IMG") return;
      e.preventDefault();

      const imgs = Array.from(panel!.querySelectorAll("img"));
      const index = imgs.indexOf(target as HTMLImageElement);
      const lineNumber = findImageLines(content)[index];
      if (lineNumber == null) return;

      if (imagesMode === "move") {
        // Move only relocates a line within the doc, so it only makes
        // sense for a plain Markdown image line — a JSX <img> tag's
        // surrounding import statement wouldn't travel with it.
        const lineText = content.split("\n")[lineNumber - 1] || "";
        if (!extractMarkdownImagePath(lineText)) {
          alert(
            "Only Markdown-syntax images (![]()) can be moved from this " +
              "toolbar right now — this one uses a JSX <img> tag.",
          );
          setImagesMode(null);
          return;
        }
        setPendingMove({ sourceLine: lineNumber });
        setImagesMode(null);
      } else if (imagesMode === "remove") {
        // Unlike Move, Remove handles JSX <img> images too — it deletes
        // the whole reference (and its import, for MDX), so there's
        // nothing left that could end up orphaned.
        setContent((prev) => removeImageReference(prev, lineNumber));
        setImagesMode(null);
      }
    }

    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [imagesMode, content]);

  // Images toolbar — Move's destination step: with a source image picked
  // (pendingMove set), tracks the cursor over the *rendered* preview and
  // shows a drop-indicator line at the nearest element boundary, mapped
  // back to a source line via that element's data-source-line (see
  // rehypeSourceLines.ts). Only considers block-level tags — every
  // inline element (<strong>, <a>, <code>...) on the same visual line
  // carries its own close-together data-source-line too, which would
  // make the indicator jitter between near-identical positions for no
  // visible reason if they weren't filtered out.
  const MOVE_BLOCK_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6",
    "UL", "OL", "LI", "TABLE", "TR", "BLOCKQUOTE", "PRE", "IMG", "HR",
  ]);

  function findDropTarget(
    panel: HTMLElement,
    clientY: number,
  ): { line: number; y: number } | null {
    const panelRect = panel.getBoundingClientRect();
    const candidates = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-source-line]"),
    )
      .filter((el) => MOVE_BLOCK_TAGS.has(el.tagName))
      .map((el) => ({
        line: parseInt(el.dataset.sourceLine || "", 10),
        rect: el.getBoundingClientRect(),
      }))
      .filter((c) => !Number.isNaN(c.line))
      .sort((a, b) => a.rect.top - b.rect.top);

    if (candidates.length === 0) return null;

    for (const c of candidates) {
      if (clientY < c.rect.top + c.rect.height / 2) {
        return { line: c.line, y: c.rect.top - panelRect.top + panel.scrollTop };
      }
    }

    const last = candidates[candidates.length - 1];
    return {
      line: content.split("\n").length + 1,
      y: last.rect.bottom - panelRect.top + panel.scrollTop,
    };
  }

  function confirmMove(destLine: number) {
    const lines = content.split("\n");
    const sourceIdx = (pendingMove?.sourceLine ?? 0) - 1;
    if (sourceIdx < 0 || sourceIdx >= lines.length) {
      setPendingMove(null);
      setMoveIndicator(null);
      return;
    }

    const [movedLine] = lines.splice(sourceIdx, 1);
    // Removing the source line above the destination shifts everything
    // below it up by one, so the destination index needs the same
    // adjustment before re-inserting.
    let destIdx = destLine - 1;
    if (sourceIdx < destIdx) destIdx -= 1;
    destIdx = Math.max(0, Math.min(lines.length, destIdx));
    lines.splice(destIdx, 0, movedLine);

    setContent(lines.join("\n"));
    setPendingMove(null);
    setMoveIndicator(null);
  }

  function confirmInsertPosition(line: number) {
    setPendingInsertPick(false);
    setMoveIndicator(null);
    setInsertAtLine(line);
    setShowImageInsertChoice(true);
  }

  function confirmAdmonitionInsertPosition(line: number) {
    setPendingAdmonitionInsertPick(false);
    setMoveIndicator(null);
    setAdmonitionInsertAtLine(line);
    setEditingAdmonition(null);
    setShowAdmonitionEntry(true);
  }

  function confirmTableInsertPosition(line: number) {
    setPendingTableInsertPick(false);
    setMoveIndicator(null);
    setTableInsertAtLine(line);
    setEditingTable(null);
    setShowTableEntry(true);
  }

  function confirmTabsInsertPosition(line: number) {
    setPendingTabsInsertPick(false);
    setMoveIndicator(null);
    setTabsInsertAtLine(line);
    setEditingTabs(null);
    setShowTabsEntry(true);
  }

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (
      !panel ||
      (!pendingMove &&
        !pendingInsertPick &&
        !pendingAdmonitionInsertPick &&
        !pendingTableInsertPick &&
        !pendingTabsInsertPick)
    )
      return;

    function onMouseMove(e: MouseEvent) {
      if (!panel) return;
      const next = findDropTarget(panel, e.clientY);
      moveIndicatorRef.current = next;
      setMoveIndicator(next);
    }

    function confirm(line: number) {
      if (pendingMove) confirmMove(line);
      else if (pendingInsertPick) confirmInsertPosition(line);
      else if (pendingAdmonitionInsertPick) confirmAdmonitionInsertPosition(line);
      else if (pendingTableInsertPick) confirmTableInsertPosition(line);
      else if (pendingTabsInsertPick) confirmTabsInsertPosition(line);
    }

    function onClick(e: MouseEvent) {
      e.preventDefault();
      if (moveIndicatorRef.current) confirm(moveIndicatorRef.current.line);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && moveIndicatorRef.current) {
        e.preventDefault();
        confirm(moveIndicatorRef.current.line);
      } else if (e.key === "Escape") {
        setPendingMove(null);
        setPendingInsertPick(false);
        setPendingAdmonitionInsertPick(false);
        setPendingTableInsertPick(false);
        setPendingTabsInsertPick(false);
        setMoveIndicator(null);
      }
    }

    panel.addEventListener("mousemove", onMouseMove);
    panel.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("mousemove", onMouseMove);
      panel.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
    // moveIndicator itself deliberately isn't a dependency — it's read via
    // moveIndicatorRef instead, so a mousemove updating it doesn't tear
    // down and re-attach all three listeners on every pixel of movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingMove,
    pendingInsertPick,
    pendingAdmonitionInsertPick,
    pendingTableInsertPick,
    pendingTabsInsertPick,
    content,
  ]);

  // Admonitions toolbar — Modify/Remove: click delegation on
  // previewPanelRef (same pattern as the images toolbar's own) for
  // clicking an *existing* admonition, as opposed to Insert's
  // drop-indicator above.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel || !admonitionsMode) return;

    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest(
        ".admonition",
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();

      const lineAttr = target.dataset.sourceLine;
      if (!lineAttr) return;
      const block = findAdmonitionBlock(content, parseInt(lineAttr, 10));
      if (!block) return;

      if (admonitionsMode === "modify") {
        setEditingAdmonition(block);
        setAdmonitionInsertAtLine(null);
        setShowAdmonitionEntry(true);
        setAdmonitionsMode(null);
      } else if (admonitionsMode === "remove") {
        const lines = content.split("\n");
        lines.splice(
          block.startLine - 1,
          block.endLine - block.startLine + 1,
        );
        setContent(lines.join("\n"));
        setAdmonitionsMode(null);
      }
    }

    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [admonitionsMode, content]);

  // Table toolbar — Modify/Remove: click delegation for clicking an
  // *existing* table, same pattern as the admonitions effect above —
  // .closest("table") since a click could land on any cell inside it.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel || !tableMode) return;

    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest(
        "table",
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();

      const lineAttr = target.dataset.sourceLine;
      if (!lineAttr) return;
      const block = findTableBlock(content, parseInt(lineAttr, 10));
      if (!block) return;

      if (tableMode === "modify") {
        setEditingTable(block);
        setTableInsertAtLine(null);
        setShowTableEntry(true);
        setTableMode(null);
      } else if (tableMode === "remove") {
        const lines = content.split("\n");
        lines.splice(block.startLine - 1, block.endLine - block.startLine + 1);
        setContent(lines.join("\n"));
        setTableMode(null);
      }
    }

    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [tableMode, content]);

  // Tabs toolbar — Modify/Remove: click delegation for clicking an
  // *existing* Tabs block. Tabs.tsx's own root div carries a plain
  // data-rf-tabs marker (not a CSS-module class, which is hashed per
  // build and can't be selected reliably from here) alongside
  // data-source-line — see rehypeSourceLines.ts for why <Tabs> needed
  // its own tagging path, unlike a plain HTML element or admonition.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel || !tabsMode) return;

    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest(
        "[data-rf-tabs]",
      ) as HTMLElement | null;
      if (!target) return;
      e.preventDefault();

      const lineAttr = target.dataset.sourceLine;
      if (!lineAttr) return;
      const block = findTabsBlock(content, parseInt(lineAttr, 10));
      if (!block) return;

      if (tabsMode === "modify") {
        setEditingTabs(block);
        setTabsInsertAtLine(null);
        setShowTabsEntry(true);
        setTabsMode(null);
      } else if (tabsMode === "remove") {
        const lines = content.split("\n");
        lines.splice(block.startLine - 1, block.endLine - block.startLine + 1);
        setContent(removeTabsImportsIfUnused(lines.join("\n")));
        setTabsMode(null);
      }
    }

    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [tabsMode, content]);

  // Closes the open toolbar row (e.g. Images' Move/Insert/Remove) on a
  // click elsewhere in the preview, but only once nothing's actually
  // pending — while a pick is in progress, that same click is the pick
  // itself (handled by the effects above), not a dismissal.
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel || !activeTopTool) return;
    if (
      imagesMode ||
      admonitionsMode ||
      tableMode ||
      tabsMode ||
      pendingMove ||
      pendingInsertPick ||
      pendingAdmonitionInsertPick ||
      pendingTableInsertPick ||
      pendingTabsInsertPick
    )
      return;

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".preview-toolbar")) return;
      setActiveTopTool(null);
    }

    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [
    activeTopTool,
    imagesMode,
    admonitionsMode,
    tableMode,
    tabsMode,
    pendingMove,
    pendingInsertPick,
    pendingAdmonitionInsertPick,
    pendingTableInsertPick,
    pendingTabsInsertPick,
  ]);

  // Mirrors the sidebar's own per-workspace node construction (see the
  // Tree render below) so listImageNames/findFirstImage can be reused
  // here for the currently-open doc rather than whichever workspace a
  // sidebar row happens to be for.
  function getCurrentWorkspaceNodes(): TreeNode[] {
    if (!workspace) return [];
    const raw = localTrees[workspace] || [];
    const backendRoot = raw[0];
    if (!backendRoot) return [];
    return [
      {
        ...backendRoot,
        isWorkspaceRoot: true,
        path: `local-workspace/${workspace}`,
      },
    ];
  }

  // Images live in an "img" folder alongside the doc that references
  // them — same convention as buildNewFileContent's own "./img/..." and
  // AddImageModal's per-folder "+" button.
  function currentDocImgFolder(): string | null {
    if (!workspace || !currentDocPath) return null;
    const relPath = currentDocPath.replace(/^local-workspace\/[^/]+\//, "");
    const docFolder = relPath.replace(/\/[^/]+$/, "");
    return `local-workspace/${workspace}/${docFolder ? docFolder + "/" : ""}img`;
  }

  // Converts a 1-indexed line number (as picked by the drop-indicator,
  // which works in line numbers same as findDropTarget above) into a
  // character offset into `text`, for splicing/insertImageReference.
  function lineNumberToOffset(text: string, lineNumber: number): number {
    const lines = text.split("\n");
    const clamped = Math.max(1, Math.min(lineNumber, lines.length + 1));
    let offset = 0;
    for (let i = 0; i < clamped - 1; i++) {
      offset += (lines[i]?.length ?? 0) + 1; // +1 for the newline itself
    }
    return offset;
  }

  function handleImagesInsert() {
    setPendingInsertPick((prev) => !prev);
  }

  function handleImagesMove() {
    setImagesMode((prev) => (prev === "move" ? null : "move"));
  }

  function handleImagesRemove() {
    setImagesMode((prev) => (prev === "remove" ? null : "remove"));
  }

  function handleImageInsertChoiceCancel() {
    setShowImageInsertChoice(false);
    setInsertAtLine(null);
  }

  function handleChooseNewImage() {
    const folder = currentDocImgFolder();
    if (!folder || insertAtLine == null) return;
    insertCursorOffsetRef.current = lineNumberToOffset(content, insertAtLine);
    setImageModalContext("insert");
    setAddImageFolder(folder);
    setAddImageExistingNames(listImageNames(getCurrentWorkspaceNodes(), folder));
    setShowImageInsertChoice(false);
    setShowAddImageModal(true);
  }

  function handleChooseExisting() {
    setShowImageInsertChoice(false);
    setShowChooseExistingImage(true);
  }

  function handleExistingImageChosen(image: { name: string; path: string }) {
    if (insertAtLine == null || !currentDocPath) return;

    const docRelPath = currentDocPath.replace(/^local-workspace\/[^/]+\//, "");
    const docFolder = docRelPath.replace(/\/[^/]+$/, "");
    const imgRelPath = image.path.replace(/^local-workspace\/[^/]+\//, "");

    let relPath = relativePosixPath(docFolder, imgRelPath);
    if (!relPath.startsWith(".")) relPath = `./${relPath}`;

    const offset = lineNumberToOffset(content, insertAtLine);
    const isMdx = currentDocPath.endsWith(".mdx");
    setContent((prev) => insertImageReference(prev, offset, isMdx, relPath));

    setShowChooseExistingImage(false);
    setInsertAtLine(null);
  }

  function handleAdmonitionsInsert() {
    setPendingAdmonitionInsertPick((prev) => !prev);
  }

  function handleAdmonitionsModify() {
    setAdmonitionsMode((prev) => (prev === "modify" ? null : "modify"));
  }

  function handleAdmonitionsRemove() {
    setAdmonitionsMode((prev) => (prev === "remove" ? null : "remove"));
  }

  // Shared by Insert (admonitionInsertAtLine set, editingAdmonition null)
  // and Modify (editingAdmonition set instead) — the entry form itself
  // doesn't know or care which one it's serving.
  function handleAdmonitionEntrySubmit(data: {
    type: string;
    title: string;
    body: string;
  }) {
    const block = buildAdmonitionBlock(data.type, data.title, data.body);

    if (editingAdmonition) {
      const lines = content.split("\n");
      const count = editingAdmonition.endLine - editingAdmonition.startLine + 1;
      lines.splice(editingAdmonition.startLine - 1, count, ...block.split("\n"));
      setContent(lines.join("\n"));
      setEditingAdmonition(null);
    } else if (admonitionInsertAtLine != null) {
      const offset = lineNumberToOffset(content, admonitionInsertAtLine);
      setContent(
        (prev) => prev.slice(0, offset) + block + "\n\n" + prev.slice(offset),
      );
      setAdmonitionInsertAtLine(null);
    }

    setShowAdmonitionEntry(false);
  }

  function handleAdmonitionEntryCancel() {
    setShowAdmonitionEntry(false);
    setEditingAdmonition(null);
    setAdmonitionInsertAtLine(null);
  }

  function handleTableInsert() {
    setPendingTableInsertPick((prev) => !prev);
  }

  function handleTableModify() {
    setTableMode((prev) => (prev === "modify" ? null : "modify"));
  }

  function handleTableRemove() {
    setTableMode((prev) => (prev === "remove" ? null : "remove"));
  }

  // Shared by Insert (tableInsertAtLine set, editingTable null) and
  // Modify (editingTable set instead) — same shape as
  // handleAdmonitionEntrySubmit above.
  function handleTableEntrySubmit(data: {
    headers: string[];
    rows: string[][];
  }) {
    const block = buildMarkdownTable(data.headers, data.rows);

    if (editingTable) {
      const lines = content.split("\n");
      const count = editingTable.endLine - editingTable.startLine + 1;
      lines.splice(editingTable.startLine - 1, count, ...block.split("\n"));
      setContent(lines.join("\n"));
      setEditingTable(null);
    } else if (tableInsertAtLine != null) {
      const offset = lineNumberToOffset(content, tableInsertAtLine);
      setContent(
        (prev) => prev.slice(0, offset) + block + "\n\n" + prev.slice(offset),
      );
      setTableInsertAtLine(null);
    }

    setShowTableEntry(false);
  }

  function handleTableEntryCancel() {
    setShowTableEntry(false);
    setEditingTable(null);
    setTableInsertAtLine(null);
  }

  function handleTabsInsert() {
    // Tabs is JSX (<Tabs>/<TabItem>) — a .md file can't render it on the
    // real Docusaurus site, so this is caught here rather than letting
    // the user pick a position only to find out at the end. An in-page
    // notice rather than a native alert() — same reasoning as
    // ConfirmDialog replacing window.confirm() elsewhere in this app:
    // a real OS dialog risked the Windows focus-loss bug that fix was
    // for in the first place.
    if (!currentDocPath.endsWith(".mdx")) {
      setPendingConfirm({
        message:
          "Cannot use Tabs for an MD file. This file needs to be converted to MDX first.",
        hideCancel: true,
        onConfirm: () => setPendingConfirm(null),
      });
      return;
    }
    setPendingTabsInsertPick((prev) => !prev);
  }

  function handleTabsModify() {
    setTabsMode((prev) => (prev === "modify" ? null : "modify"));
  }

  function handleTabsRemove() {
    setTabsMode((prev) => (prev === "remove" ? null : "remove"));
  }

  // Shared by Insert (tabsInsertAtLine set, editingTabs null) and Modify
  // (editingTabs set instead) — same shape as handleTableEntrySubmit
  // above. Each tab's `value` is derived from its label, de-duplicated
  // within this block the same way makeImportVarName in
  // insertImageReference.ts de-duplicates import names.
  function handleTabsEntrySubmit(entries: { label: string; content: string }[]) {
    const docRelPath = currentDocPath.replace(/^local-workspace\/[^/]+\//, "");
    const used = new Set<string>();
    const tabsData = entries.map((entry) => {
      const base = slugifyFileName(entry.label) || "tab";
      let value = base;
      let n = 2;
      while (used.has(value)) {
        value = `${base}-${n}`;
        n++;
      }
      used.add(value);
      return { value, label: entry.label.trim(), content: entry.content };
    });
    const block = buildTabsBlock(tabsData);

    if (editingTabs) {
      const lines = content.split("\n");
      const count = editingTabs.endLine - editingTabs.startLine + 1;
      lines.splice(editingTabs.startLine - 1, count, ...block.split("\n"));
      setContent(ensureTabsImports(lines.join("\n"), docRelPath));
      setEditingTabs(null);
    } else if (tabsInsertAtLine != null) {
      const offset = lineNumberToOffset(content, tabsInsertAtLine);
      setContent((prev) => {
        const withBlock =
          prev.slice(0, offset) + block + "\n\n" + prev.slice(offset);
        return ensureTabsImports(withBlock, docRelPath);
      });
      setTabsInsertAtLine(null);
    }

    setShowTabsEntry(false);
  }

  function handleTabsEntryCancel() {
    setShowTabsEntry(false);
    setEditingTabs(null);
    setTabsInsertAtLine(null);
  }

  const [currentFile, setCurrentFile] = useState("");

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState<ConflictData>(null);

  const conflict = isConflictFile(currentDocPath);

  const [selectedChanges, setSelectedChanges] = useState<
    Record<string, boolean>
  >({});

  const effectivePath = currentDocPath || "";

  /* AUTOSAVE */
  const saving = useAutosave(
    login,
    workspace,
    effectivePath,
    content,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveDocument,
  );

  // -----------------------------
  // VERSION EVALUATION
  // -----------------------------
  function evaluateStatus(
    cfg: DocEditorStatusConfig,
    currentVersion: string,
  ): NonNullable<EditorStatus> {
    function compare(a: string, b: string) {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
      }
      return 0;
    }

    if (cfg.blocked) {
      return { type: "blocked", message: cfg.blockMessage };
    }

    if (compare(currentVersion, cfg.minSupportedVersion) < 0) {
      return {
        type: "forceUpdate",
        current: currentVersion,
        latest: cfg.latestVersion,
        message: cfg.updateMessage,
        downloadUrl: cfg.downloadUrl,
      };
    }

    if (compare(currentVersion, cfg.latestVersion) < 0) {
      return {
        type: "updateAvailable",
        current: currentVersion,
        latest: cfg.latestVersion,
        message: cfg.updateMessage,
        downloadUrl: cfg.downloadUrl,
      };
    }

    return { type: "ok" };
  }

  // -----------------------------
  // Check Upstream
  // -----------------------------
  useEffect(() => {
    async function checkUpstream() {
      if (!login) return;
      const res = await fetch(
        `/api/reset-mirror/upstream-status?login=${login}`,
      );
      const data = await res.json();

      if (data.stale) {
        if (!login) return;
        await fetch(`/api/reset-mirror?login=${login}`, {
          method: "POST",
        });
      }
    }

    checkUpstream();
  }, [login]);

  // -----------------------------
  // EDITOR STATUS CHECK
  // -----------------------------
  useEffect(() => {
    async function checkStatus() {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) {
        setEditorStatus({ type: "ok" });
        return;
      }

      const cfg = await res.json();
      const status = evaluateStatus(cfg, APP_VERSION);
      setEditorStatus(status);
    }

    checkStatus();
  }, []);

  /* AUTH UI */
  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={rfHeliLogo} alt="" className="auth-logo" />
          <h2 className="auth-title">Rotorflight Docs Editor</h2>
          <p className="auth-subtitle">
            Sign in with GitHub to start editing the Rotorflight
            documentation.
          </p>

          {authError && <p className="auth-error">{authError}</p>}

          {authStep === "idle" && (
            <button className="auth-signin-btn" onClick={startGitHubLogin}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Sign in with GitHub
            </button>
          )}

          {authStep === "polling" && (
            <div className="auth-device-flow">
              <p>
                Open{" "}
                <a
                  href={verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  this page
                </a>{" "}
                and enter the code:
              </p>

              <div className="auth-device-code">{userCode}</div>

              <p className="auth-waiting">
                <svg
                  className="loading-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="#3578e5"
                    strokeWidth="2"
                    strokeDasharray="56"
                    strokeDashoffset="28"
                    strokeLinecap="round"
                  />
                </svg>
                Waiting for authorisation…
              </p>
            </div>
          )}

          <a
            className="auth-help-link"
            href="https://github.com/pkaig/rotorflight-docEditor/wiki"
            target="_blank"
            rel="noreferrer"
          >
            Help
          </a>
        </div>
      </div>
    );
  }

  /* -------------------------------------------
     VERSION-GATE MODALS (MAINTENANCE INCLUDED)
  ------------------------------------------- */
  if (editorStatus === null) return null;

  if (editorStatus.type === "blocked") {
    return <MaintenanceModal message={editorStatus.message} />;
  }

  if (editorStatus.type === "forceUpdate") {
    return <ForceUpdateModal {...editorStatus} />;
  }

  if (editorStatus.type === "updateAvailable") {
    return (
      <UpdateAvailableModal
        {...editorStatus}
        onContinue={() => setEditorStatus({ type: "ok" })}
      />
    );
  }

  /* FILE SELECTION */
  // const onSelect = (ws: string, path: string) => {
  //   if (workspace !== ws) {
  //     setWorkspace(ws);
  //     localStorage.setItem("rf_workspace", ws);
  //   }

  //   if (!/\.[a-z0-9]+$/i.test(path)) return;

  //   const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
  //   if (isImage) {
  //     setCurrentDocPath(path);
  //     setContent("");
  //     return;
  //   }

  //   loadDoc(path, ws);
  // };

  const onSelect = async (ws: string, path: string) => {
    // -----------------------------------------------------
    // 0. Switch workspace if needed
    // -----------------------------------------------------
    if (workspace !== ws) {
      setWorkspace(ws);
      localStorage.setItem("rf_workspace", ws);
    }

    // -----------------------------------------------------
    // 1. Normalize the path (Tree uses virtual paths)
    // -----------------------------------------------------
    let cleanPath = path;

    const prefix = `local-workspace/${ws}/`;
    if (cleanPath.startsWith(prefix)) {
      cleanPath = cleanPath.slice(prefix.length);
    }

    // Workspace-relative, keeping the docs/ or versioned_docs/ prefix —
    // matches the path format scan-local-changes returns in `changes`,
    // and what the diff-file endpoint now expects.
    const relPath = cleanPath;

    // Only strip docs/ if the tree path actually includes it
    if (path.includes(`/docs/`)) {
      cleanPath = cleanPath.replace(/^.*?docs\//, "");
    }

    // -----------------------------------------------------
    // 2. Check if a conflict file exists
    // -----------------------------------------------------
    const check = await fetch(
      `/api/reset-mirror/has-conflict?login=${login}&workspace=${ws}&file=${cleanPath}`,
    );

    const { conflict } = await check.json();

    if (conflict) {
      // Load the actual conflict content
      const conflictRes = await fetch(
        `/api/reset-mirror/conflict-file?login=${login}&workspace=${ws}&file=${cleanPath}`,
      );

      const conflictData = await conflictRes.json();

      setShowConflictModal(true);
      setConflictData({
        file: cleanPath,
        workspace: ws,
        workspaceText: conflictData.workspace,
        upstreamText: conflictData.upstream,
      });

      return; // stop normal file loading
    }

    // Whether to open this doc straight into the diff viewer. `changes` is
    // { added, modified, deleted, renamed } arrays of { path } entries
    // (from scan-local-changes), not a path-keyed map, hence the .some()
    // scan rather than a lookup.
    //
    // Excludes images: the diff viewer only knows how to show a text
    // diff, and a brand-new (or modified) image is just as much a
    // "changed file" as a doc is, so without this check every image in
    // the Changes panel opened a text diff view against binary image
    // content instead of just displaying the image.
    const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);

    const isChangedFile =
      !isImage &&
      (changes.added as { path: string }[])
        .concat(changes.modified, changes.deleted, changes.renamed)
        .some((c) => c.path === relPath);

    // -----------------------------------------------------
    // 3. Normal file selection
    // -----------------------------------------------------
    if (!/\.[a-z0-9]+$/i.test(path)) return;

    if (isImage) {
      setCurrentDocPath(path);
      setContent("");
      return;
    }
    // relPath (docs/-prefixed), not cleanPath (stripped) — currentFile must
    // stay in the same full-path format /diff-file and `changes` use, or
    // the diff view resolves the wrong file and comes back empty once this
    // file is edited and saved.
    setCurrentFile(relPath);
    setShowDiff(isChangedFile);

    // A doc actively being worked on is exactly the case that's usually
    // "changed" (added/modified) — this prompt has to fire regardless of
    // isChangedFile, or it would essentially never show for a file someone
    // is mid-edit on.
    if (path.toLowerCase().endsWith(".md") && !skipMdxPromptRef.current.has(path)) {
      setPendingConfirm({
        message: "MD file detected. Our new standard is MDX. Do you want to convert?",
        confirmLabel: "Yes",
        cancelLabel: "No",
        onConfirm: () => {
          setPendingConfirm(null);
          handleConvertMdToMdx(path, ws);
        },
        onCancel: () => {
          skipMdxPromptRef.current.add(path);
          loadDoc(path, ws);
        },
      });
      return;
    }

    loadDoc(path, ws);
  };

  // Renames a .md file to .mdx and converts any Markdown image syntax to
  // import + <img> in the same pass. Also adds the Tabs imports if the
  // raw content already contains a <Tabs> block — vanishingly rare for a
  // plain .md file (Tabs is JSX, so it wouldn't have rendered before
  // conversion anyway) but kept for consistency with how Insert handles
  // it. Fetches the file's on-disk content directly rather than trusting
  // `content` state, since that may still hold whatever doc was open
  // before this one and loadDoc's own fetch hasn't necessarily resolved
  // yet.
  async function handleConvertMdToMdx(path: string, ws: string) {
    if (!login) return;
    const storedLogin = login || localStorage.getItem("rf_login");

    const canonicalOld = path.startsWith("local-workspace/")
      ? path
      : `local-workspace/${ws}/${path}`;
    const canonicalNew = canonicalOld.replace(/\.md$/i, ".mdx");
    const newDocRelPath = canonicalOld
      .replace(/^local-workspace\/[^/]+\//, "")
      .replace(/\.md$/i, ".mdx");

    setConvertingMdToMdx(true);
    try {
      const loadRes = await fetch(
        `/api/docs/load?path=${encodeURIComponent(
          canonicalOld,
        )}&login=${encodeURIComponent(storedLogin || "")}&workspace=${encodeURIComponent(ws)}`,
      );
      const rawContent = loadRes.ok ? (await loadRes.json()).content || "" : "";
      const withImages = convertMarkdownImagesToJsx(rawContent);
      const converted = rawContent.includes("<Tabs")
        ? ensureTabsImports(withImages, newDocRelPath)
        : withImages;

      await notifyFileRenamed("local-workspace", canonicalOld, canonicalNew);

      const saveRes = await fetch(
        `/api/docs/save?login=${encodeURIComponent(login)}&workspace=${encodeURIComponent(ws)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: newDocRelPath, content: converted }),
        },
      );
      if (!saveRes.ok) {
        console.error("MD->MDX conversion save failed:", saveRes.status, await saveRes.text());
      }

      await refreshLocalWorkspace(ws);
      setCurrentFile(newDocRelPath);
      setShowDiff(false);
      loadDoc(canonicalNew, ws);
    } catch (err) {
      console.error("MD->MDX conversion failed:", err);
    } finally {
      setConvertingMdToMdx(false);
    }
  }

  /* MOVE FILES / NEW PAGE */
  function onDropFolder(ws: string, targetFolderPath: string) {
    if (!draggedItem) return;

    if (draggedItem === "__NEW_PAGE__") {
      setNewFileFolder(targetFolderPath);
      setNewFileName("");
      setShowNewFileModal(true);
      setDraggedItem(null);
      return;
    }

    const filename = draggedItem.split("/").pop();
    const newPath = `${targetFolderPath}/${filename}`;

    fetch(`/api/docs/rename?login=${login}&workspace=${ws}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: draggedItem, newPath }),
    }).then(() => {
      notifyFileRenamed("local-workspace", draggedItem, newPath);
      refreshLocalWorkspace(ws);
    });

    setDraggedItem(null);
  }

  /* DELETE FILE */
  // Only ever removes the file from the local workspace, never the real
  // rotorflight-docs repo — that stays untouched unless a PR gets
  // submitted and merged, so a plain single confirm (matching every
  // other destructive action in this app) is enough here.
  function handleDeleteFile(ws: string, filePath: string) {
    if (!login) return;
    const filename = filePath.split("/").pop() || filePath;

    setPendingConfirm({
      message: `Delete "${filename}"? This removes it from your local workspace (it won't affect the real repo unless you submit a PR).`,
      danger: true,
      onConfirm: async () => {
        setPendingConfirm(null);

        const wasOpen = filePath === currentDocPath;
        if (wasOpen) {
          setCurrentDocPath("");
          setContent("");
        }

        await notifyFileDeleted("local-workspace", filePath);
        await refreshLocalWorkspace(ws);
      },
    });
  }

  /* DELETE WORKSPACE */
  function handleDeleteWorkspace(ws: string) {
    if (!login) return;

    setPendingConfirm({
      message: `Delete workspace "${ws}"? This cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        setPendingConfirm(null);

        // Cleared before the delete request goes out, not after — leaving
        // the app still pointed at a workspace (and possibly a doc within
        // it) that's about to stop existing on disk left other effects
        // depending on `workspace`/currentDocPath free to fire against it
        // during the delete's own request, a plausible extra contributor
        // to the focus-loss bug the ConfirmDialog change above addresses
        // more directly.
        if (workspace === ws) {
          setWorkspace(null);
          if (currentDocPath.startsWith(`local-workspace/${ws}/`)) {
            setCurrentDocPath("");
          }
        }

        setDeletingWorkspace(true);
        try {
          await fetch(
            `/api/docs/delete-workspace?login=${encodeURIComponent(
              login,
            )}&workspace=${encodeURIComponent(ws)}`,
            { method: "DELETE" },
          );

          await loadWorkspaces();
        } finally {
          setDeletingWorkspace(false);
        }
      },
    });
  }

  /* Loading Local Workspace Banner */
  function LoadingLocalBanner({ message }: { message: string }) {
    return (
      <div className="loading-local-banner">
        <svg
          className="loading-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="#856404"
            strokeWidth="2"
            strokeDasharray="56"
            strokeDashoffset="28"
            strokeLinecap="round"
          />
        </svg>
        <span>{message}</span>
      </div>
    );
  }

  /* MAIN UI */
  // Note: editorStatus.type can only be "ok" once execution reaches here —
  // "blocked"/"forceUpdate"/"updateAvailable" all return a full-screen modal
  // above instead, and updateAvailable's onContinue resets type to "ok"
  // rather than preserving "was dismissed but still outdated". UpdateBanner
  // (a persistent post-dismiss reminder) is exported and imported for
  // exactly this spot but can never actually render as a result — a
  // pre-existing dead path, not something introduced by this fix pass.
  return (
    <div className="app-root">
      {saving && <div className="saving-indicator">Saving…</div>}

      {user && (
        <div className="app-header">
          <div className="app-header-brand">
            <img src={rfHeliLogo} alt="" className="app-header-logo" />
            <span className="app-header-title">Rotorflight Docs Editor</span>
          </div>

          <a
            className="app-header-help-btn"
            href="https://github.com/pkaig/rotorflight-docEditor/wiki"
            target="_blank"
            rel="noreferrer"
          >
            Help
          </a>

          <div className="app-header-user">
            <button
              type="button"
              className="app-header-avatar-btn"
              title="Log out"
              onClick={() => {
                setPendingConfirm({
                  message: "Do you want to logout?",
                  onConfirm: () => {
                    setPendingConfirm(null);
                    logout();
                  },
                });
              }}
            >
              <img
                src={user.avatar_url}
                alt="avatar"
                className="app-header-avatar"
              />
            </button>
            <span>
              Signed in as <strong>{user.login}</strong>
            </span>
          </div>
        </div>
      )}

      {appInstalled === false && appInstallUrl && (
        <div className="app-not-installed-banner">
          The Rotorflight-docEditor GitHub App isn't installed for your
          account yet — commits and pull requests won't work until it is.{" "}
          <a href={appInstallUrl} target="_blank" rel="noreferrer">
            Install or request the GitHub App
          </a>
        </div>
      )}

      {/* MAIN LAYOUT */}
      <div className="main-layout">
        {/* SIDEBAR */}
        <div className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
          {!sidebarCollapsed && (
            <>
          <div className="sidebar-top">
            {/* <h3>Docs</h3> */}

            {(checking || updating) && (
              <div
                className={
                  updating
                    ? "workspace-banner warning"
                    : "workspace-banner info"
                }
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke={updating ? "#b30000" : "#1a4d8f"}
                    strokeWidth="2"
                    strokeDasharray="56"
                    strokeDashoffset="28"
                    strokeLinecap="round"
                  />
                </svg>

                {updating ? "Updating Rotorflight-docs…" : "Checking upstream…"}
              </div>
            )}

            <div className="workspace-controls">
              <button
                className="add-workspace-btn"
                disabled={deletingWorkspace}
                title={
                  deletingWorkspace
                    ? "Waiting for the workspace deletion to finish…"
                    : undefined
                }
                onClick={() => setShowWorkspaceSelector(true)}
              >
                {deletingWorkspace ? "Deleting…" : "+ Add Workspace"}
              </button>

              {showWorkspaceSelector && (
                <WorkspaceSelector
                  login={login}
                  onSelect={async (newWorkspaceName) => {
                    if (newWorkspaceName === null) {
                      setShowWorkspaceSelector(false);
                      return;
                    }

                    const error = validateWorkspaceName(newWorkspaceName);
                    if (error) {
                      alert(error);
                      return;
                    }

                    const createRes = await fetch(
                      `/api/docs/create-workspace?login=${login}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ workspace: newWorkspaceName }),
                      },
                    );

                    if (!createRes.ok) {
                      const body = await createRes.json().catch(() => ({}));
                      alert(
                        `Failed to create workspace: ${body.error || createRes.statusText}`,
                      );
                      return;
                    }

                    await loadWorkspaces();
                    setWorkspace(newWorkspaceName);
                    await refreshLocalWorkspace(newWorkspaceName);
                    setShowWorkspaceSelector(false);
                  }}
                />
              )}

              <div className="workspace-current-label">
                Current workspace: <strong>{workspace}</strong>
              </div>
            </div>

            {/* WORKSPACE TREES */}
            {workspaces.map((ws) => {
              const raw = localTrees[ws] || [];
              const backendRoot = raw[0];

              const nodes = [
                {
                  ...backendRoot,
                  isWorkspaceRoot: true,
                  path: `local-workspace/${ws}`,
                },
              ];

              return (
                <div key={ws} className="workspace-block">
                  <button
                    className="workspace-delete-btn"
                    onClick={() => handleDeleteWorkspace(ws)}
                    title="Delete workspace"
                  >
                    <svg className="workspace-delete-icon" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>

                  <Tree
                    nodes={nodes}
                    key={ws}
                    onSelect={(path) => {
                      setWorkspace(ws);
                      onSelect(ws, path);
                    }}
                    onFolderClick={() => setWorkspace(ws)}
                    onDropFolder={(folder) => onDropFolder(ws, folder)}
                    setDraggedItem={setDraggedItem}
                    openFolders={openFolders}
                    setOpenFolders={setOpenFolders}
                    currentPath={currentDocPath}
                    onNewFile={(folderPath) => {
                      setWorkspace(ws);
                      setNewFileFolder(folderPath);
                      setNewFileName("");
                      setNewFileImageName(findFirstImage(nodes, folderPath));
                      setShowNewFileModal(true);
                    }}
                    onNewImage={(folderPath) => {
                      setWorkspace(ws);
                      setImageModalContext("sidebar");
                      setAddImageFolder(folderPath);
                      setAddImageExistingNames(listImageNames(nodes, folderPath));
                      setShowAddImageModal(true);
                    }}
                    onDeleteFile={(filePath) => handleDeleteFile(ws, filePath)}
                    rootBadge={
                      ws === workspace && prState === "merged" ? (
                        <span
                          className="workspace-pr-badge"
                          title="This workspace's PR has been merged. Nothing here is deleted or reset automatically — copy anything you still want to keep working on into a new workspace when you're ready."
                        >
                          ✓ Merged
                        </span>
                      ) : undefined
                    }
                  />
                </div>
              );
            })}

            {loadingLocal && (
              <div className="loadingLocalWorkspace">
                <LoadingLocalBanner message="Please wait… Loading local workspace" />
              </div>
            )}
          </div>

          {/* CHANGES PANEL */}
          <div className="changes-panel">
            <div className="changes-actions">
              <button
                className="clear-selected-btn"
                onClick={(e) => {
                  e.stopPropagation();

                  const selected = Object.keys(selectedChanges).filter(
                    (k) => selectedChanges[k],
                  );
                  if (selected.length === 0) return;

                  setPendingConfirm({
                    message: `Restore ${selected.length} file(s) from baseline?`,
                    danger: true,
                    onConfirm: async () => {
                      setPendingConfirm(null);

                      const ws = workspace;
                      if (!ws) return;

                      const cleanPaths = selected.map((p) => {
                        let clean = p.replace(/^local-workspace\/[^/]+\//, "");

                        if (clean.startsWith("docs/"))
                          clean = clean.slice("docs/".length);
                        if (clean.startsWith("versioned_docs/"))
                          clean = clean.slice("versioned_docs/".length);

                        return clean;
                      });

                      await fetch("/api/reset-mirror/clear-selected", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          login,
                          workspace: ws,
                          files: cleanPaths,
                        }),
                      });

                      await refreshLocalWorkspace(ws);
                      await loadChangesFromMirror();

                      if (
                        cleanPaths.includes(
                          currentDocPath.replace(/^docs\//, ""),
                        )
                      ) {
                        loadDoc(currentDocPath, ws);
                      }

                      setSelectedChanges({});
                    },
                  });
                }}
              >
                Clear selected
              </button>

              <button
                className="clear-all-btn"
                onClick={() => {
                  setPendingConfirm({
                    message: "This will restore ALL files from baseline. Continue?",
                    danger: true,
                    onConfirm: async () => {
                      setPendingConfirm(null);

                      const ws = workspace;
                      if (!ws) return;

                      await fetch("/api/reset-mirror/clear-all", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ login, workspace: ws }),
                      });

                      await refreshLocalWorkspace(ws);
                      await loadChangesFromMirror();

                      if (currentDocPath) {
                        loadDoc(currentDocPath, ws);
                      }
                    },
                  });
                }}
              >
                Clear all
              </button>
            </div>

            <div className="changes-list-container">
              <ChangesPanel
                changes={changes}
                selectedChanges={selectedChanges}
                setSelectedChanges={setSelectedChanges}
                onOpenFile={(rawPath: string) => {
                  const ws = workspace;
                  if (!ws) return;

                  // Build the full path exactly like the tree uses
                  const fullPath = `local-workspace/${ws}/${rawPath}`;

                  setWorkspace(ws);
                  onSelect(ws, fullPath); // ← this already loads the file into the editor
                }}
              />
            </div>
            <div className="pr-panel">
              <PRPanel
                login={login}
                workspace={workspace}
                banner={banner}
                activePR={activePR}
                submitPR={submitPR}
                submitting={submitting}
                clearBanner={clearBanner}
                prMerged={prState === "merged"}
                newCommentNotice={newCommentNotice}
                dismissCommentNotice={dismissCommentNotice}
              />
            </div>
          </div>
            </>
          )}
        </div>

        <button
          type="button"
          className="sidebar-toggle-bar"
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((prev) => !prev)}
        >
          <span>{sidebarCollapsed ? "»" : "«"}</span>
        </button>

        {showConflictModal && conflictData && (
          <ConflictResolver
            file={conflictData.file}
            workspace={conflictData.workspace}
            workspaceText={conflictData.workspaceText}
            upstreamText={conflictData.upstreamText}
            login={login}
            onMergedChange={(merged) => {
              setContent(merged);
              // Was previously called as saveDocument(conflictData.file, merged,
              // conflictData.workspace) — saveDocument only takes one argument
              // (newContent), so that extra-args call silently saved
              // conflictData.file (a path string) as the document's content
              // instead of the actual merged text, on every keystroke.
              saveDocument(merged);
              refreshLocalWorkspace(conflictData.workspace);
              setShowConflictModal(false);
            }}
            onClose={() => setShowConflictModal(false)}
            onResolved={() => {
              setShowConflictModal(false);
              refreshLocalWorkspace(conflictData.workspace);
            }}
          />
        )}

        {pendingConfirm && (
          <ConfirmDialog
            message={pendingConfirm.message}
            danger={pendingConfirm.danger}
            hideCancel={pendingConfirm.hideCancel}
            confirmLabel={pendingConfirm.confirmLabel}
            cancelLabel={pendingConfirm.cancelLabel}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => {
              pendingConfirm.onCancel?.();
              setPendingConfirm(null);
            }}
          />
        )}

        <AddImageModal
          isOpen={showAddImageModal}
          folder={addImageFolder}
          login={login}
          existingNames={addImageExistingNames}
          onClose={() => setShowAddImageModal(false)}
          onUploaded={async (ws, filename) => {
            if (imageModalContext === "insert") {
              const offset = insertCursorOffsetRef.current ?? content.length;
              const isMdx = currentDocPath.endsWith(".mdx");
              setContent((prev) =>
                insertImageReference(prev, offset, isMdx, `./img/${filename}`),
              );
              insertCursorOffsetRef.current = null;
            }
            await refreshLocalWorkspace(ws);
            await notifyFileSaved();
          }}
        />

        {showImageInsertChoice && (
          <ImageInsertChoiceModal
            onNewImage={handleChooseNewImage}
            onChooseExisting={handleChooseExisting}
            onCancel={handleImageInsertChoiceCancel}
          />
        )}

        {showChooseExistingImage && (
          <ChooseExistingImageModal
            images={findAllImages(getCurrentWorkspaceNodes())}
            login={login}
            workspace={workspace}
            onChoose={handleExistingImageChosen}
            onCancel={() => {
              setShowChooseExistingImage(false);
              setInsertAtLine(null);
            }}
          />
        )}

        {showAdmonitionEntry && (
          <AdmonitionEntryModal
            initial={
              editingAdmonition
                ? {
                    type: editingAdmonition.type,
                    title: editingAdmonition.title,
                    body: editingAdmonition.body,
                  }
                : undefined
            }
            onSubmit={handleAdmonitionEntrySubmit}
            onCancel={handleAdmonitionEntryCancel}
          />
        )}

        {showTableEntry && (
          <TableEntryModal
            initial={
              editingTable
                ? { headers: editingTable.headers, rows: editingTable.rows }
                : undefined
            }
            onSubmit={handleTableEntrySubmit}
            onCancel={handleTableEntryCancel}
          />
        )}

        {showTabsEntry && (
          <TabsEntryModal
            initial={
              editingTabs
                ? editingTabs.tabs.map((t) => ({
                    label: t.label,
                    content: t.content,
                  }))
                : undefined
            }
            onSubmit={handleTabsEntrySubmit}
            onCancel={handleTabsEntryCancel}
          />
        )}

        {/* MAIN EDITOR + PREVIEW AREA */}
        <div className="editor-preview-row" ref={editorPreviewRowRef}>
          {/* EDITOR COLUMN */}
          <div className="editor-column" style={{ width: `${editorPercent}%` }}>
            <div className="editor-toolbar">
              {!showDiff && (
                <button onClick={() => setShowDiff(true)}>Show Diff</button>
              )}

              {showDiff && (
                <button onClick={() => setShowDiff(false)}>Close Diff</button>
              )}
            </div>

            {convertingMdToMdx && (
              <div className="editor-converting-banner">
                <LoadingLocalBanner message="Converting file to MDX…" />
              </div>
            )}

            <div className="editor-scroll-area">
              {showDiff ? (
                <UnifiedDiffViewer
                  key={currentFile}
                  login={login}
                  workspace={workspace}
                  // currentFile already keeps the docs/ or versioned_docs/
                  // prefix (see onSelect's relPath) — /diff-file needs that
                  // prefix to resolve the right path on disk, so only the
                  // local-workspace/<ws>/ virtual-tree prefix gets stripped.
                  file={currentFile.replace(/^local-workspace\/[^/]+\//, "")}
                  onClose={() => setShowDiff(false)}
                  scrollRef={diffScrollRef}
                />
              ) : (
                <EditorPanel
                  content={content}
                  setContent={setContent}
                  currentDocPath={currentDocPath}
                  conflict={conflict}
                  errorLine={errorLine}
                  saveState={saveState}
                  login={login}
                  workspace={workspace}
                  refreshLocalWorkspace={refreshLocalWorkspace}
                  onSelect={onSelect}
                  showNewFileModal={showNewFileModal}
                  setShowNewFileModal={setShowNewFileModal}
                  newFileName={newFileName}
                  setNewFileName={setNewFileName}
                  newFileFolder={newFileFolder}
                  setNewFileFolder={setNewFileFolder}
                  notifyFileCreated={notifyFileCreated}
                  newDocTemplate={newDocTemplate}
                  newFileImageName={newFileImageName}
                  textareaRef={editorTextareaRef}
                />
              )}
            </div>
          </div>

          <SplitScrollbar
            fraction={scrollFraction}
            thumbSize={scrollThumbSize}
            onFractionChange={setScrollFraction}
            onResizeStart={startColumnResize}
            showThumb={!showDiff}
          />

          {/* PREVIEW COLUMN */}
          <div
            // The custom thumb above only tracks the editor textarea, which
            // is unmounted while Show Diff is active (see UnifiedDiffViewer)
            // — rf-synced-scroll-hidden is skipped in that case so the
            // preview keeps a real, working scrollbar instead of looking
            // unscrollable behind a hidden one with no synced thumb to
            // replace it.
            className={`preview-panel${showDiff ? "" : " rf-synced-scroll-hidden"}${imagesMode ? " picking-image" : ""}${admonitionsMode ? " picking-admonition" : ""}${tableMode ? " picking-table" : ""}${tabsMode ? " picking-tabs" : ""}${pendingMove || pendingInsertPick || pendingAdmonitionInsertPick || pendingTableInsertPick || pendingTabsInsertPick ? " picking-move-target" : ""}`}
            ref={previewPanelRef}
            style={{ width: `${100 - editorPercent}%` }}
          >
            <h3>Preview</h3>

            {currentDocPath && !/\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath) && (
              <PreviewToolbar
                activeTopTool={activeTopTool}
                onActiveTopToolChange={setActiveTopTool}
                imagesMode={imagesMode}
                imagesInsertActive={pendingInsertPick}
                onImagesMove={handleImagesMove}
                onImagesRemove={handleImagesRemove}
                onImagesInsert={handleImagesInsert}
                admonitionsMode={admonitionsMode}
                admonitionsInsertActive={pendingAdmonitionInsertPick}
                onAdmonitionsInsert={handleAdmonitionsInsert}
                onAdmonitionsModify={handleAdmonitionsModify}
                onAdmonitionsRemove={handleAdmonitionsRemove}
                tableMode={tableMode}
                tableInsertActive={pendingTableInsertPick}
                onTableInsert={handleTableInsert}
                onTableModify={handleTableModify}
                onTableRemove={handleTableRemove}
                tabsMode={tabsMode}
                tabsInsertActive={pendingTabsInsertPick}
                onTabsInsert={handleTabsInsert}
                onTabsModify={handleTabsModify}
                onTabsRemove={handleTabsRemove}
              />
            )}

            {(pendingMove ||
              pendingInsertPick ||
              pendingAdmonitionInsertPick ||
              pendingTableInsertPick ||
              pendingTabsInsertPick) && (
              <>
                <div className="move-drop-hint">
                  Click (or press Enter) to{" "}
                  {pendingMove
                    ? "drop the image"
                    : pendingInsertPick
                      ? "insert the image"
                      : pendingAdmonitionInsertPick
                        ? "insert the admonition"
                        : pendingTableInsertPick
                          ? "insert the table"
                          : "insert the tabs"}{" "}
                  here — Esc to cancel
                </div>
                {moveIndicator && (
                  <div
                    className="move-drop-indicator"
                    style={{ top: `${moveIndicator.y}px` }}
                  />
                )}
              </>
            )}

            <PreviewErrorBoundary key={currentDocPath} onError={setErrorLine}>
              {currentDocPath &&
                (content.length > 0 ||
                  /\.(png|jpe?g|gif|svg|webp)$/i.test(currentDocPath)) && (
                  <Preview
                    content={content}
                    currentDocPath={currentDocPath}
                    onError={(line) => setErrorLine(line)}
                    onImageUpdated={async () => {
                      if (workspace) await refreshLocalWorkspace(workspace);
                      await notifyFileSaved();
                    }}
                  />
                )}
            </PreviewErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
