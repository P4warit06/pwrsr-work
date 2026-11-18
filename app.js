// pwrsr-work: mobile dashboard for the GitHub Actions coding agent.
// Static page, no dependencies. Talks only to api.github.com with a
// fine-grained token kept in this browser's localStorage.
// All GitHub content is rendered with textContent (never innerHTML).
"use strict";

const API = "https://api.github.com";
const WORKFLOW_FILE = "coding-agent.yml";
const KEY_REPO = "pwrsr.repo";
const KEY_TOKEN = "pwrsr.token";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- storage
const store = {
  get(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
const cfg = () => ({ repo: store.get(KEY_REPO), token: store.get(KEY_TOKEN) });
const configured = () => { const c = cfg(); return Boolean(c.repo && c.token); };

// -------------------------------------------------------------------- api
async function gh(path, options = {}) {
  const { token } = cfg();
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("Token ไม่ถูกต้องหรือหมดอายุ ให้ไปที่ ⚙ แล้วใส่ token ใหม่");
  if (res.status === 403 || res.status === 404) {
    throw new Error(`ไม่มีสิทธิ์เข้าถึงหรือไม่พบข้อมูล (${res.status}) ให้ตรวจชื่อ repo และ permission ของ token`);
  }
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.status === 204 ? null : res.json();
}
const repoPath = (p) => `/repos/${cfg().repo}${p}`;

// --------------------------------------------------------------- helpers
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "onclick") node.addEventListener("click", v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function safeLink(url, text) {
  // Only allow links back to github.com.
  const ok = typeof url === "string" && url.startsWith("https://github.com/");
  return ok ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text) : el("span", {}, text);
}
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}
function banner(message, isError = false) {
  const b = $("banner");
  if (!message) { b.classList.add("hidden"); return; }
  b.textContent = message;
  b.className = "banner" + (isError ? " error" : "");
}
function pill(kind, text) { return el("span", { class: `pill ${kind}` }, text); }

// -------------------------------------------------------- status logic
// Derive agent status from the bot's comments on the issue.
function agentStatus(issue, comments) {
  if (issue.state === "closed") return { kind: "idle", text: "ปิดแล้ว" };
  let status = { kind: "wait", text: "รอเริ่ม" };
  for (const c of comments) {
    const body = c.body || "";
    const isBot = c.user && c.user.type === "Bot";
    if (isBot && body.startsWith("🤖 Agent started")) status = { kind: "run", text: "กำลังทำ" };
    else if (isBot && body.startsWith("### 🤖 Agent run:")) {
      status = /run: success/.test(body) ? { kind: "ok", text: "เสร็จ รอตรวจ" } : { kind: "bad", text: "ล้มเหลว" };
    } else if (!isBot && body.trim().startsWith("/agent")) status = { kind: "wait", text: "รอเริ่ม (follow-up)" };
  }
  return status;
}

// ---------------------------------------------------------------- views
let currentView = "tasks";
function show(view) {
  currentView = view;
  for (const v of ["settings", "tasks", "detail", "new", "runs"]) $(`view-${v}`).classList.toggle("hidden", v !== view);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
}

async function loadTasks() {
  const list = $("task-list");
  list.replaceChildren(el("div", { class: "empty" }, "กำลังโหลด…"));
  const [issues, pulls] = await Promise.all([
    gh(repoPath("/issues?labels=agent&state=all&sort=updated&per_page=20")),
    gh(repoPath("/pulls?state=all&per_page=50")),
  ]);
  const prByIssue = new Map();
  for (const pr of pulls) {
    const m = /^agent\/issue-(\d+)$/.exec(pr.head.ref);
    if (m && !prByIssue.has(Number(m[1]))) prByIssue.set(Number(m[1]), pr);
  }
  const items = issues.filter((i) => !i.pull_request);
  if (!items.length) {
    list.replaceChildren(el("div", { class: "empty" }, "ยังไม่มีงาน กด “+ สั่งงาน” เพื่อเริ่ม"));
    return;
  }
  const commentsList = await Promise.all(
    items.map((i) => (i.comments ? gh(repoPath(`/issues/${i.number}/comments?per_page=100`)) : Promise.resolve([]))),
  );
  list.replaceChildren(
    ...items.map((issue, idx) => {
      const st = agentStatus(issue, commentsList[idx]);
      const pr = prByIssue.get(issue.number);
      return el(
        "button",
        { class: "card", onclick: () => openDetail(issue.number) },
        el("div", { class: "card-title" }, el("span", { class: "num" }, `#${issue.number}`), issue.title),
        el(
          "div",
          { class: "meta" },
          pill(st.kind, st.text),
          pr ? el("span", {}, pr.merged_at ? "PR merged" : pr.state === "open" ? "PR เปิดอยู่" : "PR ปิดแล้ว") : null,
          el("span", {}, ago(issue.updated_at)),
        ),
      );
    }),
  );
}

