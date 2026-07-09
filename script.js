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
const videoInput = document.querySelector("#videoInput");
const processVideoButton = document.querySelector("#processVideoButton");
const addDetectedButton = document.querySelector("#addDetectedButton");
const videoStatus = document.querySelector("#videoStatus");
const videoProgress = document.querySelector("#videoProgress");
const detectedList = document.querySelector("#detectedList");
const rawOcrOutput = document.querySelector("#rawOcrOutput");
const frameVideo = document.querySelector("#frameVideo");
const frameCanvas = document.querySelector("#frameCanvas");
const scanDepth = document.querySelector("#scanDepth");

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

let entries = loadEntries();
let detectedEntries = [];

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
  const hasData = entries.length > 0 || detectedEntries.length > 0 || rawOcrOutput.textContent || videoInput.files.length > 0;

  if (!hasData) {
    return;
  }

  if (window.confirm("Clear all saved entries, detected OCR rows, and imported video state?")) {
    clearEverything();
  }
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

videoInput.addEventListener("change", () => {
  const file = videoInput.files[0];
  detectedEntries = [];
  renderDetectedEntries();
  rawOcrOutput.textContent = "";
  videoProgress.value = 0;
  processVideoButton.disabled = !file;
  addDetectedButton.disabled = true;
  videoStatus.textContent = file ? file.name : "Ready";
});

processVideoButton.addEventListener("click", async () => {
  const file = videoInput.files[0];

  if (!file) {
    return;
  }

  if (!window.Tesseract) {
    videoStatus.textContent = "OCR library unavailable";
    return;
  }

  processVideoButton.disabled = true;
  addDetectedButton.disabled = true;
  detectedEntries = [];
  renderDetectedEntries();
  rawOcrOutput.textContent = "";
  videoProgress.value = 0;

  try {
    const result = await extractVideoText(file, scanDepth.value);
    rawOcrOutput.textContent = result.rawText.trim();
    detectedEntries = dedupeDetectedEntries(parseEntriesFromText(result.rawText));
    renderDetectedEntries();
    addDetectedButton.disabled = detectedEntries.length === 0;
    videoStatus.textContent = detectedEntries.length
      ? `${detectedEntries.length} entries detected, ${formatSignedTotal(detectedEntries)} net`
      : "No point lines detected";
  } catch (error) {
    videoStatus.textContent = "Could not process video";
    rawOcrOutput.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    processVideoButton.disabled = false;
  }
});

