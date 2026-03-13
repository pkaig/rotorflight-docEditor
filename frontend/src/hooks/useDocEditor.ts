import { useState } from "react";
import { isLocalPath } from "../utils/paths";

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

    let normalized: string;

    if (inputPath.startsWith("local-workspace/")) {
      if (inputPath.startsWith("local-workspace/versioned_docs/")) {
        normalized = inputPath.replace(/^local-workspace\//, "");
      } else {
        normalized = inputPath.replace(/^local-workspace\//, "docs/");
      }
    } else if (inputPath.startsWith("Rotorflight-docs/")) {
      normalized = inputPath;
    } else if (inputPath.startsWith("docs/")) {
      normalized = "Rotorflight-docs/" + inputPath;
    } else {
      console.warn("⚠️ Unknown path format, passing through:", inputPath);
      normalized = inputPath;
    }

    if (normalized.startsWith("Rotorflight-docs/")) {
      setShowEditModal(true);
      setPendingGitHubPath(normalized);
    } else {
      setShowEditModal(false);
    }

    setCurrentDocPath(normalized);

    if (normalized.startsWith("local-workspace/")) {
      localStorage.setItem("rf_last_opened_doc", normalized);
    }

    fetch(
      `http://localhost:4000/api/docs/load?path=${encodeURIComponent(
        normalized,
      )}&login=${encodeURIComponent(storedLogin || "")}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          console.warn("⚠️ loadDoc failed:", normalized, res.status);

          if (res.status === 404) {
            const last = localStorage.getItem("rf_last_opened_doc");
            if (last === normalized) {
              localStorage.removeItem("rf_last_opened_doc");
            }
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

    const clean = pendingGitHubPath.replace(/^Rotorflight-docs\//, "");
    const folder = clean.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    loadDoc(data.localPath);
    setCurrentDocPath(data.localPath);

    await refreshLocalWorkspace();

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
