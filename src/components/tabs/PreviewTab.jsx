import { DISPLAY_ASPECT_OPTIONS, TITLE_LOCALE_LABELS, WEATHER_CONDITION_OPTIONS } from "../../constants";
import { normalizeDomId } from "../../utils/misc";

export function PreviewTab({
  previewDisplay, setPreviewDisplay,
  bannerCanvasRef, iconCanvasRef,
  isPlaying, togglePlayback, resetPlayback,
  exportCanvas,
  startFrameInput, setStartFrameInput, maxStartFrame, applyStartFrame, useCurrentFrame,
  previewDisplayAspect, setPreviewDisplayAspect,
  tevQuality, setTevQuality,
  bannerRenderState, setBannerRenderState, bannerRenderStateOptions,
  iconRenderState, setIconRenderState, iconRenderStateOptions,
  titleLocale, setTitleLocale, availableTitleLocales,
  bannerPaneStateGroups, bannerPaneStateSelections, setBannerPaneStateSelections,
  iconPaneStateGroups, iconPaneStateSelections, setIconPaneStateSelections,
  useCustomWeather, setUseCustomWeather,
  customCondition, setCustomCondition,
  customCity, setCustomCity,
  customTelop, setCustomTelop,
  customTimeLabel, setCustomTimeLabel,
  customTemperature, setCustomTemperature,
  customTemperatureUnit, setCustomTemperatureUnit,
  useCustomNews, setUseCustomNews,
  customHeadlines, setCustomHeadlines,
  animStatus,
  audioUrl, audioElementRef, audioInfo,
  parsed,
  showWeatherOptions, showNewsOptions,
}) {
  return (
    <div className="tab-content active">
      <div className="banner-display">
        <div className="section-title">Channel Banner</div>
        <div className="preview-display-toggle">
          {["both", "banner", "icon"].map((mode) => (
            <button
              key={mode}
              type="button"
              className={`preview-display-option ${previewDisplay === mode ? "active" : ""}`}
              onClick={() => setPreviewDisplay(mode)}
            >
              {mode === "both" ? "Both" : mode === "banner" ? "Banner" : "Icon"}
            </button>
          ))}
        </div>
        <div className="canvas-wrapper">
          <div className={`canvas-container ${previewDisplay === "icon" ? "hidden" : ""}`}>
            <label>Banner</label>
            <canvas ref={bannerCanvasRef} width="608" height="456" />
          </div>
          <div className={`canvas-container ${previewDisplay === "banner" ? "hidden" : ""}`}>
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
        <div className="state-settings">
          <div className="state-control">
            <label htmlFor="display-aspect">Display Aspect</label>
            <select
              id="display-aspect"
              value={previewDisplayAspect}
              onChange={(event) => setPreviewDisplayAspect(event.target.value)}
            >
              {DISPLAY_ASPECT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="state-control">
            <label htmlFor="tev-quality">TEV Quality</label>
            <select
              id="tev-quality"
              value={tevQuality}
              onChange={(event) => setTevQuality(event.target.value)}
            >
              <option value="fast">Fast</option>
              <option value="accurate">Accurate</option>
            </select>
          </div>
          {bannerRenderStateOptions.length > 0 ? (
            <div className="state-control">
              <label htmlFor="banner-state">Banner State</label>
              <select
                id="banner-state"
                value={bannerRenderState}
                onChange={(event) => setBannerRenderState(event.target.value)}
              >
                <option value="auto">Auto</option>
                {bannerRenderStateOptions.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {bannerPaneStateGroups.map((group) => {
            const controlId = `banner-pane-state-${normalizeDomId(group.id)}`;
            const parsedValue = Number.parseInt(String(bannerPaneStateSelections[group.id]), 10);
            const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
            return (
              <div className="state-control" key={`banner-pane-group-${group.id}`}>
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
          {iconRenderStateOptions.length > 0 ? (
            <div className="state-control">
              <label htmlFor="icon-state">Icon State</label>
              <select
                id="icon-state"
                value={iconRenderState}
                onChange={(event) => setIconRenderState(event.target.value)}
              >
                <option value="auto">Auto</option>
                {iconRenderStateOptions.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {iconPaneStateGroups.map((group) => {
            const controlId = `icon-pane-state-${normalizeDomId(group.id)}`;
            const parsedValue = Number.parseInt(String(iconPaneStateSelections[group.id]), 10);
            const value = Number.isFinite(parsedValue) ? String(parsedValue) : "auto";
            return (
              <div className="state-control" key={`icon-pane-group-${group.id}`}>
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
          {availableTitleLocales.length > 1 ? (
            <div className="state-control">
              <label htmlFor="title-locale">Locale</label>
              <select
                id="title-locale"
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
          ) : null}
        </div>
        {showWeatherOptions ? (
          <div className="custom-weather-settings">
            <label className="custom-weather-toggle">
              <input
                type="checkbox"
                checked={useCustomWeather}
                onChange={(event) => setUseCustomWeather(event.target.checked)}
              />
              <span>Use Custom Weather Data</span>
            </label>
            {useCustomWeather ? (
              <div className="custom-weather-grid">
                <div className="state-control">
                  <label htmlFor="custom-weather-condition">Condition</label>
                  <select
                    id="custom-weather-condition"
                    value={customCondition}
                    onChange={(event) => setCustomCondition(event.target.value)}
                  >
                    {WEATHER_CONDITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="state-control">
                  <label htmlFor="custom-weather-temp">Temperature</label>
                  <div className="custom-weather-temp-row">
                    <input
                      id="custom-weather-temp"
                      type="number"
                      value={customTemperature}
                      onChange={(event) => setCustomTemperature(event.target.value)}
                    />
                    <select
                      value={customTemperatureUnit}
                      onChange={(event) => setCustomTemperatureUnit(event.target.value)}
                    >
                      <option value="F">F</option>
                      <option value="C">C</option>
                    </select>
                  </div>
                </div>
                <div className="state-control">
                  <label htmlFor="custom-weather-city">City</label>
                  <input
                    id="custom-weather-city"
                    type="text"
                    value={customCity}
                    onChange={(event) => setCustomCity(event.target.value)}
                  />
                </div>
                <div className="state-control">
                  <label htmlFor="custom-weather-time">Time Label</label>
                  <input
                    id="custom-weather-time"
                    type="text"
                    value={customTimeLabel}
                    onChange={(event) => setCustomTimeLabel(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {showNewsOptions ? (
          <div className="custom-weather-settings">
            <label className="custom-weather-toggle">
              <input
                type="checkbox"
                checked={useCustomNews}
                onChange={(event) => setUseCustomNews(event.target.checked)}
              />
              <span>Use Custom News Headlines</span>
            </label>
            {useCustomNews ? (
              <div className="custom-weather-grid">
                <div className="state-control">
                  <label htmlFor="custom-news-headlines">Headlines (one per line)</label>
                  <textarea
                    id="custom-news-headlines"
                    rows={4}
                    value={customHeadlines}
                    onChange={(event) => setCustomHeadlines(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="anim-status">{animStatus}</div>

        <div className="audio-section">
          <label>Channel Audio</label>
          {audioUrl ? (
            <audio
              ref={audioElementRef}
              controls
              loop={parsed?.results?.audio?.loopFlag ?? false}
              src={audioUrl}
            />
          ) : (
            <div className="empty-state">No channel audio decoded.</div>
          )}
          <div className="audio-meta">{audioInfo}</div>
        </div>
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
  );
}
