const docEditorDebug = false;

import { useState } from "react";
import { isLocalPath, normaliseLocalPath } from "../utils/paths";

export function useDocEditor(login: string | null, workspace: string | null) {
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingGitHubPath, setPendingGitHubPath] = useState("");
  const [isSyncingImages, setIsSyncingImages] = useState(false);

  // Autosave suppression
  const [suppressNextAutosave, setSuppressNextAutosave] = useState(false);

  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  function clearEditor() {
    setContent("");
    setCurrentDocPath("");
    setShowEditModal(false);
  }

  //
  // LOAD DOCUMENT
  //
  function loadDoc(inputPath: string) {
    if (!login || !workspace) return;

    const storedLogin = login || localStorage.getItem("rf_login");

    let canonical: string;

    // GitHub files
    if (inputPath.startsWith("Rotorflight-docs/")) {
      canonical = inputPath;
    }

    // Local workspace files
    else if (inputPath.startsWith("local-workspace/")) {
      canonical = inputPath;
    }

    // Bare paths like "docs/index.md"
    else {
      canonical = `local-workspace/${workspace}/${inputPath}`;
    }

    const isGitHubSource = canonical.startsWith("Rotorflight-docs/");

    if (isGitHubSource) {
      setShowEditModal(true);
      setPendingGitHubPath(inputPath);
    } else {
      setShowEditModal(false);
    }

    setCurrentDocPath(canonical);

    fetch(
      `/api/docs/load?path=${encodeURIComponent(
        canonical,
      )}&login=${encodeURIComponent(storedLogin || "")}&workspace=${encodeURIComponent(
        workspace,
      )}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          setContent("");
          setCurrentDocPath("");
          setShowEditModal(false);
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
        setShowEditModal(false);
      });
  }

  //
  // CLONE GITHUB FILE → LOCAL WORKSPACE
  //
  async function handleCloneToLocal(
    refreshLocalWorkspace: () => Promise<void>,
  ) {
    if (!login || !workspace) return;

    setShowEditModal(false);

    const res = await fetch(
      `/api/docs/clone-to-local?login=${encodeURIComponent(
        login,
      )}&workspace=${encodeURIComponent(workspace)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pendingGitHubPath }),
      },
    );

    const data = await res.json();
    const canonical = normaliseLocalPath(data.localPath);

    const relative = canonical.replace(/^local-workspace\//, "");
    const folder = relative.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    // Skip autosave for the next load
    setSuppressNextAutosave(true);

    await refreshLocalWorkspace(workspace);

    loadDoc(canonical);
    setCurrentDocPath(canonical);

    setIsSyncingImages(false);
    setShowEditModal(false);

    return canonical;
  }

  function isCurrentLocal() {
    return isLocalPath(currentDocPath);
  }

  return {
    content,
    setContent,
    currentDocPath,
    setCurrentDocPath,
    showEditModal,
    setShowEditModal,
    pendingGitHubPath,
    isSyncingImages,
    setIsSyncingImages,
    editorImageFolder,
    clearEditor,
    loadDoc,
    handleCloneToLocal,
    isCurrentLocal,

    suppressNextAutosave,
    setSuppressNextAutosave,
  };
}
