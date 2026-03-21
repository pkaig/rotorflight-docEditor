const docEditorDebug = false;

import { useState } from "react";
import { isLocalPath, normaliseLocalPath } from "../utils/paths";

export function useDocEditor(login: string | null) {
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingGitHubPath, setPendingGitHubPath] = useState("");
  const [isSyncingImages, setIsSyncingImages] = useState(false);

  // 🔥 Autosave suppression lives here
  const [suppressNextAutosave, setSuppressNextAutosave] = useState(false);

  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  function clearEditor() {
    setContent("");
    setCurrentDocPath("");
    setShowEditModal(false);
  }

  function loadDoc(inputPath: string) {
    const storedLogin = login || localStorage.getItem("rf_login");

    let canonical: string;
    if (inputPath.startsWith("Rotorflight-docs/")) {
      canonical = inputPath;
    } else {
      canonical = normaliseLocalPath(inputPath);
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
      `http://localhost:4000/api/docs/load?path=${encodeURIComponent(
        canonical,
      )}&login=${encodeURIComponent(storedLogin || "")}`,
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

  // 🔥 FIX: accept refreshLocalWorkspace as a parameter
  async function handleCloneToLocal(
    refreshLocalWorkspace: () => Promise<void>,
  ) {
    setShowEditModal(false);

    const res = await fetch(
      `http://localhost:4000/api/docs/clone-to-local?login=${encodeURIComponent(
        login || "",
      )}`,
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

    // 🔥 Skip autosave for the next load
    setSuppressNextAutosave(true);

    await refreshLocalWorkspace();

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

    // 🔥 MUST be returned so App.tsx can use them
    suppressNextAutosave,
    setSuppressNextAutosave,
  };
}
