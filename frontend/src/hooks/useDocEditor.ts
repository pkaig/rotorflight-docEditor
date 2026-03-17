const docEditorDebug = true;

import { useState } from "react";
import { isLocalPath, normaliseLocalPath } from "../utils/paths";

export function useDocEditor(login: string | null) {
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingGitHubPath, setPendingGitHubPath] = useState("");
  const [isSyncingImages, setIsSyncingImages] = useState(false);
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

    // GitHub docs MUST NOT be normalised
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
    if (docEditorDebug) {
      console.debug("Loading doc:", { inputPath, canonical, isGitHubSource });
    }
    //localStorage.setItem("rf_last_opened_doc", canonical);

    fetch(
      `http://localhost:4000/api/docs/load?path=${encodeURIComponent(
        canonical,
      )}&login=${encodeURIComponent(storedLogin || "")}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          console.warn("⚠️ loadDoc failed:", canonical, res.status);

          if (res.status === 404) {
            if (docEditorDebug) {
              console.debug("Loading doc 404:", {
                inputPath,
                canonical,
                isGitHubSource,
              });
            }
            // const last = localStorage.getItem("rf_last_opened_doc");
            // if (last === canonical) {
            //   localStorage.removeItem("rf_last_opened_doc");
            // }
          }

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

    // Backend returns local-workspace/docs/... already correct
    const canonical = normaliseLocalPath(data.localPath);

    const relative = canonical.replace(/^local-workspace\//, "");
    const folder = relative.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    await refreshLocalWorkspace();

    loadDoc(canonical);
    setCurrentDocPath(canonical);

    setIsSyncingImages(false);
    setShowEditModal(false);
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
  };
}
