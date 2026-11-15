const KEY = "learning-tracker-v1";
const NEW = "__new__";
const PALETTE = ["c0", "c1", "c2", "c3"];
const byRank = (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9);

let db = null;
let statusFilter = "all";
let addOpen = false;
let addMode = "single";
let draft = null;
let formError = "";
let flash = "";
let editingId = null;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const normalize = s => String(s == null ? "" : s).trim().replace(/\s+/g, " ");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const isHttp = u => /^https?:\/\//i.test(u);

/* ---------- storage ---------- */
function defaults(){
  return {
    sections: [],
    subsections: [],
    statuses: [
      { id: "want", label: "Want to learn", rank: 0 },
      { id: "learning", label: "Learning", rank: 1 },
      { id: "learned", label: "Learned", rank: 2 }
    ],
    topics: []
  };
}
function valid(p){
  return !!p && Array.isArray(p.sections) && Array.isArray(p.subsections) &&
    Array.isArray(p.statuses) && Array.isArray(p.topics);
}
// Gives every group a clean 0..n-1 rank, keeping the order that already exists.
function renumber(items, groupOf){
  const groups = new Map();
  items.forEach(it => {
    const g = groupOf(it) || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  });
  groups.forEach(list => {
    list.sort(byRank);
    list.forEach((it, i) => { it.rank = i; });
  });
}
function ensure(p){
  renumber(p.subsections, s => s.sectionId);
  renumber(p.topics, t => t.subsectionId);
  renumber(p.statuses, () => "");
  p.topics.forEach(t => { t.url = t.url || ""; });
  return p;
}
function load(){
  try {
    const v = localStorage.getItem(KEY);
    if (v){ const p = JSON.parse(v); if (valid(p)){ db = ensure(p); return; } }
  } catch (e) {}
  db = defaults();
}
function save(){
  ensure(db);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
}

/* ---------- lookups ---------- */
function sortedStatuses(){ return [...db.statuses].sort(byRank); }
function statusOf(id){ return db.statuses.find(s => s.id === id) || null; }
function sectionOf(id){ return db.sections.find(s => s.id === id) || null; }
function subOf(id){ return db.subsections.find(s => s.id === id) || null; }
function subsIn(sectionId){ return db.subsections.filter(s => s.sectionId === sectionId).sort(byRank); }
function topicsIn(subId){ return db.topics.filter(t => t.subsectionId === subId).sort(byRank); }
function nextRank(list){ return list.reduce((m, x) => Math.max(m, x.rank ?? -1), -1) + 1; }
function pillColor(statusId){
  const i = sortedStatuses().findIndex(s => s.id === statusId);
  return "var(--" + PALETTE[(i < 0 ? 0 : i) % PALETTE.length] + ")";
}

