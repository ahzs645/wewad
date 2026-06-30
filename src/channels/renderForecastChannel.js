// A web renderer for Forecast Channel data, decoupled from the server and the
// Wii binary: it consumes a shared ChannelData envelope (channel "forecast") and
// draws a Forecast-Channel-style view with GSAP. Pairs with renderNewsChannel —
// same envelope shape, same "one call" entry point.

import { gsap } from "gsap";

const STYLE_ID = "wfc-styles";

const CSS = `
.wfc{position:relative;width:100%;height:100%;min-height:420px;color:#eef6ff;overflow:hidden;
  font-family:"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;
  background:radial-gradient(120% 90% at 50% -10%,#1d6fb8,#0c3a63 55%,#04223a)}
.wfc *{box-sizing:border-box;margin:0;padding:0}
.wfc header{display:flex;align-items:center;gap:14px;padding:16px 26px;border-bottom:1px solid rgba(150,210,255,.25)}
.wfc .logo{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#bfe6ff,#2a86c8 60%,#0a3a5e);box-shadow:0 0 18px #7cc4ff88}
.wfc h1{font-size:20px;font-weight:700;letter-spacing:.5px}
.wfc .updated{margin-left:auto;font-size:12px;opacity:.75}
.wfc .unit{margin-left:14px;display:flex;border:1px solid rgba(190,225,255,.4);border-radius:999px;overflow:hidden;font-size:12px;cursor:pointer}
.wfc .unit span{padding:4px 10px}
.wfc .unit .on{background:#bfe6ff;color:#06324f;font-weight:700}
.wfc .stage{flex:1;display:grid;grid-template-columns:1.4fr 1fr;gap:20px;padding:22px 26px;min-height:0}
.wfc .today{position:relative;border-radius:18px;padding:26px;overflow:hidden;background:linear-gradient(160deg,#15558c,#0a2d4d);border:1px solid rgba(150,210,255,.2);display:flex;flex-direction:column;justify-content:center}
.wfc .city{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#bfe6ff}
.wfc .now{display:flex;align-items:center;gap:20px;margin:14px 0}
.wfc .glyph{font-size:74px;line-height:1}
.wfc .temp{font-size:64px;font-weight:700}
.wfc .temp small{font-size:24px;opacity:.7;font-weight:400}
.wfc .cond{font-size:20px;margin-bottom:6px}
.wfc .hilo{font-size:15px;opacity:.85}
.wfc .tomorrow{margin-top:18px;font-size:14px;opacity:.8;display:flex;align-items:center;gap:10px}
.wfc .list{display:flex;flex-direction:column;gap:8px;overflow:auto;padding-right:6px}
.wfc .item{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-size:14px}
.wfc .item:hover{background:rgba(150,210,255,.14)}
.wfc .item.active{background:rgba(150,210,255,.2);border-color:#bfe6ff}
.wfc .item .g{font-size:20px}
.wfc .item .t{margin-left:auto;opacity:.85}
.wfc .strip{display:flex;gap:8px;padding:14px 26px;border-top:1px solid rgba(150,210,255,.3);background:linear-gradient(90deg,#072b48,#0c3a63,#072b48)}
.wfc .day{flex:1;text-align:center;font-size:13px;padding:8px 4px;border-radius:10px;background:rgba(255,255,255,.04)}
.wfc .day .g{font-size:22px;margin:4px 0}
.wfc .day .h{font-weight:700}
.wfc .day .l{opacity:.7}
`;

// Map a condition name to a glyph. Falls back by keyword so unknown names still
// pick something sensible.
const GLYPHS = {
  sunny: "☀️",
  clear: "☀️",
  fair: "🌤️",
  cloudy: "☁️",
  "partly cloudy": "⛅",
  rain: "🌧️",
  showers: "🌦️",
  thunderstorm: "⛈️",
  snow: "🌨️",
  fog: "🌫️",
  windy: "🌬️",
};

function glyphFor(name) {
  const key = String(name ?? "").toLowerCase();
  if (GLYPHS[key]) {
    return GLYPHS[key];
  }
  for (const [word, glyph] of Object.entries(GLYPHS)) {
    if (key.includes(word)) {
      return glyph;
    }
  }
  return "🌤️";
}

function ensureStyles(doc) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
}

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

// Match a forecast's location key to the shared locations list for a city name.
function locationName(data, key) {
  const loc = (data.locations ?? []).find(
    (l) =>
      l.countryCode === key.countryCode &&
      l.regionCode === key.regionCode &&
      l.locationCode === key.locationCode,
  );
  return loc?.name ?? `Location ${key.locationCode}`;
}

/**
 * Render a Forecast Channel data envelope into `mount` with GSAP animation.
 * @param {import("./format.js").ChannelData} data envelope with channel "forecast"
 * @param {HTMLElement} mount container element (cleared and owned by the renderer)
 * @param {{unit?: "C"|"F", title?: string}} [options]
 * @returns {{destroy: () => void, show: (index: number) => void}}
 */
