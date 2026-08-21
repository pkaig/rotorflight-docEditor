/* frontend/src/components/ConfirmDialog.tsx
 *
 * Description of responsibility:
 *   An in-page replacement for window.confirm() — same yes/no shape, but
 *   rendered entirely within the app's own DOM instead of a native OS
 *   dialog.
 *
 * Info:
 *   The native confirm() this replaces was the actual trigger behind a
 *   real, reproducible bug: closing it left Windows' foreground-lock
 *   state such that the Electron window couldn't reliably reclaim
 *   keyboard focus afterward (not even via BrowserWindow.focus() from
 *   the main process, nor the alwaysOnTop-toggle workaround for that
 *   same lock) — recoverable only by an actual alt-tab away and back. A
 *   dialog that never leaves this window's own DOM has no OS-level focus
 *   handoff to go wrong in the first place, so this sidesteps the bug
 *   entirely rather than trying to recover from it after the fact.
 */
export interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="confirm-dialog-box" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-buttons">
          <button
            className={danger ? "confirm-dialog-danger-btn" : "confirm-dialog-confirm-btn"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
          <button className="confirm-dialog-cancel-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
