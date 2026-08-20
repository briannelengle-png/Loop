
const DB_NAME = "loop-db";
const DB_VERSION = 1;
const TASK_STORE = "tasks";
const COMPLETED_STORE = "completed";

let db;
let currentStream = "personal";
let selectedId = null;
let selectedSource = "active";
let toastTimer = null;

const els = {
  taskList: document.getElementById("taskList"),
  pinnedList: document.getElementById("pinnedList"),
  pinnedSection: document.getElementById("pinnedSection"),
  emptyState: document.getElementById("emptyState"),
  queueMeta: document.getElementById("queueMeta"),
  completedCount: document.getElementById("completedCount"),
  futureCount: document.getElementById("futureCount"),
  taskDialog: document.getElementById("taskDialog"),
  addDialog: document.getElementById("addDialog"),
  listDialog: document.getElementById("listDialog"),
  moreDialog: document.getElementById("moreDialog"),
  dialogTitle: document.getElementById("dialogTitle"),
  dialogTime: document.getElementById("dialogTime"),
  firstActions: document.getElementById("firstActions"),
  forwardActions: document.getElementById("forwardActions"),
  customTime: document.getElementById("customTime"),
  pinBtn: document.getElementById("pinBtn"),
  switchStreamBtn: document.getElementById("switchStreamBtn"),
  listDialogTitle: document.getElementById("listDialogTitle"),
  secondaryList: document.getElementById("secondaryList"),
  secondaryEmpty: document.getElementById("secondaryEmpty"),
  toast: document.getElementById("toast")
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(TASK_STORE)) {
        database.createObjectStore(TASK_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(COMPLETED_STORE)) {
        database.createObjectStore(COMPLETED_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function getAll(name) {
  return new Promise((resolve, reject) => {
    const req = store(name).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function put(name, value) {
  return new Promise((resolve, reject) => {
    const req = store(name, "readwrite").put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function remove(name, id) {
  return new Promise((resolve, reject) => {
    const req = store(name, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function clearStore(name) {
  return new Promise((resolve, reject) => {
    const req = store(name, "readwrite").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function todayBounds() {
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function isToday(date) {
  const d = new Date(date);
  const { start, end } = todayBounds();
  return d >= start && d < end;
}

function isFutureAfterToday(date) {
  const d = new Date(date);
  const { end } = todayBounds();
  return d >= end;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(date) {
  const d = new Date(date);
  if (isToday(d)) return formatTime(d);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })
    + " · " + formatTime(d);
}

function toLocalInputValue(date) {
  const d = new Date(date);
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0,16);
}

function sortTasks(a, b) {
  const diff = new Date(a.nextAttention) - new Date(b.nextAttention);
  if (diff !== 0) return diff;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function visibleToday(tasks) {
  // Show all unfinished tasks whose next-attention time is before the end
  // of today. This intentionally includes tasks from prior days, so an
  // unfinished item stays at the top until Bri moves or completes it.
  const { end } = todayBounds();
  return tasks.filter(
    t => t.stream === currentStream && new Date(t.nextAttention) < end
  );
}

function createTaskRow(task, source = "active") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "task-row" + (new Date(task.nextAttention) <= new Date() ? " eligible" : "") + (task.pinned ? " pinned" : "");
  btn.dataset.id = task.id;

  const time = document.createElement("div");
  time.className = "task-time";
  time.textContent = formatTime(task.nextAttention);

  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  titleWrap.appendChild(title);

  if (!isToday(task.nextAttention)) {
    const dateTag = document.createElement("span");
    dateTag.className = "date-tag";
    dateTag.textContent = new Date(task.nextAttention).toLocaleDateString([], { month: "short", day: "numeric" });
    titleWrap.appendChild(dateTag);
  }

  btn.append(time, titleWrap);
  btn.addEventListener("click", () => openTask(task.id, source));
  return btn;
}

async function render() {
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  const today = visibleToday(tasks);
  const pinned = today.filter(t => t.pinned).sort(sortTasks);
  const normal = today.filter(t => !t.pinned).sort(sortTasks);

  els.pinnedList.innerHTML = "";
  els.taskList.innerHTML = "";

  pinned.forEach(t => els.pinnedList.appendChild(createTaskRow(t)));
  normal.forEach(t => els.taskList.appendChild(createTaskRow(t)));

  els.pinnedSection.classList.toggle("hidden", pinned.length === 0);
  els.emptyState.classList.toggle("hidden", today.length !== 0);

  const eligibleCount = today.filter(t => new Date(t.nextAttention) <= new Date()).length;
  els.queueMeta.textContent = eligibleCount ? `${eligibleCount} eligible` : `${today.length} in today's roll`;

  const future = tasks.filter(t => t.stream === currentStream && isFutureAfterToday(t.nextAttention));
  els.futureCount.textContent = future.length;
  els.completedCount.textContent = completed.length;

  document.querySelectorAll(".stream-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.stream === currentStream);
  });
}

async function openTask(id, source = "active") {
  selectedId = id;
  selectedSource = source;
  const sourceStore = source === "completed" ? COMPLETED_STORE : TASK_STORE;
  const all = await getAll(sourceStore);
  const task = all.find(t => String(t.id) === String(id));
  if (!task) return;

  if (source === "completed") {
    const restore = confirm(`Restore "${task.title}" to the loop?`);
    if (restore) {
      task.nextAttention = new Date().toISOString();
      delete task.completedAt;
      await put(TASK_STORE, task);
      await remove(COMPLETED_STORE, task.id);
      await render();
      await showSecondaryList("completed");
      showToast("Restored to loop");
    }
    return;
  }

  els.dialogTitle.textContent = task.title;
  els.dialogTime.textContent = "Next attention · " + formatDateTime(task.nextAttention);
  els.firstActions.classList.remove("hidden");
  els.forwardActions.classList.add("hidden");
  els.customTime.value = toLocalInputValue(task.nextAttention);
  els.pinBtn.textContent = task.pinned ? "Unpin priority" : "Pin priority";
  els.switchStreamBtn.textContent = task.stream === "personal" ? "Move to Work" : "Move to Personal";
  els.taskDialog.showModal();
}

async function selectedTask() {
  const all = await getAll(TASK_STORE);
  return all.find(t => String(t.id) === String(selectedId));
}

async function sendForward(minutes) {
  const task = await selectedTask();
  if (!task) return;
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  d.setSeconds(0,0);
  task.nextAttention = d.toISOString();
  await put(TASK_STORE, task);
  els.taskDialog.close();
  await render();
  showToast(`${task.title} → ${formatDateTime(d)}`);
}

function showToast(text) {
  clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 1800);
}

async function showSecondaryList(mode) {
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  els.secondaryList.innerHTML = "";

  let items = [];
  if (mode === "future") {
    els.listDialogTitle.textContent = "Future";
    items = tasks.filter(t => t.stream === currentStream && isFutureAfterToday(t.nextAttention)).sort(sortTasks);
    items.forEach(t => els.secondaryList.appendChild(createTaskRow(t, "active")));
  } else {
    els.listDialogTitle.textContent = "Completed";
    items = completed.sort((a,b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    items.forEach(t => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "task-row";
      btn.addEventListener("click", () => openTask(t.id, "completed"));
      const when = document.createElement("div");
      when.className = "task-time";
      when.textContent = t.completedAt ? new Date(t.completedAt).toLocaleDateString([], {month:"short", day:"numeric"}) : "";
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = t.title;
      btn.append(when, title);
      els.secondaryList.appendChild(btn);
    });
  }
  els.secondaryEmpty.classList.toggle("hidden", items.length !== 0);
  if (!els.listDialog.open) els.listDialog.showModal();
}

async function exportBackup() {
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  const payload = {
    app: "Loop",
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    completed
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `loop-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast("Backup exported");
}

async function restoreBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.app !== "Loop" || !Array.isArray(data.tasks)) throw new Error("Not a Loop backup");
    const ok = confirm(`Restore this backup? It contains ${data.tasks.length} active task(s). This replaces the current local data.`);
    if (!ok) return;
    await clearStore(TASK_STORE);
    await clearStore(COMPLETED_STORE);
    for (const t of data.tasks) await put(TASK_STORE, t);
    for (const c of (data.completed || [])) await put(COMPLETED_STORE, c);
    await render();
    els.moreDialog.close();
    showToast("Backup restored");
  } catch (err) {
    alert("That file could not be restored as a Loop backup.");
  }
}

function bindEvents() {
  document.querySelectorAll(".stream-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentStream = btn.dataset.stream;
      await render();
    });
  });

  document.getElementById("addBtn").addEventListener("click", () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10);
    d.setSeconds(0,0);
    document.getElementById("newTitle").value = "";
    document.getElementById("newTime").value = toLocalInputValue(d);
    document.getElementById("newPinned").checked = false;
    els.addDialog.showModal();
    setTimeout(() => document.getElementById("newTitle").focus(), 40);
  });

  document.getElementById("saveNew").addEventListener("click", async () => {
    const title = document.getElementById("newTitle").value.trim();
    const raw = document.getElementById("newTime").value;
    if (!title || !raw) return;
    const task = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
      title,
      stream: currentStream,
      nextAttention: new Date(raw).toISOString(),
      pinned: document.getElementById("newPinned").checked,
      createdAt: Date.now()
    };
    await put(TASK_STORE, task);
    els.addDialog.close();
    await render();
    showToast("Added to loop");
  });

  document.getElementById("doneBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    task.completedAt = new Date().toISOString();
    await put(COMPLETED_STORE, task);
    await remove(TASK_STORE, task.id);
    els.taskDialog.close();
    await render();
    showToast(`Done ✓  ${task.title}`);
  });

  document.getElementById("forwardBtn").addEventListener("click", () => {
    els.firstActions.classList.add("hidden");
    els.forwardActions.classList.remove("hidden");
  });

  document.querySelectorAll(".offset-btn").forEach(btn => {
    btn.addEventListener("click", () => sendForward(Number(btn.dataset.offset)));
  });

  document.getElementById("customApply").addEventListener("click", async () => {
    const raw = els.customTime.value;
    if (!raw) return;
    const task = await selectedTask();
    if (!task) return;
    const d = new Date(raw);
    task.nextAttention = d.toISOString();
    await put(TASK_STORE, task);
    els.taskDialog.close();
    await render();
    showToast(`${task.title} → ${formatDateTime(d)}`);
  });

  document.getElementById("pinBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    task.pinned = !task.pinned;
    await put(TASK_STORE, task);
    els.pinBtn.textContent = task.pinned ? "Unpin priority" : "Pin priority";
    await render();
    showToast(task.pinned ? "Pinned" : "Unpinned");
  });

  document.getElementById("switchStreamBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    task.stream = task.stream === "personal" ? "work" : "personal";
    await put(TASK_STORE, task);
    els.taskDialog.close();
    await render();
    showToast(`Moved to ${task.stream === "work" ? "Work" : "Personal"}`);
  });

  document.getElementById("editTitleBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    const next = prompt("Rename task", task.title);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    task.title = trimmed;
    await put(TASK_STORE, task);
    els.dialogTitle.textContent = trimmed;
    await render();
  });

  document.getElementById("futureBtn").addEventListener("click", () => showSecondaryList("future"));
  document.getElementById("completedBtn").addEventListener("click", () => showSecondaryList("completed"));

  document.getElementById("moreBtn").addEventListener("click", () => els.moreDialog.showModal());
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("restoreInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) restoreBackup(file);
    e.target.value = "";
  });

  document.getElementById("closeTaskDialog").addEventListener("click", () => els.taskDialog.close());
  document.getElementById("closeAddDialog").addEventListener("click", () => els.addDialog.close());
  document.getElementById("closeListDialog").addEventListener("click", () => els.listDialog.close());
  document.getElementById("closeMoreDialog").addEventListener("click", () => els.moreDialog.close());

  window.addEventListener("focus", render);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
}

async function init() {
  db = await openDB();
  bindEvents();
  await render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

init().catch(err => {
  console.error(err);
  document.getElementById("emptyState").textContent = "Loop could not open its local database.";
  document.getElementById("emptyState").classList.remove("hidden");
});
