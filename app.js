/* Calm Calendar app. Self contained: data lives on this device only.
   The calendar grid shows the whole truth. The list under it is the day,
   adapted to how you feel. Parked means parked, never dropped. */
(function () {
"use strict";
var L = window.CalmLogic;
var STORE = "calmcal-v1";
/* Accounts wave: the document gets an owner. Storage keys are
   per-identity — "calmcal-v1:guest" signed out, "calmcal-v1:<uid>"
   per account — so accounts on one device never bleed across. The
   legacy bare key migrates to the guest key on first boot (the
   original stays, frozen, as a backup; nothing is ever deleted). */
var FB = window.PaceFB || { configured: false, session: function () { return null; } };
var ACTIVE_UID = null;
try { var sess0 = FB.configured ? FB.session() : null; if (sess0 && sess0.uid) ACTIVE_UID = String(sess0.uid); } catch (e) {}
function storeKey() { return ACTIVE_UID ? STORE + ":" + ACTIVE_UID : STORE + ":guest"; }
try { if (!localStorage.getItem(STORE + ":guest") && localStorage.getItem(STORE)) localStorage.setItem(STORE + ":guest", localStorage.getItem(STORE)); } catch (e) {}
var state = load();
var selected = L.todayKey();
var currentView = "dayGridMonth";
var calendar = null;
var currentTaskId = null;
var currentInstanceDate = null;
var drafts = [];

function uid() { return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function icon(name) { return '<svg class="ico" aria-hidden="true"><use href="#' + name + '"/></svg>'; }
function $(id) { return document.getElementById(id); }

function defaultSettings() {
  return {
    checkinTime: "08:00",
    names: { low: "Bad", steady: "Ok", full: "Great" },
    notif: { perm: "off", checkin: true, start: true, setup: 5, digest: true, digestTimes: ["12:30", "16:30"], done: false, doneTime: "20:00" },
    pausedDate: null,
    appearance: { theme: "white", cute: false, photo: null, photoMode: "light", bgChoice: "theme" },
    sidebarCollapsed: true,
    profileName: ""
  };
}
function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
/* A clock time as HH:MM if it is a real time of day, else null. */
function validClock(x) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(x == null ? "" : x).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return L.pad(+m[1]) + ":" + m[2];
}
function load(fromKey) {
  try {
    var raw = localStorage.getItem(fromKey || storeKey());
    if (!raw) return null;
    var s = JSON.parse(raw);
    if (!isObj(s)) return null;
    /* Normalise every field the app leans on. All of a user's data lives in
       this one key; a wrong-shaped field must recover, never brick the app. */
    if (!Array.isArray(s.tasks)) s.tasks = [];
    s.tasks = s.tasks.filter(function (t) { return isObj(t) && typeof t.title === "string"; });
    s.tasks.forEach(function (t) {
      if (!t.id) t.id = uid();
      if (typeof t.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) t.date = L.todayKey();
      if (!Array.isArray(t.skipDates)) t.skipDates = [];
      if (!Array.isArray(t.doneDates)) t.doneDates = [];
      if (!Array.isArray(t.steps)) t.steps = [];
      if (typeof t.durationMin !== "number" || !(t.durationMin > 0)) t.durationMin = 25;
      if (typeof t.status !== "string") t.status = "todo";
    });
    if (!isObj(s.feelings)) s.feelings = {};
    if (!isObj(s.sent)) s.sent = {};
    if (typeof s.todos === "string" && s.todos) s.todos = [{ text: s.todos }];
    if (!Array.isArray(s.todos)) s.todos = [];
    /* Entry-level heal (QA's named seed, accounts phase): a bare
       string ENTRY inside todos becomes an item — repaired, never
       dropped like the field-level string already was. */
    s.todos = s.todos.map(function (t) { return typeof t === "string" && t ? { text: t } : t; });
    s.todos = s.todos.filter(function (t) { return isObj(t) && typeof t.text === "string"; });
    s.todos.forEach(function (t) {
      if (!t.id) t.id = uid();
      t.done = !!t.done;
      if (typeof t.calTaskId !== "string") t.calTaskId = null;
    });
    if (!Array.isArray(s.habits)) s.habits = [];
    s.habits = s.habits.filter(function (h) { return isObj(h) && typeof h.name === "string"; });
    s.habits.forEach(function (h) {
      if (!h.id) h.id = uid();
      if (L.HABIT_ICONS.indexOf(h.icon) === -1) h.icon = "star";
      if (!isObj(h.days)) h.days = {};
    });
    s.settings = Object.assign(defaultSettings(), isObj(s.settings) ? s.settings : {});
    s.settings.notif = Object.assign(defaultSettings().notif, isObj(s.settings.notif) ? s.settings.notif : {});
    if (!isObj(s.settings.names)) s.settings.names = defaultSettings().names;
    ["low", "steady", "full"].forEach(function (k) {
      if (typeof s.settings.names[k] !== "string" || !s.settings.names[k].trim()) s.settings.names[k] = defaultSettings().names[k];
    });
    // The feeling words ruling (15 Oct): the three choices read
    // Bad · Ok · Great. A profile still carrying the COMPLETE
    // old factory set (Bad/Ok/Good) never customised them, so
    // it rides the rename; any customised name is the user's
    // own and stays exactly as they left it (Law B).
    if (s.settings.names.low === "Bad" && s.settings.names.steady === "Ok" && s.settings.names.full === "Good") s.settings.names.full = "Great";
    s.settings.appearance = Object.assign(defaultSettings().appearance, isObj(s.settings.appearance) ? s.settings.appearance : {});
    /* Law E: the user's own background photo is USER DATA (Law B) —
       a wrong-shaped value repairs to "no photo", never deletes by
       surprise beyond its own field. */
    if (typeof s.settings.appearance.photo !== "string" || s.settings.appearance.photo.indexOf("data:image/") !== 0 || s.settings.appearance.photo.length > 4200000) s.settings.appearance.photo = null;
    if (s.settings.appearance.photoMode !== "dark") s.settings.appearance.photoMode = "light";
    if (s.settings.appearance.bgChoice !== "photo" || !s.settings.appearance.photo) s.settings.appearance.bgChoice = "theme";
    if (typeof s.settings.sidebarCollapsed !== "boolean") s.settings.sidebarCollapsed = !!s.settings.sidebarCollapsed;
    s.settings.sidebarCollapsed = true; // Sidebar Adaptive Law, final shape: hidden on EVERY load; opening is per-session only.
    if (typeof s.settings.profileName !== "string") s.settings.profileName = s.settings.profileName == null ? "" : String(s.settings.profileName);
    if (typeof s.settings.guideDone !== "boolean") s.settings.guideDone = !!s.settings.guideDone;
    var times = (Array.isArray(s.settings.notif.digestTimes) ? s.settings.notif.digestTimes : []).map(validClock).filter(Boolean);
    s.settings.notif.digestTimes = times.length ? times : ["12:30"];
    s.welcomed = !!s.welcomed;
    s.imports = (Array.isArray(s.imports) ? s.imports : []).filter(function (r) { return r && typeof r === "object" && typeof r.key === "string"; }).map(function (r) { return { key: r.key, source: String(r.source || "calendar"), at: String(r.at || ""), count: Math.max(0, Math.round(+r.count) || 0) }; });
    return s;
  } catch (e) {}
  return null;
}
function save() {
  try {
    if (state) state.updatedAt = Date.now();
    localStorage.setItem(storeKey(), JSON.stringify(state));
  } catch (e) {}
  scheduleSync();
}

function seed() {
  var today = L.todayKey(), tomorrow = L.addDays(today, 1);
  function mk(title, date, time, dur, extra) {
    var cat = L.categoryFor(title);
    return Object.assign({ id: uid(), title: title, date: date, time: time, durationMin: dur, priority: 0, repeat: null, category: cat.id, color: cat.color, essential: false, status: "todo", steps: L.decompose(title, dur, false), minVersion: "", fullVersion: "", source: "sample", originalText: "", skipDates: [], doneDates: [] }, extra || {});
  }
  // Empty-Start Law (14 Oct): the store build starts EMPTY for every user.
  // The store wrapper (Capacitor) is detectable at runtime; the web app
  // keeps its samples. Existing saved data is never touched either way.
  var storeBuild = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var tasks = storeBuild ? [] : [
    mk("Doctor appointment", today, "10:00", 45, { essential: true, minVersion: "Ring the doctor to rebook" }),
    mk("Pay the electricity bill", today, null, 15, { essential: true, priority: 3 }),
    mk("Clean the kitchen", today, "16:00", 30, {}),
    mk("Reply to one email", today, null, 10, {}),
    mk("Walk around the block", today, "17:30", 15, {}),
    mk("Plan the weekend", today, null, 45, {}),
    mk("Buy groceries for the week", tomorrow, null, 45, {}),
    mk("Call mum", tomorrow, "17:00", 15, {})
  ];
  return { tasks: tasks, feelings: {}, settings: defaultSettings(), welcomed: false, sent: {}, todos: [], habits: [], imports: [] };
}
if (!state) { state = ACTIVE_UID ? freshAccountState() : seed(); save(); }

/* ---------- instances (recurrence expansion) ---------- */
function repeatMatches(task, key) {
  if (!task.repeat) return key === task.date;
  if (key < task.date) return false;
  var d = L.parseKey(key), wd = d.getDay();
  var r = task.repeat;
  if (r === "every day") return true;
  if (r === "every weekday") return wd >= 1 && wd <= 5;
  if (r === "every weekend") return wd === 0 || wd === 6;
  if (r === "every week") return wd === L.parseKey(task.date).getDay();
  var names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (r === "every " + names[wd]) return true;
  return false;
}
function instanceOf(task, key) {
  var copy = {}; for (var k in task) copy[k] = task[k];
  copy.date = key;
  copy.instanceDate = key;
  if (task.repeat && (task.doneDates || []).indexOf(key) !== -1) copy.status = "done";
  return copy;
}
function tasksOn(key) {
  var out = [];
  state.tasks.forEach(function (t) {
    if ((t.skipDates || []).indexOf(key) !== -1) return;
    if (repeatMatches(t, key)) out.push(instanceOf(t, key));
  });
  return out;
}
function instancesInRange(a, b) {
  var out = [], key = a;
  while (key <= b) { out = out.concat(tasksOn(key)); key = L.addDays(key, 1); }
  return out;
}
function baseTask(id) { return state.tasks.filter(function (t) { return t.id === id; })[0]; }
function levelFor(key) { return state.feelings[key] || "steady"; }
function adaptedFor(key) {
  return L.adaptDay(tasksOn(key), levelFor(key), tasksOn(L.addDays(key, 1)));
}

/* ---------- appearance + sidebar ---------- */
var THEME_COLORS = { white: "#ffffff", dark: "#161618", blush: "#fff8fa", sky: "#f7fbff", mint: "#f6fcf8", lavender: "#faf8ff", brand: "#dce1f6", photolight: "#f3f5fa", photodark: "#141f1b" };
function applyAppearance() {
  var a = state.settings.appearance;
  var root = document.documentElement;
  var photoOn = a.bgChoice === "photo" && typeof a.photo === "string" && !!a.photo;
  if (photoOn) {
    root.setAttribute("data-theme", a.photoMode === "dark" ? "photodark" : "photolight");
    root.setAttribute("data-photo", a.photoMode);
    root.style.setProperty("--photo", 'url("' + a.photo + '")');
  } else {
    root.setAttribute("data-theme", a.theme || "white");
    root.removeAttribute("data-photo");
    root.style.removeProperty("--photo");
  }
  if (a.cute) root.setAttribute("data-cute", "1"); else root.removeAttribute("data-cute");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[root.getAttribute("data-theme")] || "#ffffff");
  document.querySelectorAll(".swatch[data-theme-set]").forEach(function (b) { b.classList.toggle("is-active", !photoOn && b.getAttribute("data-theme-set") === a.theme); });
  var pa = $("photoApply");
  if (pa) {
    pa.hidden = !a.photo;
    pa.classList.toggle("is-active", photoOn);
    var dot = $("photoDot");
    if (dot && a.photo) { dot.style.backgroundImage = 'url("' + a.photo + '")'; dot.style.backgroundSize = "cover"; dot.style.backgroundPosition = "center"; }
  }
  var pr = $("photoRemove"); if (pr) pr.hidden = !a.photo;
  $("cuteToggle").checked = !!a.cute;
}
function applySidebar() {
  var root = document.documentElement;
  if (state.settings.sidebarCollapsed) root.setAttribute("data-sb", "collapsed"); else root.removeAttribute("data-sb");
  $("sbToggle").checked = !state.settings.sidebarCollapsed;
  // F1 (final sweep): the calendar measures itself at init,
  // before the sidebar settles — re-size it against the final
  // layout on every sidebar change, or a fresh phone load
  // paints the grid at a stale, narrower width forever.
  if (calendar) calendar.updateSize();
}
document.querySelectorAll(".swatch[data-theme-set]").forEach(function (b) {
  b.addEventListener("click", function () { var t = b.getAttribute("data-theme-set"); state.settings.appearance.theme = t; state.settings.appearance.bgChoice = "theme"; save(); applyAppearance(); if (t !== "white" && t !== "dark") maybePlus("look"); });
});
$("cuteToggle").addEventListener("change", function () { state.settings.appearance.cute = $("cuteToggle").checked; save(); applyAppearance(); if ($("cuteToggle").checked) maybePlus("cute"); });
/* Law E — the user's own photo as the background. The photo is user
   data: picking another look never deletes it; only Remove does,
   and Remove carries Undo (Law B2). A soft veil + an ink set chosen
   from the photo's own brightness keep every word readable (AA). */
$("bgPhotoBtn").addEventListener("click", function () { $("bgPhotoFile").click(); });
$("bgPhotoFile").addEventListener("change", function () {
  var f = $("bgPhotoFile").files && $("bgPhotoFile").files[0];
  $("bgPhotoFile").value = "";
  if (!f) return;
  var url = URL.createObjectURL(f);
  var img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    var scale = Math.min(1, 1440 / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var cx = cv.getContext("2d"); cx.drawImage(img, 0, 0, w, h);
    var tiny = document.createElement("canvas"); tiny.width = 24; tiny.height = 24;
    var tx = tiny.getContext("2d"); tx.drawImage(cv, 0, 0, 24, 24);
    var px = tx.getImageData(0, 0, 24, 24).data, lum = 0;
    for (var i = 0; i < px.length; i += 4) lum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    lum /= (px.length / 4);
    var prev = { photo: state.settings.appearance.photo, photoMode: state.settings.appearance.photoMode, bgChoice: state.settings.appearance.bgChoice };
    state.settings.appearance.photo = cv.toDataURL("image/jpeg", 0.85);
    state.settings.appearance.photoMode = lum >= 0.45 ? "light" : "dark";
    state.settings.appearance.bgChoice = "photo";
    save();
    var kept = false;
    try { kept = (JSON.parse(localStorage.getItem(storeKey())).settings.appearance.photo || "").length > 1000; } catch (e) {}
    if (!kept) {
      state.settings.appearance.photo = prev.photo; state.settings.appearance.photoMode = prev.photoMode; state.settings.appearance.bgChoice = prev.bgChoice;
      save(); applyAppearance();
      toast("That photo is too big to keep on this device. A smaller one will fit.");
      return;
    }
    applyAppearance();
    toast("Your photo is the background now. A soft veil keeps the words readable.");
  };
  img.onerror = function () { URL.revokeObjectURL(url); toast("That file did not read as a photo. Nothing changed."); };
  img.src = url;
});
$("photoApply").addEventListener("click", function () {
  if (!state.settings.appearance.photo) return;
  state.settings.appearance.bgChoice = "photo"; save(); applyAppearance();
});
$("photoRemove").addEventListener("click", function () {
  var a = state.settings.appearance;
  var kept = { photo: a.photo, photoMode: a.photoMode };
  a.photo = null; a.bgChoice = "theme"; save(); applyAppearance();
  toast("Photo removed.", function () {
    state.settings.appearance.photo = kept.photo; state.settings.appearance.photoMode = kept.photoMode; state.settings.appearance.bgChoice = "photo";
    save(); applyAppearance();
  });
});
$("sbCollapse").addEventListener("click", function () { state.settings.sidebarCollapsed = true; save(); applySidebar(); });
$("sbExpand").addEventListener("click", function () { state.settings.sidebarCollapsed = false; save(); applySidebar(); });
$("sbToggle").addEventListener("change", function () { state.settings.sidebarCollapsed = !$("sbToggle").checked; save(); applySidebar(); });
function renderRing() {
  var score = L.dayScore(adaptedFor(L.todayKey()));
  var fg = $("ringFg");
  if (fg) fg.style.strokeDashoffset = String(113 * (1 - score.pct / 100));
  var pct = $("ringPct");
  if (pct) pct.textContent = score.pct + "%";
}

/* ---------- toast ---------- */
var toastTimer = null;
function toast(msg, undoFn) {
  var t = $("toast"); t.innerHTML = ""; t.appendChild(document.createTextNode(msg));
  clearTimeout(toastTimer);
  if (typeof undoFn === "function") {
    var b = document.createElement("button");
    b.type = "button"; b.className = "toast-undo"; b.textContent = "Undo";
    b.addEventListener("click", function () { clearTimeout(toastTimer); t.hidden = true; undoFn(); });
    t.appendChild(b);
    t.hidden = false;
    toastTimer = setTimeout(function () { t.hidden = true; }, 6500);
  } else {
    t.hidden = false;
    toastTimer = setTimeout(function () { t.hidden = true; }, 3400);
  }
}
function restoreAt(arr, item, index) { arr.splice(Math.min(index, arr.length), 0, item); }

/* ---------- ticker ---------- */
function renderTicker() {
  var el = $("ticker"); el.innerHTML = "";
  var start = L.addDays(selected, -15);
  var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (var i = 0; i < 31; i++) {
    (function (key) {
      var d = L.parseKey(key);
      var btn = document.createElement("button");
      btn.className = "tick" + (key === L.todayKey() ? " is-today" : "") + (key === selected ? " is-selected" : "");
      btn.setAttribute("data-date", key);
      var dayTasks = tasksOn(key).filter(function (t) { return t.status !== "done"; });
      var pills = "", seen = {};
      dayTasks.slice(0, 12).forEach(function (t) { if (!seen[t.color]) { seen[t.color] = 1; pills += '<span class="tick-pill" style="background:' + t.color + '"></span>'; } });
      btn.innerHTML = '<span class="tick-wd">' + names[d.getDay()] + '</span><span class="tick-num">' + d.getDate() + '</span><span class="tick-pills">' + pills + "</span>";
      btn.addEventListener("click", function () { selectDate(key, true); });
      el.appendChild(btn);
    })(L.addDays(start, i));
  }
  var sel = el.querySelector('[data-date="' + selected + '"]');
  if (sel) el.scrollTo({ left: sel.offsetLeft - el.clientWidth / 2 + 26, behavior: tickerBooted ? "smooth" : "auto" });
  tickerBooted = true;
}
var tickerBooted = false;

/* ---------- day list (the adapted plan) ---------- */
function renderDayList() {
  var key = selected;
  var ad = adaptedFor(key);
  var score = L.dayScore(ad);
  var d = L.parseKey(key);
  var level = levelFor(key);
  var names = state.settings.names;
  var html = "<h3>" + d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) +
    '<span class="dl-score">' + score.done + " of " + score.total + " done at your " + esc(names[level]) + " pace</span></h3>";
  html += '<div class="dl-progress"><i style="width:' + score.pct + '%"></i></div>';
  if (!ad.visible.length && !ad.done.length) html += '<div class="empty-note dock-note"><span class="dock-skip">' + skipSvg("goodbye") + '</span><span>Nothing today. Empty is allowed.</span></div>';
  ad.visible.forEach(function (t) { html += rowHtml(t, false); });
  ad.done.forEach(function (t) { html += rowHtml(t, true); });
  if (ad.stretch) html += '<div class="stretch-note">One more from tomorrow: <strong>' + esc(ad.stretch.title) + '</strong><button data-act="stretch" data-id="' + ad.stretch.id + '">Bring it to today</button></div>';
  if (ad.parked.length) html += '<p class="parked-note">' + (ad.parked.length === 1 ? "1 thing" : ad.parked.length + " things") + " parked. Parked, not dropped. Raise the level to bring them back.</p>";
  $("dayList").innerHTML = html;
  bindRows($("dayList"));
}
function rowHtml(t, done) {
  var meta = [];
  if (t.time) meta.push(t.time);
  meta.push("about " + t.durationMin + " min");
  if (t.steps && t.steps.length) meta.push(t.steps.filter(function (s) { return s.done; }).length + " of " + t.steps.length + " steps");
  if (t.shrunk) meta.push("small version");
  if (t.repeat) meta.push(t.repeat);
  return '<div draggable="true" class="task-row' + (done ? " is-done" : "") + '" data-id="' + t.id + '" data-date="' + t.instanceDate + '">' +
    '<span class="tr-dot" style="background:' + t.color + '"></span>' +
    '<span class="tr-main"><span class="tr-title">' + esc(t.displayTitle || t.title) + '</span><span class="tr-meta">' + esc(meta.join(" · ")) + "</span></span>" +
    '<button class="tr-check" data-check="' + t.id + '" aria-label="Mark done">' + (done ? icon("i-check") : "") + "</button></div>";
}
function bindRows(root) {
  root.querySelectorAll(".task-row").forEach(function (row) {
    row.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-check")) return;
      openTask(row.getAttribute("data-id"), row.getAttribute("data-date"));
    });
  });
  root.querySelectorAll("[data-check]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var row = btn.closest(".task-row");
      toggleDone(row.getAttribute("data-id"), row.getAttribute("data-date"));
    });
  });
  var st = root.querySelector('[data-act="stretch"]');
  if (st) st.addEventListener("click", function () {
    var t = baseTask(st.getAttribute("data-id"));
    if (t) { moveInstance(t, L.addDays(selected, 1), selected); toast("Brought to today. Only because you asked."); refreshAll(); }
  });
}
function toggleDone(id, dateKey) {
  var t = baseTask(id); if (!t) return;
  if (t.repeat) {
    t.doneDates = t.doneDates || [];
    var i = t.doneDates.indexOf(dateKey);
    if (i === -1) t.doneDates.push(dateKey); else t.doneDates.splice(i, 1);
  } else {
    t.status = t.status === "done" ? "todo" : "done";
    if (t.status === "done") toast("Done. That counts.");
  }
  save(); refreshAll();
}
/* Move one occurrence of a (possibly repeating) task to another date. */
function moveInstance(t, fromKey, toKey) {
  if (t.repeat || fromKey !== t.date) {
    t.skipDates = t.skipDates || [];
    if (t.skipDates.indexOf(fromKey) === -1) t.skipDates.push(fromKey);
    var copy = {}; for (var k in t) copy[k] = t[k];
    copy.id = uid(); copy.date = toKey; copy.repeat = null; copy.skipDates = []; copy.doneDates = [];
    copy.steps = (t.steps || []).map(function (s) { return { text: s.text, done: s.done }; });
    state.tasks.push(copy);
    return copy;
  }
  t.date = toKey;
  return t;
}

