// A web renderer for Everybody Votes Channel data, decoupled from the server
// and the Wii binary: it consumes a shared ChannelData envelope (channel
// "everybodyVotes") and draws an Everybody-Votes-style view with GSAP. Pairs
// with renderNewsChannel / renderForecastChannel — same envelope shape, same
// "one call" entry point.

import { gsap } from "gsap";

const STYLE_ID = "wevc-styles";

const CSS = `
.wevc{position:relative;width:100%;height:100%;min-height:420px;color:#fff4ee;overflow:hidden;
  font-family:"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;
  background:radial-gradient(120% 90% at 50% -10%,#d8366f,#7a1c46 55%,#3a0a24)}
.wevc *{box-sizing:border-box;margin:0;padding:0}
.wevc header{display:flex;align-items:center;gap:14px;padding:16px 26px;border-bottom:1px solid rgba(255,210,225,.25)}
.wevc .logo{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffd6e6,#e8508f 60%,#6e1240);box-shadow:0 0 18px #ff7fb888}
.wevc h1{font-size:20px;font-weight:700;letter-spacing:.5px}
.wevc .scope{margin-left:auto;display:flex;border:1px solid rgba(255,210,225,.4);border-radius:999px;overflow:hidden;font-size:12px}
.wevc .scope span{padding:4px 12px;cursor:pointer}
.wevc .scope .on{background:#ffd6e6;color:#5e1138;font-weight:700}
.wevc .stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:26px;min-height:0;overflow:auto}
.wevc .question{font-size:24px;font-weight:700;text-align:center;max-width:640px}
.wevc .responses{display:flex;gap:18px;width:100%;max-width:640px}
.wevc .response{flex:1;border-radius:16px;padding:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);text-align:center}
.wevc .response .label{font-size:16px;font-weight:600;margin-bottom:10px}
.wevc .bar-row{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:6px}
.wevc .bar-row .name{width:64px;text-align:left;opacity:.8}
.wevc .bar{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
.wevc .bar > span{display:block;height:100%;background:linear-gradient(90deg,#ffd6e6,#ff7fb8)}
.wevc .bar-row .pct{width:38px;text-align:right;opacity:.85}
.wevc .translations{font-size:12px;opacity:.7;text-align:center}
`;

function ensureStyles(doc) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
}

function resultFor(data, question) {
  return (data?.payload?.results ?? []).find((r) => r.scope === question.scope && r.pollId === question.pollId) ?? null;
}

// Build the two-response bar rows (male/female/predictors) for one result.
function barsFor(doc, result, responseIndex) {
  const rows = [
    ["Male", result.male?.[responseIndex] ?? 0],
    ["Female", result.female?.[responseIndex] ?? 0],
    ["Predicted", result.predictors?.[responseIndex] ?? 0],
  ];
  const otherIndex = responseIndex === 0 ? 1 : 0;
  const frag = doc.createDocumentFragment();
  for (const [name, value] of rows) {
    const other = name === "Male" ? result.male?.[otherIndex] : name === "Female" ? result.female?.[otherIndex] : result.predictors?.[otherIndex];
    const total = value + (other ?? 0);
    const pct = total ? Math.round((value / total) * 100) : 0;
    const row = doc.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `<span class="name">${name}</span><span class="bar"><span style="width:${pct}%"></span></span><span class="pct">${pct}%</span>`;
    frag.appendChild(row);
  }
  return frag;
}

/**
 * Render an Everybody Votes Channel data envelope into `mount` with GSAP
 * animation.
 * @param {import("./format.js").ChannelData} data envelope with channel "everybodyVotes"
 * @param {HTMLElement} mount container element (cleared and owned by the renderer)
 * @param {{title?: string}} [options]
 * @returns {{destroy: () => void, show: (index: number) => void}}
 */
export function renderEverybodyVotesChannel(data, mount, options = {}) {
  const questions = data?.payload?.questions ?? [];
  const title = options.title ?? "Everybody Votes Channel";

  const doc = mount.ownerDocument;
  ensureStyles(doc);
  mount.classList.add("wevc");
  mount.innerHTML = `
    <header>
      <div class="logo"></div><h1></h1>
      <div class="scope" data-scope></div>
    </header>
    <div class="stage">
      <div class="question" data-question></div>
      <div class="responses" data-responses></div>
      <div class="translations" data-translations></div>
    </div>`;

  mount.querySelector("h1").textContent = title;

  const q = (sel) => mount.querySelector(sel);
  const tweens = [];
  let index = 0;

  function render(i) {
    index = i;
    const question = questions[i];
    if (!question) {
      q("[data-question]").textContent = "No active poll";
      q("[data-responses]").innerHTML = "";
      q("[data-translations]").textContent = "";
      return;
    }
    q("[data-question]").textContent = question.text ?? `Poll ${question.pollId}`;

    const result = resultFor(data, question);
    const responses = q("[data-responses]");
    responses.innerHTML = "";
    (question.responses.length ? question.responses : ["Response 1", "Response 2"]).forEach((label, ri) => {
      const card = doc.createElement("div");
      card.className = "response";
      card.innerHTML = `<div class="label">${label}</div>`;
      if (result) {
        card.appendChild(barsFor(doc, result, ri));
      }
      responses.appendChild(card);
    });

    q("[data-translations]").textContent = question.translations.length > 1
      ? `Also available in ${question.translations.length} languages`
      : "";

    mount.querySelectorAll(".scope span").forEach((el) => el.classList.toggle("on", Number(el.dataset.index) === i));

    const tl = gsap.timeline();
    tl.from("[data-question]", { opacity: 0, y: 10, duration: 0.35, immediateRender: false }).from(
      responses.children,
      { opacity: 0, y: 12, duration: 0.35, stagger: 0.08, immediateRender: false },
      "<0.05",
    );
    tweens.push(tl);
  }

  const scope = q("[data-scope]");
  questions.forEach((question, i) => {
    const el = doc.createElement("span");
    el.dataset.index = String(i);
    el.textContent = question.scope === "worldwide" ? "Worldwide" : "National";
    el.addEventListener("click", () => render(i));
    scope.appendChild(el);
  });

  render(0);

  return {
    show: render,
    destroy() {
      tweens.forEach((t) => t.kill());
      mount.classList.remove("wevc");
      mount.innerHTML = "";
    },
  };
}
