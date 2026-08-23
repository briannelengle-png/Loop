const DB_NAME = "loop-db";
const DB_VERSION = 2;
const TASK_STORE = "tasks";
const COMPLETED_STORE = "completed";
const HISTORY_STORE = "history";
const SNAPSHOT_STORE = "snapshots";
const MAX_SNAPSHOTS = 12;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

let db;
let currentStream = "personal";
let selectedId = null;
let selectedSource = "active";
let toastTimer = null;
let currentSecondaryMode = null;

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
  listSearchWrap: document.getElementById("listSearchWrap"),
  listSearch: document.getElementById("listSearch"),
  dataStatus: document.getElementById("dataStatus"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toastText"),
  toastAction: document.getElementById("toastAction")
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
}

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
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        database.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Database transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Database transaction aborted"));
  });
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

async function replaceTaskData(tasks, completed) {
  const tx = db.transaction([TASK_STORE, COMPLETED_STORE], "readwrite");
  const taskStore = tx.objectStore(TASK_STORE);
  const completedStore = tx.objectStore(COMPLETED_STORE);
  taskStore.clear();
  completedStore.clear();
  for (const task of tasks || []) taskStore.put(task);
  for (const task of completed || []) completedStore.put(task);
  await txDone(tx);
}

async function moveActiveToCompleted(task) {
  const tx = db.transaction([TASK_STORE, COMPLETED_STORE], "readwrite");
  tx.objectStore(COMPLETED_STORE).put(task);
  tx.objectStore(TASK_STORE).delete(task.id);
  await txDone(tx);
}

async function moveCompletedToActive(task) {
  const tx = db.transaction([TASK_STORE, COMPLETED_STORE], "readwrite");
  tx.objectStore(TASK_STORE).put(task);
  tx.objectStore(COMPLETED_STORE).delete(task.id);
  await txDone(tx);
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function validDate(value) {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function isToday(date) {
  if (!validDate(date)) return false;
  const d = new Date(date);
  const { start, end } = todayBounds();
  return d >= start && d < end;
}

function isFutureAfterToday(date) {
  if (!validDate(date)) return false;
  const d = new Date(date);
  const { end } = todayBounds();
  return d >= end;
}

function formatTime(date) {
  if (!validDate(date)) return "Needs date";
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(date) {
  if (!validDate(date)) return "Needs a valid date";
  const d = new Date(date);
  if (isToday(d)) return formatTime(d);
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined
  }) + " · " + formatTime(d);
}

function formatFullDateTime(date) {
  if (!validDate(date)) return "Needs a valid date";
  return new Date(date).toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  });
}