/* ---------- up next ---------- */
function renderUpNext() {
  var el = $("upNext");
  var today = L.todayKey();
  if (selected !== today) { el.hidden = true; return; }
  var ad = adaptedFor(today);
  var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  var timed = ad.visible.filter(function (t) { return t.time && L.toMin(t.time) >= nowMin; });
  var next = timed[0] || ad.visible[0];
  if (!next) { el.hidden = true; return; }
  el.hidden = false;
  var firstStep = (next.steps && next.steps.some(function (s) { return !s.done; })) ? L.nextStepText(next) : "";
  el.innerHTML = '<span class="un-label">Up next</span><strong>' + esc(next.displayTitle || next.title) + "</strong> · about " + next.durationMin + " min" +
    (next.time ? " · " + next.time : "") + (firstStep ? "<br><span style='color:var(--ink-3)'>" + esc(firstStep) + "</span>" : "") + '<button data-un="' + next.id + '">Start</button>';
  el.querySelector("[data-un]").addEventListener("click", function () {
    var t = baseTask(next.id); if (t) { t.status = "doing"; save(); refreshAll(); toast("Started. One step at a time."); }
  });
}

/* ---------- check-in ---------- */
function renderCheckin() {
  var level = state.feelings[selected];
  document.querySelectorAll(".level-btn").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-level") === level);
  });
  var names = state.settings.names;
  document.querySelectorAll("[data-level-name]").forEach(function (s) { s.textContent = names[s.getAttribute("data-level-name")]; });
  var sl = $("sideLevel");
  var todayLevel = state.feelings[L.todayKey()];
  sl.innerHTML = todayLevel ? "Today: <strong>" + esc(names[todayLevel]) + "</strong>" : "No check-in yet today";
  $("checkinQ").textContent = selected === L.todayKey() ? "How are you feeling today?" : "How does this day feel?";
}
document.querySelectorAll(".level-btn").forEach(function (b) {
  b.addEventListener("click", function () {
    var level = b.getAttribute("data-level");
    state.feelings[selected] = level; save();
    markActivated("check-in");
    if (level === "low") toast("Bad day. Small list — the rest is parked, safe.");
    else if (level === "full") toast("Great day. A little more is on the table.");
    else toast("Ok day. A small, capped list.");
    refreshAll();
  });
});

