import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BannerRenderer,
  TPL_FORMATS,
  flattenTextures,
  processWAD,
} from "./lib/wadRenderer";

function createArrayLogger(storage) {
  return {
    clear() {
      storage.length = 0;
    },
    info(message) {
      storage.push({ level: "info", message });
    },
    warn(message) {
      storage.push({ level: "warn", message });
    },
    error(message) {
      storage.push({ level: "error", message });
    },
    success(message) {
      storage.push({ level: "success", message });
    },
  };
}

function formatLayoutInfo(layout) {
  if (!layout) {
    return "No layout data parsed yet.";
  }

  const lines = [];
  lines.push(`Layout size: ${layout.width}x${layout.height}`);
  lines.push(`Textures: ${layout.textures.join(", ") || "none"}`);
  lines.push(`Materials: ${layout.materials.map((material) => material.name).join(", ") || "none"}`);
  lines.push("");

  for (const pane of layout.panes) {
    const parts = [
      `[${pane.type}] ${pane.name}`,
      `pos(${pane.translate.x.toFixed(1)}, ${pane.translate.y.toFixed(1)})`,
      `scale(${pane.scale.x.toFixed(2)}, ${pane.scale.y.toFixed(2)})`,
      `size(${pane.size.w.toFixed(0)}x${pane.size.h.toFixed(0)})`,
    ];

    if (pane.materialIndex >= 0) {
      parts.push(`mat=${pane.materialIndex}`);
    }

    lines.push(parts.join(" "));
  }

  return lines.join("\n");
}

function formatAnimationInfo(animation) {
  if (!animation) {
    return "No animation data parsed yet.";
  }

  const lines = [`Frame count: ${animation.frameSize}`, ""];

  for (const pane of animation.panes) {
    lines.push(`Pane: ${pane.name}`);
    for (const tag of pane.tags) {
      lines.push(`  Tag: ${tag.type}`);
      for (const entry of tag.entries) {
        const values = entry.keyframes
          .map((keyframe) => `f${keyframe.frame.toFixed(0)}->${keyframe.value.toFixed(2)}`)
          .join(", ");
        lines.push(`    ${entry.typeName}: ${values}`);
      }
    }
  }

  return lines.join("\n");
}

function TextureCard({ entry }) {
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

const TABS = [
  { id: "preview", label: "Preview" },
  { id: "textures", label: "Textures" },
  { id: "layout", label: "Layout Info" },
  { id: "log", label: "Parse Log" },
];

function clampFrame(value, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max, Math.round(value)));
}

function findAlphaRevealFrame(animation, paneNamePattern = null) {
  if (!animation?.panes?.length) {
    return null;
  }

  const revealFrames = [];
  for (const pane of animation.panes) {
    if (paneNamePattern && !paneNamePattern.test(pane.name)) {
      continue;
    }

    for (const tag of pane.tags ?? []) {
      for (const entry of tag.entries ?? []) {
        if (entry.type !== 0x0a && entry.type !== 0x10) {
          continue;
        }

        for (const keyframe of entry.keyframes ?? []) {
          if (Number.isFinite(keyframe.frame) && Number.isFinite(keyframe.value) && keyframe.value >= 200) {
            revealFrames.push(keyframe.frame);
            break;
          }
        }
      }
    }
  }

  if (revealFrames.length === 0) {
    return null;
  }
  return Math.min(...revealFrames);
}

function suggestInitialFrame(result) {
  const startAnim = result?.results?.banner?.animStart;
  if (!startAnim) {
    return 0;
  }

  const maxFrame = Math.max(0, (startAnim.frameSize ?? 1) - 1);
  const titleReveal = findAlphaRevealFrame(startAnim, /^N_title/i);
  if (titleReveal != null) {
    return clampFrame(titleReveal, maxFrame);
  }

  const anyReveal = findAlphaRevealFrame(startAnim);
  if (anyReveal != null) {
    return clampFrame(anyReveal, maxFrame);
  }

  return 0;
}

