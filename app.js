// pwrsr-work: mobile dashboard for the GitHub Actions coding agent hub.
// One issue in the hub repo = one conversation; its header picks the target
// repo/folder/mode (same format as agent/task.py).
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
// GitHub tokens are ASCII letters, digits and "_". Anything else (masking dots,
// spaces, Thai text) would make fetch() throw "Type error" before sending.
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
const cleanToken = (t) => String(t || "").replace(/[\s\u200b-\u200d\ufeff•]/g, "");
const configured = () => { const c = cfg(); return Boolean(c.repo && TOKEN_RE.test(c.token)); };

// -------------------------------------------------------------------- api
async function gh(path, options = {}) {
  const { token } = cfg();
  if (!TOKEN_RE.test(token)) throw new Error("token ที่บันทึกไว้มีตัวอักษรที่ไม่ถูกต้อง ให้ไปที่ ⚙ แล้ววาง token ใหม่");
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new Error("เชื่อมต่อ GitHub ไม่ได้ ตรวจอินเทอร์เน็ต หรือวาง token ใหม่ที่ ⚙");
  }
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

// ------------------------------------------------------------ task header
const HEADER_LINE = /^\s*(repo|folder|mode)\s*:\s*(.*?)\s*$/i;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const FOLDER_PART = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,99}$/;

function splitHeader(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const header = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    const m = HEADER_LINE.exec(lines[i]);
    if (!m) break;
    header[m[1].toLowerCase()] = m[2];
  }
  return { header, rest: lines.slice(i).join("\n").trim() };
}
const hubRepo = () => cfg().repo;
const hubOwner = () => hubRepo().split("/")[0].toLowerCase();
function taskTarget(issue) {
  const { header } = splitHeader(issue.body);
  let repo = (header.repo || "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!REPO_RE.test(repo)) repo = hubRepo();
  const folder = (header.folder || "").replace(/^\.?\/+|\/+$/g, "");
  const mode = (header.mode || "code").toLowerCase() === "ask" ? "ask" : "code";
  return { repo, folder, mode };
}
function cleanFolder(value) {
  const v = value.trim().replace(/\\/g, "/");
  if (v.startsWith("/") || v.startsWith("~")) return null;
  const parts = v.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === ".." || !FOLDER_PART.test(p))) return null;
  return parts.join("/");
}
const shortRepo = (repo) => (repo.split("/")[0].toLowerCase() === hubOwner() ? repo.split("/")[1] : repo);
const targetLabel = (t) => (t.folder ? `${shortRepo(t.repo)} / ${t.folder}` : shortRepo(t.repo));

// -------------------------------------------------------- status logic
const isBot = (c) => Boolean(c.user && c.user.type === "Bot");
const isCommand = (body) => /^\s*\/(agent|ask)\b/i.test(body || "");
const PR_LINE = /\*\*Pull request:\*\*\s*(https:\/\/github\.com\/\S+)/;

// Derive agent status from the bot's comments on the issue.
function agentStatus(issue, comments) {
  if (issue.state === "closed") return { kind: "idle", text: "ปิดแล้ว" };
  let status = { kind: "wait", text: "รอเริ่ม" };
  for (const c of comments) {
    const body = c.body || "";
    if (isBot(c) && body.startsWith("🤖 Agent started")) status = { kind: "run", text: "กำลังทำ" };
    else if (isBot(c) && body.startsWith("### 🤖 Agent run:")) {
      status = /run: success/.test(body) ? { kind: "ok", text: "ตอบแล้ว" } : { kind: "bad", text: "ล้มเหลว" };
    } else if (!isBot(c) && isCommand(body)) status = { kind: "wait", text: "รอเริ่ม" };
  }
  return status;
}
function lastPrUrl(comments) {
  let url = "";
  for (const c of comments) {
    const m = isBot(c) ? PR_LINE.exec(c.body || "") : null;
    if (m) url = m[1];
  }
  return url;
}

// ---------------------------------------------------------------- views
let currentView = "tasks";
let pollTimer = null;
function show(view) {
  currentView = view;
  clearTimeout(pollTimer);
  for (const v of ["settings", "tasks", "detail", "new", "runs"]) $(`view-${v}`).classList.toggle("hidden", v !== view);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.body.classList.toggle("chat-open", view === "detail");
}