addDetectedButton.addEventListener("click", () => {
  if (detectedEntries.length === 0) {
    return;
  }

  entries = entries.concat(detectedEntries.map((entry) => ({ ...entry, id: createId() })));
  detectedEntries = [];
  saveEntries();
  render();
  renderDetectedEntries();
  addDetectedButton.disabled = true;
  videoStatus.textContent = "Detected entries added";
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

function clearEverything() {
  entries = [];
  detectedEntries = [];
  videoInput.value = "";
  rawOcrOutput.textContent = "";
  videoProgress.value = 0;
  videoStatus.textContent = "Ready";
  processVideoButton.disabled = true;
  addDetectedButton.disabled = true;
  saveEntries();
  renderDetectedEntries();
  render();
}

function render() {
  const lots = calculateLots(entries);
  const today = startOfDay(new Date());
  const activeLots = lots.filter((lot) => lot.remaining > 0 && lot.expiresAt >= today);
  const expiredLots = lots.filter((lot) => lot.remaining > 0 && lot.expiresAt < today);
  const activeTotal = sum(activeLots.map((lot) => lot.remaining));
  const explicitExpiredTotal = sum(entries
    .filter((entry) => entry.kind === "expired")
    .map((entry) => entry.points));
  const expiredTotal = sum(expiredLots.map((lot) => lot.remaining)) + explicitExpiredTotal;

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

  for (const entry of sorted.filter((item) => item.kind === "used" || item.kind === "expired")) {
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
    const sign = entry.kind === "earned" ? "+" : "-";

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

async function extractVideoText(file, depth) {
  const objectUrl = URL.createObjectURL(file);
  const context = frameCanvas.getContext("2d", { willReadFrequently: true });
  const rawText = [];
  const progressState = { frameIndex: 0, frameCount: 1 };
  let worker = null;

  try {
    await loadVideo(objectUrl);
    const duration = Number.isFinite(frameVideo.duration) ? frameVideo.duration : 0;
    const times = sampleTimes(duration, depth);
    progressState.frameCount = times.length;

    if (times.length === 0) {
      throw new Error("The selected video has no readable duration.");
    }

    rawText.push(`Scan: ${times.length} frames from ${duration.toFixed(1)}s video`);
    videoStatus.textContent = `Preparing OCR for ${times.length} frames`;
    worker = await createOcrWorker(progressState);

    for (let index = 0; index < times.length; index += 1) {
      const time = times[index];
      progressState.frameIndex = index;
      videoStatus.textContent = `Reading frame ${index + 1} of ${times.length}`;
      videoProgress.value = index / times.length;
      await seekVideo(time);
      drawVideoFrame(context);
      const text = await recognizeCanvasText(worker, index, times.length);
      rawText.push(`Frame ${index + 1} (${time.toFixed(1)}s)\n${text}`);
    }

    videoProgress.value = 1;
    return { rawText: rawText.join("\n\n") };
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (worker) {
      await worker.terminate();
    }
    frameVideo.removeAttribute("src");
    frameVideo.load();
  }
}

function loadVideo(objectUrl) {
  return new Promise((resolve, reject) => {
    frameVideo.onloadedmetadata = () => resolve();
    frameVideo.onerror = () => reject(new Error("The browser could not load this video file."));
    frameVideo.src = objectUrl;
    frameVideo.load();
  });
}

function seekVideo(time) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Timed out while reading the video.")), 8000);

    frameVideo.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    frameVideo.currentTime = Math.min(time, Math.max(frameVideo.duration - 0.1, 0));
  });
}

function sampleTimes(duration, depth) {
  if (!duration || duration < 0.5) {
    return [];
  }

  const settings = {
    quick: { step: 1, maxFrames: 45 },
    thorough: { step: 0.55, maxFrames: 110 },
    maximum: { step: 0.35, maxFrames: 180 }
  };
  const setting = settings[depth] || settings.thorough;
  const primary = collectSampleTimes(duration, setting.step, 0.25);
  const offset = collectSampleTimes(duration, setting.step, 0.25 + setting.step / 2);
  const times = primary.concat(offset)
    .filter((time) => time < duration - 0.05)
    .sort((a, b) => a - b);

  return downsampleTimes(times, setting.maxFrames);
}

function collectSampleTimes(duration, step, start) {
  const times = [];

  for (let time = start; time < duration; time += step) {
    times.push(time);
  }

  return times;
}

function downsampleTimes(times, maxFrames) {
  if (times.length <= maxFrames) {
    return times;
  }

  const sampled = [];
  const lastIndex = times.length - 1;

  for (let index = 0; index < maxFrames; index += 1) {
    const sourceIndex = Math.round((index / (maxFrames - 1)) * lastIndex);
    sampled.push(times[sourceIndex]);
  }

  return Array.from(new Set(sampled));
}

function drawVideoFrame(context) {
  const maxWidth = 1100;
  const scale = Math.min(1, maxWidth / frameVideo.videoWidth);
  const width = Math.max(1, Math.round(frameVideo.videoWidth * scale));
  const height = Math.max(1, Math.round(frameVideo.videoHeight * scale));

  frameCanvas.width = width;
  frameCanvas.height = height;
  context.filter = "contrast(1.18) saturate(0.9)";
  context.drawImage(frameVideo, 0, 0, width, height);
  context.filter = "none";
}

async function createOcrWorker(progressState) {
  if (typeof window.Tesseract.createWorker !== "function") {
    return null;
  }

  try {
    return await window.Tesseract.createWorker("eng+chi_sim", 1, {
      logger(message) {
        if (message.status === "recognizing text") {
          const frameProgress = progressState.frameIndex / progressState.frameCount;
          const ocrProgress = message.progress / progressState.frameCount;
          videoProgress.value = Math.min(frameProgress + ocrProgress, 1);
        }
      }
    });
  } catch {
    return null;
  }
}

async function recognizeCanvasText(worker, frameIndex, frameCount) {
  if (worker) {
    const result = await worker.recognize(frameCanvas);
    return result.data.text || "";
  }

  const result = await window.Tesseract.recognize(frameCanvas, "eng+chi_sim", {
    logger(message) {
      if (message.status === "recognizing text") {
        const frameProgress = frameIndex / frameCount;
        const ocrProgress = message.progress / frameCount;
        videoProgress.value = Math.min(frameProgress + ocrProgress, 1);
      }
    }
  });

  return result.data.text || "";
}

function parseEntriesFromText(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const parsed = [];

  for (let index = 0; index < lines.length; index += 1) {
    const windowText = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(" ");
    const date = parseDetectedDate(windowText);
    const points = parseDetectedPoints(windowText);

    if (!date || !points) {
      continue;
    }

    const kind = detectEntryKind(windowText, points.signed);
    parsed.push({
      id: createId(),
      kind,
      date,
      points: Math.abs(points.value),
      note: `Video OCR: ${lines[index].slice(0, 44)}`
    });
  }

  return parsed;
}

function parseDetectedDate(text) {
  const numeric = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);

  if (numeric) {
    return normalizeDetectedDate(numeric[1], numeric[2], numeric[3]);
  }

  const chinese = text.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);

  if (chinese) {
    return normalizeDetectedDate(chinese[1], chinese[2], chinese[3]);
  }

  const slash = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);

  if (slash) {
    return normalizeDetectedDate(slash[3], slash[1], slash[2]);
  }

  return null;
}