/* ---------- DOM helpers ---------- */
function el(tag, props, ...kids){
  const n = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (k === "text") n.textContent = v;
    else if (k === "value") n.value = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
// Two-tap confirm: first click arms, second click within 3s runs the action.
function dangerBtn(label, action){
  const b = el("button", { type: "button", class: "ghost danger small", text: label });
  b.dataset.label = label;
  b.addEventListener("click", () => {
    if (b.dataset.armed){ action(); }
    else {
      b.dataset.armed = "1"; b.textContent = "Confirm";
      setTimeout(() => { if (b.isConnected){ delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3000);
    }
  });
  return b;
}
function moveBtn(label, disabled, action){
  return el("button", { type: "button", class: "ghost small", text: label,
    "aria-label": label === "↑" ? "Move up" : "Move down", disabled: disabled ? "" : null, onclick: action });
}
function card(title, ...kids){
  return el("section", { class: "card" }, el("h2", { text: title }), ...kids);
}
function link(href, text){ return el("a", { class: "crumb", href, text }); }
function tile(href, colorIdx, name){
  return el("a", { class: "tile", href, style: "--tile:var(--" + PALETTE[colorIdx % PALETTE.length] + ")" },
    el("span", { class: "tile-name", text: name }));
}
function nameInput(value, ariaLabel, apply){
  return el("input", { value, "aria-label": ariaLabel, onchange: e => {
    const v = normalize(e.target.value);
    if (!v){ e.target.value = value; return; }
    apply(cap(v)); save(); render();
  } });
}

/* ---------- reordering ---------- */
// Swaps the rank of an item with its neighbour in a sorted list.
function swapWith(list, idx, dir){
  const a = list[idx], b = list[idx + dir];
  if (!a || !b) return;
  [a.rank, b.rank] = [b.rank, a.rank];
  save(); render();
}
// Sections keep their array order.
function swapSections(idx, dir){
  const j = idx + dir;
  if (j < 0 || j >= db.sections.length) return;
  [db.sections[idx], db.sections[j]] = [db.sections[j], db.sections[idx]];
  save(); render();
}

/* ---------- normalisation: applied before anything is stored ---------- */
function resolveSection(name){
  const n = normalize(name);
  const hit = db.sections.find(s => s.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  const sec = { id: uid(), name: cap(n) };
  db.sections.push(sec);
  return sec.id;
}
function resolveSub(name, sectionId){
  const n = normalize(name);
  const hit = subsIn(sectionId).find(s => s.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  const sub = { id: uid(), name: cap(n), sectionId, rank: nextRank(subsIn(sectionId)) };
  db.subsections.push(sub);
  return sub.id;
}
function resolveStatus(name){
  const n = normalize(name);
  const hit = db.statuses.find(s => s.label.toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  const st = { id: uid(), label: cap(n), rank: nextRank(db.statuses) };
  db.statuses.push(st);
  return st.id;
}

/* ---------- add form: single topic or many (one per line) ---------- */
function newDraft(sectionId, subId){
  const first = sortedStatuses()[0];
  return { title: "", url: "", lines: "", sectionId: sectionId || "", sectionNew: "",
    subId: subId || "", subNew: "", statusId: first ? first.id : "", statusNew: "" };
}
function openAdd(sectionId, subId){
  addOpen = true; addMode = "single";
  draft = newDraft(sectionId, subId);
  formError = ""; flash = "";
  render();
}
function addModule(sectionId, subId){
  if (!addOpen) return el("button", { type: "button", class: "add-btn", text: "+ Add topics",
    onclick: () => openAdd(sectionId, subId) });
  const seg = (m, label) => el("button", { type: "button", class: "seg", "aria-pressed": String(addMode === m), text: label,
    onclick: () => { addMode = m; formError = ""; render(); } });
  const msg = flash; flash = "";
  return el("section", { class: "card", "aria-label": "Add topics" },
    el("div", { class: "add-head" },
      el("div", { class: "seg-group", role: "group", "aria-label": "Add mode" },
        seg("single", "Single topic"), seg("multi", "Multiple topics")),
      el("button", { type: "button", class: "ghost small", text: "Close", onclick: () => { addOpen = false; render(); } })),
    el("div", { class: "ok", role: "status", text: msg }),
    addForm());
}
function addForm(){
  const d = draft;
  const sectionSel = el("select", { "aria-label": "Section", onchange: e => {
    d.sectionId = e.target.value;
    d.subId = d.sectionId === NEW ? NEW : "";
    render();
  } },
    el("option", { value: "", text: "Choose a section" }),
    ...db.sections.map(s => el("option", { value: s.id, text: s.name })),
    el("option", { value: NEW, text: "+ New section…" }));
  sectionSel.value = d.sectionId;

  const subs = d.sectionId && d.sectionId !== NEW ? subsIn(d.sectionId) : [];
  const subSel = el("select", { "aria-label": "Subsection", disabled: d.sectionId ? null : "", onchange: e => {
    d.subId = e.target.value; render();
  } },
    el("option", { value: "", text: "Choose a subsection" }),
    ...subs.map(s => el("option", { value: s.id, text: s.name })),
    el("option", { value: NEW, text: "+ New subsection…" }));
  subSel.value = d.subId;

  const statusSel = el("select", { "aria-label": "Status", onchange: e => { d.statusId = e.target.value; render(); } },
    ...sortedStatuses().map(s => el("option", { value: s.id, text: s.label })),
    el("option", { value: NEW, text: "+ New status…" }));
  statusSel.value = d.statusId;

  const newInput = (label, key) => el("label", { class: "full" }, label,
    el("input", { value: d[key], placeholder: label, autocomplete: "off", oninput: e => { d[key] = e.target.value; } }));
  const newNames = [
    d.sectionId === NEW ? newInput("New section name", "sectionNew") : null,
    d.subId === NEW ? newInput("New subsection name", "subNew") : null,
    d.statusId === NEW ? newInput("New status name", "statusNew") : null
  ];

  const topicFields = addMode === "single"
    ? [
        el("label", { class: "full" }, "Topic",
          el("input", { value: d.title, placeholder: "e.g. Double-entry ledgers", autocomplete: "off",
            oninput: e => { d.title = e.target.value; } })),
        el("label", { class: "full" }, "Link (optional)",
          el("input", { value: d.url, type: "url", inputmode: "url", placeholder: "https://…",
            oninput: e => { d.url = e.target.value; } }))
      ]
    : [
        el("label", { class: "full" }, "Topics, one per line",
          el("textarea", { value: d.lines, placeholder: "Idempotent payments\nRefund flows\nPCI basics",
            oninput: e => { d.lines = e.target.value; } }))
      ];

  const form = el("form", { class: "stack", novalidate: "" },
    el("div", { class: "fields" },
      el("label", null, "Section", sectionSel),
      el("label", null, "Subsection", subSel),
      el("label", null, "Status", statusSel),
      ...newNames.filter(Boolean),
      ...topicFields),
    el("div", { class: "err", role: "alert", text: formError }),
    el("div", { class: "btns" },
      el("button", { type: "submit", text: addMode === "single" ? "Add topic" : "Add topics" })));
  form.addEventListener("submit", e => {
    e.preventDefault();
    saveDraft();
    render();
  });
  return form;
}
// Validates everything first, then creates any new section, subsection or status.
function saveDraft(){
  const d = draft;
  const single = addMode === "single";
  const titles = (single ? [d.title] : d.lines.split("\n")).map(normalize).filter(Boolean);
  const url = single ? normalize(d.url) : "";
  if (!titles.length){ formError = single ? "Add a topic title." : "Add at least one topic, one per line."; return false; }
  if (url && !isHttp(url)){ formError = "Paste the full link, starting with https://."; return false; }
  if (!d.sectionId){ formError = "Choose a section."; return false; }
  if (d.sectionId === NEW && !normalize(d.sectionNew)){ formError = "Name the new section."; return false; }
  if (!d.subId){ formError = "Choose a subsection."; return false; }
  if (d.subId === NEW && !normalize(d.subNew)){ formError = "Name the new subsection."; return false; }
  if (d.statusId === NEW && !normalize(d.statusNew)){ formError = "Name the new status."; return false; }

  const sectionId = d.sectionId === NEW ? resolveSection(d.sectionNew) : d.sectionId;
  const subId = d.subId === NEW ? resolveSub(d.subNew, sectionId) : d.subId;
  const statusId = d.statusId === NEW ? resolveStatus(d.statusNew) : d.statusId;

  const existing = new Set(topicsIn(subId).map(t => t.title.toLowerCase()));
  const fresh = [];
  titles.forEach(t => {
    const key = t.toLowerCase();
    if (!existing.has(key)){ existing.add(key); fresh.push(t); }
  });
  if (!fresh.length){ formError = "That topic is already in this subsection."; return false; }

  let rank = nextRank(topicsIn(subId));
  fresh.forEach(t => db.topics.push({ id: uid(), title: t, url: single ? url : "", subsectionId: subId, statusId, rank: rank++ }));
  save();

  const skipped = titles.length - fresh.length;
  flash = skipped
    ? `Added ${fresh.length}. Skipped ${skipped} already in this subsection.`
    : `Added ${fresh.length} ${fresh.length === 1 ? "topic" : "topics"}.`;
  draft = { ...newDraft(sectionId, subId), statusId };
  formError = "";
  return true;
}

/* ---------- topics ---------- */
function statusChips(){
  return el("section", { class: "card" },
    el("div", { class: "chips", role: "group", "aria-label": "Filter by status" },
      el("button", { type: "button", class: "chip", "aria-pressed": String(statusFilter === "all"),
        onclick: () => { statusFilter = "all"; render(); }, text: "All" }),
      ...sortedStatuses().map(st => el("button", { type: "button", class: "chip",
        "aria-pressed": String(statusFilter === st.id), onclick: () => { statusFilter = st.id; render(); }, text: st.label }))));
}
function topicRow(t, full, idx){
  if (editingId === t.id) return editRow(t);
  const statusSel = el("select", { "aria-label": "Status for " + t.title,
    onchange: e => { t.statusId = e.target.value; save(); render(); } },
    ...sortedStatuses().map(s => el("option", { value: s.id, text: s.label })));
  statusSel.value = t.statusId;
  const name = t.url
    ? el("a", { class: "vtitle", href: t.url, target: "_blank", rel: "noopener noreferrer", text: t.title })
    : el("span", { class: "vtitle", text: t.title });
  return el("li", { class: "row" },
    el("div", { class: "main" }, name,
      el("span", { class: "pill", style: "--pc:" + pillColor(t.statusId),
        text: (statusOf(t.statusId) || { label: "No status" }).label })),
    el("div", { class: "ops" },
      statusSel,
      moveBtn("↑", idx === 0, () => swapWith(full, idx, -1)),
      moveBtn("↓", idx === full.length - 1, () => swapWith(full, idx, 1)),
      el("button", { type: "button", class: "ghost small", text: "Edit", onclick: () => { editingId = t.id; render(); } }),
      dangerBtn("Delete", () => { db.topics = db.topics.filter(x => x.id !== t.id); save(); render(); })));
}
function editRow(t){
  const title = el("input", { value: t.title, "aria-label": "Topic title", autocomplete: "off" });
  const url = el("input", { value: t.url, type: "url", inputmode: "url", placeholder: "Link (optional)", "aria-label": "Topic link" });
  const err = el("div", { class: "err", role: "alert" });
  const commit = () => {
    const v = normalize(title.value), u = normalize(url.value);
    if (!v){ err.textContent = "Add a title."; return; }
    if (u && !isHttp(u)){ err.textContent = "Paste the full link, starting with https://."; return; }
    t.title = v; t.url = u; editingId = null; save(); render();
  };
  title.addEventListener("keydown", e => { if (e.key === "Enter") commit(); });
  url.addEventListener("keydown", e => { if (e.key === "Enter") commit(); });
  return el("li", { class: "row edit" },
    el("div", { class: "fields" },
      el("label", { class: "full" }, "Title", title),
      el("label", { class: "full" }, "Link", url)),
    err,
    el("div", { class: "btns" },
      el("button", { type: "button", class: "small", text: "Save", onclick: commit }),
      el("button", { type: "button", class: "ghost small", text: "Cancel", onclick: () => { editingId = null; render(); } })));
}

/* ---------- routing ---------- */
function render(){
  const route = (location.hash || "#home").slice(1);
  const app = document.getElementById("app");
  const nav = document.getElementById("nav");
  const title = document.getElementById("title");
  nav.replaceChildren();
  const sub = route.startsWith("sub-") ? subOf(route.slice(4)) : null;
  const sec = route.startsWith("sec-") ? sectionOf(route.slice(4)) : null;
  let view;
  if (route === "settings"){
    title.textContent = "Settings";
    nav.append(link("#home", "← Back"));
    view = settingsView();
  } else if (sub){
    const parent = sectionOf(sub.sectionId);
    title.textContent = sub.name;
    nav.append(link(parent ? "#sec-" + parent.id : "#home", "← " + (parent ? parent.name : "Home")));
    view = subView(sub);
  } else if (sec){
    title.textContent = sec.name;
    nav.append(link("#home", "← All sections"));
    view = sectionView(sec);
  } else {
    title.textContent = "Learning Tracker";
    nav.append(link("#settings", "Settings"));
    view = homeView();
  }
  app.replaceChildren(view);
}
window.addEventListener("hashchange", () => {
  addOpen = false; editingId = null; statusFilter = "all"; formError = ""; render();
});

/* ---------- home: sections ---------- */
function homeView(){
  const wrap = el("div", { class: "stack" });
  if (!db.sections.length){
    wrap.append(el("section", { class: "card" },
      el("p", { class: "hint", text: "No sections yet. Sections are your big areas, such as Software engineering or Sanatan Dharma." }),
      el("div", { class: "btns" }, el("a", { class: "btn", href: "#settings", text: "Add your first section" }))));
  } else {
    wrap.append(el("div", { class: "grid" }, ...db.sections.map((s, idx) => tile("#sec-" + s.id, idx, s.name))));
  }
  wrap.append(addModule(null, null));
  return wrap;
}

/* ---------- section: its subsections ---------- */
function sectionView(sec){
  const subs = subsIn(sec.id);
  const wrap = el("div", { class: "stack" });
  if (!subs.length){
    wrap.append(el("section", { class: "card" },
      el("p", { class: "hint", text: "No subsections yet. Subsections hold the topics, for example Fintech inside Software engineering." })));
  } else {
    wrap.append(el("div", { class: "grid" }, ...subs.map((s, idx) => tile("#sub-" + s.id, idx, s.name))));
  }
  wrap.append(addModule(sec.id, null));
  return wrap;
}

/* ---------- subsection: ordered topics ---------- */
function subView(sub){
  const full = topicsIn(sub.id);
  const shown = full.map((t, i) => ({ t, i }))
    .filter(x => statusFilter === "all" || x.t.statusId === statusFilter);
  const list = el("ul", { class: "card list", style: "padding:0 14px;gap:0" });
  if (!full.length) list.append(el("li", { class: "empty", text: "No topics yet. Add some below." }));
  else if (!shown.length) list.append(el("li", { class: "empty", text: "Nothing with this status." }));
  shown.forEach(({ t, i }) => list.append(topicRow(t, full, i)));
  return el("div", { class: "stack" }, statusChips(), list, addModule(sub.sectionId, sub.id));
}

/* ---------- settings ---------- */
function settingsView(){
  const wrap = el("div", { class: "stack" });

  // Sections
  const secList = el("ul", { class: "list" });
  db.sections.forEach((s, idx) => {
    const del = dangerBtn("Delete", () => {
      db.sections = db.sections.filter(x => x.id !== s.id);
      save(); render();
    });
    if (subsIn(s.id).length){ del.disabled = true; del.title = "Remove its subsections first."; }
    secList.append(el("li", { class: "row" },
      el("div", { class: "rowline" }, nameInput(s.name, "Section name", v => { s.name = v; })),
      el("div", { class: "ops" },
        moveBtn("↑", idx === 0, () => swapSections(idx, -1)),
        moveBtn("↓", idx === db.sections.length - 1, () => swapSections(idx, 1)),
        del)));
  });
  const newSec = el("input", { placeholder: "New section name", "aria-label": "New section name" });
  wrap.append(card("Sections",
    el("p", { class: "hint", text: "A section that still has subsections can't be deleted." }),
    secList,
    el("div", { class: "rowline" }, newSec,
      el("button", { type: "button", class: "small", text: "Add section", onclick: () => {
        const v = normalize(newSec.value); if (!v) return;
        db.sections.push({ id: uid(), name: cap(v) }); save(); render();
      } }))));

  // Subsections, grouped by section
  const subList = el("ul", { class: "list" });
  db.sections.forEach(sec => {
    const subs = subsIn(sec.id);
    if (!subs.length) return;
    subList.append(el("li", { class: "group", text: sec.name }));
    subs.forEach((s, idx) => {
      const del = dangerBtn("Delete", () => {
        db.subsections = db.subsections.filter(x => x.id !== s.id);
        save(); render();
      });
      if (topicsIn(s.id).length){ del.disabled = true; del.title = "Remove its topics first."; }
      subList.append(el("li", { class: "row" },
        el("div", { class: "rowline" }, nameInput(s.name, "Subsection name", v => { s.name = v; })),
        el("div", { class: "ops" },
          moveBtn("↑", idx === 0, () => swapWith(subs, idx, -1)),
          moveBtn("↓", idx === subs.length - 1, () => swapWith(subs, idx, 1)),
          del)));
    });
  });
  const subName = el("input", { placeholder: "New subsection name", "aria-label": "New subsection name" });
  const subSec = el("select", { "aria-label": "Section for new subsection" },
    ...db.sections.map(s => el("option", { value: s.id, text: s.name })));
  wrap.append(card("Subsections",
    el("p", { class: "hint", text: "Subsections sit inside a section, for example Fintech inside Software engineering." }),
    subList,
    el("div", { class: "rowline" }, subName, subSec,
      el("button", { type: "button", class: "small", text: "Add subsection", onclick: () => {
        const v = normalize(subName.value);
        if (!v || !subSec.value) return;
        if (subsIn(subSec.value).some(s => s.name.toLowerCase() === v.toLowerCase())) return;
        db.subsections.push({ id: uid(), name: cap(v), sectionId: subSec.value, rank: nextRank(subsIn(subSec.value)) });
        save(); render();
      } }))));

  // Statuses
  const ordered = sortedStatuses();
  const stList = el("ul", { class: "list" });
  ordered.forEach((s, idx) => {
    const inUse = db.topics.some(t => t.statusId === s.id);
    const del = dangerBtn("Delete", () => {
      if (inUse || db.statuses.length <= 1) return;
      db.statuses = db.statuses.filter(x => x.id !== s.id);
      save(); render();
    });
    if (inUse){ del.disabled = true; del.title = "Used by topics. Change those topics first."; }
    stList.append(el("li", { class: "row" },
      el("div", { class: "rowline" }, nameInput(s.label, "Status name", v => { s.label = v; })),
      el("div", { class: "ops" },
        moveBtn("↑", idx === 0, () => swapWith(ordered, idx, -1)),
        moveBtn("↓", idx === ordered.length - 1, () => swapWith(ordered, idx, 1)),
        del)));
  });
  const newSt = el("input", { placeholder: "New status name", "aria-label": "New status name" });
  wrap.append(card("Statuses",
    el("p", { class: "hint", text: "Higher on the list shows first. A status that topics still use can't be deleted." }),
    stList,
    el("div", { class: "rowline" }, newSt,
      el("button", { type: "button", class: "small", text: "Add status", onclick: () => {
        const v = normalize(newSt.value); if (!v) return;
        db.statuses.push({ id: uid(), label: cap(v), rank: nextRank(db.statuses) });
        save(); render();
      } }))));

  // Export and import
  const out = el("textarea", { "aria-label": "Export and import data", placeholder: "Export text appears here. Paste an export here to import it." });
  const msg = el("div", { class: "hint", role: "status" });
  const file = el("input", { type: "file", accept: "application/json,.json", "aria-label": "Choose export file" });
  file.addEventListener("change", () => {
    const f = file.files && file.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { out.value = String(r.result || ""); msg.textContent = "File loaded. Press Import to replace everything."; };
    r.readAsText(f);
  });
  wrap.append(card("Export and import",
    el("p", { class: "hint", text: "Copy the export text into another browser or device, then paste it there and press Import." }),
    el("div", { class: "btns" },
      el("button", { type: "button", class: "ghost small", text: "Show export", onclick: () => {
        out.value = JSON.stringify(db, null, 2); out.select(); msg.textContent = "Copy this text and keep it somewhere safe.";
      } }),
      el("button", { type: "button", class: "ghost small", text: "Copy", onclick: () => {
        if (!out.value) return;
        navigator.clipboard.writeText(out.value).then(() => { msg.textContent = "Copied."; },
          () => { out.select(); msg.textContent = "Press Ctrl+C or Cmd+C to copy."; });
      } })),
    out,
    el("label", null, "Or load an export file", file),
    el("div", { class: "btns" },
      dangerBtn("Import (replaces everything)", () => {
        try {
          const p = JSON.parse(out.value);
          if (!valid(p)) throw new Error("invalid");
          const secIds = new Set(p.sections.map(s => s.id));
          p.subsections = p.subsections.filter(s => secIds.has(s.sectionId));
          const subIds = new Set(p.subsections.map(s => s.id));
          p.topics = p.topics.filter(t => subIds.has(t.subsectionId));
          const statusIds = new Set(p.statuses.map(s => s.id));
          const first = [...p.statuses].sort(byRank)[0];
          p.topics.forEach(t => { if (!statusIds.has(t.statusId)) t.statusId = first ? first.id : null; });
          db = ensure(p); save(); msg.textContent = "Imported."; render();
        } catch (e) { msg.textContent = "That text is not a valid export."; }
      })),
    msg));
  return wrap;
}

load();
render();
