"use strict";

/* ---------- Config ---------- */
// Change this if your server runs on a different port.
const API_BASE = "http://127.0.0.1:8001";
const MAX_SCORE = 10; // gauge scale; adjust if your model uses another range

const PLATFORMS = [
  "Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube",
  "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat",
];
const COUNTRIES = ["India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France", "Other"];

// Field names match the Pydantic StudentData model exactly (typos included).
const FIELDS = {
  age:                     { type: "int",   min: 10, max: 100, label: "Age" },
  gender:                  { type: "text",  label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "text",  label: "Academic level" },
  most_used_platform:      { type: "text",  label: "Most used platform" },
  purpose_of_use:          { type: "text",  label: "Main purpose" },
  avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Daily usage" },
  daily_unloacks:          { type: "int",   min: 0, max: 24, label: "Daily phone unlocks" },
  study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
  physical_sctivity_hours: { type: "float", min: 0, max: 24, label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", min: 0, max: 24, label: "Sleep hours" },
  stress_level:            { type: "text",  label: "Stress level" },
};

const SAMPLE = {
  age: 20, gender: "Female", country: "India", academic_level: "Undergraduate",
  most_used_platform: "Instagram", purpose_of_use: "Entertainment",
  avg_daily_usage_hours: 5.5, daily_unloacks: 14, study_hours: 3,
  physical_sctivity_hours: 0.5, sleep_hours_per_night: 6, stress_level: "High",
};

/* ---------- Elements ---------- */
const $ = (id) => document.getElementById(id);
const form = $("predict-form");
const submitBtn = $("submit-btn");
const states = { empty: $("state-empty"), loading: $("state-loading"), error: $("state-error"), result: $("state-result") };
const history = [];
let lastSummary = "";

/* ---------- Setup ---------- */
$("platform-chips").innerHTML = PLATFORMS.map((name) =>
  `<label><input type="radio" name="most_used_platform" value="${name}"><span>${name}</span></label>`
).join("");
$("country-list").innerHTML = COUNTRIES.map((c) => `<option value="${c}"></option>`).join("");

/* ---------- Helpers ---------- */
const getValue = (name) => String(form.elements[name].value || "").trim();

function setValue(name, value) {
  form.elements[name].value = value;
}

function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
}

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Predicting" : "Predict score";
}

function setFieldError(name, message) {
  const holder = form.querySelector(`[data-error-for="${name}"]`);
  if (!holder) return;
  holder.textContent = message || "";
  holder.closest(".field")?.classList.toggle("invalid", Boolean(message));
}
const clearFieldErrors = () => Object.keys(FIELDS).forEach((n) => setFieldError(n, ""));

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 1800);
}

function showError(title, message, details = []) {
  $("error-title").textContent = title;
  $("error-message").textContent = message;
  const list = $("error-list");
  list.innerHTML = "";
  details.forEach((t) => { const li = document.createElement("li"); li.textContent = t; list.appendChild(li); });
  showState("error");
}

/* ---------- Live interactions ---------- */
// Sliders <-> number inputs
document.querySelectorAll('input[type="range"][data-sync]').forEach((range) => {
  const num = form.elements[range.dataset.sync];
  const paint = () => range.style.setProperty("--pct", `${(Number(range.value) / Number(range.max)) * 100}%`);
  range.addEventListener("input", () => { num.value = range.value; paint(); refreshLive(); });
  num.addEventListener("input", () => { range.value = Math.min(Number(num.value) || 0, Number(range.max)); paint(); });
  range.paint = paint;
});

// +/- steppers
document.querySelectorAll(".step").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.target);
    const min = Number(input.min), max = Number(input.max);
    const current = input.value === "" ? Number(btn.dataset.start) - Number(btn.dataset.delta) : Number(input.value);
    input.value = Math.min(Math.max(current + Number(btn.dataset.delta), min), max);
    setFieldError(input.name, "");
    
refreshLive();
  });
});

const hoursOf = (name) => Math.max(Number(getValue(name)) || 0, 0);
const dayValues = () => ({
  sleep: hoursOf("sleep_hours_per_night"),
  study: hoursOf("study_hours"),
  move: hoursOf("physical_sctivity_hours"),
  social: hoursOf("avg_daily_usage_hours"),
});

function dayMarkup(v) {
  const parts = [
    ["Sleep", v.sleep, "var(--c-sleep)"], ["Study", v.study, "var(--c-study)"],
    ["Activity", v.move, "var(--c-move)"], ["Social media", v.social, "var(--c-social)"],
  ];
  const total = parts.reduce((s, p) => s + p[1], 0);
  const base = Math.max(total, 24);
  const free = 24 - total;
  const fmt = (n) => (Math.round(n * 10) / 10).toString();
  const note = total > 24
    ? `<p class="day-total over">These add up to ${fmt(total)} h, which is ${fmt(total - 24)} h more than a day has. Activities can overlap, so this may be fine.</p>`
    : `<p class="day-total">${fmt(total)} h accounted for, ${fmt(free)} h free.</p>`;
  return `<div class="day-bar">${parts.map((p) => `<span style="width:${(p[1] / base) * 100}%;background:${p[2]}"></span>`).join("")}</div>
    <ul class="day-legend">${parts.map((p) => `<li><i style="background:${p[2]}"></i>${p[0]} ${fmt(p[1])} h</li>`).join("")}</ul>${note}`;
}

