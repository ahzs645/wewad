import { DebugTextureCard } from "../TextureCard";

export function DebugTab({
  bannerTextureEntries, iconTextureEntries,
  bannerUsedTextures, iconUsedTextures,
}) {
  return (
    <div className="tab-content active">
      <div className="section-title">Banner Textures</div>
      <div className="debug-texture-stats">
        {bannerTextureEntries.length} total, {bannerTextureEntries.filter((e) => bannerUsedTextures.has(e.name)).length} in use by panes
      </div>
      <div className="textures-grid">
        {bannerTextureEntries.length === 0 ? (
          <div className="empty-state">No banner textures.</div>
        ) : (
          bannerTextureEntries.map((entry) => (
            <DebugTextureCard
              key={entry.key}
              entry={entry}
              isUsed={bannerUsedTextures.has(entry.name)}
            />
          ))
        )}
      </div>

      <div className="section-title icon-title">Icon Textures</div>
      <div className="debug-texture-stats">
        {iconTextureEntries.length} total, {iconTextureEntries.filter((e) => iconUsedTextures.has(e.name)).length} in use by panes
      </div>
      <div className="textures-grid">
        {iconTextureEntries.length === 0 ? (
          <div className="empty-state">No icon textures.</div>
        ) : (
          iconTextureEntries.map((entry) => (
            <DebugTextureCard
              key={entry.key}
              entry={entry}
              isUsed={iconUsedTextures.has(entry.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}