let detailIssue = null;
async function openDetail(number) {
  show("detail");
  detailIssue = number;
  const box = $("detail");
  box.replaceChildren(el("div", { class: "empty" }, "กำลังโหลด…"));
  const [issue, comments, pulls] = await Promise.all([
    gh(repoPath(`/issues/${number}`)),
    gh(repoPath(`/issues/${number}/comments?per_page=100`)),
    gh(repoPath(`/pulls?state=all&head=${encodeURIComponent(cfg().repo.split("/")[0] + ":agent/issue-" + number)}`)),
  ]);
  const st = agentStatus(issue, comments);
  const pr = pulls[0];
  const parts = [
    el("div", { class: "card" },
      el("div", { class: "card-title" }, el("span", { class: "num" }, `#${issue.number}`), issue.title),
      el("div", { class: "meta" }, pill(st.kind, st.text), safeLink(issue.html_url, "เปิดใน GitHub")),
      issue.body ? el("div", { class: "text-block mt" }, issue.body) : null,
    ),
  ];

  if (pr) {
    const files = await gh(repoPath(`/pulls/${pr.number}/files?per_page=50`));
    parts.push(
      el("div", { class: "section-title" }, `Pull request #${pr.number}`),
      el("div", { class: "card" },
        el("div", { class: "meta" },
          pill(pr.merged_at ? "ok" : pr.state === "open" ? "wait" : "idle", pr.merged_at ? "merged" : pr.state),
          safeLink(pr.html_url, "ตรวจ / Merge ใน GitHub"),
        ),
        el("div", { class: "muted mt" }, `${files.length} ไฟล์ที่เปลี่ยน`),
        ...files.map((f) => [el("div", { class: "file-name" }, `${f.status} · ${f.filename}  +${f.additions} −${f.deletions}`), renderDiff(f.patch)]),
      ),
    );
  }

  parts.push(el("div", { class: "section-title" }, `ความคืบหน้า (${comments.length})`));
  for (const c of comments) {
    parts.push(
      el("div", { class: "comment" },
        el("div", { class: "meta" }, el("b", {}, c.user ? c.user.login : "?"), ago(c.created_at)),
        el("div", { class: "text-block" }, c.body || ""),
      ),
    );
  }
  box.replaceChildren(...parts);
}

function renderDiff(patch) {
  if (!patch) return el("div", { class: "muted" }, "(ไม่มี diff ให้แสดง เช่น ไฟล์ใหญ่หรือ binary)");
  const pre = el("pre");
  for (const line of patch.split("\n")) {
    const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
    pre.append(el("span", { class: `ln ${cls}` }, line || " "));
  }
  return el("div", { class: "diff" }, pre);
}

async function loadRuns() {
  const list = $("run-list");
  list.replaceChildren(el("div", { class: "empty" }, "กำลังโหลด…"));
  const data = await gh(repoPath("/actions/runs?per_page=20"));
  const runs = data.workflow_runs || [];
  if (!runs.length) { list.replaceChildren(el("div", { class: "empty" }, "ยังไม่มี workflow run")); return; }
  list.replaceChildren(
    ...runs.map((r) => {
      const kind = r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : r.conclusion === "skipped" ? "idle" : "bad";
      const label = r.status !== "completed" ? r.status : r.conclusion;
      return el("div", { class: "card" },
        el("div", { class: "card-title" }, r.display_title || r.name),
        el("div", { class: "meta" }, pill(kind, label), el("span", {}, r.name), el("span", {}, ago(r.created_at)), safeLink(r.html_url, "log")),
      );
    }),
  );
}

// --------------------------------------------------------------- actions
async function guarded(fn, button) {
  banner("");
  if (button) button.disabled = true;
  $("btn-refresh").classList.add("spinning");
  try { await fn(); } catch (err) { banner(err.message || String(err), true); } finally {
    if (button) button.disabled = false;
    $("btn-refresh").classList.remove("spinning");
  }
}

function refresh() {
  if (!configured()) { show("settings"); banner("ตั้งค่า repo และ token ก่อนใช้งาน"); return; }
  if (currentView === "tasks") guarded(loadTasks);
  else if (currentView === "runs") guarded(loadRuns);
  else if (currentView === "detail" && detailIssue) guarded(() => openDetail(detailIssue));
}

function init() {
  $("in-repo").value = store.get(KEY_REPO);
  $("in-token").value = store.get(KEY_TOKEN) ? "••••••••" : "";

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { show(t.dataset.view); refresh(); }),
  );
  $("btn-refresh").addEventListener("click", refresh);
  $("btn-settings").addEventListener("click", () => show("settings"));
  $("btn-back").addEventListener("click", () => { show("tasks"); refresh(); });

  $("btn-save").addEventListener("click", () => {
    const repo = $("in-repo").value.trim();
    const token = $("in-token").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { banner("รูปแบบ repo ต้องเป็น owner/name", true); return; }
    store.set(KEY_REPO, repo);
    if (token && token !== "••••••••") store.set(KEY_TOKEN, token);
    if (!store.get(KEY_TOKEN)) { banner("ยังไม่ได้ใส่ token", true); return; }
    $("in-token").value = "••••••••";
    banner("บันทึกแล้ว");
    show("tasks");
    refresh();
  });
  $("btn-forget").addEventListener("click", () => {
    store.del(KEY_TOKEN);
    $("in-token").value = "";
    banner("ลบ token ออกจากเครื่องนี้แล้ว");
  });

  $("form-new").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter;
    guarded(async () => {
      const issue = await gh(repoPath("/issues"), {
        method: "POST",
        body: JSON.stringify({ title: $("in-title").value.trim(), body: $("in-body").value.trim(), labels: ["agent"] }),
      });
      $("form-new").reset();
      banner(`สร้างงาน #${issue.number} แล้ว agent จะเริ่มในอีกไม่กี่วินาที`);
      await openDetail(issue.number);
    }, btn);
  });

  $("form-followup").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const text = $("in-followup").value.trim();
    if (!text || !detailIssue) return;
    guarded(async () => {
      await gh(repoPath(`/issues/${detailIssue}/comments`), { method: "POST", body: JSON.stringify({ body: `/agent ${text}` }) });
      $("in-followup").value = "";
      banner("ส่งคำสั่งแก้เพิ่มแล้ว");
      await openDetail(detailIssue);
    }, btn);
  });

  refresh();
}

document.addEventListener("DOMContentLoaded", init);