/* ---------- calendar ---------- */
function fcEvents() {
  var a = L.addDays(selected, -45), b = L.addDays(selected, 80);
  return instancesInRange(a, b).map(function (t) {
    var ev = { id: t.id + "@" + t.instanceDate, taskId: t.id, instanceDate: t.instanceDate, title: t.title, allDay: !t.time, backgroundColor: t.color, borderColor: t.color, extendedProps: { taskId: t.id, instanceDate: t.instanceDate } };
    if (t.time) {
      var startMin = L.toMin(t.time);
      ev.start = t.instanceDate + "T" + t.time + ":00";
      ev.end = t.instanceDate + "T" + L.toHHMM(startMin + t.durationMin) + ":00";
      if (startMin + t.durationMin >= 1440) { ev.end = L.addDays(t.instanceDate, 1) + "T" + L.toHHMM(startMin + t.durationMin) + ":00"; }
    } else { ev.start = t.instanceDate; }
    if (t.status === "done") ev.classNames = ["ev-done"];
    return ev;
  });
}
function initCalendar() {
  calendar = new FullCalendar.Calendar($("calendar"), {
    initialView: "dayGridMonth",
    height: "auto",
    firstDay: 1,
    headerToolbar: false,
    editable: true,
    dayMaxEvents: 3,
    slotMinTime: "06:00:00",
    slotMaxTime: "22:00:00",
    scrollTime: "07:30:00",
    eventDidMount: function (info) {
      var c = info.event.backgroundColor || "#5b6bd5";
      info.el.classList.add("ev-calm");
      info.el.style.setProperty("--ev-c", c);
      if (info.el.classList.contains("fc-daygrid-event") || info.el.classList.contains("fc-timegrid-event")) {
        info.el.style.background = "color-mix(in srgb, " + c + " 15%, var(--card))";
        info.el.style.borderLeft = "3px solid " + c;
        info.el.style.color = "var(--ink)";
      }
    },
    eventDurationEditable: true,
    longPressDelay: 250,
    events: fcEvents(),
    dateClick: function (info) { selectDate(info.dateStr.slice(0, 10), false); },
    eventClick: function (info) { openTask(info.event.extendedProps.taskId, info.event.extendedProps.instanceDate); },
    eventDrop: function (info) {
      var t = baseTask(info.event.extendedProps.taskId); if (!t) return;
      var fromKey = info.event.extendedProps.instanceDate;
      var newStart = info.event.start;
      var newKey = L.toKey(newStart);
      if (t.repeat || fromKey !== t.date) {
        var copy = moveInstance(t, fromKey, newKey);
        if (info.event.allDay === false && newStart.getHours() !== undefined) copy.time = L.pad(newStart.getHours()) + ":" + L.pad(newStart.getMinutes());
      } else {
        t.date = newKey;
        if (!info.event.allDay) t.time = L.pad(newStart.getHours()) + ":" + L.pad(newStart.getMinutes());
      }
      save(); refreshAll(); toast("Moved. The day re-shaped itself.");
    },
    eventResize: function (info) {
      var t = baseTask(info.event.extendedProps.taskId); if (!t) return;
      var mins = Math.max(5, Math.round((info.event.end - info.event.start) / 60000));
      t.durationMin = mins; save(); refreshAll();
    },
    datesSet: function () { renderTitle(); }
  });
  calendar.render();
  var style = document.createElement("style");
  style.textContent = ".ev-done{opacity:.45} .ev-done .fc-event-title{text-decoration:line-through}";
  document.head.appendChild(style);
}
function renderTitle() {
  var d = calendar ? calendar.getDate() : L.parseKey(selected);
  $("monthTitle").textContent = d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}
function refreshCalendar() {
  if (!calendar) return;
  calendar.removeAllEvents();
  fcEvents().forEach(function (e) { calendar.addEvent(e); });
}
function selectDate(key, jumpCalendar) {
  selected = key;
  if (calendar && jumpCalendar) calendar.gotoDate(key);
  renderTicker(); renderDayList(); renderUpNext(); renderCheckin(); renderYear();
}
$("monthTitle").addEventListener("click", function () { selectDate(L.todayKey(), true); });
document.querySelectorAll(".segmented button").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".segmented button").forEach(function (x) { x.classList.remove("is-active"); });
    b.classList.add("is-active");
    var v = b.getAttribute("data-view");
    currentView = v;
    if (v === "year") { $("calendar").hidden = true; $("yearView").hidden = false; renderYear(); }
    else { $("calendar").hidden = false; $("yearView").hidden = true; calendar.changeView(v, selected); }
  });
});
function renderYear() {
  if (currentView !== "year") return;
  var year = L.parseKey(selected).getFullYear();
  var html = '<div class="year-grid">';
  var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (var m = 0; m < 12; m++) {
    var first = new Date(year, m, 1);
    var daysIn = new Date(year, m + 1, 0).getDate();
    var lead = (first.getDay() + 6) % 7;
    html += '<div class="mini-month"><h4>' + monthNames[m] + '</h4><div class="mm-grid">';
    for (var i = 0; i < lead; i++) html += '<span class="mm-day mm-blank"></span>';
    for (var dnum = 1; dnum <= daysIn; dnum++) {
      var key = year + "-" + L.pad(m + 1) + "-" + L.pad(dnum);
      var count = tasksOn(key).filter(function (t) { return t.status !== "done"; }).length;
      var cls = "mm-day" + (count === 1 ? " has-1" : count === 2 ? " has-2" : count >= 3 ? " has-3" : "") + (key === L.todayKey() ? " is-today" : "");
      html += '<button class="' + cls + '" data-ydate="' + key + '">' + dnum + "</button>";
    }
    html += "</div></div>";
  }
  $("yearView").innerHTML = html + "</div>";
  $("yearView").querySelectorAll("[data-ydate]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelector('.segmented button[data-view="timeGridDay"]').click();
      selectDate(btn.getAttribute("data-ydate"), true);
    });
  });
}

/* ---------- panels ---------- */
document.querySelectorAll(".side-item").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".side-item").forEach(function (x) { x.classList.remove("is-active"); });
    document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("is-active"); });
    b.classList.add("is-active");
    $("panel-" + b.getAttribute("data-panel")).classList.add("is-active");
    if (b.getAttribute("data-panel") === "progress") renderProgress();
    if (b.getAttribute("data-panel") === "capture") maybePlus("talk");
    // Phone + the Muse-app shape: choosing an area shows it —
    // the menu gives the screen back (the sliver tap and the
    // close button do the same when no choice is made).
    if (window.innerWidth <= 700 && !state.settings.sidebarCollapsed) {
      state.settings.sidebarCollapsed = true; save(); applySidebar();
    }
  });
});
// The sliver: one tap on the squeezed content strip closes
// the menu and returns the full screen (phone widths; the
// element only exists visually there, while the menu is open).
$("sbSliver").addEventListener("click", function () {
  state.settings.sidebarCollapsed = true; save(); applySidebar();
});
function showPanel(name) { document.querySelector('.side-item[data-panel="' + name + '"]').click(); }

/* ---------- quick add ---------- */
$("addBtn").addEventListener("click", function () {
  $("quickText").value = ""; $("fTitle").value = "";
  $("fDate").value = selected; $("fTime").value = ""; $("fDur").value = 25;
  $("fMin").value = ""; $("fFull").value = ""; $("fEssential").checked = false;
  $("quickPreview").hidden = true;
  $("addSheet").hidden = false;
  setTimeout(function () { $("quickText").focus(); }, 50);
});
$("addCancel").addEventListener("click", function () { $("addSheet").hidden = true; });
$("quickText").addEventListener("input", function () {
  var v = $("quickText").value.trim();
  if (!v) { $("quickPreview").hidden = true; return; }
  var item = L.parseItem(v, selected);
  if (!item) { $("quickPreview").hidden = true; return; }
  $("quickPreview").hidden = false;
  $("quickPreview").innerHTML = "<strong>" + esc(item.title) + "</strong><br>" +
    esc(L.parseKey(item.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })) +
    (item.time ? " at " + item.time : " · no time yet") + " · about " + item.durationMin + " min" +
    (item.repeat ? " · " + esc(item.repeat) : "") + (item.essential ? " · must not slip" : "");
});
$("addSave").addEventListener("click", function () {
  var task = null;
  var manualTitle = $("fTitle").value.trim();
  if (manualTitle) {
    var cat = L.categoryFor(manualTitle);
    task = { title: manualTitle, date: $("fDate").value || selected, time: $("fTime").value || null, durationMin: Math.max(5, +$("fDur").value || 25), priority: 0, repeat: null, category: cat.id, color: cat.color, essential: $("fEssential").checked, steps: L.decompose(manualTitle, +$("fDur").value || 25, false), minVersion: $("fMin").value.trim(), fullVersion: $("fFull").value.trim() };
  } else if ($("quickText").value.trim()) {
    var item = L.parseItem($("quickText").value.trim(), selected);
    if (item) task = { title: item.title, date: item.date, time: item.time, durationMin: item.durationMin, priority: item.priority, repeat: item.repeat, category: item.category, color: item.color, essential: item.essential, steps: item.steps, minVersion: $("fMin").value.trim(), fullVersion: $("fFull").value.trim() };
  }
  if (!task) { toast("Give it a title first, even a messy one."); return; }
  task.id = uid(); task.status = "todo"; task.source = "manual"; task.originalText = $("quickText").value.trim(); task.skipDates = []; task.doneDates = [];
  state.tasks.push(task); save(); markActivated("event");
  $("addSheet").hidden = true;
  selectDate(task.date, true); refreshAll();
  toast("Added. Small and clear.");
});

/* ---------- task sheet ---------- */
function openTask(id, instanceDate) {
  var t = baseTask(id); if (!t) return;
  currentTaskId = id; currentInstanceDate = instanceDate || t.date;
  var inst = instanceOf(t, currentInstanceDate);
  $("dTitle").textContent = inst.title;
  var meta = [];
  meta.push(L.parseKey(currentInstanceDate).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }));
  if (inst.time) meta.push(inst.time);
  meta.push("about " + inst.durationMin + " min");
  if (inst.repeat) meta.push("repeats " + inst.repeat + " · changes to date or done apply to this day only");
  if (inst.source === "sample") meta.push("sample task");
  $("dMeta").textContent = meta.join(" · ");
  renderSteps(t);
  $("dMin").value = t.minVersion || "";
  $("dFull").value = t.fullVersion || "";
  $("dDate").value = currentInstanceDate;
  $("dTime").value = t.time || "";
  $("dDur").value = t.durationMin;
  $("dEssential").checked = !!t.essential;
  if (t.originalText) { $("dOriginalWrap").hidden = false; $("dOriginal").textContent = t.originalText; }
  else $("dOriginalWrap").hidden = true;
  $("taskSheet").hidden = false;
}
function renderSteps(t) {
  var box = $("dSteps");
  if (!t.steps || !t.steps.length) { box.innerHTML = '<p class="hint">No steps yet.</p>'; return; }
  box.innerHTML = t.steps.map(function (s, i) {
    return '<label class="step-row' + (s.done ? " is-done" : "") + '"><input type="checkbox" data-step="' + i + '"' + (s.done ? " checked" : "") + "><span>" + esc(s.text) + "</span></label>";
  }).join("");
  box.querySelectorAll("[data-step]").forEach(function (cb) {
    cb.addEventListener("change", function () {
      t.steps[+cb.getAttribute("data-step")].done = cb.checked;
      save(); renderSteps(t); refreshAll();
    });
  });
}
$("dBreak").addEventListener("click", function () {
  var t = baseTask(currentTaskId); if (!t) return;
  if (!t.steps || !t.steps.length) t.steps = L.decompose(t.title, t.durationMin, true);
  else t.steps = t.steps.concat(L.decompose(t.title, t.durationMin, true));
  save(); renderSteps(t); refreshAll(); toast("Broken down. Only the first step matters right now.");
});
function persistSheetFields() {
  var t = baseTask(currentTaskId); if (!t) return;
  t.minVersion = $("dMin").value.trim();
  t.fullVersion = $("dFull").value.trim();
  t.time = $("dTime").value || null;
  t.durationMin = Math.max(5, +$("dDur").value || t.durationMin);
  t.essential = $("dEssential").checked;
  var newDate = $("dDate").value;
  if (newDate && newDate !== currentInstanceDate) {
    moveInstance(t, currentInstanceDate, newDate);
    currentInstanceDate = newDate;
  }
  save();
}
["dMin", "dFull", "dTime", "dDur", "dEssential", "dDate"].forEach(function (id) {
  $(id).addEventListener("change", function () { persistSheetFields(); refreshAll(); });
});
$("dClose").addEventListener("click", function () { persistSheetFields(); $("taskSheet").hidden = true; refreshAll(); });
$("dDone").addEventListener("click", function () { persistSheetFields(); toggleDone(currentTaskId, currentInstanceDate); $("taskSheet").hidden = true; });
$("dDoing").addEventListener("click", function () {
  var t = baseTask(currentTaskId); if (!t) return;
  persistSheetFields();
  if (t.repeat) { t.doneDates = (t.doneDates || []).filter(function (d) { return d !== currentInstanceDate; }); }
  t.status = "doing"; save(); $("taskSheet").hidden = true; refreshAll(); toast("Doing. One step at a time.");
});
$("dNotToday").addEventListener("click", function () {
  var t = baseTask(currentTaskId); if (!t) return;
  persistSheetFields();
  moveInstance(t, currentInstanceDate, L.addDays(currentInstanceDate, 1));
  save(); $("taskSheet").hidden = true; refreshAll();
  toast("Moved to tomorrow. That counts as handling it.");
});
$("dDelete").addEventListener("click", function () {
  var t = baseTask(currentTaskId); if (!t) return;
  if (t.repeat) {
    t.skipDates = t.skipDates || [];
    if (t.skipDates.indexOf(currentInstanceDate) === -1) t.skipDates.push(currentInstanceDate);
    toast("Removed for this day. The rest of the series stays.", function () {
      t.skipDates = t.skipDates.filter(function (d) { return d !== currentInstanceDate; });
      save(); refreshAll(); toast("Back again.");
    });
  } else {
    var taskIdx = state.tasks.indexOf(t);
    state.tasks = state.tasks.filter(function (x) { return x.id !== currentTaskId; });
    toast("Deleted.", function () { restoreAt(state.tasks, t, taskIdx); save(); refreshAll(); toast("Back again."); });
  }
  save(); $("taskSheet").hidden = true; refreshAll();
});