let repoFilter = "";
async function loadTasks() {
  const list = $("task-list");
  list.replaceChildren(el("div", { class: "empty" }, "กำลังโหลด…"));
  const issues = (await gh(repoPath("/issues?labels=agent&state=all&sort=updated&per_page=30"))).filter((i) => !i.pull_request);
  if (!issues.length) {
    $("repo-filter").replaceChildren();
    list.replaceChildren(el("div", { class: "empty" }, "ยังไม่มีงาน กด “สั่งงาน” เพื่อเริ่ม"));
    return;
  }
  const commentsList = await Promise.all(
    issues.map((i) => (i.comments ? gh(repoPath(`/issues/${i.number}/comments?per_page=100`)) : Promise.resolve([]))),
  );
  const rows = issues.map((issue, idx) => ({ issue, comments: commentsList[idx], target: taskTarget(issue) }));

  const repos = [...new Set(rows.map((r) => r.target.repo))];
  if (repoFilter && !repos.includes(repoFilter)) repoFilter = "";
  const chip = (value, text) =>
    el("button", { class: "chip" + (repoFilter === value ? " active" : ""), type: "button", "aria-pressed": String(repoFilter === value),
      onclick: () => { repoFilter = value; guarded(loadTasks); } }, text);
  $("repo-filter").replaceChildren(...(repos.length > 1 ? [chip("", "ทั้งหมด"), ...repos.map((r) => chip(r, shortRepo(r)))] : []));

  const visible = rows.filter((r) => !repoFilter || r.target.repo === repoFilter);
  list.replaceChildren(
    ...visible.map(({ issue, comments, target }) => {
      const st = agentStatus(issue, comments);
      return el(
        "button",
        { class: "card", onclick: () => guarded(() => openDetail(issue.number)) },
        el("div", { class: "card-top" },
          el("span", { class: "target" }, targetLabel(target)),
          target.mode === "ask" ? el("span", { class: "tag" }, "ถาม") : null,
        ),
        el("div", { class: "card-title" }, el("span", { class: "num" }, `#${issue.number}`), issue.title),
        el("div", { class: "meta" },
          pill(st.kind, st.text),
          lastPrUrl(comments) ? el("span", {}, "มี PR") : null,
          el("span", {}, `${comments.filter((c) => !isBot(c) || !(c.body || "").startsWith("🤖 Agent started")).length + 1} ข้อความ`),
          el("span", {}, ago(issue.updated_at)),
        ),
      );
    }),
  );
}

// Tiny, safe formatter: code fences become <pre>, GitHub links become <a>,
// "**" markers are dropped. Everything else is plain text.
function rich(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text || "").split(/```[^\n]*\n?([\s\S]*?)```/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) { frag.append(el("pre", { class: "code" }, part.replace(/\n$/, ""))); return; }
    const clean = part.replace(/\*\*/g, "").replace(/^#{1,6}\s+/gm, "").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    if (!clean) return;
    const p = el("div", { class: "msg-text" });
    const re = /`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/github\.com\/[^)\s]+)\)|(https:\/\/github\.com\/[^\s)]+)/g;
    let last = 0, m;
    while ((m = re.exec(clean))) {
      p.append(clean.slice(last, m.index));
      if (m[1] !== undefined) p.append(el("code", {}, m[1]));
      else p.append(safeLink(m[3] || m[4], m[2] || m[4].replace("https://github.com/", "")));
      last = re.lastIndex;
    }
    p.append(clean.slice(last));
    frag.append(p);
  });
  return frag;
}

function message(c) {
  const body = c.body || "";
  if (isBot(c) && body.startsWith("🤖 Agent started")) {
    const what = body.replace(/^🤖\s*Agent started:?\s*/, "").replace(/`/g, "").split(". ")[0].replace(/\s+with\s+.*$/, "");
    return el("div", { class: "sys" }, `agent เริ่มทำงาน${what && !what.startsWith("with") ? ` · ${what}` : ""} · ${ago(c.created_at)}`);
  }
  if (isBot(c)) {
    const ok = /^### 🤖 Agent run: success/.test(body);
    const text = body.replace(/^### 🤖 Agent run: \w+\s*/, "").replace(/^\*\*Model:\*\*.*\n?/m, "")
      .replace(/^> Generated by a local LLM.*$/m, "").replace(/^\[Run log\]\((\S+)\).*$/m, "[ดู log]($1)");
    return el("div", { class: "msg agent" },
      el("div", { class: "msg-head" }, el("b", {}, "agent"), pill(ok ? "ok" : "bad", ok ? "สำเร็จ" : "ล้มเหลว"), el("span", {}, ago(c.created_at))),
      rich(text),
    );
  }
  const owner = c.user && c.user.login.toLowerCase() === hubOwner();
  const cmd = /^\s*\/(agent|ask)\b/i.exec(body);
  return el("div", { class: "msg " + (owner ? "me" : "other") },
    el("div", { class: "msg-head" },
      owner ? null : el("b", {}, c.user ? c.user.login : "?"),
      cmd ? el("span", { class: "tag" }, cmd[1].toLowerCase() === "ask" ? "ถาม" : "แก้โค้ด") : null,
      el("span", {}, ago(c.created_at)),
    ),
    rich(cmd ? body.slice(cmd[0].length).trim() : body),
  );
}

