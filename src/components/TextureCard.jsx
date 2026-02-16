import { useRef, useEffect } from "react";
import { TPL_FORMATS } from "../lib/wadRenderer";

export function TextureCard({ entry }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = entry.image.width;
    canvas.height = entry.image.height;

    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(entry.image.imageData, entry.image.width, entry.image.height), 0, 0);
  }, [entry]);

  return (
    <div className="texture-card">
      <canvas ref={canvasRef} />
      <div className="name">{entry.name}</div>
      <div className="dims">
        {entry.image.width}x{entry.image.height} {TPL_FORMATS[entry.image.format] ?? "?"}
      </div>
    </div>
  );
}

export function DebugTextureCard({ entry, isUsed }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = entry.image.width;
    canvas.height = entry.image.height;
    const context = canvas.getContext("2d");
    context.putImageData(new ImageData(entry.image.imageData, entry.image.width, entry.image.height), 0, 0);
  }, [entry]);

  return (
    <div className={`texture-card debug-texture-card ${isUsed ? "in-use" : "unused"}`}>
      <canvas ref={canvasRef} />
      <div className="name">{entry.name}</div>
      <div className="dims">
        {entry.image.width}x{entry.image.height} {TPL_FORMATS[entry.image.format] ?? "?"}
      </div>
      <div className={`debug-usage-badge ${isUsed ? "used" : "not-used"}`}>
        {isUsed ? "IN USE" : "UNUSED"}
      </div>
    </div>
  );
}
