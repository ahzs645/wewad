import { useCallback, useState } from "react";

export function useRendererPlayback({
  bannerRendererRef,
  iconRendererRef,
  audioSyncRef,
  customWeatherData,
  canCustomizeWeather,
}) {
  const [bannerPlaying, setBannerPlaying] = useState(false);
  const [iconPlaying, setIconPlaying] = useState(false);
  const isPlaying = bannerPlaying || iconPlaying;

  const stopPlaybackState = useCallback(() => {
    setBannerPlaying(false);
    setIconPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    const bannerRenderer = bannerRendererRef.current;
    const iconRenderer = iconRendererRef.current;
    const audioCtrl = audioSyncRef.current;
    const freezeVisualPlayback = Boolean(customWeatherData && canCustomizeWeather);

    if (!bannerRenderer && !iconRenderer && !audioCtrl) return;

    if (isPlaying) {
      bannerRenderer?.stop();
      iconRenderer?.stop();
      audioCtrl?.pause();
      stopPlaybackState();
      return;
    }

    if (!freezeVisualPlayback && bannerRenderer) {
      bannerRenderer.play();
      setBannerPlaying(true);
    }
    if (!freezeVisualPlayback && iconRenderer) {
      iconRenderer.play();
      setIconPlaying(true);
    }
    if (audioCtrl) {
      const info = bannerRenderer?.getPlaybackInfo?.() ?? iconRenderer?.getPlaybackInfo?.() ?? null;
      if (info) audioCtrl.seekToFrame(info.audioFrame ?? info.globalFrame);
      audioCtrl.play(audioCtrl.currentTime);
    }
  }, [
    audioSyncRef,
    bannerRendererRef,
    canCustomizeWeather,
    customWeatherData,
    iconRendererRef,
    isPlaying,
    stopPlaybackState,
  ]);

  const resetPlayback = useCallback(() => {
    bannerRendererRef.current?.stop();
    iconRendererRef.current?.stop();
    bannerRendererRef.current?.reset();
    iconRendererRef.current?.reset();
    audioSyncRef.current?.stop();
    stopPlaybackState();
  }, [audioSyncRef, bannerRendererRef, iconRendererRef, stopPlaybackState]);

  const handleTrackTogglePlay = useCallback((trackId) => {
    const audioCtrl = audioSyncRef.current;
    if (trackId === "banner") {
      const renderer = bannerRendererRef.current;
      if (!renderer) return;
      if (bannerPlaying) {
        renderer.stop();
        audioCtrl?.pause();
        setBannerPlaying(false);
      } else {
        renderer.play();
        if (audioCtrl) {
          const info = renderer.getPlaybackInfo();
          if (info) audioCtrl.seekToFrame(info.audioFrame ?? info.globalFrame);
          audioCtrl.play(audioCtrl.currentTime);
        }
        setBannerPlaying(true);
      }
    } else if (trackId === "icon") {
      const renderer = iconRendererRef.current;
      if (!renderer) return;
      if (iconPlaying) {
        renderer.stop();
        setIconPlaying(false);
      } else {
        renderer.play();
        setIconPlaying(true);
      }
    }
  }, [audioSyncRef, bannerPlaying, bannerRendererRef, iconPlaying, iconRendererRef]);

  const handleTrackSeek = useCallback((trackId, globalFrame) => {
    if (trackId === "banner") {
      bannerRendererRef.current?.seekToFrame(globalFrame);
      audioSyncRef.current?.seekToFrame(globalFrame);
    } else if (trackId === "icon") {
      iconRendererRef.current?.seekToFrame(globalFrame);
    }
  }, [audioSyncRef, bannerRendererRef, iconRendererRef]);

  return {
    bannerPlaying,
    iconPlaying,
    isPlaying,
    stopPlaybackState,
    togglePlayback,
    resetPlayback,
    handleTrackTogglePlay,
    handleTrackSeek,
  };
}
