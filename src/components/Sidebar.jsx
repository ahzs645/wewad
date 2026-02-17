import { formatByteSize } from "../utils/formatters";

export function Sidebar({
  fileInputRef,
  isDragOver,
  setIsDragOver,
  isProcessing,
  selectedFileName,
  handleFile,
  recentWads,
  isLoadingRecentId,
  loadRecentWad,
  clearRecentWadsList,
  themePreference,
  setThemePreference,
}) {
  return (
    <aside className="sidebar">
      <header>
        <h1>Wii Channel Banner Renderer</h1>
        <p>Drop a .WAD, .ARC, or .ZIP file to extract and render its channel banner and icon</p>
      </header>

      <div
        className={`drop-zone ${isDragOver ? "dragover" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        <div className="drop-title">
          {isProcessing
            ? `Processing ${selectedFileName || "file"}...`
            : selectedFileName
              ? `Loaded: ${selectedFileName}`
              : "Drop file here"}
        </div>
        <span>or click to browse</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".wad,.arc,.zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
      </div>

      {recentWads.length > 0 ? (
        <div className="recent-wads">
          <div className="recent-wads-header">
            <div className="recent-wads-title">Recent WADs</div>
            <button
              className="clear-recent-button"
              onClick={() => void clearRecentWadsList()}
              type="button"
              disabled={isProcessing || Boolean(isLoadingRecentId)}
            >
              Clear
            </button>
          </div>
          <div className="recent-wads-list">
            {recentWads.map((entry) => {
              const isLoadingThis = isLoadingRecentId === entry.id;
              return (
                <button
                  className="recent-wad-item"
                  key={entry.id}
                  onClick={() => void loadRecentWad(entry.id)}
                  type="button"
                  disabled={isProcessing || isLoadingThis}
                >
                  <span className="recent-wad-preview" aria-hidden="true">
                    {entry.iconPreviewUrl ? (
                      <img src={entry.iconPreviewUrl} alt="" />
                    ) : (
                      <span className="recent-wad-preview-empty">No preview</span>
                    )}
                  </span>
                  <span className="recent-wad-info">
                    <span className="recent-wad-name">
                      {isLoadingThis ? `Loading ${entry.name}...` : entry.name}
                    </span>
                    <span className="recent-wad-meta">
                      {formatByteSize(entry.size)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="sidebar-footer">
        <button
          className="theme-toggle"
          onClick={() =>
            setThemePreference((prev) =>
              prev === "system" ? "light" : prev === "light" ? "dark" : "system",
            )
          }
          type="button"
          title={`Theme: ${themePreference}`}
        >
          {themePreference === "light" ? "\u2600" : themePreference === "dark" ? "\u263E" : "\u25D1"}
          <span className="theme-label">
            {themePreference === "system" ? "Auto" : themePreference === "light" ? "Light" : "Dark"}
          </span>
        </button>
      </div>
    </aside>
  );
}