function toLocalInputValue(date) {
  const d = validDate(date) ? new Date(date) : new Date();
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function sortTasks(a, b) {
  const aValid = validDate(a.nextAttention);
  const bValid = validDate(b.nextAttention);
  if (!aValid && bValid) return -1;
  if (aValid && !bValid) return 1;
  if (aValid && bValid) {
    const diff = new Date(a.nextAttention) - new Date(b.nextAttention);
    if (diff !== 0) return diff;
  }
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function visibleToday(tasks) {
  const { end } = todayBounds();
  return tasks.filter(t => {
    if (t.stream !== currentStream) return false;
    // Invalid dates are deliberately surfaced instead of disappearing.
    if (!validDate(t.nextAttention)) return true;
    return new Date(t.nextAttention) < end;
  });
}

function createTaskRow(task, source = "active", options = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  const eligible = validDate(task.nextAttention) && new Date(task.nextAttention) <= new Date();
  btn.className = "task-row" + (eligible ? " eligible" : "") + (task.pinned ? " pinned" : "") + (!validDate(task.nextAttention) ? " needs-repair" : "");
  btn.dataset.id = task.id;

  const time = document.createElement("div");
  time.className = "task-time";
  time.textContent = validDate(task.nextAttention) ? formatTime(task.nextAttention) : "⚠︎";

  const titleWrap = document.createElement("div");
  titleWrap.className = "task-title-wrap";
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title || "Untitled task";
  titleWrap.appendChild(title);

  const metaParts = [];
  if (options.showStream) metaParts.push(task.stream === "work" ? "Work" : "Personal");
  if (!validDate(task.nextAttention)) {
    metaParts.push("Needs a valid next-attention date");
  } else if (options.fullDate || !isToday(task.nextAttention)) {
    metaParts.push(formatDateTime(task.nextAttention));
  }

  if (metaParts.length) {
    const meta = document.createElement("span");
    meta.className = "date-tag";
    meta.textContent = metaParts.join(" · ");
    titleWrap.appendChild(meta);
  }

  btn.append(time, titleWrap);
  btn.addEventListener("click", () => openTask(task.id, source));
  return btn;
}

async function dataHealth() {
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  const completedIds = new Set(completed.map(t => String(t.id)));
  const invalid = tasks.filter(t => !validDate(t.nextAttention));
  const duplicates = tasks.filter(t => completedIds.has(String(t.id)));
  return { tasks, completed, invalid, duplicates };
}

async function updateDataStatus() {
  const { tasks, completed, invalid, duplicates } = await dataHealth();
  const warnings = invalid.length + duplicates.length;
  els.dataStatus.textContent = warnings
    ? `⚠️ ${warnings} item${warnings === 1 ? "" : "s"} need attention · ${tasks.length} active · ${completed.length} completed`
    : `${tasks.length} active · ${completed.length} completed · recovery history on`;
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

  const now = new Date();
  const eligibleCount = today.filter(t => !validDate(t.nextAttention) || new Date(t.nextAttention) <= now).length;
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
  if (!task) {
    showToast("That task is no longer in this view");
    await render();
    return;
  }

  if (source === "completed") {
    const restore = confirm(`Restore "${task.title}" to the loop?`);
    if (restore) {
      const restored = { ...task, nextAttention: new Date().toISOString() };
      delete restored.completedAt;
      await moveCompletedToActive(restored);
      await recordHistory("restored", restored, { from: "completed", toNextAttention: restored.nextAttention });
      await maybeSnapshot("restored");
      await render();
      await showSecondaryList("completed");
      showToast("Restored to loop");
    }
    return;
  }

  els.dialogTitle.textContent = task.title || "Untitled task";
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

async function recordHistory(action, task, details = {}) {
  const event = {
    id: uid(),
    at: new Date().toISOString(),
    action,
    taskId: task?.id ?? null,
    title: task?.title ?? details.title ?? "",
    stream: task?.stream ?? details.stream ?? null,
    details
  };
  try {
    await put(HISTORY_STORE, event);
  } catch (err) {
    console.warn("Loop history write failed", err);
  }
}

async function newestSnapshot() {
  const snapshots = await getAll(SNAPSHOT_STORE);
  if (!snapshots.length) return null;
  return snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

async function pruneSnapshots() {
  const snapshots = (await getAll(SNAPSHOT_STORE)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const extras = snapshots.slice(MAX_SNAPSHOTS);
  for (const snap of extras) await remove(SNAPSHOT_STORE, snap.id);
}

async function maybeSnapshot(reason = "auto", force = false) {
  try {
    if (!force) {
      const latest = await newestSnapshot();
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < SNAPSHOT_INTERVAL_MS) return;
    }
    const tasks = await getAll(TASK_STORE);
    const completed = await getAll(COMPLETED_STORE);
    await put(SNAPSHOT_STORE, {
      id: uid(),
      createdAt: new Date().toISOString(),
      reason,
      tasks,
      completed
    });
    await pruneSnapshots();
  } catch (err) {
    console.warn("Loop snapshot failed", err);
  }
}

async function sendForward(minutes) {
  const task = await selectedTask();
  if (!task) return;
  const from = task.nextAttention;
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  d.setSeconds(0, 0);
  task.nextAttention = d.toISOString();
  await put(TASK_STORE, task);
  await recordHistory("moved", task, { fromNextAttention: from, toNextAttention: task.nextAttention });
  await maybeSnapshot("auto");
  els.taskDialog.close();
  await render();
  showToast(`${task.title} → ${formatDateTime(d)}`);
}

function showToast(text, actionLabel = null, actionFn = null, duration = 1800) {
  clearTimeout(toastTimer);
  els.toastText.textContent = text;
  els.toastAction.classList.toggle("hidden", !actionLabel);
  els.toastAction.textContent = actionLabel || "";
  els.toastAction.onclick = actionFn ? async () => {
    els.toastAction.disabled = true;
    try {
      await actionFn();
    } finally {
      els.toastAction.disabled = false;
      els.toastAction.classList.add("hidden");
    }
  } : null;
  els.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), duration);
}

function historyDescription(event) {
  const d = event.details || {};
  switch (event.action) {
    case "created": return `Created · ${formatDateTime(d.toNextAttention)}`;
    case "moved": return `Moved ${formatDateTime(d.fromNextAttention)} → ${formatDateTime(d.toNextAttention)}`;
    case "completed": return `Marked Done · was ${formatDateTime(d.fromNextAttention)}`;
    case "undo_done": return `Undid Done · back at ${formatDateTime(d.toNextAttention)}`;
    case "restored": return `Restored from Completed · ${formatDateTime(d.toNextAttention)}`;
    case "pin_changed": return d.toPinned ? "Pinned priority" : "Unpinned priority";
    case "stream_changed": return `Moved ${d.fromStream === "work" ? "Work" : "Personal"} → ${d.toStream === "work" ? "Work" : "Personal"}`;
    case "renamed": return `Renamed from “${d.fromTitle || ""}”`;
    case "backup_restored": return `Backup restored · ${d.activeCount || 0} active`;
    case "snapshot_restored": return `Recovery snapshot restored`;
    case "v03_started": return "v0.3 recovery tracking started";
    default: return event.action.replaceAll("_", " ");
  }
}

function renderHistoryRow(event) {
  const row = document.createElement("div");
  row.className = "history-row";
  const top = document.createElement("div");
  top.className = "history-title";
  top.textContent = event.title || "Loop";
  const desc = document.createElement("div");
  desc.className = "history-desc";
  desc.textContent = historyDescription(event);
  const when = document.createElement("div");
  when.className = "history-time";
  when.textContent = formatFullDateTime(event.at);
  row.append(top, desc, when);
  return row;
}

async function restoreSnapshot(snapshot) {
  const ok = confirm(`Restore the recovery snapshot from ${formatFullDateTime(snapshot.createdAt)}?\n\nLoop will first save your current state so this can be undone.`);
  if (!ok) return;
  await maybeSnapshot("before_snapshot_restore", true);
  await replaceTaskData(snapshot.tasks || [], snapshot.completed || []);
  await recordHistory("snapshot_restored", null, { snapshotAt: snapshot.createdAt, title: "Loop" });
  await render();
  els.listDialog.close();
  showToast("Recovery snapshot restored");
}

function renderSnapshotRow(snapshot) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "recovery-row";
  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = formatFullDateTime(snapshot.createdAt);
  const meta = document.createElement("div");
  meta.className = "history-desc";
  meta.textContent = `${(snapshot.tasks || []).length} active · ${(snapshot.completed || []).length} completed · ${snapshot.reason || "auto"}`;
  btn.append(title, meta);
  btn.addEventListener("click", () => restoreSnapshot(snapshot));
  return btn;
}

async function showSecondaryList(mode) {
  currentSecondaryMode = mode;
  const query = (els.listSearch.value || "").trim().toLowerCase();
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  els.secondaryList.innerHTML = "";
  els.listSearchWrap.classList.toggle("hidden", !["all", "history"].includes(mode));

  let count = 0;
  if (mode === "future") {
    els.listDialogTitle.textContent = "Future";
    const items = tasks.filter(t => t.stream === currentStream && isFutureAfterToday(t.nextAttention)).sort(sortTasks);
    items.forEach(t => els.secondaryList.appendChild(createTaskRow(t, "active")));
    count = items.length;
  } else if (mode === "completed") {
    els.listDialogTitle.textContent = "Completed";
    const items = completed.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    items.forEach(t => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "task-row";
      btn.addEventListener("click", () => openTask(t.id, "completed"));
      const when = document.createElement("div");
      when.className = "task-time";
      when.textContent = t.completedAt && validDate(t.completedAt)
        ? new Date(t.completedAt).toLocaleDateString([], { month: "short", day: "numeric" })
        : "Done";
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = t.title || "Untitled task";
      btn.append(when, title);
      els.secondaryList.appendChild(btn);
    });
    count = items.length;
  } else if (mode === "all") {
    els.listDialogTitle.textContent = "All active tasks";
    const items = tasks
      .filter(t => !query || `${t.title || ""} ${t.stream || ""}`.toLowerCase().includes(query))
      .sort(sortTasks);
    items.forEach(t => els.secondaryList.appendChild(createTaskRow(t, "active", { showStream: true, fullDate: true })));
    count = items.length;
  } else if (mode === "history") {
    els.listDialogTitle.textContent = "Activity history";
    const events = (await getAll(HISTORY_STORE))
      .filter(e => !query || `${e.title || ""} ${historyDescription(e)}`.toLowerCase().includes(query))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    events.forEach(e => els.secondaryList.appendChild(renderHistoryRow(e)));
    count = events.length;
  } else if (mode === "snapshots") {
    els.listDialogTitle.textContent = "Recovery snapshots";
    const snapshots = (await getAll(SNAPSHOT_STORE)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    snapshots.forEach(s => els.secondaryList.appendChild(renderSnapshotRow(s)));
    count = snapshots.length;
  }

  els.secondaryEmpty.classList.toggle("hidden", count !== 0);
  if (!els.listDialog.open) els.listDialog.showModal();
}

async function exportBackup() {
  const tasks = await getAll(TASK_STORE);
  const completed = await getAll(COMPLETED_STORE);
  const history = (await getAll(HISTORY_STORE)).sort((a, b) => new Date(a.at) - new Date(b.at));
  const payload = {
    app: "Loop",
    version: 2,
    loopVersion: "0.3",
    exportedAt: new Date().toISOString(),
    tasks,
    completed,
    history
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `loop-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
    const ok = confirm(`Restore this backup? It contains ${data.tasks.length} active task(s).\n\nLoop will save your current state as a recovery snapshot first.`);
    if (!ok) return;

    await maybeSnapshot("before_backup_restore", true);
    await replaceTaskData(data.tasks, data.completed || []);

    if (Array.isArray(data.history)) {
      for (const event of data.history) {
        if (event && event.id) {
          try { await put(HISTORY_STORE, event); } catch (_) {}
        }
      }
    }
    await recordHistory("backup_restored", null, { title: "Loop", activeCount: data.tasks.length, completedCount: (data.completed || []).length });
    await maybeSnapshot("after_backup_restore", true);
    await render();
    els.moreDialog.close();
    showToast("Backup restored");
  } catch (err) {
    console.error(err);
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
    d.setSeconds(0, 0);
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
      id: uid(),
      title,
      stream: currentStream,
      nextAttention: new Date(raw).toISOString(),
      pinned: document.getElementById("newPinned").checked,
      createdAt: Date.now()
    };
    await put(TASK_STORE, task);
    await recordHistory("created", task, { toNextAttention: task.nextAttention });
    await maybeSnapshot("auto");
    els.addDialog.close();
    await render();
    showToast("Added to loop");
  });

  document.getElementById("doneBtn").addEventListener("click", async () => {
    const original = await selectedTask();
    if (!original) return;
    await maybeSnapshot("before_done", true);
    const completedTask = { ...original, completedAt: new Date().toISOString() };
    await moveActiveToCompleted(completedTask);
    await recordHistory("completed", completedTask, { fromNextAttention: original.nextAttention });
    els.taskDialog.close();
    await render();

    showToast(`Done ✓  ${original.title}`, "Undo", async () => {
      const restored = { ...original };
      delete restored.completedAt;
      await moveCompletedToActive(restored);
      await recordHistory("undo_done", restored, { toNextAttention: restored.nextAttention });
      await maybeSnapshot("undo_done", true);
      await render();
      showToast("Back on the loop");
    }, 8000);
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
    const from = task.nextAttention;
    const d = new Date(raw);
    task.nextAttention = d.toISOString();
    await put(TASK_STORE, task);
    await recordHistory("moved", task, { fromNextAttention: from, toNextAttention: task.nextAttention });
    await maybeSnapshot("auto");
    els.taskDialog.close();
    await render();
    showToast(`${task.title} → ${formatDateTime(d)}`);
  });

  document.getElementById("pinBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    const fromPinned = !!task.pinned;
    task.pinned = !task.pinned;
    await put(TASK_STORE, task);
    await recordHistory("pin_changed", task, { fromPinned, toPinned: task.pinned });
    await maybeSnapshot("auto");
    els.pinBtn.textContent = task.pinned ? "Unpin priority" : "Pin priority";
    await render();
    showToast(task.pinned ? "Pinned" : "Unpinned");
  });

  document.getElementById("switchStreamBtn").addEventListener("click", async () => {
    const task = await selectedTask();
    if (!task) return;
    const fromStream = task.stream;
    task.stream = task.stream === "personal" ? "work" : "personal";
    await put(TASK_STORE, task);
    await recordHistory("stream_changed", task, { fromStream, toStream: task.stream });
    await maybeSnapshot("auto");
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
    const fromTitle = task.title;
    task.title = trimmed;
    await put(TASK_STORE, task);
    await recordHistory("renamed", task, { fromTitle, toTitle: trimmed });
    await maybeSnapshot("auto");
    els.dialogTitle.textContent = trimmed;
    await render();
  });

  document.getElementById("futureBtn").addEventListener("click", () => {
    els.listSearch.value = "";
    showSecondaryList("future");
  });
  document.getElementById("completedBtn").addEventListener("click", () => {
    els.listSearch.value = "";
    showSecondaryList("completed");
  });

  document.getElementById("moreBtn").addEventListener("click", async () => {
    await updateDataStatus();
    els.moreDialog.showModal();
  });
  document.getElementById("allTasksBtn").addEventListener("click", () => {
    els.moreDialog.close();
    els.listSearch.value = "";
    showSecondaryList("all");
  });
  document.getElementById("historyBtn").addEventListener("click", () => {
    els.moreDialog.close();
    els.listSearch.value = "";
    showSecondaryList("history");
  });
  document.getElementById("snapshotsBtn").addEventListener("click", () => {
    els.moreDialog.close();
    els.listSearch.value = "";
    showSecondaryList("snapshots");
  });
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("restoreInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) restoreBackup(file);
    e.target.value = "";
  });

  els.listSearch.addEventListener("input", () => {
    if (currentSecondaryMode) showSecondaryList(currentSecondaryMode);
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

  const history = await getAll(HISTORY_STORE);
  if (!history.length) {
    await recordHistory("v03_started", null, { title: "Loop" });
  }
  await maybeSnapshot("v0.3_start");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then(reg => reg.update()).catch(() => {});
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
