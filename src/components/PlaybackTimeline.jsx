import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const PHASE_MODES = [
  { value: "full", label: "Full Sequence" },
  { value: "startOnly", label: "Start Only" },
  { value: "loopOnly", label: "Loop Only" },
];

function TrackRow({ id, label, startFrames, loopFrames, isPlaying, showLabel, onTogglePlay, onSeek, elemRef }) {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const totalFrames = startFrames + loopFrames;
  const startPercent = totalFrames > 0 ? (startFrames / totalFrames) * 100 : 0;

  const resolveFrameFromPointer = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(fraction * totalFrames);
  }, [totalFrames]);

  const handlePointerDown = useCallback((event) => {
    if (!trackRef.current) return;
    event.preventDefault();
    setIsDragging(true);
    trackRef.current.setPointerCapture(event.pointerId);
    onSeek?.(id, resolveFrameFromPointer(event.clientX));
  }, [id, resolveFrameFromPointer, onSeek]);

  const handlePointerMove = useCallback((event) => {
    if (!isDragging) return;
    onSeek?.(id, resolveFrameFromPointer(event.clientX));
  }, [id, isDragging, resolveFrameFromPointer, onSeek]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return undefined;
    const onUp = () => setIsDragging(false);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [isDragging]);

  if (totalFrames <= 0) return null;

  return (
    <div className="timeline-track-row">
      <div className="timeline-labels">
        <button
          type="button"
          className="timeline-track-play"
          onClick={() => onTogglePlay?.(id)}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "\u23F8" : "\u25B6"}
        </button>
        {showLabel ? <span className="timeline-track-label">{label}</span> : null}
        {startFrames > 0 ? (
          <span className="timeline-phase-label start">Start ({startFrames}f)</span>
        ) : null}
        <span className="timeline-phase-label loop">Loop ({loopFrames}f)</span>
        <span
          className="timeline-counter"
          ref={(el) => { elemRef.current[`${id}-counter`] = el; }}
        >
          0 / {totalFrames}
        </span>
      </div>
      <div
        className={`timeline-track${isDragging ? " dragging" : ""}`}
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {startFrames > 0 ? (
          <div className="timeline-segment start" style={{ width: `${startPercent}%` }} />
        ) : null}
        <div className="timeline-segment loop" style={{ width: `${100 - startPercent}%` }} />
        <div
          className="timeline-playhead"
          ref={(el) => { elemRef.current[`${id}-playhead`] = el; }}
        />
      </div>
    </div>
  );
}

export const PlaybackTimeline = forwardRef(function PlaybackTimeline({
  tracks,
  phaseMode,
  setPhaseMode,
  hasStartAnim,
  hasLoopAnim,
  onTogglePlay,
  onSeek,
}, ref) {
  const elemRef = useRef({});
  const showPhaseMode = hasStartAnim && hasLoopAnim;
  const showLabel = tracks.length > 1;

  useImperativeHandle(ref, () => ({
    updatePlayhead(trackId, globalFrame) {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) return;
      const playhead = elemRef.current[`${trackId}-playhead`];
      const counter = elemRef.current[`${trackId}-counter`];
      const total = track.startFrames + track.loopFrames;
      const clamped = Math.max(0, Math.min(globalFrame, total));
      const percent = total > 0 ? (clamped / total) * 100 : 0;
      if (playhead) playhead.style.left = `${percent}%`;
      if (counter) {
        const phase = track.startFrames > 0 && clamped < track.startFrames ? "Start" : "Loop";
        const localFrame = clamped < track.startFrames ? clamped : clamped - track.startFrames;
        const phaseTotal = clamped < track.startFrames ? track.startFrames : track.loopFrames;
        counter.textContent = `${phase} ${Math.floor(localFrame)} / ${Math.floor(phaseTotal)}`;
      }
    },
  }), [tracks]);

  const hasAnyFrames = tracks.some((t) => (t.startFrames + t.loopFrames) > 0);
  if (!hasAnyFrames) return null;

  return (
    <div className="playback-timeline">
      {showPhaseMode ? (
        <div className="phase-mode-toggle">
          {PHASE_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={`phase-mode-option ${phaseMode === mode.value ? "active" : ""}`}
              onClick={() => setPhaseMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      ) : null}

      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          id={track.id}
          label={track.label}
          startFrames={track.startFrames}
          loopFrames={track.loopFrames}
          isPlaying={track.isPlaying}
          showLabel={showLabel}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          elemRef={elemRef}
        />
      ))}
    </div>
  );
});