let detailIssue = null;
async function openDetail(number, { quiet = false } = {}) {
  if (!quiet) show("detail");
  detailIssue = number;
  const box = $("detail");
  if (!quiet) box.replaceChildren(el("div", { class: "empty" }, "กำลังโหลด…"));
  const [issue, comments] = await Promise.all([
    gh(repoPath(`/issues/${number}`)),
    gh(repoPath(`/issues/${number}/comments?per_page=100`)),
  ]);
  if (currentView !== "detail" || detailIssue !== number) return;
  const target = taskTarget(issue);
  const st = agentStatus(issue, comments);

  const parts = [
    el("div", { class: "card chat-head" },
      el("div", { class: "card-top" }, el("span", { class: "target" }, targetLabel(target)), safeLink(issue.html_url, "GitHub")),
      el("div", { class: "card-title" }, el("span", { class: "num" }, `#${issue.number}`), issue.title),
      el("div", { class: "meta" }, pill(st.kind, st.text)),
    ),
  ];

  // Pull request in the target repo (branch agent/issue-N).
  if (lastPrUrl(comments)) {
    try {
      const owner = target.repo.split("/")[0];
      const pulls = await gh(`/repos/${target.repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:agent/issue-${number}`)}`);
      const pr = pulls[0];
      if (pr) {
        const files = await gh(`/repos/${target.repo}/pulls/${pr.number}/files?per_page=50`);
        const add = files.reduce((n, f) => n + f.additions, 0), del = files.reduce((n, f) => n + f.deletions, 0);
        parts.push(
          el("details", { class: "card pr" },
            el("summary", {},
              el("span", { class: "pr-title" }, `Pull request #${pr.number}`),
              pill(pr.merged_at ? "ok" : pr.state === "open" ? "wait" : "idle", pr.merged_at ? "merged" : pr.state === "open" ? "รอตรวจ" : "ปิดแล้ว"),
              el("span", { class: "muted" }, `${files.length} ไฟล์ · +${add} −${del}`),
            ),
            el("div", { class: "mt" }, safeLink(pr.html_url, "ตรวจ / Merge ใน GitHub")),
            ...files.map((f) => [el("div", { class: "file-name" }, `${f.status} · ${f.filename}  +${f.additions} −${f.deletions}`), renderDiff(f.patch)]),
          ),
        );
      }
    } catch (err) {
      parts.push(el("div", { class: "card muted" }, `ดู PR ไม่ได้: token ของหน้านี้ยังไม่มีสิทธิ์อ่าน ${target.repo}`));
    }
  }

  const thread = el("div", { class: "thread" });
  const first = splitHeader(issue.body).rest;
  thread.append(el("div", { class: "msg me" },
    el("div", { class: "msg-head" }, el("span", { class: "tag" }, target.mode === "ask" ? "ถาม" : "แก้โค้ด"), el("span", {}, ago(issue.created_at))),
    rich(first || issue.title),
  ));
  for (const c of comments) thread.append(message(c));
  if (st.kind === "run" || st.kind === "wait") {
    thread.append(el("div", { class: "msg agent typing", "aria-label": "agent กำลังทำงาน" },
      el("span", { class: "dots" }, el("i"), el("i"), el("i")),
      el("span", { class: "muted" }, st.kind === "run" ? "agent กำลังทำงาน…" : "รอ GitHub Actions เริ่ม…")));
  }
  parts.push(thread);

  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  box.replaceChildren(...parts);
  if (!quiet || atBottom) window.scrollTo({ top: document.body.scrollHeight, behavior: quiet ? "smooth" : "auto" });

  if (!quiet) $("composer").querySelector(`input[value="${target.mode}"]`).checked = true;
  clearTimeout(pollTimer);
  if (st.kind === "run" || st.kind === "wait") {
    pollTimer = setTimeout(() => {
      if (currentView === "detail" && detailIssue === number && !document.hidden) openDetail(number, { quiet: true }).catch(() => {});
    }, 20000);
  }
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