/* ---------- capture ---------- */
$("parseBtn").addEventListener("click", function () {
  var text = $("dumpText").value;
  drafts = L.parseDump(text, L.todayKey());
  if (!drafts.length) { $("captureMsg").textContent = "Nothing I could sort yet. Try one thing per line, like: call the dentist tomorrow at 3pm."; return; }
  $("captureMsg").textContent = "";
  renderDrafts(text);
});
function renderDrafts(original) {
  $("draftArea").hidden = false;
  $("originalText").textContent = original;
  var box = $("draftList"); box.innerHTML = "";
  drafts.forEach(function (d, i) {
    var card = document.createElement("div");
    card.className = "draft-card";
    card.innerHTML = '<span class="tr-dot" style="background:' + d.color + '"></span><div style="flex:1">' +
      '<input type="text" data-f="title" value="' + esc(d.title) + '">' +
      '<div class="dc-meta"><input type="date" data-f="date" value="' + d.date + '"><input type="time" data-f="time" value="' + (d.time || "") + '"><input type="number" data-f="durationMin" value="' + d.durationMin + '" min="5" step="5" style="width:76px"><span class="hint">min</span>' +
      (d.repeat ? '<span class="hint">' + esc(d.repeat) + "</span>" : "") + (d.essential ? '<span class="hint">must not slip</span>' : "") + "</div>" +
      (d.steps && d.steps.length ? '<ol class="dc-steps">' + d.steps.map(function (s) { return "<li>" + esc(s.text) + "</li>"; }).join("") + "</ol>" : "") +
      '</div><button class="dc-del" data-del="' + i + '">Remove</button>';
    card.querySelectorAll("[data-f]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var f = inp.getAttribute("data-f");
        if (f === "durationMin") drafts[i].durationMin = Math.max(5, +inp.value || 25);
        else if (f === "time") drafts[i].time = inp.value || null;
        else drafts[i][f] = inp.value;
      });
    });
    card.querySelector("[data-del]").addEventListener("click", function () { drafts.splice(i, 1); renderDrafts(original); });
    box.appendChild(card);
  });
}
$("draftClear").addEventListener("click", function () { drafts = []; $("draftArea").hidden = true; $("dumpText").value = ""; });
$("draftAddAll").addEventListener("click", function () {
  var original = $("dumpText").value;
  drafts.forEach(function (d) {
    state.tasks.push({ id: uid(), title: d.title, date: d.date, time: d.time, durationMin: d.durationMin, priority: d.priority, repeat: d.repeat, category: d.category, color: d.color, essential: d.essential, status: "todo", steps: d.steps || [], minVersion: "", fullVersion: "", source: "capture", originalText: original, skipDates: [], doneDates: [] });
  });
  save(); if (drafts.length) markActivated("event");
  var n = drafts.length;
  drafts = []; $("draftArea").hidden = true; $("dumpText").value = "";
  showPanel("calendar"); selectDate(L.todayKey(), true); refreshAll();
  toast(n + (n === 1 ? " thing" : " things") + " sorted onto your calendar.");
});
$("journalFile").addEventListener("change", function (e) {
  var f = e.target.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function () { $("dumpText").value = String(r.result || ""); $("captureMsg").textContent = "Journal loaded. Tap Make my list when you are ready."; };
  r.readAsText(f);
});
/* Voice engine: ONE engine for every Speak button. In the store app it
   uses the device recogniser (Capacitor SpeechRecognition plugin —
   the WebView offers no web speech of its own, which is why dictation
   "did not work at all" there). In a browser it uses Web Speech with
   live words while you talk. Errors say what actually went wrong.
   Typing always works exactly the same. */
var voiceSession = null;
function voiceErrorText(code) {
  if (code === "not-allowed" || code === "service-not-allowed") return "The microphone is blocked. Allow the mic for Pace, then tap Speak again. Typing works the same.";
  if (code === "audio-capture") return "No microphone could be found. Typing works the same.";
  if (code === "no-speech") return "I did not hear anything. Try again, a little closer. Typing works the same.";
  if (code === "network") return "Voice typing needs the internet on this device. Typing works the same.";
  if (code === "aborted") return "";
  return "Voice did not come through. Typing works the same.";
}
function nativeSpeech() {
  try {
    var C = window.Capacitor;
    if (C && typeof C.isNativePlatform === "function" && C.isNativePlatform() && C.Plugins && C.Plugins.SpeechRecognition) return C.Plugins.SpeechRecognition;
  } catch (e) {}
  return null;
}
/* hooks: { msg(text), final(text), btn } — final fires per finished phrase. */
function toggleVoice(hooks) {
  if (voiceSession) { voiceSession.stop(); return; }
  var btn = hooks.btn, span = btn.querySelector("span");
  var done = function () { voiceSession = null; if (span) span.textContent = "Speak"; };
  var nat = nativeSpeech();
  if (nat) {
    var stopped = false;
    voiceSession = { stop: function () { stopped = true; try { nat.stop(); } catch (e) {} done(); } };
    if (span) span.textContent = "Stop";
    hooks.msg("Listening… talk away, then tap Stop.");
    nat.requestPermissions().then(function (perm) {
      if (perm && perm.speechRecognition && perm.speechRecognition !== "granted") { hooks.msg(voiceErrorText("not-allowed")); done(); return null; }
      var partialH = null;
      if (typeof nat.addListener === "function") {
        nat.addListener("partialResults", function (d) { if (!stopped && d && d.matches && d.matches[0]) hooks.msg("Listening… " + d.matches[0]); }).then(function (h) { partialH = h; });
      }
      return nat.start({ language: "en-AU", partialResults: true, popup: false, maxResults: 1 }).then(function (res) {
        if (partialH && partialH.remove) partialH.remove();
        var said = res && res.matches && res.matches[0] ? String(res.matches[0]).trim() : "";
        if (said) hooks.final(said); else if (!stopped) hooks.msg(voiceErrorText("no-speech"));
        done();
      });
    }).catch(function () { if (!stopped) hooks.msg(voiceErrorText("")); done(); });
    return;
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { hooks.msg("Voice is not offered by this browser. Typing in the box works exactly the same."); return; }
  var rec = new SR();
  rec.lang = "en-AU"; rec.interimResults = true; rec.continuous = true;
  var heardFinal = false;
  voiceSession = { stop: function () { try { rec.stop(); } catch (e) {} } };
  if (span) span.textContent = "Stop";
  hooks.msg("Listening… talk away, then tap Stop.");
  rec.onresult = function (ev) {
    var interim = "";
    for (var i = ev.resultIndex; i < ev.results.length; i++) {
      var r = ev.results[i], txt = r[0].transcript;
      if (r.isFinal) { var t = txt.trim(); if (t) { heardFinal = true; hooks.final(t); } }
      else interim += txt;
    }
    /* Once a final has landed, the message belongs to the final hook
       (the "check the words" nudge) — interim previews must not stomp
       it (QA v13 audit note 3). */
    if (!heardFinal && interim.trim()) hooks.msg("Listening… " + interim.trim());
  };
  rec.onerror = function (ev) { var m = voiceErrorText(ev && ev.error); if (m) hooks.msg(m); };
  rec.onend = function () { done(); };
  try { rec.start(); } catch (e) { hooks.msg(voiceErrorText("")); done(); }
}
$("voiceBtn").addEventListener("click", function () {
  toggleVoice({
    btn: $("voiceBtn"),
    msg: function (t) { $("captureMsg").textContent = t; },
    final: function (said) {
      $("dumpText").value = ($("dumpText").value ? $("dumpText").value + "\n" : "") + said;
      $("captureMsg").textContent = "Got it. Check the words, then tap Make my list.";
    }
  });
});
/* Handwriting photo: OCR runs on-device with the Tesseract.js copy bundled
   in vendor/tesseract (worker, LSTM core and English data are local too).
   Shared by Talk to it and To do; onText receives the words found. */
/* In the store build, bundletool stores the language file decompressed as
   eng.traineddata (it strips .gz); on the web the .gz is served as-is.
   gzip:false makes Tesseract ask for the raw name the bundle carries. */
var OCR_IN_APP = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
var OCR_OPTIONS = {
  workerPath: "vendor/tesseract/worker.min.js",
  corePath: "vendor/tesseract/core",
  langPath: "vendor/tesseract/lang",
  cacheMethod: "none",
  gzip: !OCR_IN_APP
};
function ocrPhoto(f, msgEl, onText) {
  msgEl.textContent = "Reading your photo. This can take a little while the first time.";
  if (!window.Tesseract) {
    msgEl.textContent = "The reading tool did not load. Typing or speaking works the same.";
    return;
  }
  window.Tesseract.recognize(f, "eng", OCR_OPTIONS).then(function (res) {
    var text = (res && res.data && res.data.text || "").trim();
    if (text) onText(text);
    else msgEl.textContent = "I could not read words in that photo. Typing or speaking works the same.";
  }).catch(function () { msgEl.textContent = "Reading the photo did not work this time. Typing or speaking works the same."; });
}
$("photoFile").addEventListener("change", function (e) {
  var f = e.target.files[0]; if (!f) return;
  ocrPhoto(f, $("captureMsg"), function (text) {
    $("dumpText").value = ($("dumpText").value ? $("dumpText").value + "\n" : "") + text;
    $("captureMsg").textContent = "Here is what I could read. Fix any words, then tap Make my list.";
  });
});

/* ---------- to do: a fast list that lives happily beside the calendar ---------- */
function addTodo(text) {
  text = (text || "").trim();
  if (!text) return null;
  var item = { id: uid(), text: text, done: false, calTaskId: null };
  state.todos.unshift(item);
  return item;
}
function todoLinked(item) {
  return !!(item.calTaskId && state.tasks.some(function (t) { return t.id === item.calTaskId; }));
}
function linkTodo(item) {
  if (todoLinked(item)) return false;
  var cat = L.categoryFor(item.text);
  var task = { id: uid(), title: item.text, date: L.todayKey(), time: null, durationMin: 25, priority: 0, repeat: null, category: cat.id, color: cat.color, essential: false, status: "todo", steps: L.decompose(item.text, 25, false), minVersion: "", fullVersion: "", source: "todo", originalText: "", skipDates: [], doneDates: [] };
  state.tasks.push(task);
  item.calTaskId = task.id;
  markActivated("event");
  return true;
}
function renderTodos() {
  var wrap = $("todoList"); if (!wrap) return;
  wrap.innerHTML = "";
  if (!state.todos.length) wrap.innerHTML = '<div class="empty-note">' + icon("i-todo") + "<span>Nothing here. Write one fast, above.</span></div>";
  state.todos.forEach(function (item) {
    var row = document.createElement("div");
    row.className = "todo-row" + (item.done ? " is-done" : "");
    row.innerHTML =
      '<button class="todo-tick" data-act="tick" aria-label="Mark done">' + (item.done ? icon("i-check") : "") + "</button>" +
      '<span class="todo-text"></span>' +
      '<button class="todo-cal' + (todoLinked(item) ? " is-on" : "") + '" data-act="cal" aria-label="Put on the calendar" title="Put on the calendar">' + icon("i-calplus") + "</button>" +
      '<button class="todo-del" data-act="del" aria-label="Delete">' + icon("i-trash") + "</button>";
    row.querySelector(".todo-text").textContent = item.text;
    row.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act");
        if (act === "tick") { item.done = !item.done; save(); renderTodos(); }
        else if (act === "del") { var todoIdx = state.todos.indexOf(item); state.todos = state.todos.filter(function (t) { return t.id !== item.id; }); save(); renderTodos(); toast("Deleted.", function () { restoreAt(state.todos, item, todoIdx); save(); renderTodos(); toast("Back again."); }); }
        else if (act === "cal") {
          if (todoLinked(item)) {
            var linked = baseTask(item.calTaskId); var linkedIdx = linked ? state.tasks.indexOf(linked) : -1;
            state.tasks = state.tasks.filter(function (t) { return t.id !== item.calTaskId; });
            item.calTaskId = null; save(); refreshAll();
            toast("Off the calendar. Still on your list.", linked ? function () { restoreAt(state.tasks, linked, linkedIdx); item.calTaskId = linked.id; save(); refreshAll(); toast("Back again."); } : undefined);
          } else if (linkTodo(item)) { save(); refreshAll(); toast("On today's calendar."); }
        }
      });
    });
    wrap.appendChild(row);
  });
  $("todoClearDone").hidden = !state.todos.some(function (t) { return t.done; });
}
function submitTodoInput() {
  if (addTodo($("todoInput").value)) { $("todoInput").value = ""; save(); renderTodos(); }
}
$("todoAddBtn").addEventListener("click", submitTodoInput);
$("todoInput").addEventListener("keydown", function (e) { if (e.key === "Enter") submitTodoInput(); });
$("todoClearDone").addEventListener("click", function () {
  var cleared = []; state.todos.forEach(function (t, i) { if (t.done) cleared.push([t, i]); });
  state.todos = state.todos.filter(function (t) { return !t.done; });
  save(); renderTodos();
  toast("Done list cleared.", function () { cleared.forEach(function (p) { restoreAt(state.todos, p[0], p[1]); }); save(); renderTodos(); toast("Back again."); });
});
$("todoCalAll").addEventListener("click", function () {
  var n = 0;
  state.todos.forEach(function (item) { if (!item.done && linkTodo(item)) n++; });
  save(); refreshAll();
  toast(n ? n + (n === 1 ? " item" : " items") + " on today's calendar." : "Everything is already on the calendar.");
});
$("todoVoiceBtn").addEventListener("click", function () {
  toggleVoice({
    btn: $("todoVoiceBtn"),
    msg: function (t) { $("todoMsg").textContent = t; },
    final: function (said) { if (addTodo(said)) { save(); renderTodos(); toast("Added: " + said); } }
  });
});
$("todoPhoto").addEventListener("change", function (e) {
  var f = e.target.files[0]; if (!f) return;
  ocrPhoto(f, $("todoMsg"), function (text) {
    var lines = text.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!lines.length) { $("todoMsg").textContent = "I could not read a list in that photo."; return; }
    var list = $("todoDraftList"); list.innerHTML = "";
    lines.forEach(function (line) {
      var lab = document.createElement("label");
      lab.className = "todo-draft-line";
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true; cb.value = line;
      var sp = document.createElement("span"); sp.textContent = line;
      lab.appendChild(cb); lab.appendChild(sp); list.appendChild(lab);
    });
    $("todoDraftArea").hidden = false;
    $("todoMsg").textContent = "Here is what I could read. Untick anything that is not a to-do.";
  });
});
$("todoDraftAdd").addEventListener("click", function () {
  var n = 0;
  $("todoDraftList").querySelectorAll("input[type=checkbox]:checked").forEach(function (cb) { if (addTodo(cb.value)) n++; });
  $("todoDraftArea").hidden = true;
  save(); renderTodos();
  toast(n ? n + (n === 1 ? " to-do" : " to-dos") + " added." : "Nothing ticked, nothing added.");
});
$("todoDraftClear").addEventListener("click", function () { $("todoDraftArea").hidden = true; });