export default function App() {
  const fileInputRef = useRef(null);
  const bannerCanvasRef = useRef(null);
  const iconCanvasRef = useRef(null);
  const bannerRendererRef = useRef(null);
  const iconRendererRef = useRef(null);

  const [activeTab, setActiveTab] = useState("preview");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animStatus, setAnimStatus] = useState("Frame 0");
  const [startFrame, setStartFrame] = useState(0);
  const [startFrameInput, setStartFrameInput] = useState("0");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [logEntries, setLogEntries] = useState([]);

  const maxStartFrame = useMemo(() => {
    if (!parsed) {
      return 959;
    }
    const bannerStartFrames = parsed?.results.banner?.animStart?.frameSize ?? 0;
    const bannerFrames = parsed?.results.banner?.anim?.frameSize ?? 0;
    const iconFrames = parsed?.results.icon?.anim?.frameSize ?? 0;
    if (bannerStartFrames > 0) {
      return Math.max(1, bannerStartFrames) - 1;
    }
    return Math.max(1, bannerFrames, iconFrames) - 1;
  }, [parsed]);

  const normalizeStartFrame = useCallback(
    (rawValue) => {
      const parsedValue = Number.parseInt(String(rawValue), 10);
      if (!Number.isFinite(parsedValue)) {
        return 0;
      }
      return Math.max(0, Math.min(maxStartFrame, parsedValue));
    },
    [maxStartFrame],
  );

  const stopRenderers = useCallback(() => {
    bannerRendererRef.current?.dispose();
    iconRendererRef.current?.dispose();
    bannerRendererRef.current = null;
    iconRendererRef.current = null;
  }, []);

  const handleFile = useCallback(
    async (file) => {
      if (!file) {
        return;
      }

      setSelectedFileName(file.name);
      setIsProcessing(true);
      setIsPlaying(false);
      setAnimStatus("Frame 0");
      setActiveTab("preview");

      stopRenderers();

      const logs = [];
      const logger = createArrayLogger(logs);
      logger.info(`Loading ${file.name}`);

      try {
        const buffer = await file.arrayBuffer();
        const result = await processWAD(buffer, logger);

        if (!result.results.banner && !result.results.icon) {
          logger.warn("No banner or icon content could be rendered.");
        }

        const suggestedFrame = suggestInitialFrame(result);
        setStartFrame(suggestedFrame);
        setStartFrameInput(String(suggestedFrame));
        setAnimStatus(`Frame ${suggestedFrame}`);
        setParsed(result);
      } catch (error) {
        logger.error(`Fatal: ${error.message}`);
        setParsed(null);
      } finally {
        setLogEntries(logs);
        setIsProcessing(false);
      }
    },
    [stopRenderers],
  );

  useEffect(() => {
    stopRenderers();
    setIsPlaying(false);

    if (!parsed || activeTab !== "preview") {
      return () => {
        stopRenderers();
      };
    }

    const bannerResult = parsed.results.banner;
    const iconResult = parsed.results.icon;

    if (bannerResult && bannerCanvasRef.current) {
      const bannerRenderer = new BannerRenderer(
        bannerCanvasRef.current,
        bannerResult.renderLayout,
        bannerResult.anim,
        bannerResult.tplImages,
        {
          initialFrame: startFrame,
          startAnim: bannerResult.animStart ?? null,
          loopAnim: bannerResult.animLoop ?? bannerResult.anim ?? null,
          onFrame: (frame, total, phase) => {
            const phaseLabel = phase === "start" ? "Start" : "Loop";
            setAnimStatus(`${phaseLabel} ${frame} / ${total}`);
          },
        },
      );
      bannerRenderer.render();
      bannerRendererRef.current = bannerRenderer;
    }

    if (iconResult && iconCanvasRef.current) {
      const iconRenderer = new BannerRenderer(
        iconCanvasRef.current,
        iconResult.renderLayout,
        iconResult.anim,
        iconResult.tplImages,
        {
          initialFrame: startFrame,
        },
      );
      iconRenderer.render();
      iconRendererRef.current = iconRenderer;
    }

    return () => {
      stopRenderers();
    };
  }, [activeTab, parsed, startFrame, stopRenderers]);

  useEffect(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    if (!bannerRenderer && !iconRenderer) {
      return;
    }

    bannerRenderer?.setStartFrame(startFrame);
    iconRenderer?.setStartFrame(startFrame);
    setIsPlaying(false);
  }, [startFrame]);

  const bannerTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.banner?.tplImages ?? {}),
    [parsed],
  );
  const iconTextureEntries = useMemo(
    () => flattenTextures(parsed?.results.icon?.tplImages ?? {}),
    [parsed],
  );

  const layoutInfo = useMemo(() => formatLayoutInfo(parsed?.results.banner?.layout), [parsed]);
  const animationInfo = useMemo(() => formatAnimationInfo(parsed?.results.banner?.anim), [parsed]);

  const showRenderArea = Boolean(parsed || logEntries.length > 0);

  const togglePlayback = useCallback(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;

    if (!bannerRenderer && !iconRenderer) {
      return;
    }

    if (isPlaying) {
      bannerRenderer?.stop();
      iconRenderer?.stop();
      setIsPlaying(false);
      return;
    }

    bannerRenderer?.play();
    iconRenderer?.play();
    setIsPlaying(true);
  }, [isPlaying]);

  const resetPlayback = useCallback(() => {
    bannerRendererRef.current?.stop();
    iconRendererRef.current?.stop();
    bannerRendererRef.current?.reset();
    iconRendererRef.current?.reset();
    setIsPlaying(false);
  }, []);

  const applyStartFrame = useCallback(() => {
    const nextStartFrame = normalizeStartFrame(startFrameInput);
    setStartFrame(nextStartFrame);
    setStartFrameInput(String(nextStartFrame));
  }, [normalizeStartFrame, startFrameInput]);

  const useCurrentFrame = useCallback(() => {
    const current = bannerRendererRef.current?.frame ?? iconRendererRef.current?.frame ?? startFrame;
    const nextStartFrame = normalizeStartFrame(current);
    setStartFrame(nextStartFrame);
    setStartFrameInput(String(nextStartFrame));
  }, [normalizeStartFrame, startFrame]);

  useEffect(() => {
    if (!parsed) {
      return;
    }
    const clampedStartFrame = normalizeStartFrame(startFrame);
    if (clampedStartFrame === startFrame) {
      return;
    }
    setStartFrame(clampedStartFrame);
    setStartFrameInput(String(clampedStartFrame));
  }, [maxStartFrame, normalizeStartFrame, parsed, startFrame]);

  const exportCanvas = useCallback((canvasRef, filename) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Wii Channel Banner Renderer</h1>
        <p>Drop a .WAD file to extract and render its channel banner and icon</p>
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
              : "Drop .WAD file here"}
        </div>
        <span>or click to browse</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".wad"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
      </div>

      {showRenderArea ? (
        <div className="render-area visible">
          <div className="tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "preview" ? (
            <div className="tab-content active">
              <div className="banner-display">
                <div className="section-title">Channel Banner</div>
                <div className="canvas-wrapper">
                  <div className="canvas-container">
                    <label>Banner</label>
                    <canvas ref={bannerCanvasRef} width="608" height="456" />
                  </div>
                  <div className="canvas-container">
                    <label>Icon</label>
                    <canvas ref={iconCanvasRef} width="128" height="128" />
                  </div>
                </div>
                <div className="controls">
                  <button className="primary" onClick={togglePlayback} type="button">
                    {isPlaying ? "Pause Animation" : "Play Animation"}
                  </button>
                  <button onClick={resetPlayback} type="button">
                    Reset
                  </button>
                  <button
                    onClick={() => exportCanvas(bannerCanvasRef, "banner.png")}
                    type="button"
                  >
                    Export Banner PNG
                  </button>
                  <button onClick={() => exportCanvas(iconCanvasRef, "icon.png")} type="button">
                    Export Icon PNG
                  </button>
                </div>
                <div className="frame-settings">
                  <label htmlFor="start-frame">Start Sequence Frame</label>
                  <input
                    id="start-frame"
                    type="number"
                    min="0"
                    max={maxStartFrame}
                    step="1"
                    value={startFrameInput}
                    onChange={(event) => setStartFrameInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        applyStartFrame();
                      }
                    }}
                  />
                  <button onClick={applyStartFrame} type="button">
                    Apply
                  </button>
                  <button onClick={useCurrentFrame} type="button">
                    Use Current
                  </button>
                  <span className="frame-settings-range">0-{maxStartFrame}</span>
                </div>
                <div className="anim-status">{animStatus}</div>
              </div>

              <div className="info-panel">
                {parsed ? (
                  <>
                    <div>
                      <span className="key">Title ID:</span> <span className="val">{parsed.wad.titleId}</span>
                    </div>
                    <div>
                      <span className="key">WAD Type:</span>{" "}
                      <span className="val">0x{parsed.wad.wadType.toString(16)}</span>
                    </div>
                    <div>
                      <span className="key">Contents:</span>{" "}
                      <span className="val">{parsed.wad.numContents} file(s)</span>
                    </div>
                  </>
                ) : (
                  <span className="val">No WAD data parsed.</span>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "textures" ? (
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
          ) : null}

          {activeTab === "layout" ? (
            <div className="tab-content active">
              <div className="section-title">BRLYT Layout Data</div>
              <pre className="info-panel info-pre">{layoutInfo}</pre>
              <div className="section-title icon-title">BRLAN Animation Data</div>
              <pre className="info-panel info-pre">{animationInfo}</pre>
            </div>
          ) : null}

          {activeTab === "log" ? (
            <div className="tab-content active">
              <div className="section-title">Parse Log</div>
              <div className="log">
                {logEntries.map((entry, index) => (
                  <div className={entry.level} key={`${entry.level}-${index}`}>
                    [{entry.level.toUpperCase()}] {entry.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
