import { useCallback, useMemo, useState } from "react";
import { WEATHER_CONDITION_OPTIONS } from "../constants";
import { hasWeatherScene, hasNewsScene, mapForecastConditionToOption } from "../utils/weather";

export function useCustomizationSettings({ parsed }) {
  const [useCustomWeather, setUseCustomWeather] = useState(false);
  const [customCondition, setCustomCondition] = useState("partly_cloudy");
  const [customCity, setCustomCity] = useState("Seattle");
  const [customTelop, setCustomTelop] = useState("Partly cloudy with a chance of evening rain.");
  const [customTimeLabel, setCustomTimeLabel] = useState("Updated 9:41 AM");
  const [customTemperature, setCustomTemperature] = useState("72");
  const [customTemperatureUnit, setCustomTemperatureUnit] = useState("F");
  const [useCustomNews, setUseCustomNews] = useState(false);
  const [customHeadlines, setCustomHeadlines] = useState(
    "Breaking: Wii Channel banners now render in the browser\nNintendo announces new system update\nLocal weather: sunny skies expected all week",
  );

  const canCustomizeWeather = useMemo(
    () => hasWeatherScene(parsed?.results?.banner?.renderLayout),
    [parsed],
  );

  const customWeatherData = useMemo(() => {
    if (!useCustomWeather || !canCustomizeWeather) return null;
    const parsedTemperature = Number.parseInt(customTemperature, 10);
    return {
      enabled: true,
      condition: customCondition,
      city: customCity,
      telop: WEATHER_CONDITION_OPTIONS.find((option) => option.value === customCondition)?.label ?? customCondition,
      timeLabel: customTimeLabel,
      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : null,
      temperatureUnit: customTemperatureUnit,
    };
  }, [
    canCustomizeWeather,
    customCity,
    customCondition,
    customTemperature,
    customTemperatureUnit,
    customTimeLabel,
    useCustomWeather,
  ]);

  const canCustomizeNews = useMemo(
    () => hasNewsScene(parsed?.results?.icon?.renderLayout),
    [parsed],
  );

  const customNewsData = useMemo(() => {
    if (!useCustomNews || !canCustomizeNews) return null;
    const headlines = customHeadlines
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return headlines.length === 0 ? null : { enabled: true, headlines };
  }, [canCustomizeNews, customHeadlines, useCustomNews]);

  const resetCustomization = useCallback(() => {
    setUseCustomWeather(false);
    setUseCustomNews(false);
  }, []);

  // Pull a live decoded Forecast Channel envelope (src/channels/forecast.js)
  // into the banner preview: picks the first forecast entry, maps its real
  // condition name to a preset, and formats its real temperature/time.
  const applyDecodedWeather = useCallback((decoded) => {
    const forecast = decoded?.payload?.forecasts?.[0];
    if (decoded?.channel !== "forecast" || !forecast) {
      return false;
    }
    const location = (decoded.locations ?? []).find(
      (l) =>
        l.countryCode === forecast.location.countryCode &&
        l.regionCode === forecast.location.regionCode &&
        l.locationCode === forecast.location.locationCode,
    );
    setCustomCity(location?.name ?? `Location ${forecast.location.locationCode}`);
    setCustomCondition(mapForecastConditionToOption(forecast.today.conditionName));
    setCustomTemperature(String(forecast.today.highF));
    setCustomTemperatureUnit("F");
    setCustomTimeLabel(
      decoded.updated
        ? `Updated ${new Date(decoded.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Updated now",
    );
    setUseCustomWeather(true);
    return true;
  }, []);

  // Pull a live decoded News Channel envelope's menuHeadlines — the exact feed
  // the real Wii Menu ticker reads (src/channels/news.js) — into the preview.
  const applyDecodedNews = useCallback((decoded) => {
    const headlines = decoded?.payload?.menuHeadlines;
    if (decoded?.channel !== "news" || !Array.isArray(headlines) || headlines.length === 0) {
      return false;
    }
    setCustomHeadlines(headlines.join("\n"));
    setUseCustomNews(true);
    return true;
  }, []);

  return {
    weather: {
      enabled: useCustomWeather,
      setEnabled: setUseCustomWeather,
      condition: customCondition,
      setCondition: setCustomCondition,
      city: customCity,
      setCity: setCustomCity,
      telop: customTelop,
      setTelop: setCustomTelop,
      timeLabel: customTimeLabel,
      setTimeLabel: setCustomTimeLabel,
      temperature: customTemperature,
      setTemperature: setCustomTemperature,
      temperatureUnit: customTemperatureUnit,
      setTemperatureUnit: setCustomTemperatureUnit,
      canCustomize: canCustomizeWeather,
      data: customWeatherData,
      applyDecoded: applyDecodedWeather,
    },
    news: {
      enabled: useCustomNews,
      setEnabled: setUseCustomNews,
      headlines: customHeadlines,
      setHeadlines: setCustomHeadlines,
      canCustomize: canCustomizeNews,
      data: customNewsData,
      applyDecoded: applyDecodedNews,
    },
    resetCustomization,
  };
}