/* ---------- habits: an icon, a tick, a run of dots ---------- */
function habitIconId(key) { return key === "heart" ? "i-heart" : "i-h-" + key; }
var habitPick = "star";
function renderIconPicker() {
  var wrap = $("habitIcons"); if (!wrap) return;
  wrap.innerHTML = "";
  L.HABIT_ICONS.forEach(function (key) {
    var b = document.createElement("button");
    b.className = "icon-pick" + (key === habitPick ? " is-on" : "");
    b.setAttribute("aria-label", "Icon: " + key);
    b.innerHTML = icon(habitIconId(key));
    b.addEventListener("click", function () { habitPick = key; renderIconPicker(); });
    wrap.appendChild(b);
  });
}
function renderHabits() {
  var wrap = $("habitList"); if (!wrap) return;
  wrap.innerHTML = "";
  if (!state.habits.length) wrap.innerHTML = '<div class="empty-note">' + icon("i-habits") + "<span>No habits yet. Name one and pick its icon below.</span></div>";
  var today = L.todayKey();
  state.habits.forEach(function (h, idx) {
    var info = L.streakInfo(h.days, today);
    var row = document.createElement("div");
    row.className = "habit-row";
    var dots = info.last7.map(function (d, i) {
      return '<button class="week-dot' + (d.done ? " is-done" : "") + (i === 6 ? " is-today" : "") + '" data-key="' + d.key + '" aria-label="Toggle ' + d.key + '"></button>';
    }).join("");
    var streakDots = "";
    for (var i = 0; i < Math.min(info.current, 10); i++) streakDots += '<span class="streak-dot"></span>';
    row.innerHTML =
      '<span class="habit-ico tint-' + (idx % 6) + '">' + icon(habitIconId(h.icon)) + "</span>" +
      '<span class="habit-main"><span class="habit-name"></span>' +
      '<span class="habit-streak">' + streakDots + (info.current ? '<span class="streak-num">' + info.current + " in a row</span>" : '<span class="streak-none">No run yet</span>') + "</span></span>" +
      '<span class="habit-week">' + dots + "</span>" +
      '<button class="habit-tick' + (h.days[today] ? " is-done" : "") + '" aria-label="Done today">' + (h.days[today] ? icon("i-check") : "") + "</button>" +
      '<button class="habit-del" aria-label="Delete habit">' + icon("i-trash") + "</button>";
    row.querySelector(".habit-name").textContent = h.name;
    row.querySelectorAll(".week-dot").forEach(function (d) {
      d.addEventListener("click", function () {
        var k = d.getAttribute("data-key");
        if (h.days[k]) delete h.days[k]; else h.days[k] = true;
        save(); renderHabits();
      });
    });
    row.querySelector(".habit-tick").addEventListener("click", function () {
      if (h.days[today]) delete h.days[today]; else h.days[today] = true;
      save(); renderHabits();
    });
    row.querySelector(".habit-del").addEventListener("click", function () {
      var habitIdx = state.habits.indexOf(h);
      state.habits = state.habits.filter(function (x) { return x.id !== h.id; });
      save(); renderHabits();
      toast("Habit removed.", function () { restoreAt(state.habits, h, habitIdx); save(); renderHabits(); toast("Back again."); });
    });
    wrap.appendChild(row);
  });
  renderIconPicker();
}
function submitHabit() {
  var name = $("habitName").value.trim();
  if (!name) { toast("Give the habit a name first."); return; }
  state.habits.push({ id: uid(), name: name, icon: habitPick, days: {} });
  $("habitName").value = "";
  save(); renderHabits();
}
$("habitAddBtn").addEventListener("click", submitHabit);
$("habitName").addEventListener("keydown", function (e) { if (e.key === "Enter") submitHabit(); });

/* ---------- progress board ---------- */
function renderProgress() {
  var all = state.tasks;
  var doneCount = all.filter(function (t) { return t.status === "done" || (t.doneDates || []).length; }).length;
  var todayAd = adaptedFor(L.todayKey());
  var ts = L.dayScore(todayAd);
  $("progressSummary").innerHTML =
    "<div><strong>" + ts.done + " of " + ts.total + "</strong>done today, at your pace</div>" +
    "<div><strong>" + all.filter(function (t) { return t.status === "doing"; }).length + "</strong>in progress</div>" +
    "<div><strong>" + all.filter(function (t) { return t.status !== "done"; }).length + "</strong>still on the list, all safe</div>" +
    "<div><strong>" + doneCount + "</strong>things finished, counted forever</div>";
  ["todo", "doing", "done"].forEach(function (status) {
    var col = $("col-" + status); col.innerHTML = "";
    var list = all.filter(function (t) { return t.status === status; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!list.length) col.innerHTML = '<p class="hint">Nothing here right now.</p>';
    list.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "p-card"; card.draggable = true; card.setAttribute("data-pid", t.id);
      card.innerHTML = '<span class="pc-title">' + esc(t.title) + '</span><span class="pc-meta"><span class="tr-dot" style="background:' + t.color + '"></span>' +
        esc(L.parseKey(t.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })) + (t.time ? " · " + t.time : "") + " · " + t.durationMin + " min" + (t.repeat ? " · " + esc(t.repeat) : "") + "</span>";
      card.addEventListener("click", function () { openTask(t.id, t.date); });
      card.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", t.id); });
      col.appendChild(card);
    });
  });
}
document.querySelectorAll(".board-col").forEach(function (col) {
  col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drag-over"); });
  col.addEventListener("dragleave", function () { col.classList.remove("drag-over"); });
  col.addEventListener("drop", function (e) {
    e.preventDefault(); col.classList.remove("drag-over");
    var t = baseTask(e.dataTransfer.getData("text/plain")); if (!t) return;
    t.status = col.getAttribute("data-status");
    if (t.status === "done") toast("Done. That counts.");
    save(); renderProgress(); refreshAll();
  });
});
/* Dragging a day-list row onto a DayTicker day moves the task to that day.
   Both live in the Calendar panel, so the drag never crosses panels. */
$("dayList").addEventListener("dragstart", function (e) {
  var row = e.target.closest ? e.target.closest(".task-row") : null;
  if (!row) return;
  row.classList.add("dragging");
  e.dataTransfer.setData("text/plain", JSON.stringify({ id: row.getAttribute("data-id"), date: row.getAttribute("data-date") }));
});
$("dayList").addEventListener("dragend", function () {
  $("dayList").querySelectorAll(".dragging").forEach(function (r) { r.classList.remove("dragging"); });
});
$("ticker").addEventListener("dragover", function (e) { e.preventDefault(); });
$("ticker").addEventListener("drop", function (e) {
  var raw = e.dataTransfer.getData("text/plain");
  if (!raw) return;
  var info; try { info = JSON.parse(raw); } catch (err) { return; }
  var cell = e.target.closest ? e.target.closest("[data-date]") : null;
  if (!cell || !info.id) return;
  var t = baseTask(info.id); if (!t) return;
  e.preventDefault();
  moveInstance(t, info.date, cell.getAttribute("data-date"));
  save(); refreshAll(); toast("Moved. The day re-shaped itself.");
});

/* ---------- settings ---------- */
function bindSettings() {
  var s = state.settings;
  $("checkinTime").value = s.checkinTime;
  $("nameLow").value = s.names.low; $("nameSteady").value = s.names.steady; $("nameFull").value = s.names.full;
  $("nCheckin").checked = s.notif.checkin; $("nStart").checked = s.notif.start;
  $("nSetup").value = s.notif.setup; $("nDigest").checked = s.notif.digest;
  $("nDigestTimes").value = s.notif.digestTimes.join(", ");
  $("nDone").checked = s.notif.done; $("nDoneTime").value = s.notif.doneTime;
  renderNotifStatus();
}
function readSettings() {
  var s = state.settings;
  s.checkinTime = $("checkinTime").value || "08:00";
  s.names.low = $("nameLow").value.trim() || "Low";
  s.names.steady = $("nameSteady").value.trim() || "Steady";
  s.names.full = $("nameFull").value.trim() || "Full";
  s.notif.checkin = $("nCheckin").checked; s.notif.start = $("nStart").checked;
  s.notif.setup = Math.max(0, Math.min(60, +$("nSetup").value || 5));
  s.notif.digest = $("nDigest").checked;
  s.notif.digestTimes = $("nDigestTimes").value.split(",").map(validClock).filter(Boolean);
  if (!s.notif.digestTimes.length) s.notif.digestTimes = ["12:30"];
  s.notif.done = $("nDone").checked; s.notif.doneTime = $("nDoneTime").value || "20:00";
  /* Show what was actually kept, so a fixed time is never a silent change. */
  $("nDigestTimes").value = s.notif.digestTimes.join(", ");
  save(); renderCheckin();
}
["checkinTime", "nameLow", "nameSteady", "nameFull", "nCheckin", "nStart", "nSetup", "nDigest", "nDigestTimes", "nDone", "nDoneTime"].forEach(function (id) {
  $(id).addEventListener("change", readSettings);
});
$("clearSamples").addEventListener("click", function () {
  var samples = []; state.tasks.forEach(function (t, i) { if (t.source === "sample") samples.push([t, i]); });
  state.tasks = state.tasks.filter(function (t) { return t.source !== "sample"; });
  save(); refreshAll();
  toast("Sample tasks removed. This is fully yours now.", samples.length ? function () { samples.forEach(function (p) { restoreAt(state.tasks, p[0], p[1]); }); save(); refreshAll(); toast("Back again."); } : undefined);
});

