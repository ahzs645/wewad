import { useCallback, useMemo, useState } from "react";
import { WEATHER_CONDITION_OPTIONS } from "../constants";
import { hasWeatherScene, hasNewsScene } from "../utils/weather";

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
    },
    news: {
      enabled: useCustomNews,
      setEnabled: setUseCustomNews,
      headlines: customHeadlines,
      setHeadlines: setCustomHeadlines,
      canCustomize: canCustomizeNews,
      data: customNewsData,
    },
    resetCustomization,
  };
}