function refreshLive() {
  $("day-budget").innerHTML = dayMarkup(dayValues());
  const answered = Object.keys(FIELDS).filter((n) => getValue(n) !== "").length;
  $("answered-count").textContent = answered;
  $("progress-bar").style.width = `${(answered / 12) * 100}%`;
  $("empty-hint").textContent = answered === 12
    ? "Everything is filled in. Choose Predict score."
    : `${12 - answered} ${12 - answered === 1 ? "question" : "questions"} left, then choose Predict score.`;
}

form.addEventListener("input", (e) => { if (e.target.name) setFieldError(e.target.name, ""); refreshLive(); });
form.addEventListener("change", (e) => { if (e.target.name) setFieldError(e.target.name, ""); refreshLive(); });

$("sample-btn").addEventListener("click", () => {
  Object.entries(SAMPLE).forEach(([k, v]) => setValue(k, v));
  document.querySelectorAll('input[type="range"][data-sync]').forEach((r) => {
    r.value = form.elements[r.dataset.sync].value; r.paint();
  });
  clearFieldErrors();
  
refreshLive();
  toast("Sample student loaded");
});

form.addEventListener("reset", () => {
  setTimeout(() => {
    document.querySelectorAll('input[type="range"]').forEach((r) => r.paint());
    clearFieldErrors();
    
refreshLive();
    showState("empty");
  });
});

/* ---------- Validation and payload ---------- */
function buildPayload() {
  const payload = {}, errors = {};
  for (const [name, rules] of Object.entries(FIELDS)) {
    const raw = getValue(name);
    if (raw === "") { errors[name] = `${rules.label} is required.`; continue; }
    if (rules.type === "text") { payload[name] = raw; continue; }
    const value = Number(raw);
    if (Number.isNaN(value)) errors[name] = "Enter a valid number.";
    else if (rules.type === "int" && !Number.isInteger(value)) errors[name] = "Enter a whole number.";
    else if (value < rules.min || value > rules.max) errors[name] = `Enter a value from ${rules.min} to ${rules.max}.`;
    else payload[name] = value;
  }
  return { payload, errors };
}

/* ---------- API ---------- */
async function requestPrediction(payload) {
  let response;
  try {
    response = await fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw Object.assign(new Error("network"), { kind: "network" });
  }
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON body */ }
  if (!response.ok) throw Object.assign(new Error("http"), { kind: "http", status: response.status, body });
  return body;
}

// FastAPI 422 shape: { detail: [{ loc: ["body", "age"], msg: "..." }] }
function handleValidationError(detail) {
  const messages = [];
  if (Array.isArray(detail)) {
    detail.forEach((item) => {
      const field = item.loc?.[item.loc.length - 1];
      const text = item.msg || "Invalid value.";
      if (field in FIELDS) { setFieldError(field, text); messages.push(`${FIELDS[field].label}: ${text}`); }
      else messages.push(text);
    });
  }
  showError("Some answers need a change", "The server rejected these values. Fix the highlighted fields and try again.", messages);
}

/* ---------- Result ---------- */
function describeScore(score) {
  if (score <= 4) return { band: "Lower score", note: "The model associates these habits with weaker mental health.", color: "var(--g-low)" };
  if (score <= 6) return { band: "Moderate score", note: "The model sees a mixed picture for these habits.", color: "var(--g-mid)" };
  return { band: "Higher score", note: "The model associates these habits with stronger mental health.", color: "var(--g-high)" };
}

function buildInsights(p) {
  const notes = [];
  if (p.sleep_hours_per_night < 7) notes.push(["warn", `Sleep is ${p.sleep_hours_per_night} h. Around 7 to 9 h is commonly recommended.`]);
  else notes.push(["good", `Sleep of ${p.sleep_hours_per_night} h is within the commonly recommended range.`]);
  if (p.avg_daily_usage_hours >= 5) notes.push(["warn", `${p.avg_daily_usage_hours} h of daily social media is on the high side.`]);
  else if (p.avg_daily_usage_hours <= 2) notes.push(["good", "Social media time is modest."]);
  if (p.physical_sctivity_hours < 0.5) notes.push(["warn", "There is very little physical activity. Even short daily walks can help."]);
  else if (p.physical_sctivity_hours >= 1) notes.push(["good", "At least an hour of daily activity is a healthy habit."]);
  if (["High", "Very High"].includes(p.stress_level)) notes.push(["warn", `Self-reported stress is ${p.stress_level.toLowerCase()}.`]);
  return notes.slice(0, 4);
}

function renderHistory() {
  $("history-block").hidden = history.length < 2;
  $("history").innerHTML = history.slice(0, 5).map((h, i) =>
    `<li><b>${h.score}</b><div class="bar"><span style="width:${(h.score / MAX_SCORE) * 100}%"></span></div><em>${i === 0 ? "now" : h.platform}</em></li>`
  ).join("");
}