/* ---------- notifications ---------- */
function renderNotifStatus() {
  var n = state.settings.notif;
  $("notifStatus").textContent = !("Notification" in window) ? "This browser does not offer notifications." :
    n.perm === "granted" ? "Notifications are on. You choose what they say and when." :
    n.perm === "denied" ? "Notifications are blocked in the browser. You can allow them in the browser site settings." :
    "Notifications are off.";
}
function notify(title, body, key) {
  if (state.sent[key]) return;
  state.sent[key] = 1; save();
  function fire() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { if (reg.showNotification) reg.showNotification(title, { body: body, icon: "icon.svg" }); else new Notification(title, { body: body, icon: "icon.svg" }); }).catch(function () { new Notification(title, { body: body }); });
      } else new Notification(title, { body: body });
    } catch (e) {}
  }
  fire();
}
function requestNotif() {
  if (!("Notification" in window)) { toast("This browser does not offer notifications."); return; }
  Notification.requestPermission().then(function (p) {
    state.settings.notif.perm = p; save(); renderNotifStatus();
    if (p === "granted") toast("Notifications on. Gentle ones, chosen by you.");
    else toast("No problem. The app still works fully without them.");
  });
}
$("notifEnable").addEventListener("click", requestNotif);
$("notifTest").addEventListener("click", function () {
  if (!("Notification" in window)) { toast("This browser does not offer notifications."); return; }
  if (Notification.permission !== "granted") { toast("Turn notifications on first, then the test can arrive."); return; }
  try { new Notification("Pace", { body: "This is your test. Gentle, like the real ones." }); } catch (e) {}
});
$("notifPause").addEventListener("click", function () {
  state.settings.pausedDate = L.todayKey(); save(); toast("Paused for today. Silence is a fine choice.");
});
function checkNotifications() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  var s = state.settings, today = L.todayKey();
  if (s.pausedDate === today) return;
  var now = new Date(), hhmm = L.pad(now.getHours()) + ":" + L.pad(now.getMinutes());
  var n = s.notif;
  if (n.checkin && hhmm === s.checkinTime && !state.feelings[today]) {
    notify("How are you feeling today?", "One tap sets the shape of your day.", "checkin-" + today);
  }
  var ad = adaptedFor(today);
  if (n.start) {
    ad.visible.forEach(function (t) {
      if (!t.time) return;
      if (L.nudgeTime(t, n.setup) === hhmm) {
        notify("Time to start: " + (t.displayTitle || t.title), "First step: " + L.nextStepText(t) + " · about " + t.durationMin + " min.", "start-" + t.id + "-" + today);
      }
    });
  }
  if (n.digest && n.digestTimes.indexOf(hhmm) !== -1) {
    notify("Your day, gently", L.digestText(ad.visible), "digest-" + today + "-" + hhmm);
  }
  if (n.done && hhmm === n.doneTime && ad.done.length) {
    notify("Today, done", ad.done.length + (ad.done.length === 1 ? " thing" : " things") + " done today. The rest is parked for tomorrow.", "done-" + today);
  }
}
setInterval(checkNotifications, 30000);

/* ---------- welcome ---------- */
if (!state.welcomed) {
  // Address the user by their own name when the profile
  // carries one (asked at sign-up; theirs alone).
  var wn = (state.settings.profileName || "").trim().split(/\s+/)[0];
  if (wn) $("welcomeTitle").textContent = "Welcome to Pace Calendar, " + wn;
  $("welcome").hidden = false;
}
$("welcomeSkip").addEventListener("click", function () { state.welcomed = true; save(); $("welcome").hidden = true; maybeGuide(); });
$("welcomeNotif").addEventListener("click", function () { state.welcomed = true; save(); $("welcome").hidden = true; requestNotif(); maybeGuide(); });

/* ---------- Skip the Ferry: the setup guide (Lab spec GUIDE-MASCOTS-001) ----------
   One SVG master, four poses as prop/transform changes. Bubbles max 6 words.
   Closing never blocks; the guide reopens from Settings. Skip waits at the
   empty-state dock only, never on a working day. */
function skipSvg(pose) {
  /* Skip's guide art of record (variant B composition, finished as vector
     14 Oct 2026): full ferry, the calendar smaller inside him as his
     cabin, board palette. Poses are prop/transform changes on one master. */
  var ink = "#21392E", hull = "#5B6BD5", cream = "#FAF4E4", flagGreen = "#2F7D4F", dotGreen = "#35704E", apricot = "#F0A868", wave = "#AEB8EC";
  var flagRot = pose === "point" ? "14" : pose === "goodbye" ? "-12" : "0";
  var flag = '<g transform="rotate(' + flagRot + ' 120 30)"><line x1="120" y1="8" x2="120" y2="48" stroke="' + ink + '" stroke-width="6.5" stroke-linecap="round"/><path d="M120 10 L149 19.5 L120 29 Z" fill="' + flagGreen + '"/></g>';
  var spray = pose === "celebrate" ? '<path d="M27 103 q-9 -9 -17 -7 M29 115 q-10 -3 -15 3" fill="none" stroke="' + apricot + '" stroke-width="5" stroke-linecap="round"/>' : "";
  var trail = pose === "goodbye" ? '<path d="M2 172 q8 -8 16 0 q8 8 16 0" fill="none" stroke="' + wave + '" stroke-width="5" stroke-linecap="round" opacity="0.55"/>' : "";
  var tilt = pose === "celebrate" ? ' transform="rotate(2 120 110)"' : pose === "point" ? ' transform="rotate(-2 120 110)"' : "";
  return '<svg viewBox="0 0 240 196" class="skip-svg" aria-hidden="true"><g' + tilt + '>' + spray +
    '<path d="M22 118 H218 L186 164 H54 Z" fill="' + hull + '" stroke="' + ink + '" stroke-width="7" stroke-linejoin="round"/>' +
    '<rect x="80" y="46" width="80" height="78" rx="13" fill="' + cream + '" stroke="' + ink + '" stroke-width="7"/>' +
    '<circle cx="98" cy="40" r="8" fill="none" stroke="' + ink + '" stroke-width="6"/>' +
    '<circle cx="142" cy="40" r="8" fill="none" stroke="' + ink + '" stroke-width="6"/>' +
    '<circle cx="102" cy="64" r="4.5" fill="' + dotGreen + '"/><circle cx="120" cy="64" r="4.5" fill="' + dotGreen + '"/><circle cx="138" cy="64" r="4.5" fill="' + apricot + '"/>' +
    '<circle cx="108" cy="88" r="6.8" fill="' + ink + '"/><circle cx="132" cy="88" r="6.8" fill="' + ink + '"/>' +
    '<circle cx="105.8" cy="85.8" r="2.1" fill="#fff"/><circle cx="129.8" cy="85.8" r="2.1" fill="#fff"/>' +
    '<circle cx="93" cy="98" r="4.6" fill="' + apricot + '" opacity="0.55"/><circle cx="147" cy="98" r="4.6" fill="' + apricot + '" opacity="0.55"/>' +
    '<path d="M108 99 q12 10 24 0" fill="none" stroke="' + ink + '" stroke-width="5" stroke-linecap="round"/>' + flag + '</g>' + trail +
    '<path d="M16 182 q16 -12 32 0 t32 0 t32 0 t32 0 t32 0 t32 0" fill="none" stroke="' + wave + '" stroke-width="8" stroke-linecap="round"/></svg>';
}
var GUIDE_STEPS = [
  { pose: "welcome", bubble: "We cross at your pace.", next: "Next" },
  { pose: "welcome", bubble: "This calendar helps people that are overwhelmed, or with ADHD and problems getting things done.", next: "Next" },
  { pose: "point", bubble: "Pick a look you like.", next: "Next", themes: true },
  { pose: "celebrate", bubble: "Add one small thing.", next: "Done ✓", last: true }
];
/* THE TOUR (v4 shape): Skip's pop-up tours the app from the
   middle of the screen. Step 1 asks the NAME when the
   account has none (there is no separate name moment); then
   the menu stop (the card docks beside the open menu); then
   the app's areas; last stop Done. The X or "Skip tour"
   closes it any time; it runs on the first visit only. */
function tourNeedsName() { return !!(ACTIVE_UID && FB.configured && !(state.settings.profileName || "").trim()); }
var TOUR = [];
function buildTour() {
  TOUR = [];
  if (tourNeedsName()) TOUR.push({ kind: "name", pose: "welcome", bubble: "Ahoy! I'm Skip. Welcome aboard! What's your name?", next: "Next" });
  TOUR.push({ kind: "step", pose: GUIDE_STEPS[0].pose, bubble: GUIDE_STEPS[0].bubble, next: "Next" });
  TOUR.push({ kind: "menu", pose: "point", bubble: "This is your menu — everything lives here.", next: "Next" });
  for (var i = 1; i < GUIDE_STEPS.length; i++) TOUR.push(Object.assign({ kind: "step" }, GUIDE_STEPS[i]));
}
var guideStep = 0;
function showGuide(step) {
  if (!TOUR.length) buildTour();
  guideStep = step;
  var s = TOUR[step];
  $("guideArt").innerHTML = skipSvg(s.pose);
  $("guideBubble").textContent = s.bubble;
  $("guideNext").textContent = s.next;
  $("guideImport").hidden = !s.last || DEMO_SESSION;
  $("guideDots").innerHTML = TOUR.map(function (_, i) { return '<span class="g-dot' + (i === step ? " is-on" : "") + '"></span>'; }).join("");
  // The menu stop: open the menu and dock the card beside it.
  var sheet = $("guideSheet");
  if (s.kind === "menu") {
    document.documentElement.removeAttribute("data-sb");
    sheet.setAttribute("data-dock", "menu");
  } else {
    sheet.removeAttribute("data-dock");
    applySidebar();
  }
  var ex = $("guideExtra");
  if (s.kind === "name") {
    ex.innerHTML = '<input type="text" id="tourName" class="tour-name-input" autocomplete="name" placeholder="Your name" aria-label="Your name">';
  } else if (s.themes) {
    /* The guide offers a curated set of looks (the photo modes are
       not picks; Brand joined the set with Law E). */
    var GUIDE_THEMES = ["white", "dark", "blush", "sky", "mint", "lavender", "brand"];
    ex.innerHTML = '<div class="guide-swatches">' + GUIDE_THEMES.map(function (t) {
      return '<button class="g-swatch" data-g-theme="' + t + '" style="background:' + THEME_COLORS[t] + '" aria-label="' + t + ' theme"></button>';
    }).join("") + "</div>";
    ex.querySelectorAll("[data-g-theme]").forEach(function (b) {
      b.addEventListener("click", function () { var t = b.getAttribute("data-g-theme"); state.settings.appearance.theme = t; state.settings.appearance.bgChoice = "theme"; save(); applyAppearance(); if (t !== "white" && t !== "dark") maybePlus("look"); });
    });
  } else ex.innerHTML = "";
  $("guideSheet").hidden = false;
}
/* The name re-ask bookkeeping (HQ ruling): a name step left
   unanswered earns ONE gentle re-offer on the NEXT visit —
   never the same session, never a third time. "Visit" is a
   page load: BOOT_T stamps this load, and a skip recorded
   under an earlier stamp is what unlocks the re-offer. */
