import "./UpdatePrompt.css";

function UpdatePrompt({ isUpdateAvailable, onReload }) {
  if (!isUpdateAvailable) return null;

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <button type="button" onClick={onReload}>
        New version available - Reload
      </button>
    </div>
  );
}

export default UpdatePrompt;