function normalizeDetectedDate(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return toInputDate(date);
}

function parseDetectedPoints(text) {
  const matches = Array.from(text.matchAll(/([+-]?)\s*(\d{1,5})\s*(?:points?|pts?|积分|分)?/gi))
    .map((match) => ({
      sign: match[1],
      value: Number.parseInt(match[2], 10),
      index: match.index || 0
    }))
    .filter((match) => Number.isFinite(match.value) && match.value > 0);

  const pointMatch = matches.find((match) => {
    const nearby = text.slice(match.index, match.index + 18).toLowerCase();
    return /point|pts|积分|分/.test(nearby) || match.sign;
  });

  if (!pointMatch) {
    return null;
  }

  return {
    value: pointMatch.value,
    signed: pointMatch.sign === "-" ? -pointMatch.value : pointMatch.value
  };
}

function detectEntryKind(text, signedPoints) {
  const normalized = text.toLowerCase();

  if (/expired|expire|过期|失效|到期/.test(normalized)) {
    return "expired";
  }

  if (signedPoints < 0 || /used|redeem|spent|consume|使用|兑换|消费|扣除/.test(normalized)) {
    return "used";
  }

  return "earned";
}

function dedupeDetectedEntries(sourceEntries) {
  const seen = new Set();

  return sourceEntries.filter((entry) => {
    const key = `${entry.kind}:${entry.date}:${entry.points}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function renderDetectedEntries() {
  detectedList.replaceChildren();

  if (detectedEntries.length === 0) {
    return;
  }

  for (const entry of detectedEntries) {
    const row = document.createElement("article");
    row.className = "detected-row";
    const sign = entry.kind === "earned" ? "+" : "-";

    row.innerHTML = `
      <div>
        <strong>${sign}${formatNumber(entry.points)} points</strong>
        <div class="meta">${formatDate(parseLocalDate(entry.date))} &middot; ${escapeHtml(entry.note)}</div>
      </div>
      <span class="status">${entry.kind}</span>
    `;
    detectedList.append(row);
  }
}

function formatSignedTotal(sourceEntries) {
  const total = sourceEntries.reduce((sumTotal, entry) => {
    return sumTotal + (entry.kind === "earned" ? entry.points : -entry.points);
  }, 0);
  const sign = total > 0 ? "+" : "";

  return `${sign}${formatNumber(total)}`;
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
