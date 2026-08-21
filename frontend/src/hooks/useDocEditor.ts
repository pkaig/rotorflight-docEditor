/* frontend/src/hooks/useDocEditor.ts
 *
 * Description of responsibility:
 *   Owns the currently-open document's state: loading a file's content
 *   from the workspace, tracking its path, saving edits back (skipping
 *   a save if content is unchanged since the last one), and cloning a
 *   file from the upstream mirror into the local workspace.
 *
 * Info:
 *   notifyFileSaved is passed in as a parameter rather than obtained
 *   from this hook's own useGitPR() call, because every call to that
 *   hook is an independent state instance — a separate instance's
 *   notifyFileSaved would only refresh its own `changes`, never the
 *   instance actually feeding App.tsx's rendered Changes panel. loadDoc
 *   sets currentDocPath synchronously but content only after its fetch
 *   resolves — Preview.tsx's compile effect has a specific
 *   settle-window workaround for the resulting double-fire this causes
 *   on file open.
 */
import { useState, useRef, useEffect } from "react";

// notifyFileSaved is passed in rather than obtained from its own
// useGitPR(...) call here — every call to that hook creates an
// independent state instance (React hooks don't share state across call
// sites), so a separate instance's notifyFileSaved only ever refreshes
// *that* instance's own `changes`, never the one actually feeding the
// rendered Changes panel (App.tsx's instance). Saving a file updated
// nothing visible because of exactly this: the notification went to an
// orphaned instance nobody was looking at.
export function useDocEditor(
  login: string | null,
  workspace: string | null,
  notifyFileSaved: () => void,
) {
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [isSyncingImages, setIsSyncingImages] = useState(false);
  const lastSavedContentRef = useRef<string>("");

  const [suppressNextAutosave, setSuppressNextAutosave] = useState(false);
  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  //Auto save state
  useEffect(() => {
    if (!currentDocPath) return;

    // When a new file loads, baseline = loaded content
    lastSavedContentRef.current = content;
  }, [currentDocPath]);

  // save indicator state
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  //
  // LOAD DOCUMENT (LOCAL ONLY)
  //
  function loadDoc(inputPath: string, ws: string) {
    if (!login || !ws) return;
    console.log("loadDoc using workspace =", ws);

    const storedLogin = login || localStorage.getItem("rf_login");

    // Always produce: local-workspace/<workspace>/...
    const canonical = inputPath.startsWith("local-workspace/")
      ? inputPath
      : `local-workspace/${ws}/${inputPath}`;

    setCurrentDocPath(canonical);

    fetch(
      `/api/docs/load?path=${encodeURIComponent(
        canonical,
      )}&login=${encodeURIComponent(storedLogin || "")}&workspace=${encodeURIComponent(
        ws,
      )}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          setContent("");
          setCurrentDocPath("");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setContent(data.content || "");
      })
      .catch(() => {
        setContent("");
        setCurrentDocPath("");
      });
  }

  function normaliseSavePath(path: string, workspace: string) {
    return (
      path

        // Remove ANY leading local-workspace/<workspace>/ prefix
        .replace(new RegExp(`^local-workspace/${workspace}/`), "")

        // Remove ANY leading local-workspace/ prefix
        .replace(/^local-workspace\//, "")

        // Remove ANY duplicated workspace/docs prefix
        .replace(new RegExp(`^${workspace}/docs/`), "")

        // Remove ANY leading workspace/ prefix
        .replace(new RegExp(`^${workspace}/`), "")

        // Normalize versioned docs
        .replace(/^versioned-docs\//, "versioned_docs/")
    );
  }

  //
  // SAVE DOCUMENT
  //
  async function saveDocument(newContent: string) {
    if (!login || !workspace || !currentDocPath) return;

    // ⭐ Skip save if content hasn't changed
    if (newContent === lastSavedContentRef.current) {
      return;
    }

    setSaveState("saving");

    try {
      console.log("Workspace start:", workspace);
      console.log("Path start:", currentDocPath);
      const normalisedPath = normaliseSavePath(currentDocPath, workspace);
      console.log("Normalised Path:", normalisedPath);
      const res = await fetch(
        `/api/docs/save?login=${encodeURIComponent(login)}&workspace=${encodeURIComponent(workspace)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: normalisedPath,
            content: newContent,
          }),
        },
      );

      if (!res.ok) {
        setSaveState("error");
        return;
      }

      // ⭐ Update baseline AFTER successful save
      lastSavedContentRef.current = newContent;
      notifyFileSaved();

      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveState("error");
    }
  }

  //
  // CLONE GITHUB FILE → LOCAL WORKSPACE
  //
  async function handleCloneToLocal(
    refreshLocalWorkspace: () => Promise<void>,
  ) {
    if (!login || !workspace) return;

    const relative = currentDocPath.replace(/^local-workspace\/[^/]+\//, "");

    const res = await fetch(
      `/api/docs/clone-to-local?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relative }),
      },
    );

    const data = await res.json();
    const canonical = data.localPath;

    const folder = relative.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    setSuppressNextAutosave(true);

    //await refreshLocalWorkspace(workspace);
    await refreshLocalWorkspace();

    loadDoc(canonical, workspace);
    setCurrentDocPath(canonical);

    setIsSyncingImages(false);

    return canonical;
  }

  return {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    isSyncingImages,
    setIsSyncingImages,
    editorImageFolder,
    loadDoc,
    handleCloneToLocal,
    suppressNextAutosave,
    setSuppressNextAutosave,
    saveState,
    saveDocument,
  };
}
