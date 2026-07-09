const storageKey = "heytea-points-tracker.entries";
const sixMonths = 6;
const dayMs = 24 * 60 * 60 * 1000;

const form = document.querySelector("#entryForm");
const dateInput = document.querySelector("#entryDate");
const pointsInput = document.querySelector("#entryPoints");
const noteInput = document.querySelector("#entryNote");
const balancesList = document.querySelector("#balancesList");
const activityList = document.querySelector("#activityList");
const availablePoints = document.querySelector("#availablePoints");
const expiredPoints = document.querySelector("#expiredPoints");
const nextExpiration = document.querySelector("#nextExpiration");
const balanceCount = document.querySelector("#balanceCount");
const clearAllButton = document.querySelector("#clearAllButton");
const sampleButton = document.querySelector("#sampleButton");
const emptyTemplate = document.querySelector("#emptyStateTemplate");

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

let entries = loadEntries();

dateInput.value = toInputDate(new Date());
render();

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const points = Number.parseInt(data.get("points"), 10);
  const date = data.get("date");
  const kind = data.get("kind");

  if (!date || !Number.isFinite(points) || points < 1) {
    return;
  }

  entries.push({
    id: createId(),
    kind,
    date,
    points,
    note: String(data.get("note") || "").trim()
  });

  pointsInput.value = "";
  noteInput.value = "";
  saveEntries();
  render();
});

clearAllButton.addEventListener("click", () => {
  if (entries.length === 0) {
    return;
  }

  entries = [];
  saveEntries();
  render();
});

sampleButton.addEventListener("click", () => {
  entries = [
    { id: createId(), kind: "earned", date: "2026-01-18", points: 86, note: "Order reward" },
    { id: createId(), kind: "earned", date: "2026-02-05", points: 120, note: "Promo bonus" },
    { id: createId(), kind: "used", date: "2026-03-12", points: 60, note: "Redeemed drink" },
    { id: createId(), kind: "earned", date: "2026-05-30", points: 44, note: "Tea run" }
  ];
  saveEntries();
  render();
});

function loadEntries() {
  try {
    return JSON.parse(window.localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function saveEntries() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // The tracker still works for the current page session if storage is blocked.
  }
}

function render() {
  const lots = calculateLots(entries);
  const today = startOfDay(new Date());
  const activeLots = lots.filter((lot) => lot.remaining > 0 && lot.expiresAt >= today);
  const expiredLots = lots.filter((lot) => lot.remaining > 0 && lot.expiresAt < today);
  const activeTotal = sum(activeLots.map((lot) => lot.remaining));
  const expiredTotal = sum(expiredLots.map((lot) => lot.remaining));

  availablePoints.textContent = formatNumber(activeTotal);
  expiredPoints.textContent = formatNumber(expiredTotal);
  balanceCount.textContent = `${activeLots.length} ${activeLots.length === 1 ? "lot" : "lots"}`;
  nextExpiration.textContent = activeLots.length ? formatDate(activeLots[0].expiresAt) : "None";

  renderBalances(activeLots, today);
  renderActivity();
}

function calculateLots(sourceEntries) {
  const sorted = [...sourceEntries].sort((a, b) => {
    return new Date(a.date) - new Date(b.date);
  });

  const lots = sorted
    .filter((entry) => entry.kind === "earned")
    .map((entry) => ({
      ...entry,
      remaining: entry.points,
      expiresAt: expirationDate(entry.date)
    }));

  for (const entry of sorted.filter((item) => item.kind === "used")) {
    let pointsToUse = entry.points;
    const usableLots = lots
      .filter((lot) => lot.remaining > 0 && lot.date <= entry.date)
      .sort((a, b) => a.expiresAt - b.expiresAt);

    for (const lot of usableLots) {
      if (pointsToUse <= 0) {
        break;
      }

      const used = Math.min(lot.remaining, pointsToUse);
      lot.remaining -= used;
      pointsToUse -= used;
    }
  }

  return lots
    .filter((lot) => lot.remaining > 0)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

function renderBalances(lots, today) {
  balancesList.replaceChildren();

  if (lots.length === 0) {
    balancesList.append(emptyTemplate.content.cloneNode(true));
    return;
  }

  for (const lot of lots) {
    const daysLeft = Math.ceil((lot.expiresAt - today) / dayMs);
    const row = document.createElement("article");
    row.className = "balance-row";

    const statusClass = daysLeft <= 30 ? " status--soon" : "";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(lot.note || "Earned points")}</strong>
        <div class="meta">Earned ${formatDate(parseLocalDate(lot.date))} &middot; expires ${formatDate(lot.expiresAt)}</div>
        <span class="status${statusClass}">${daysLeft} days left</span>
      </div>
      <div class="points">${formatNumber(lot.remaining)}</div>
    `;
    balancesList.append(row);
  }
}

function renderActivity() {
  activityList.replaceChildren();

  if (entries.length === 0) {
    activityList.append(emptyTemplate.content.cloneNode(true));
    return;
  }

  const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const entry of sorted) {
    const row = document.createElement("article");
    row.className = `activity-row activity-row--${entry.kind}`;
    const sign = entry.kind === "used" ? "-" : "+";

    row.innerHTML = `
      <div>
        <strong>${sign}${formatNumber(entry.points)} points</strong>
        <div class="meta">${formatDate(parseLocalDate(entry.date))}${entry.note ? ` &middot; ${escapeHtml(entry.note)}` : ""}</div>
      </div>
      <button type="button" aria-label="Delete entry" title="Delete">&times;</button>
    `;

    row.querySelector("button").addEventListener("click", () => {
      entries = entries.filter((item) => item.id !== entry.id);
      saveEntries();
      render();
    });

    activityList.append(row);
  }
}

function expirationDate(inputDate) {
  const earned = parseLocalDate(inputDate);
  return new Date(earned.getFullYear(), earned.getMonth() + sixMonths + 1, 1);
}

function parseLocalDate(inputDate) {
  const [year, month, day] = inputDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return dateFormatter.format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