export function renderForecastChannel(data, mount, options = {}) {
  const forecasts = data?.payload?.forecasts ?? [];
  let unit = options.unit ?? (data?.payload?.temperatureFlag ? "C" : "F");
  const title = options.title ?? "Web Forecast Channel";

  const doc = mount.ownerDocument;
  ensureStyles(doc);
  mount.classList.add("wfc");
  mount.innerHTML = `
    <header>
      <div class="logo"></div><h1></h1>
      <div class="updated"></div>
      <div class="unit"><span data-c>°C</span><span data-f>°F</span></div>
    </header>
    <div class="stage">
      <div class="today">
        <div class="city" data-city></div>
        <div class="now"><div class="glyph" data-glyph></div>
          <div><div class="cond" data-cond></div><div class="temp" data-temp></div></div></div>
        <div class="hilo" data-hilo></div>
        <div class="tomorrow" data-tomorrow></div>
      </div>
      <div class="list" data-list></div>
    </div>
    <div class="strip" data-strip></div>`;

  mount.querySelector("h1").textContent = title;
  mount.querySelector(".updated").textContent = data?.updated ? `updated ${fmtTime(data.updated)}` : "";

  const q = (sel) => mount.querySelector(sel);
  const tweens = [];
  const hi = (block) => (unit === "C" ? block.highC : block.highF);
  const lo = (block) => (unit === "C" ? block.lowC : block.lowF);

  let index = 0;

  function render(i) {
    index = i;
    const f = forecasts[i];
    if (!f) {
      return;
    }
    q("[data-city]").textContent = locationName(data, f.location);
    q("[data-glyph]").textContent = glyphFor(f.today.conditionName);
    q("[data-cond]").textContent = f.today.conditionName ?? `Code ${f.today.condition}`;
    q("[data-temp]").innerHTML = `${hi(f.today)}<small>°${unit}</small>`;
    q("[data-hilo]").textContent = `High ${hi(f.today)}° · Low ${lo(f.today)}°`;
    q("[data-tomorrow]").innerHTML =
      `<span>Tomorrow</span> ${glyphFor(f.tomorrow.conditionName)} ${f.tomorrow.conditionName ?? ""} ` +
      `${hi(f.tomorrow)}° / ${lo(f.tomorrow)}°`;

    const strip = q("[data-strip]");
    strip.innerHTML = "";
    f.fiveDay.forEach((d, n) => {
      const el = doc.createElement("div");
      el.className = "day";
      el.innerHTML = `<div>Day ${n + 1}</div><div class="g">${glyphFor(d.conditionName)}</div>` +
        `<span class="h">${hi(d)}°</span> <span class="l">${lo(d)}°</span>`;
      strip.appendChild(el);
    });

    mount.querySelectorAll(".item").forEach((el, j) => el.classList.toggle("active", j === i));
    // immediateRender:false keeps content visible at rest (the from-state is only
    // applied once the tween actually ticks), so it never gets stuck invisible.
    const tl = gsap.timeline();
    tl.from("[data-glyph], [data-cond], [data-temp], [data-hilo], [data-tomorrow]", {
      opacity: 0,
      y: 12,
      duration: 0.4,
      stagger: 0.05,
      immediateRender: false,
    }).from(
      strip.children,
      { opacity: 0, y: 10, duration: 0.3, stagger: 0.04, immediateRender: false },
      "<",
    );
    tweens.push(tl);
  }

  // location list
  const list = q("[data-list]");
  forecasts.forEach((f, i) => {
    const el = doc.createElement("div");
    el.className = "item" + (i === 0 ? " active" : "");
    el.innerHTML = `<span class="g">${glyphFor(f.today.conditionName)}</span>` +
      `<span>${locationName(data, f.location)}</span>` +
      `<span class="t">${hi(f.today)}°/${lo(f.today)}°</span>`;
    el.addEventListener("click", () => render(i));
    list.appendChild(el);
  });

  // unit toggle
  function setUnit(next) {
    unit = next;
    q("[data-c]").classList.toggle("on", unit === "C");
    q("[data-f]").classList.toggle("on", unit === "F");
    list.innerHTML = "";
    forecasts.forEach((f, i) => {
      const el = doc.createElement("div");
      el.className = "item" + (i === index ? " active" : "");
      el.innerHTML = `<span class="g">${glyphFor(f.today.conditionName)}</span>` +
        `<span>${locationName(data, f.location)}</span>` +
        `<span class="t">${hi(f.today)}°/${lo(f.today)}°</span>`;
      el.addEventListener("click", () => render(i));
      list.appendChild(el);
    });
    render(index);
  }
  q("[data-c]").addEventListener("click", () => setUnit("C"));
  q("[data-f]").addEventListener("click", () => setUnit("F"));

  q("[data-c]").classList.toggle("on", unit === "C");
  q("[data-f]").classList.toggle("on", unit === "F");
  render(0);

  return {
    show: render,
    destroy() {
      tweens.forEach((t) => t.kill());
      mount.classList.remove("wfc");
      mount.innerHTML = "";
    },
  };
}
