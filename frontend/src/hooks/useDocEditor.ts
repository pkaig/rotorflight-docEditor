import { useState } from "react";

export function useDocEditor(login: string | null, workspace: string | null) {
  const [content, setContent] = useState("");
  const [currentDocPath, setCurrentDocPath] = useState("");
  const [isSyncingImages, setIsSyncingImages] = useState(false);

  const [suppressNextAutosave, setSuppressNextAutosave] = useState(false);
  const [editorImageFolder, setEditorImageFolder] = useState<string | null>(
    null,
  );

  function clearEditor() {
    setContent("");
    setCurrentDocPath("");
  }

  //
  // LOAD DOCUMENT (LOCAL ONLY)
  //
  function loadDoc(inputPath: string, ws: string) {
    if (!login || !ws) return;
    console.log("loadDoc using workspace =", ws);

    const storedLogin = login || localStorage.getItem("rf_login");

    // Always convert workspace-relative paths into canonical local-workspace paths
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

  //
  // CLONE GITHUB FILE → LOCAL WORKSPACE (backend handles GitHub)
  //
  async function handleCloneToLocal(
    refreshLocalWorkspace: () => Promise<void>,
  ) {
    if (!login || !workspace) return;

    // Convert canonical → workspace-relative
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
    const canonical = data.localPath; // already canonical

    const folder = relative.replace(/[^/]+$/, "") + "img";
    setEditorImageFolder(folder);

    setSuppressNextAutosave(true);

    await refreshLocalWorkspace(workspace);

    loadDoc(canonical);
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
    clearEditor,
    loadDoc,
    handleCloneToLocal,
    suppressNextAutosave,
    setSuppressNextAutosave,
  };
}