// Repos the token can see, for the new-task picker.
let repoOptions = null;
async function loadRepoOptions() {
  const select = $("in-target");
  if (!repoOptions) {
    repoOptions = [hubRepo()];
    try {
      const repos = await gh("/user/repos?per_page=100&sort=updated");
      for (const r of repos) if (!r.archived && !repoOptions.includes(r.full_name)) repoOptions.push(r.full_name);
    } catch { /* token may not allow listing: hub only */ }
  }
  const keep = select.value;
  select.replaceChildren(...repoOptions.map((r, i) => el("option", { value: r }, i === 0 ? `${r} (hub)` : r)));
  if (keep && repoOptions.includes(keep)) select.value = keep;
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
  else if (currentView === "new") guarded(loadRepoOptions);
}

function init() {
  $("in-repo").value = store.get(KEY_REPO);
  const showSaved = () => {
    $("in-token").value = "";
    $("in-token").placeholder = store.get(KEY_TOKEN) ? "บันทึกแล้ว · วาง token ใหม่เพื่อเปลี่ยน" : "github_pat_...";
  };
  showSaved();

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { show(t.dataset.view); refresh(); }),
  );
  $("btn-refresh").addEventListener("click", refresh);
  $("btn-settings").addEventListener("click", () => show("settings"));
  $("btn-back").addEventListener("click", () => { show("tasks"); refresh(); });

  $("btn-save").addEventListener("click", () => {
    const repo = $("in-repo").value.trim();
    const token = cleanToken($("in-token").value);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { banner("รูปแบบ repo ต้องเป็น owner/name", true); return; }
    store.set(KEY_REPO, repo);
    repoOptions = null;
    if (token) {
      if (!TOKEN_RE.test(token)) { banner("token ไม่ถูกต้อง ต้องขึ้นต้นด้วย github_pat_ และมีแค่ตัวอักษรอังกฤษ ตัวเลข และ _", true); return; }
      store.set(KEY_TOKEN, token);
    }
    if (!TOKEN_RE.test(store.get(KEY_TOKEN))) { banner("ยังไม่ได้ใส่ token", true); return; }
    showSaved();
    banner("บันทึกแล้ว");
    show("tasks");
    refresh();
  });
  $("btn-forget").addEventListener("click", () => {
    store.del(KEY_TOKEN);
    showSaved();
    banner("ลบ token ออกจากเครื่องนี้แล้ว");
  });

  $("form-new").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const repo = $("in-target").value || hubRepo();
    const folder = cleanFolder($("in-folder").value);
    if (folder === null) { banner("Folder ต้องเป็น path ใน repo เช่น backend/api (ห้าม .. หรือขึ้นต้นด้วย /)", true); return; }
    const mode = document.querySelector('input[name="new-mode"]:checked').value;
    const header = [`repo: ${repo}`, folder ? `folder: ${folder}` : "", mode === "ask" ? "mode: ask" : ""].filter(Boolean);
    const body = `${header.join("\n")}\n\n${$("in-body").value.trim()}`.trim();
    guarded(async () => {
      const issue = await gh(repoPath("/issues"), {
        method: "POST",
        body: JSON.stringify({ title: $("in-title").value.trim(), body, labels: ["agent"] }),
      });
      $("in-title").value = "";
      $("in-body").value = "";
      banner(`สร้างงาน #${issue.number} แล้ว agent จะเริ่มในอีกไม่กี่วินาที`);
      await openDetail(issue.number);
    }, btn);
  });

  const reply = $("in-reply");
  const grow = () => { reply.style.height = "auto"; reply.style.height = Math.min(reply.scrollHeight, 180) + "px"; };
  reply.addEventListener("input", grow);
  reply.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const text = reply.value.trim();
    if (!text || !detailIssue) return;
    const mode = document.querySelector('input[name="reply-mode"]:checked').value;
    guarded(async () => {
      await gh(repoPath(`/issues/${detailIssue}/comments`), {
        method: "POST",
        body: JSON.stringify({ body: `${mode === "ask" ? "/ask" : "/agent"} ${text}` }),
      });
      reply.value = "";
      grow();
      await openDetail(detailIssue, { quiet: true });
    }, btn);
  });

  refresh();
}

document.addEventListener("DOMContentLoaded", init);
