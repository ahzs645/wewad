import { TextureCard } from "../TextureCard";

export function TexturesTab({ bannerTextureEntries, iconTextureEntries }) {
  return (
    <div className="tab-content active">
      <div className="section-title">Banner Textures</div>
      <div className="textures-grid">
        {bannerTextureEntries.length === 0 ? (
          <div className="empty-state">No banner textures decoded.</div>
        ) : (
          bannerTextureEntries.map((entry) => <TextureCard key={entry.key} entry={entry} />)
        )}
      </div>

      <div className="section-title icon-title">Icon Textures</div>
      <div className="textures-grid">
        {iconTextureEntries.length === 0 ? (
          <div className="empty-state">No icon textures decoded.</div>
        ) : (
          iconTextureEntries.map((entry) => <TextureCard key={entry.key} entry={entry} />)
        )}
      </div>
    </div>
  );
}