var BOOT_T = Date.now();
function noteNameSkip() {
  if (!tourNeedsName()) return;
  if (!TOUR.some(function (s) { return s.kind === "name"; })) return;
  try { localStorage.setItem("pace-name-skip", (ACTIVE_UID || "") + ":" + BOOT_T); } catch (e) {}
}
function closeGuide() {
  noteNameSkip();
  $("guideSheet").hidden = true;
  $("guideSheet").removeAttribute("data-dock");
  applySidebar();
  TOUR = [];
  if (!state.settings.guideDone) { state.settings.guideDone = true; save(); toast("See you at the dock."); }
}
function maybeGuide() { if (!state.settings.guideDone) { buildTour(); showGuide(0); } }
$("guideClose").addEventListener("click", closeGuide);
$("guideSkip").addEventListener("click", closeGuide);
$("guideNext").addEventListener("click", function () {
  var s = TOUR[guideStep];
  if (!s) return;
  if (s.kind === "name") {
    // The tour's first stop IS the name ask: Next carries
    // whatever is typed onto the profile (empty = skipped
    // in the moment; Settings keeps the name row forever).
    var inp = $("tourName");
    var nm = inp ? inp.value.trim().slice(0, 60) : "";
    if (nm) {
      state.settings.profileName = nm; save(); renderAccount();
      toast("Hi " + nm.split(/\s+/)[0] + " — you're in.");
    }
  }
  if (s.last || guideStep >= TOUR.length - 1) closeGuide();
  else showGuide(guideStep + 1);
});
$("guideAgain").addEventListener("click", function () { TOUR = []; buildTour(); showGuide(0); });

/* ---------- the upgrade moment ---------- */
/* Fires ONLY on a paid-edge tap (a Plus look, Cute mode,
   Talk to it) — never on open, never twice for the same
   edge in one visit. It invites to Plans; it never charges
   and never locks: the tapped thing works exactly as today,
   popup or no popup. (Pace has no repeat picker — repeats
   arrive through Talk to it, already an edge, and through
   import, a completed flow with no wanting-moment.) */
var plusShown = {};
function maybePlus(edge) {
  if (DEMO_SESSION || plusShown[edge]) return;
  plusShown[edge] = 1;
  $("plusArt").innerHTML = skipSvg("welcome");
  $("plusSheet").hidden = false;
}
function closePlus() { $("plusSheet").hidden = true; }
$("plusClose").addEventListener("click", closePlus);
$("plusNotNow").addEventListener("click", closePlus);
$("plusPlans").addEventListener("click", function () { closePlus(); $("plansSheet").hidden = false; });
$("plansOpen").addEventListener("click", function () { $("plansSheet").hidden = false; });
$("plansClose").addEventListener("click", function () { $("plansSheet").hidden = true; });

/* ---------- bring my calendar in (shared module: IMPORT-DESIGN.md) ---------- */
var DEMO_SESSION = /[?&]demo=1\b/.test(location.search) || !!(state.settings && state.settings.demo);
var IMPORT_GUIDE = {
  google: "In Google Calendar: Settings \u2192 your calendar \u2192 \u201CSecret address in iCal format\u201D. Copy it, paste it below.",
  apple: "On iCloud.com: Calendar \u2192 the share icon beside a calendar \u2192 Public Calendar gives a link. Or export a .ics file from the Calendar app and choose it below.",
  outlook: "In Outlook on the web: Settings \u2192 Calendar \u2192 Shared calendars \u2192 publish, and copy the ICS link. Paste it below.",
  file: "Pick the .ics file your old calendar exported. It is read once, copied in, and the file itself is never changed."
};
var IMPORT_LABELS = { google: "Google Calendar", apple: "Apple / iCloud", outlook: "Outlook", file: "a calendar file" };
var importSource = "google";
function openImport() { if (DEMO_SESSION) return; $("importResult").textContent = ""; $("importSheet").hidden = false; }
function shapeToTask(s) {
  var cat = L.categoryFor(s.title);
  var words = [s.location, s.notes].filter(Boolean).join(" \u2014 ");
  return { id: uid(), title: s.title, date: s.date, time: s.time, durationMin: s.durationMin, priority: 0, repeat: s.repeat, category: cat.id, color: cat.color, essential: false, status: "todo", steps: [], minVersion: "", fullVersion: "", source: "import", originalText: words, skipDates: [], doneDates: [], importUid: s.importUid, importKey: s.importKey };
}
function runImport(text, label) {
  var parsed = window.CI.parseICS(text);
  if (parsed.error || !parsed.events.length) { $("importResult").textContent = "That didn\u2019t read as a calendar. Nothing was brought in."; return; }
  var plan = window.CI.planImport(parsed, state.tasks, { sourceLabel: label });
  var res = window.CI.applyImport(state, plan, label, shapeToTask);
  save(); refreshAll();
  if (res.added > 0) {
    markActivated("import");
    if (ACTIVE_UID && FB.configured) {
      var totalEv = (state.imports || []).reduce(function (a, r) { return a + (r.count || 0); }, 0);
      FB.fsSet("aggImports/" + ACTIVE_UID, { events: totalEv, imports: (state.imports || []).length, at: new Date().toISOString() }).catch(function () {});
    }
  }
  var bits = [res.added + (res.added === 1 ? " event" : " events") + " brought in"];
  if (res.liveRepeats) bits.push(res.liveRepeats + " repeating");
  if (res.dupes) bits.push(res.dupes + " already here");
  if (res.skipped) bits.push(res.skipped + " couldn\u2019t be read");
  $("importResult").textContent = bits.join(" \u00B7 ") + ".";
  toast(res.added ? "Calendar brought in." : "Nothing new to bring in.");
}
if (DEMO_SESSION) { $("importBtn").hidden = true; $("importOpen2").hidden = true; }
$("importBtn").addEventListener("click", openImport);
$("importOpen2").addEventListener("click", openImport);
$("guideImport").addEventListener("click", function () { closeGuide(); openImport(); });
$("importClose").addEventListener("click", function () { $("importSheet").hidden = true; });
document.querySelectorAll(".import-src").forEach(function (b) {
  b.addEventListener("click", function () {
    importSource = b.getAttribute("data-src");
    document.querySelectorAll(".import-src").forEach(function (x) { x.classList.toggle("is-active", x === b); });
    $("importGuide").textContent = IMPORT_GUIDE[importSource];
  });
});
$("importGo").addEventListener("click", function () {
  var url = $("importUrl").value.trim();
  if (!url) { $("importResult").textContent = "Paste a calendar link first \u2014 or choose a file below."; return; }
  $("importResult").textContent = "Fetching\u2026";
  fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.text(); })
    .then(function (t) { runImport(t, IMPORT_LABELS[importSource]); })
    .catch(function () { $("importResult").textContent = "That link couldn\u2019t be fetched \u2014 some calendars block links. Export a .ics file from it instead; that always works."; });
});
$("importFileBtn").addEventListener("click", function () { $("importFile").click(); });
$("importFile").addEventListener("change", function () {
  var f = $("importFile").files && $("importFile").files[0];
  if (!f) return;
  var rd = new FileReader();
  rd.onload = function () { runImport(String(rd.result || ""), importSource === "file" ? "a calendar file" : IMPORT_LABELS[importSource]); };
  rd.onerror = function () { $("importResult").textContent = "That file couldn\u2019t be read."; };
  rd.readAsText(f);
  $("importFile").value = "";
});
if (state.welcomed && !state.settings.guideDone) maybeGuide();

/* ---------- accounts (the accounts wave) ----------
   Guest mode is forever: everything below is inert unless the
   Firebase config has landed AND a session exists. The spine is
   the contracts' light record (createdAt / lastActiveAt / plan /
   activatedAt) — the state itself lives at users/{uid}/data/state
   as one JSON string, so count-only readers (the CEO dashboard)
   can never reach a state payload. */
var spine = null;
var syncTimer = null;
var syncBusy = false;
function spinePath() { return "users/" + ACTIVE_UID; }
function statePath() { return "users/" + ACTIVE_UID + "/data/state"; }
function scheduleSync() {
  if (!ACTIVE_UID || !FB.configured) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1200);
}
var DELETING = false;
function syncNow() {
  if (!ACTIVE_UID || !FB.configured || syncBusy || DELETING) return;
  syncBusy = true;
  var payload = JSON.stringify(state);
  FB.fsSet(statePath(), { stateJson: payload, updatedAt: new Date().toISOString() })
    .then(function () { syncBusy = false; }, function () { syncBusy = false; });
  var note = $("accountNote");
  if (note && payload.length > 800000) note.textContent = "Your saved calendar is getting large (" + Math.round(payload.length / 1000) + " KB). It still fits — a tidy-up option is coming before it ever matters.";
}
function spineTouchDaily() {
  if (!spine) return;
  var today = new Date().toISOString().slice(0, 10);
  if (String(spine.lastActiveAt || "").slice(0, 10) === today) return;
  spine.lastActiveAt = new Date().toISOString();
  FB.fsSet(spinePath(), { lastActiveAt: spine.lastActiveAt }, ["lastActiveAt"]).catch(function () {});
}
function markActivated(kind) {
  if (!ACTIVE_UID || !FB.configured || !spine || spine.activatedAt) return;
  spine.activatedAt = new Date().toISOString();
  spine.activationKind = kind;
  FB.fsSet(spinePath(), { activatedAt: spine.activatedAt, activationKind: kind }, ["activatedAt", "activationKind"]).catch(function () {});
  FB.fsSet("aggSignups/" + ACTIVE_UID, { activatedAt: spine.activatedAt, activationKind: kind }, ["activatedAt", "activationKind"]).catch(function () {});
}
function guestPot() {
  try {
    var g = JSON.parse(localStorage.getItem(STORE + ":guest") || "null");
    if (!g) return null;
    // The pot is the guest's OWN things. The app's factory samples
    // (source "sample") are not user data — a samples-only slot is
    // no pot, or the next account would be offered the demo set.
    var n = (g.tasks || []).filter(function (t) { return t && t.source !== "sample"; }).length
      + (g.todos || []).length + (g.habits || []).length;
    return n > 0 ? g : null;
  } catch (e) { return null; }
}
function adoptStateObject(obj) {
  try { localStorage.setItem(storeKey(), JSON.stringify(obj)); } catch (e) {}
  var fresh = load();
  if (fresh) { state = fresh; save(); applyAppearance(); refreshAll(); renderTitle(); }
}
function reconcileAccount() {
  if (!ACTIVE_UID || !FB.configured) return;
  FB.fsGet(spinePath()).then(function (sp) {
    if (!sp) {
      spine = { createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), deletedByUser: false };
      // No plan on the user record — entitlement lives at _comp
      // alone. The aggregate shard (owner space) is the only
      // outward fact: this account exists, and when it arrived.
      FB.fsSet("aggSignups/" + ACTIVE_UID, { createdAt: spine.createdAt }).catch(function () {});
      return FB.fsSet(spinePath(), spine).then(function () { return null; });
    }
    spine = sp; return null;
  }).then(function () {
    spineTouchDaily();
    return FB.fsGet(statePath());
  }).then(function (doc) {
    renderAccount();
    if (doc && typeof doc.stateJson === "string") {
      var serverAt = Date.parse(doc.updatedAt || "") || 0;
      var localAt = (state && state.updatedAt) || 0;
      if (serverAt > localAt) {
        try { adoptStateObject(JSON.parse(doc.stateJson)); } catch (e) {}
      }
      renderAccount();
    }
    // The door is decided HERE, after any adoption — and by
    // CONTENT, not by the state doc's existence: a fresh
    // account's own first sync writes its (empty) state doc
    // while this reconcile is still fetching, so "no doc" is a
    // race the door loses on real networks (live-caught on the
    // twin journey: the door never fired, mock always won).
    adoptPendingName();
    maybeJoinDoor();
  }).catch(function () { renderAccount(); });
}
/* Door-first joining, v4: after the door the user is inside
   the app and Skip's TOUR asks the name as its first stop.
   Left unanswered, the name earns exactly ONE gentle
   re-offer on the next visit (HQ's re-ask ruling — see
   maybeJoinDoor + noteNameSkip), then never again; the
   name also lives in Settings forever. The pot door
   follows either way. */
function maybeJoinDoor() {
  if (!ACTIVE_UID || state.settings.profileName) { maybePotDoor(); return; }
  if (!state.settings.guideDone) { maybePotDoor(); return; } // the coming tour asks it
  // THE GENTLE RE-OFFER (HQ ruling): once, on a later visit
  // than the skip — never the same session, never again
  // after. An account never asked at all (its tour predates
  // the name step) gets this as its first ask.
  try {
    if (localStorage.getItem("pace-name-reoffered") === ACTIVE_UID) { maybePotDoor(); return; }
    var sk = (localStorage.getItem("pace-name-skip") || "").split(":");
    if (sk[0] === ACTIVE_UID && !(Number(sk[1]) < BOOT_T)) { maybePotDoor(); return; } // skipped this very visit
    localStorage.setItem("pace-name-reoffered", ACTIVE_UID);
  } catch (e) { maybePotDoor(); return; }
  TOUR = [{ kind: "name", pose: "welcome", bubble: "Ahoy! I'm Skip. What's your name?", next: "Done ✓", last: true }];
  showGuide(0);
  maybePotDoor();
}
/* The name asked at sign-up (or carried by a Google door)
   lands on the profile AFTER reconcile settles — adopting it
   earlier would stamp the local state and could win against
   a newer server copy (Law B: never hide a user's data). */
