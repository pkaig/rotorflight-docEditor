/* frontend/src/components/PreviewToolbar.tsx
 *
 * Description of responsibility:
 *   The floating toolbox pinned to the top of the preview panel — one
 *   button per WYSIWYG-style insert helper (images, admonitions,
 *   tables). Clicking a button toggles it active and opens a row
 *   beneath the toolbar for that helper's own controls.
 *
 * Info:
 *   Only one top-level tool can be open at a time (clicking the active
 *   one again closes it) — these are meant to be quick, single-purpose
 *   inserts into the doc, not panels you'd want open side by side.
 *   activeTopTool is a controlled prop rather than this component's own
 *   state: App.tsx also closes it on a stray click elsewhere in the
 *   preview once nothing's actively pending (see its own click-outside
 *   effect), which it can only do if it owns the state being closed.
 *   Images, Admonitions, Table, and Tabs all follow the same shape:
 *   Insert always puts the preview into the shared drop-indicator
 *   "click somewhere to pick a position" mode, while Move/Remove
 *   (images) and Modify/Remove (admonitions, table, tabs) put it into a
 *   "click an existing one to pick it" mode instead — all owned in
 *   App.tsx, which needs to listen for those clicks/the drop-indicator
 *   on the preview panel itself.
 */
import imagesIcon from "../assets/toolbar-icons/images.svg";
import imagesIconActive from "../assets/toolbar-icons/images-active.svg";
import admonitionsIcon from "../assets/toolbar-icons/admonitions.svg";
import admonitionsIconActive from "../assets/toolbar-icons/admonitions-active.svg";
import tableIcon from "../assets/toolbar-icons/table.svg";
import tableIconActive from "../assets/toolbar-icons/table-active.svg";
import tabsIcon from "../assets/toolbar-icons/tabs.svg";
import tabsIconActive from "../assets/toolbar-icons/tabs-active.svg";

export type TopToolKey = "images" | "admonitions" | "table" | "tabs";

// Real .svg asset files rendered via <img>, the same way this app's own
// header logo (RFHeli.svg) already renders successfully — both an
// inline <svg> in the DOM and a CSS mask-image on a plain <span>
// reproducibly painted nothing at all in this app's packaged Electron
// build (confirmed via DevTools: every computed style — size, color,
// stroke-width, opacity — read back correct, yet nothing showed up on
// screen), which pointed at some paint/compositing quirk specific to
// those two approaches rather than anything about the icons
// themselves. <img> has no currentColor equivalent, so each icon ships
// as two color variants instead — a plain <img> swap on .active is far
// simpler than trying to recolor a loaded raster/vector image in CSS.
const TOP_TOOLS: {
  key: TopToolKey;
  icon: string;
  iconActive: string;
  title: string;
}[] = [
  { key: "images", icon: imagesIcon, iconActive: imagesIconActive, title: "Images toolbar" },
  { key: "admonitions", icon: admonitionsIcon, iconActive: admonitionsIconActive, title: "Admonitions toolbar" },
  { key: "table", icon: tableIcon, iconActive: tableIconActive, title: "Table toolbar" },
  { key: "tabs", icon: tabsIcon, iconActive: tabsIconActive, title: "Tabs toolbar" },
];

interface PreviewToolbarProps {
  activeTopTool: TopToolKey | null;
  onActiveTopToolChange: (tool: TopToolKey | null) => void;

  imagesMode: "move" | "remove" | null;
  imagesInsertActive: boolean;
  onImagesMove: () => void;
  onImagesRemove: () => void;
  onImagesInsert: () => void;

  admonitionsMode: "modify" | "remove" | null;
  admonitionsInsertActive: boolean;
  onAdmonitionsInsert: () => void;
  onAdmonitionsModify: () => void;
  onAdmonitionsRemove: () => void;

  tableMode: "modify" | "remove" | null;
  tableInsertActive: boolean;
  onTableInsert: () => void;
  onTableModify: () => void;
  onTableRemove: () => void;

  tabsMode: "modify" | "remove" | null;
  tabsInsertActive: boolean;
  onTabsInsert: () => void;
  onTabsModify: () => void;
  onTabsRemove: () => void;
}

