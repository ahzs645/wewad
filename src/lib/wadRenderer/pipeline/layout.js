import { withLogger } from "../shared/index";

function clonePane(pane) {
  return {
    ...pane,
    translate: pane.translate ? { ...pane.translate } : { x: 0, y: 0, z: 0 },
    rotate: pane.rotate ? { ...pane.rotate } : { x: 0, y: 0, z: 0 },
    scale: pane.scale ? { ...pane.scale } : { x: 1, y: 1 },
    size: pane.size ? { ...pane.size } : { w: 0, h: 0 },
    texCoords: pane.texCoords ? pane.texCoords.map((coords) => ({ ...coords })) : undefined,
  };
}

export function createRenderableLayout(layout, tplImages, fallbackWidth, fallbackHeight, loggerInput) {
  const logger = withLogger(loggerInput);

  const renderLayout = layout
    ? {
        ...layout,
        width: layout.width || fallbackWidth,
        height: layout.height || fallbackHeight,
        textures: [...layout.textures],
        materials: [...layout.materials],
        panes: layout.panes.map((pane) => clonePane(pane)),
      }
    : {
        textures: [],
        materials: [],
        panes: [],
        groups: [],
        width: fallbackWidth,
        height: fallbackHeight,
      };

  const hasPicturePanes = renderLayout.panes.some(
    (pane) => pane.type === "pic1" || pane.type === "bnd1" || pane.type === "wnd1",
  );
  if (!hasPicturePanes) {
    logger.warn("No pic1 panes found, creating synthetic layout from textures");

    const textureNames = Object.keys(tplImages);
    for (let i = 0; i < textureNames.length; i += 1) {
      const textureName = textureNames[i];
      const images = tplImages[textureName];
      if (!images || images.length === 0) {
        continue;
      }

      const firstImage = images[0];
      renderLayout.panes.push({
        type: "pic1",
        name: `Picture_${String(i).padStart(2, "0")}`,
        flags: 0x01,
        origin: 4,
        alpha: 255,
        visible: true,
        parent: null,
        translate: { x: 0, y: 0, z: 0 },
        rotate: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        size: { w: firstImage.width, h: firstImage.height },
        materialIndex: i,
      });

      if (!renderLayout.textures.includes(textureName)) {
        renderLayout.textures.push(textureName);
      }
    }
  }

  return renderLayout;
}