function adoptPendingName() {
  try {
    var pn = localStorage.getItem("pace-pending-name");
    if (!pn) return;
    localStorage.removeItem("pace-pending-name");
    if (!ACTIVE_UID || state.settings.profileName) return;
    state.settings.profileName = String(pn).slice(0, 60);
    save();
    var wn = state.settings.profileName.trim().split(/\s+/)[0];
    if (wn && !$("welcome").hidden) $("welcomeTitle").textContent = "Welcome to Pace Calendar, " + wn;
    renderAccount();
  } catch (e) {}
}
/* The door's stamps key to the POT'S GENERATION (Security's
   precision): the same pot is never offered twice, a genuinely
   new pot may be; the stamps live on this device only, and
   stamping never touches the pot's data. */
function potGeneration(pot) {
  if (!pot) return "";
  var real = (pot.tasks || []).filter(function (t) { return t && t.source !== "sample"; });
  var first = (real[0] && real[0].id) || "";
  return String(pot.updatedAt || "") + ":" + real.length + ":" + first;
}
function maybePotDoor() {
  var pot = guestPot();
  if (!pot) return;
  if (localStorage.getItem("pace-pot-offered") === potGeneration(pot)) return;
  // An account holding real content of its own is never
  // offered the pot — the door is for empty-handed accounts.
  var ownReal = (state.tasks || []).some(function (t) { return t && t.source !== "sample"; }) || (state.todos || []).length > 0 || (state.habits || []).length > 0;
  if (ownReal) return;
  var n = (pot.tasks || []).length;
  $("potText").textContent = "This device has a guest calendar on it (" + n + (n === 1 ? " event" : " events") + ", plus its lists). Bring it into your account, or start fresh — the guest copy stays on the device either way until you say.";
  $("potSheet").hidden = false;
}
function resolvePot(bring) {
  var pot0 = guestPot();
  localStorage.setItem("pace-pot-offered", potGeneration(pot0));
  $("potSheet").hidden = true;
  if (!bring) { toast("Fresh start. Your guest calendar is still on this device."); return; }
  var pot = guestPot();
  if (!pot) return;
  adoptStateObject(pot);
  localStorage.setItem("pace-pot-consumed", potGeneration(pot));
  try { localStorage.setItem(STORE + ":guest", JSON.stringify(seed())); } catch (e) {}
  syncNow();
  toast("Your things are in your account now.");
}
function freshAccountState() {
  var s = seed();
  s.tasks = []; s.todos = []; s.habits = []; s.feelings = {}; s.imports = [];
  return s;
}
function renderAccount() {
  var grp = $("accountGroup");
  if (!grp || !FB.configured) return;
  grp.hidden = false;
  var sess = FB.session();
  var note = $("accountNote");
  if (ACTIVE_UID && sess) {
    var myName = (state.settings.profileName || "").trim();
    var firstName = myName ? myName.split(/\s+/)[0] : "";
    $("accountLine").textContent = (firstName ? "Hi " + firstName + " — signed in as " : "Signed in as ") + (sess.email || "your account") + ". Your calendar saves to your account and this device.";
    var pnr = $("profileNameRow"), pni = $("profileName");
    if (pnr && pni) { pnr.hidden = false; if (document.activeElement !== pni) pni.value = myName; }
    $("accountOpen").hidden = true; $("accountOut").hidden = false; $("accountDelete").hidden = false;
    var potNow = guestPot();
    $("accountBring").hidden = !(potNow && localStorage.getItem("pace-pot-consumed") !== potGeneration(potNow));
    $("accountUncache").hidden = true;
    if (note && !note.textContent) note.textContent = "";
  } else {
    $("accountLine").textContent = "You are using Pace on this device only. Sign in to keep your calendar safe across devices.";
    $("accountOpen").hidden = false; $("accountOut").hidden = true; $("accountDelete").hidden = true;
    $("accountBring").hidden = true;
    var pnr2 = $("profileNameRow"); if (pnr2) pnr2.hidden = true;
    var lastUid = null;
    try { lastUid = localStorage.getItem("pace-last-uid"); } catch (e) {}
    $("accountUncache").hidden = !(lastUid && localStorage.getItem(STORE + ":" + lastUid));
  }
}
function openAuth() {
  if (!FB.configured) return;
  $("authMsg").textContent = "";
  $("authMsg1").textContent = "";
  $("authPass").value = "";
  $("doorStep1").hidden = false;
  $("doorStep2").hidden = true;
  $("appleBtn").hidden = !(window.PACE_FB_CONFIG && window.PACE_FB_CONFIG.appleEnabled);
  $("authSheet").hidden = false;
}
function authBusy(msg) { $("authMsg").textContent = msg; }
function afterSignIn() { try { localStorage.setItem("pace-last-uid", ACTIVE_UID || ""); } catch (e) {} location.reload(); }
function bindAccounts() {
  if (!FB.configured) return;
  renderAccount();
  var pni = $("profileName");
  if (pni) pni.addEventListener("change", function () {
    state.settings.profileName = pni.value.trim().slice(0, 60);
    save(); renderAccount(); toast("We'll call you " + (state.settings.profileName.split(/\s+/)[0] || "friend") + " here.");
  });
  $("accountOpen").addEventListener("click", openAuth);
  $("authClose").addEventListener("click", function () { $("authSheet").hidden = true; });
  // DOOR-FIRST JOINING (the ruling, 15 Oct): the door is only
  // the door — mark, Google, Apple, email + password, ONE
  // button. One tap signs a returning user in; if no account
  // exists for the email, the same tap creates it (under
  // enumeration protection the two failures read alike, so a
  // create attempt follows — an EMAIL_EXISTS answer then
  // means the password was wrong, and says so plainly).
  // The name is asked on the very next screen, never here.
  var doDoor = function () {
    var email = $("authEmail").value.trim(), pw = $("authPass").value;
    if (!email || !pw) { authBusy("Add your email and password first."); return; }
    authBusy("One moment…");
    FB.emailSignIn(email, pw).then(function (s) { ACTIVE_UID = s.uid; afterSignIn(); })
      .catch(function (e) {
        if (e && (e.code === "EMAIL_NOT_FOUND" || e.code === "INVALID_LOGIN_CREDENTIALS")) {
          authBusy("Creating your account…");
          FB.emailSignUp(email, pw).then(function (s) { ACTIVE_UID = s.uid; afterSignIn(); })
            .catch(function (e2) {
              if (e2 && e2.code === "EMAIL_EXISTS") authBusy("That email has an account, but the password does not match it. Try again, or tap Forgot password.");
              else authBusy(e2.message);
            });
        } else authBusy(e.message);
      });
  };
  $("authGo").addEventListener("click", doDoor);
  $("authPass").addEventListener("keydown", function (e) { if (e.key === "Enter") doDoor(); });
  // The door's two steps (the refined shape): the arrow
  // carries a plausible email to the password step; Change
  // walks back. Enter on the email does what the arrow does.
  var doorNext = function () {
    var email = $("authEmail").value.trim();
    if (!email || email.indexOf("@") < 1) { $("authMsg1").textContent = "That email address does not look right."; return; }
    $("authMsg1").textContent = "";
    $("doorEmailEcho").textContent = email;
    $("doorStep1").hidden = true;
    $("doorStep2").hidden = false;
    $("authPass").focus();
  };
  $("doorNext").addEventListener("click", doorNext);
  $("authEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") doorNext(); });
  $("doorChange").addEventListener("click", function () {
    $("doorStep2").hidden = true;
    $("doorStep1").hidden = false;
    $("authEmail").focus();
  });
  $("pwEye").addEventListener("click", function () {
    var f = $("authPass");
    f.type = f.type === "password" ? "text" : "password";
    f.focus();
  });
  $("doorBack").addEventListener("click", function () {
    $("doorStep2").hidden = true;
    $("doorStep1").hidden = false;
    $("authEmail").focus();
  });
  $("authReset").addEventListener("click", function () {
    var email = $("authEmail").value.trim();
    if (!email) { authBusy("Type your email above first, then tap Forgot password."); return; }
    FB.sendPasswordReset(email).then(function () { authBusy("Reset email sent. Follow its link, then sign in here."); })
      .catch(function (e) { authBusy(e.message); });
  });
  $("googleBtn").addEventListener("click", function () {
    var cid = window.PACE_FB_CONFIG && window.PACE_FB_CONFIG.googleClientId;
    if (!cid) { authBusy("Google sign-in is not switched on yet. Email + password works now."); return; }
    authBusy("Opening Google…");
    var go = function () {
      window.google.accounts.id.initialize({
        client_id: cid,
        callback: function (resp) {
          FB.googleSignIn(resp.credential).then(function (s) { ACTIVE_UID = s.uid; afterSignIn(); })
            .catch(function (e) { authBusy(e.message); });
        },
      });
      window.google.accounts.id.prompt();
    };
    if (window.google && window.google.accounts) go();
    else {
      var sc = document.createElement("script");
      sc.src = "https://accounts.google.com/gsi/client";
      sc.onload = go; sc.onerror = function () { authBusy("Google did not load. Check your connection, or use email + password."); };
      document.head.appendChild(sc);
    }
  });
  $("appleBtn").addEventListener("click", function () { authBusy("Apple sign-in arrives with the iOS launch. Email + password works now."); });
  $("accountOut").addEventListener("click", function () {
    try { localStorage.setItem("pace-last-uid", ACTIVE_UID || ""); } catch (e) {}
    FB.signOut(); location.reload();
  });
  $("accountDownload").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "pace-calendar-data.json"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });
  $("accountBring").addEventListener("click", function () { $("potSheet").hidden = false; var pot = guestPot(); if (pot) $("potText").textContent = "Bring this device's guest calendar (" + (pot.tasks || []).length + " events, plus its lists) into your account? It replaces nothing — your account has no saved calendar yet."; });
  $("potYes").addEventListener("click", function () { resolvePot(true); });
  $("potNo").addEventListener("click", function () { resolvePot(false); });
  $("accountUncache").addEventListener("click", function () {
    var lastUid = null;
    try { lastUid = localStorage.getItem("pace-last-uid"); } catch (e) {}
    if (lastUid) { try { localStorage.removeItem(STORE + ":" + lastUid); } catch (e) {} }
    toast("Your cached data is off this device. Your account itself is untouched.");
    renderAccount();
  });
  $("accountDelete").addEventListener("click", function () { $("deleteMsg").textContent = ""; $("deleteSheet").hidden = false; });
  $("deleteCancel").addEventListener("click", function () { $("deleteSheet").hidden = true; });
  $("deleteGo").addEventListener("click", function () {
    var pw = $("deletePass").value;
    var sess = FB.session();
    if (!sess) return;
    // Disarm sync FIRST (Quality's held leg, diagnosed): a
    // debounced save landing mid-sweep would resurrect the
    // state doc after its delete — the sweep must be the
    // only writer from here. A failed delete re-arms it.
    DELETING = true;
    if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
    $("deleteMsg").textContent = "Checking it is you…";
    FB.emailSignIn(sess.email, pw).then(function () {
      $("deleteMsg").textContent = "Deleting…";
      // The §6 sweep, in order (Security ruling, rules v2.2):
      // state → spine → the aggregate shards → the Auth user.
      // Erasure takes the shard: a uid-keyed row is the user's
      // data however light its fields. aggSubs stays out — a
      // payment-path record under its own retention policy.
      return FB.fsDelete(statePath())
        .then(function () { return FB.fsDelete(spinePath()); })
        .then(function () { return FB.fsDelete("aggSignups/" + sess.uid); })
        .then(function () { return FB.fsDelete("aggImports/" + sess.uid); });
    }).then(function () { return FB.deleteAccount(); })
      .then(function () {
        try { localStorage.removeItem(storeKey()); localStorage.removeItem("pace-last-uid"); } catch (e) {}
        location.reload();
      })
      .catch(function (e) { DELETING = false; $("deleteMsg").textContent = e.message || "That did not work. Nothing was deleted."; });
  });
  reconcileAccount();
}

/* ---------- boot ---------- */
function refreshAll() { renderTicker(); renderDayList(); renderUpNext(); renderCheckin(); renderRing(); refreshCalendar(); renderYear(); renderTodos(); renderHabits(); if ($("panel-progress").classList.contains("is-active")) renderProgress(); }
initCalendar();
applyAppearance();
applySidebar();
bindSettings();
renderTitle();
selectDate(L.todayKey(), false);
renderTodos();
renderHabits();
checkNotifications();
bindAccounts();
if ("serviceWorker" in navigator) { navigator.serviceWorker.register("service-worker.js").catch(function () {}); }
})();