export function PreviewToolbar({
  activeTopTool,
  onActiveTopToolChange,
  imagesMode,
  imagesInsertActive,
  onImagesMove,
  onImagesRemove,
  onImagesInsert,
  admonitionsMode,
  admonitionsInsertActive,
  onAdmonitionsInsert,
  onAdmonitionsModify,
  onAdmonitionsRemove,
  tableMode,
  tableInsertActive,
  onTableInsert,
  onTableModify,
  onTableRemove,
  tabsMode,
  tabsInsertActive,
  onTabsInsert,
  onTabsModify,
  onTabsRemove,
}: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar">
      <div className="preview-toolbar-buttons">
        {TOP_TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            className={`preview-toolbar-btn${activeTopTool === tool.key ? " active" : ""}`}
            title={tool.title}
            onClick={() =>
              onActiveTopToolChange(activeTopTool === tool.key ? null : tool.key)
            }
          >
            <img
              src={activeTopTool === tool.key ? tool.iconActive : tool.icon}
              alt=""
              className="preview-toolbar-icon"
            />
          </button>
        ))}
      </div>

      {activeTopTool === "images" && (
        <div className="preview-toolbar-panel preview-toolbar-panel-row">
          <button
            type="button"
            className={`preview-toolbar-subbtn${imagesMode === "move" ? " active" : ""}`}
            title="Click, then click an image in the preview to relocate it"
            onClick={onImagesMove}
          >
            Move
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${imagesInsertActive ? " active" : ""}`}
            title="Click, then click where in the preview to insert an image"
            onClick={onImagesInsert}
          >
            Insert
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${imagesMode === "remove" ? " active" : ""}`}
            title="Click, then click an image in the preview to remove it from this doc"
            onClick={onImagesRemove}
          >
            Remove
          </button>
        </div>
      )}

      {activeTopTool === "admonitions" && (
        <div className="preview-toolbar-panel preview-toolbar-panel-row">
          <button
            type="button"
            className={`preview-toolbar-subbtn${admonitionsInsertActive ? " active" : ""}`}
            title="Click, then click where in the preview to insert an admonition"
            onClick={onAdmonitionsInsert}
          >
            Insert
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${admonitionsMode === "modify" ? " active" : ""}`}
            title="Click, then click an admonition in the preview to edit it"
            onClick={onAdmonitionsModify}
          >
            Modify
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${admonitionsMode === "remove" ? " active" : ""}`}
            title="Click, then click an admonition in the preview to remove it"
            onClick={onAdmonitionsRemove}
          >
            Remove
          </button>
        </div>
      )}

      {activeTopTool === "table" && (
        <div className="preview-toolbar-panel preview-toolbar-panel-row">
          <button
            type="button"
            className={`preview-toolbar-subbtn${tableInsertActive ? " active" : ""}`}
            title="Click, then click where in the preview to insert a table"
            onClick={onTableInsert}
          >
            Insert
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${tableMode === "modify" ? " active" : ""}`}
            title="Click, then click a table in the preview to edit it"
            onClick={onTableModify}
          >
            Modify
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${tableMode === "remove" ? " active" : ""}`}
            title="Click, then click a table in the preview to remove it"
            onClick={onTableRemove}
          >
            Remove
          </button>
        </div>
      )}

      {activeTopTool === "tabs" && (
        <div className="preview-toolbar-panel preview-toolbar-panel-row">
          <button
            type="button"
            className={`preview-toolbar-subbtn${tabsInsertActive ? " active" : ""}`}
            title="Click, then click where in the preview to insert tabs (.mdx only)"
            onClick={onTabsInsert}
          >
            Insert
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${tabsMode === "modify" ? " active" : ""}`}
            title="Click, then click a tabs block in the preview to edit it"
            onClick={onTabsModify}
          >
            Modify
          </button>
          <button
            type="button"
            className={`preview-toolbar-subbtn${tabsMode === "remove" ? " active" : ""}`}
            title="Click, then click a tabs block in the preview to remove it"
            onClick={onTabsRemove}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
