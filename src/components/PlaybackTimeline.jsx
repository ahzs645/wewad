import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const PHASE_MODES = [
  { value: "full", label: "Full Sequence" },
  { value: "startOnly", label: "Start Only" },
  { value: "loopOnly", label: "Loop Only" },
];

export const PlaybackTimeline = forwardRef(function PlaybackTimeline({
  startFrames,
  loopFrames,
  phaseMode,
  setPhaseMode,
  hasStartAnim,
  hasLoopAnim,
  onSeek,
  isPlaying,
}, ref) {
  const trackRef = useRef(null);
  const playheadRef = useRef(null);
  const counterRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const totalFrames = startFrames + loopFrames;
  const startPercent = totalFrames > 0 ? (startFrames / totalFrames) * 100 : 0;
  const showPhaseMode = hasStartAnim && hasLoopAnim;

  useImperativeHandle(ref, () => ({
    updatePlayhead(globalFrame) {
      if (!playheadRef.current || !counterRef.current) return;
      const clamped = Math.max(0, Math.min(globalFrame, totalFrames));
      const percent = totalFrames > 0 ? (clamped / totalFrames) * 100 : 0;
      playheadRef.current.style.left = `${percent}%`;

      const phase = startFrames > 0 && clamped < startFrames ? "Start" : "Loop";
      const localFrame = clamped < startFrames ? clamped : clamped - startFrames;
      const phaseTotal = clamped < startFrames ? startFrames : loopFrames;
      counterRef.current.textContent = `${phase} ${Math.floor(localFrame)} / ${Math.floor(phaseTotal)}`;
    },
  }), [totalFrames, startFrames, loopFrames]);

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
    const frame = resolveFrameFromPointer(event.clientX);
    onSeek?.(frame);
  }, [resolveFrameFromPointer, onSeek]);

  const handlePointerMove = useCallback((event) => {
    if (!isDragging) return;
    const frame = resolveFrameFromPointer(event.clientX);
    onSeek?.(frame);
  }, [isDragging, resolveFrameFromPointer, onSeek]);

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

      <div className="timeline-labels">
        {startFrames > 0 ? (
          <span className="timeline-phase-label start">Start ({startFrames}f)</span>
        ) : null}
        <span className="timeline-phase-label loop">Loop ({loopFrames}f)</span>
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
        <div className="timeline-playhead" ref={playheadRef} />
      </div>

      <div className="timeline-counters">
        <span ref={counterRef}>Frame 0 / {totalFrames}</span>
      </div>
    </div>
  );
});