function showResult(score, p) {
  const info = describeScore(score);
  const fill = $("gauge-fill"), number = $("score-number");
  const prev = history[0];

  history.unshift({ score, platform: p.most_used_platform });
  if (history.length > 8) history.pop();

  $("score-band").textContent = info.band;
  $("score-note").textContent = info.note;

  const delta = $("score-delta");
  if (prev && prev.score !== score) {
    const diff = score - prev.score;
    delta.textContent = `${diff > 0 ? "+" : ""}${diff} vs last run`;
    delta.className = `delta ${diff > 0 ? "up" : "down"}`;
    delta.hidden = false;
  } else if (prev) {
    delta.textContent = "same as last run";
    delta.className = "delta";
    delta.hidden = false;
  } else delta.hidden = true;

  $("result-day").innerHTML = dayMarkup({
    sleep: p.sleep_hours_per_night, study: p.study_hours,
    move: p.physical_sctivity_hours, social: p.avg_daily_usage_hours,
  });
  $("insights").innerHTML = buildInsights(p).map(([type, text], i) =>
    `<li class="${type}" style="animation-delay:${0.5 + i * 0.12}s">${text}</li>`).join("");
  const profile = [`${p.age} years`, p.gender, p.country, p.academic_level, p.most_used_platform, p.purpose_of_use, `${p.stress_level} stress`];
  $("profile-chips").replaceChildren(...profile.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  renderHistory();

  lastSummary = `Predicted mental health score: ${score}/${MAX_SCORE} (${info.band}). `
    + `Profile: ${p.age}, ${p.gender}, ${p.country}, ${p.academic_level}. `
    + `Platform: ${p.most_used_platform} for ${p.purpose_of_use.toLowerCase()}, ${p.avg_daily_usage_hours} h/day. `
    + `Sleep ${p.sleep_hours_per_night} h, study ${p.study_hours} h, activity ${p.physical_sctivity_hours} h, stress ${p.stress_level}.`;

  fill.style.stroke = info.color;
  fill.style.strokeDashoffset = 100;
  number.textContent = "0";
  showState("result");
  $("state-result").closest(".result-panel").scrollTop = 0;

  const ratio = Math.min(Math.max(score / MAX_SCORE, 0), 1);
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.strokeDashoffset = 100 - ratio * 100; }));

  const start = performance.now();
  (function tick(now) {
    const t = Math.min((now - start) / 900, 1);
    number.textContent = String(Math.round(score * t));
    if (t < 1) requestAnimationFrame(tick);
  })(start);

  if (window.matchMedia("(max-width: 900px)").matches) $("state-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Events ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors();

  const { payload, errors } = buildPayload();
  const invalid = Object.keys(errors);
  if (invalid.length) {
    invalid.forEach((n) => setFieldError(n, errors[n]));
    form.querySelector(`[name="${invalid[0]}"]`).focus();
    form.querySelector(`[data-error-for="${invalid[0]}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  setLoading(true);
  showState("loading");
  try {
    const data = await requestPrediction(payload);
    showResult(Number(data.predicted_mental_health_score), payload);
  } catch (err) {
    if (err.kind === "network") showError("Can’t reach the server", `Check that the API is running at ${API_BASE} and that the port matches.`);
    else if (err.status === 422) handleValidationError(err.body?.detail);
    else if (err.status >= 500) showError("The server hit an error", "The model could not process this request. Check the uvicorn terminal for the traceback.");
    else showError("Request failed", `The server answered with status ${err.status}.`);
  } finally {
    setLoading(false);
  }
});

$("retry-btn").addEventListener("click", () => showState(history.length ? "result" : "empty"));
$("edit-btn").addEventListener("click", () => form.scrollIntoView({ behavior: "smooth", block: "start" }));
$("copy-btn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(lastSummary); toast("Summary copied"); }
  catch { toast("Copy isn’t available in this browser"); }
});


/* ---------- Starfield (slow twinkle, purely decorative) ---------- */
function buildSky(el, { yUnit, yMax, scale = 1 }) {
  const layers = [
    { n: Math.round(60 * scale), size: 1,   dur: 7 },
    { n: Math.round(28 * scale), size: 1.6, dur: 11 },
    { n: Math.round(10 * scale), size: 2.4, dur: 16 },
  ];
  el.replaceChildren(...layers.map((l, i) => {
    const dots = Array.from({ length: l.n }, () =>
      `${(Math.random() * 100).toFixed(1)}vw ${(Math.random() * yMax).toFixed(1)}${yUnit} 0 0 currentColor`
    ).join(",");
    const layer = document.createElement("div");
    layer.className = "star-layer";
    layer.style.cssText = `width:${l.size}px;height:${l.size}px;box-shadow:${dots};--dur:${l.dur}s;animation-delay:-${i * 3}s`;
    return layer;
  }));
}
buildSky($("page-sky"), { yUnit: "vh", yMax: 100 });
buildSky($("hero-sky"), { yUnit: "rem", yMax: 26, scale: 0.9 });

refreshLive();
