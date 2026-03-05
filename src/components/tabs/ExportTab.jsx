import { TITLE_LOCALE_LABELS } from "../../constants";
import { normalizeDomId } from "../../utils/misc";

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
  tevQuality, setTevQuality,
  bannerAnimOverride, setBannerAnimOverride,
  bannerDiscType, setBannerDiscType, showDiscTypeOption,
  iconAnimOverride, setIconAnimOverride,
  titleLocale, setTitleLocale, availableTitleLocales,
  bannerPaneStateGroups, bannerPaneStateSelections, setBannerPaneStateSelections,
  iconPaneStateGroups, iconPaneStateSelections, setIconPaneStateSelections,
}) {
  const bannerAnimEntries = parsed?.results?.banner?.animEntries ?? [];
  const iconAnimEntries = parsed?.results?.icon?.animEntries ?? [];
  const hasStateSettings = bannerAnimEntries.length > 2 || iconAnimEntries.length > 1
    || showDiscTypeOption || (availableTitleLocales?.length ?? 0) > 1
    || bannerPaneStateGroups?.length > 0 || iconPaneStateGroups?.length > 0;
  return (
    <div className="tab-content active">
      <div className="section-title">Export Bundle</div>
      <div className="export-panel">
        <div className="export-options">
          <div className="export-actions">
            <button
              className="primary"
              onClick={handleExportGsap}
              disabled={isExporting || !parsed}
              type="button"
              title="Export renderer data bundle — contains layout, textures, animations, and fonts needed to replay this animation in another project using BannerRenderer + GSAP"
            >
              {isExporting ? "Exporting..." : "Export Renderer Bundle"}
            </button>
            <button
              onClick={() => handleExportBundle(false)}
              disabled={isExporting || !parsed}
              type="button"
            >
              {isExporting ? "Exporting..." : "Export Snapshots (.zip)"}
            </button>
            <button
              onClick={() => handleExportBundle(true)}
              disabled={isExporting || !parsed}
              type="button"
              title="Includes all animation frames as PNGs — requires selecting an aspect ratio"
            >
              {isExporting ? "Exporting..." : "Export with All Frames"}
            </button>
            {exportProgress && <span className="export-progress">{exportProgress}</span>}
          </div>
          <div className="export-option-row">
            <label htmlFor="export-aspect">Frame Render Aspect</label>
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
              Only applies to snapshot/frame exports. Renderer bundle uses native resolution (aspect set at runtime).
            </span>
          </div>
          {hasStateSettings && (
            <div className="export-state-settings">
              <div className="export-settings-label">Channel Settings</div>
              <div className="state-settings">
                <div className="state-control">
                  <label htmlFor="export-tev-quality">TEV Quality</label>
                  <select
                    id="export-tev-quality"
                    value={tevQuality}
                    onChange={(event) => setTevQuality(event.target.value)}
                  >
                    <option value="fast">Fast</option>
                    <option value="accurate">Accurate</option>
                  </select>
                </div>
                {bannerAnimEntries.length > 2 && (
                  <div className="state-control">
                    <label htmlFor="export-banner-anim">Animation</label>
                    <select
                      id="export-banner-anim"
                      value={bannerAnimOverride ?? "auto"}
                      onChange={(event) => setBannerAnimOverride(event.target.value === "auto" ? null : event.target.value)}
                    >
                      <option value="auto">Auto</option>
                      {bannerAnimEntries.map((entry) => {
                        const fileName = entry.path.split("/").pop().replace(/\.[^.]+$/, "");
                        const loopLabel = (entry.anim?.flags & 1) ? "loop" : "once";
                        return (
                          <option key={entry.id} value={entry.id}>
                            {fileName} ({entry.frameSize}f, {loopLabel})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
                {showDiscTypeOption && (
                  <div className="state-control">
                    <label htmlFor="export-banner-disc-type">Disc Type</label>
                    <select
                      id="export-banner-disc-type"
                      value={bannerDiscType}
                      onChange={(event) => setBannerDiscType(event.target.value)}
                    >
                      <option value="auto">Auto</option>
                      <option value="all">All</option>
                      <option value="none">None</option>
                      <option value="wii">Wii Disc</option>
                      <option value="gc">GameCube Disc</option>
                      <option value="dvd">DVD</option>
                    </select>
                  </div>
                )}
                {bannerPaneStateGroups.map((group) => {
                  const controlId = `export-banner-pane-state-${normalizeDomId(group.id)}`;
                  const parsedValue = Number.parseInt(String(bannerPaneStateSelections[group.id]), 10);
                  const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
                  return (
                    <div className="state-control" key={`export-banner-pane-group-${group.id}`}>
                      <label htmlFor={controlId}>Banner {group.label}</label>
                      <select
                        id={controlId}
                        value={value}
                        onChange={(event) => {
                          const next = event.target.value === "auto"
                            ? null
                            : Number.parseInt(event.target.value, 10);
                          setBannerPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                        }}
                      >
                        <option value="auto">Auto</option>
                        {group.options.map((option) => (
                          <option key={`${group.id}-${option.index}`} value={String(option.index)}>
                            {option.paneName}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {iconAnimEntries.length > 1 && (
                  <div className="state-control">
                    <label htmlFor="export-icon-anim">Icon Animation</label>
                    <select
                      id="export-icon-anim"
                      value={iconAnimOverride ?? "auto"}
                      onChange={(event) => setIconAnimOverride(event.target.value === "auto" ? null : event.target.value)}
                    >
                      <option value="auto">Auto</option>
                      {iconAnimEntries.map((entry) => {
                        const fileName = entry.path.split("/").pop().replace(/\.[^.]+$/, "");
                        const loopLabel = (entry.anim?.flags & 1) ? "loop" : "once";
                        return (
                          <option key={entry.id} value={entry.id}>
                            {fileName} ({entry.frameSize}f, {loopLabel})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
                {iconPaneStateGroups.map((group) => {
                  const controlId = `export-icon-pane-state-${normalizeDomId(group.id)}`;
                  const parsedValue = Number.parseInt(String(iconPaneStateSelections[group.id]), 10);
                  const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
                  return (
                    <div className="state-control" key={`export-icon-pane-group-${group.id}`}>
                      <label htmlFor={controlId}>Icon {group.label}</label>
                      <select
                        id={controlId}
                        value={value}
                        onChange={(event) => {
                          const next = event.target.value === "auto"
                            ? null
                            : Number.parseInt(event.target.value, 10);
                          setIconPaneStateSelections((previous) => ({ ...previous, [group.id]: next }));
                        }}
                      >
                        <option value="auto">Auto</option>
                        {group.options.map((option) => (
                          <option key={`${group.id}-${option.index}`} value={String(option.index)}>
                            {option.paneName}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
                {(availableTitleLocales?.length ?? 0) > 1 && (
                  <div className="state-control">
                    <label htmlFor="export-title-locale">Locale</label>
                    <select
                      id="export-title-locale"
                      value={titleLocale}
                      onChange={(event) => setTitleLocale(event.target.value)}
                    >
                      <option value="auto">Auto</option>
                      {availableTitleLocales.map((localeCode) => (
                        <option key={localeCode} value={localeCode}>
                          {TITLE_LOCALE_LABELS[localeCode] ?? localeCode}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}
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
