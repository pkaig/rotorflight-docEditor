// VersionModals.tsx

export function MaintenanceModal({ message }) {
  return (
    <div style={modalBackdrop}>
      <div style={modalBox}>
        <h2 style={modalTitle}>Maintenance Mode</h2>
        <p style={modalMessage}>{message}</p>

        <button style={primaryButton} onClick={() => window.location.reload()}>
          Close
        </button>
      </div>
    </div>
  );
}

export function ForceUpdateModal({ message, current, latest, downloadUrl }) {
  return (
    <div style={modalBackdrop}>
      <div style={modalBox}>
        <h2 style={modalTitle}>Update Required</h2>

        <p style={modalMessage}>{message}</p>

        <div style={{ marginBottom: "1rem", marginLeft: "0.5rem" }}>
          <p>
            <strong>Your version:</strong> {current}
          </p>
          <p>
            <strong>Latest version:</strong> {latest}
          </p>
        </div>

        <div style={{ display: "flex", gap: "1rem" }}>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={primaryButton}
          >
            Download Update
          </a>
        </div>
      </div>
    </div>
  );
}

export function UpdateAvailableModal({
  message,
  latest,
  current,
  downloadUrl,
  onContinue,
}) {
  return (
    <div style={modalBackdrop}>
      <div style={modalBox}>
        <h2 style={modalTitle}>Update Available</h2>

        <p style={modalMessage}>{message}</p>
        <p>
          <strong>Your version:</strong> {current}
        </p>
        <p style={{ marginLeft: "0.5rem" }}>
          <strong>Latest version:</strong> {latest}
        </p>

        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={primaryButton}
          >
            Download Update
          </a>

          <button style={secondaryButton} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateBanner({ message, latest }) {
  return (
    <div style={bannerStyle}>
      <strong>Update available:</strong> {message} (v{latest})
    </div>
  );
}

/* -----------------------------
   SHARED STYLES
----------------------------- */

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  justifyContent: "flex-start",
  alignItems: "center",
  paddingLeft: "3rem", // left margin
  zIndex: 9999,
};

const modalBox = {
  background: "white",
  padding: "2rem",
  borderRadius: "8px",
  width: "420px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  border: "1px solid #ddd",
};

const modalTitle = {
  marginTop: 0,
  marginBottom: "1rem",
  fontSize: "1.4rem",
};

const modalMessage = {
  marginBottom: "1rem",
  lineHeight: 1.4,
};

const primaryButton = {
  padding: "0.6rem 1.2rem",
  background: "#007bff",
  color: "white",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

const secondaryButton = {
  padding: "0.6rem 1.2rem",
  background: "#e0e0e0",
  color: "#333",
  border: "1px solid #ccc",
  borderRadius: "4px",
  cursor: "pointer",
};

const bannerStyle = {
  background: "#fff3cd",
  borderBottom: "1px solid #ffeeba",
  padding: "0.75rem 1rem",
  color: "#856404",
  fontSize: "0.95rem",
};
