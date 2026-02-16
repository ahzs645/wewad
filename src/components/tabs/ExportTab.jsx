export function ExportTab({
  exportAspect, setExportAspect,
  isExporting, exportProgress,
  parsed,
  handleExportBundle,
  handleExportGsap,
  bundleFileInputRef,
  handleLoadBundleZip,
  bundlePreview,
  bundlePreviewSection, setBundlePreviewSection,
}) {
  return (
    <div className="tab-content active">
      <div className="section-title">Export Bundle</div>
      <div className="export-panel">
        <div className="export-options">
          <div className="export-option-row">
            <label htmlFor="export-aspect">Frame Aspect Ratio</label>
            <select
              id="export-aspect"
              value={exportAspect}
              onChange={(event) => setExportAspect(event.target.value)}
            >
              <option value="4:3">4:3 (Wii Standard)</option>
              <option value="16:9">16:9 (Wii Widescreen)</option>
              <option value="16:10">16:10</option>
            </select>
            <span className="export-option-hint">
              Snapshots always include both 4:3 and 16:9. This controls animation frame renders.
            </span>
          </div>
          <div className="export-actions">
            <button
              className="primary"
              onClick={() => handleExportBundle(false)}
              disabled={isExporting || !parsed}
              type="button"
            >
              {isExporting ? "Exporting..." : "Export Bundle (.zip)"}
            </button>
            <button
              onClick={() => handleExportBundle(true)}
              disabled={isExporting || !parsed}
              type="button"
              title="Includes all animation frames as PNGs (may be slow for long animations)"
            >
              {isExporting ? "Exporting..." : "Export with All Frames"}
            </button>
            <button
              onClick={handleExportGsap}
              disabled={isExporting || !parsed}
              type="button"
              title="Export as GSAP animation bundle with individual layers, timeline JSON, and a self-contained HTML player"
            >
              {isExporting ? "Exporting..." : "Export GSAP Animation"}
            </button>
            {exportProgress && <span className="export-progress">{exportProgress}</span>}
          </div>
        </div>

        <div className="export-preview-section">
          <div className="section-title">
            Bundle Preview
            <button
              className="export-load-zip-btn"
              onClick={() => bundleFileInputRef.current?.click()}
              type="button"
            >
              Load .zip
            </button>
            <input
              ref={bundleFileInputRef}
              type="file"
              accept=".zip"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLoadBundleZip(file);
                event.target.value = "";
              }}
            />
          </div>

          {bundlePreview ? (
            <>
              <div className="bundle-nav">
                {["snapshots", "textures", "manifest", "files"].map((section) => (
                  <button
                    key={section}
                    type="button"
                    className={`bundle-nav-btn ${bundlePreviewSection === section ? "active" : ""}`}
                    onClick={() => setBundlePreviewSection(section)}
                  >
                    {section === "snapshots" ? "Snapshots" : section === "textures" ? "Textures" : section === "manifest" ? "Manifest" : "All Files"}
                  </button>
                ))}
              </div>

              {bundlePreviewSection === "snapshots" && (
                <div className="bundle-snapshots">
                  {["banner-4x3.png", "banner-16x9.png", "icon-4x3.png", "icon-16x9.png", "banner.png", "icon.png"].map((name) => {
                    const url = bundlePreview.urls[name];
                    if (!url) return null;
                    return (
                      <div key={name} className="bundle-snapshot-card">
                        <img src={url} alt={name} />
                        <div className="bundle-snapshot-label">{name}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {bundlePreviewSection === "textures" && (
                <div className="bundle-textures">
                  {bundlePreview.entries
                    .filter((e) => e.isImage && e.path.startsWith("textures/"))
                    .map((e) => (
                      <div key={e.path} className="bundle-texture-card">
                        <img src={e.url} alt={e.path} />
                        <div className="bundle-texture-label">
                          {e.path.replace("textures/", "")}
                        </div>
                      </div>
                    ))}
                  {bundlePreview.entries.filter((e) => e.isImage && e.path.startsWith("textures/")).length === 0 && (
                    <div className="empty-state">No textures in this bundle.</div>
                  )}
                </div>
              )}

              {bundlePreviewSection === "manifest" && (
                <pre className="info-panel info-pre bundle-manifest">
                  {bundlePreview.manifest
                    ? JSON.stringify(bundlePreview.manifest, null, 2)
                    : "No manifest.json found in bundle."}
                </pre>
              )}

              {bundlePreviewSection === "files" && (
                <div className="bundle-file-list">
                  <table>
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Size</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundlePreview.entries.map((e) => (
                        <tr key={e.path}>
                          <td className="bundle-file-path">{e.path}</td>
                          <td className="bundle-file-size">
                            {e.size < 1024
                              ? `${e.size} B`
                              : e.size < 1024 * 1024
                                ? `${(e.size / 1024).toFixed(1)} KB`
                                : `${(e.size / (1024 * 1024)).toFixed(1)} MB`}
                          </td>
                          <td className="bundle-file-type">
                            {e.isImage ? "Image" : e.isAudio ? "Audio" : e.isJson ? "JSON" : "Binary"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bundle-file-summary">
                    {bundlePreview.entries.length} files
                  </div>
                </div>
              )}

              {bundlePreview.entries.some((e) => e.isAudio) && (
                <div className="bundle-audio">
                  <div className="section-title">Audio</div>
                  {bundlePreview.entries.filter((e) => e.isAudio).map((e) => (
                    <audio key={e.path} controls src={e.url}>
                      {e.path}
                    </audio>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              Export a bundle or load an existing .zip to preview its contents.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
