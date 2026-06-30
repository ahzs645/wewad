// A web renderer for News Channel data, decoupled from both the server and the
// Wii binary: it consumes a shared ChannelData envelope (channel "news") and
// drives a News-Channel-style view with GSAP timelines. The whole channel is one
// call — renderNewsChannel(data, mount) — so any data source (decoded news.bin,
// generator output, or hand-written JSON) renders the same way.

import { gsap } from "gsap";

const STYLE_ID = "wcn-styles";

const CSS = `
.wcn{position:relative;width:100%;height:100%;min-height:420px;color:#eaf3ff;overflow:hidden;
  font-family:"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;
  background:radial-gradient(120% 90% at 50% -10%,#06467a,#0a1830 55%,#02101f)}
.wcn *{box-sizing:border-box;margin:0;padding:0}
.wcn header{display:flex;align-items:center;gap:14px;padding:16px 26px;border-bottom:1px solid rgba(54,198,255,.25)}
.wcn .logo{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 0deg,#1fa2ff,#36c6ff,#0e6,#1fa2ff);box-shadow:0 0 18px #1fa2ff88}
.wcn h1{font-size:20px;font-weight:700;letter-spacing:.5px}
.wcn .updated{margin-left:auto;font-size:12px;opacity:.7}
.wcn .stage{flex:1;display:grid;grid-template-columns:1.3fr 1fr;gap:20px;padding:22px 26px;min-height:0}
.wcn .feature{position:relative;display:flex;flex-direction:column;justify-content:flex-end;border-radius:18px;padding:26px;overflow:hidden;background:linear-gradient(160deg,#0c2b50,#071a32);border:1px solid rgba(54,198,255,.2)}
.wcn .globe{position:absolute;top:-60px;right:-50px;width:230px;height:230px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5fd0ff,#0a63a8 60%,#03203b);box-shadow:0 0 60px #1fa2ff55,inset -18px -18px 40px #00131f99;opacity:.85}
.wcn .kicker{font-size:12px;letter-spacing:2px;color:#36c6ff;text-transform:uppercase}
.wcn .feature h2{font-size:30px;line-height:1.18;margin:10px 0 14px;max-width:90%}
.wcn .feature p{font-size:15px;line-height:1.5;opacity:.86;max-width:95%}
.wcn .feature .meta{margin-top:16px;font-size:12px;opacity:.6}
.wcn .list{display:flex;flex-direction:column;gap:8px;overflow:auto;padding-right:6px}
.wcn .item{padding:12px 14px;border-radius:12px;cursor:pointer;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);font-size:14px;line-height:1.35}
.wcn .item:hover{background:rgba(54,198,255,.12)}
.wcn .item.active{background:rgba(54,198,255,.18);border-color:#36c6ff}
.wcn .ticker{height:46px;display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#041427,#06467a,#041427);border-top:1px solid rgba(54,198,255,.3);overflow:hidden;white-space:nowrap}
.wcn .ticker .tag{flex:none;padding:0 16px;height:100%;display:flex;align-items:center;font-size:12px;font-weight:700;letter-spacing:1px;background:#36c6ff;color:#022}
.wcn .ticker .track{display:inline-flex;gap:48px;padding-left:24px;font-size:15px}
.wcn .ticker .track span::before{content:"\\25CF";color:#36c6ff;margin-right:46px;font-size:10px;vertical-align:middle}
`;

function ensureStyles(doc) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
}

function fmtTime(iso) {
  if (!iso) {
    return "";
  }
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Render a News Channel data envelope into `mount` with GSAP-driven animation.
 * @param {import("./format.js").ChannelData} data envelope with channel "news"
 * @param {HTMLElement} mount container element (cleared and owned by the renderer)
 * @param {{autoCycleMs?: number, title?: string}} [options]
 * @returns {{destroy: () => void, show: (index: number) => void}}
 */
export function renderNewsChannel(data, mount, options = {}) {
  const { autoCycleMs = 5000, title = "Web News Channel" } = options;
  const articles = data?.payload?.articles ?? [];
  const menuHeadlines = data?.payload?.menuHeadlines?.length
    ? data.payload.menuHeadlines
    : articles.map((a) => a.headline);

  const doc = mount.ownerDocument;
  ensureStyles(doc);

  mount.classList.add("wcn");
  mount.innerHTML = `
    <header>
      <div class="logo"></div><h1></h1>
      <div class="updated"></div>
    </header>
    <div class="stage">
      <div class="feature">
        <div class="globe"></div>
        <div class="kicker" data-kicker>Top Story</div>
        <h2 data-head></h2>
        <p data-body></p>
        <div class="meta" data-meta></div>
      </div>
      <div class="list" data-list></div>
    </div>
    <div class="ticker"><div class="tag">HEADLINES</div><div class="track" data-track></div></div>`;

  mount.querySelector("h1").textContent = title;
  mount.querySelector(".updated").textContent = data?.updated
    ? `updated ${fmtTime(data.updated)} · ${articles.length} stories`
    : `${articles.length} stories`;

  const q = (sel) => mount.querySelector(sel);
  const list = q("[data-list]");
  const tweens = [];

  articles.forEach((article, i) => {
    const el = doc.createElement("div");
    el.className = "item" + (i === 0 ? " active" : "");
    el.textContent = article.headline;
    el.addEventListener("click", () => show(i));
    list.appendChild(el);
  });

  // The ticker is the icon/banner feed: the same menuHeadlines the Wii Menu shows.
  const track = q("[data-track]");
  [...menuHeadlines, ...menuHeadlines].forEach((h) => {
    const span = doc.createElement("span");
    span.textContent = h;
    track.appendChild(span);
  });
  if (menuHeadlines.length) {
    tweens.push(
      gsap.to(track, { xPercent: -50, duration: menuHeadlines.length * 4, ease: "none", repeat: -1 }),
    );
  }
  tweens.push(gsap.to(q(".globe"), { rotation: 360, duration: 40, ease: "none", repeat: -1 }));

  let index = 0;

  function setContent(i) {
    index = i;
    const a = articles[i];
    if (!a) {
      return;
    }
    q("[data-head]").textContent = a.headline;
    const body = a.body ?? "";
    q("[data-body]").textContent = body.length > 260 ? `${body.slice(0, 260)}…` : body;
    q("[data-meta]").textContent =
      `Story ${i + 1} of ${articles.length}` + (a.published ? ` · published ${fmtTime(a.published)}` : "");
    q("[data-kicker]").textContent = i === 0 ? "Top Story" : "Story";
    gsap.set([q("[data-head]"), q("[data-body]"), q("[data-meta]")], { opacity: 1, y: 0 });
    mount.querySelectorAll(".item").forEach((el, j) => el.classList.toggle("active", j === i));
  }

  function show(i) {
    const els = [q("[data-head]"), q("[data-body]"), q("[data-meta]")];
    const tl = gsap.timeline();
    tl.to(els, { opacity: 0, y: 14, duration: 0.25, stagger: 0.04 })
      .add(() => setContent(i))
      .fromTo(els, { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 });
    tweens.push(tl);
  }

  setContent(0);
  let timer = null;
  if (autoCycleMs && articles.length > 1) {
    timer = setInterval(() => show((index + 1) % articles.length), autoCycleMs);
  }

  return {
    show,
    destroy() {
      if (timer) {
        clearInterval(timer);
      }
      tweens.forEach((t) => t.kill());
      mount.classList.remove("wcn");
      mount.innerHTML = "";
    },
  };
}
