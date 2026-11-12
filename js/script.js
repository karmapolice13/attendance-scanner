// 1. Dynamic Script URL from ?scriptUrl= parameter with fallback
const urlParams = new URLSearchParams(window.location.search);
const SCRIPT_URL = urlParams.get('scriptUrl') || "https://script.google.com/macros/s/AKfycbyCprd2xbGdpQ7zM2ueI-FTJ0ZpQumiEDCaOW0rSja7M4hj3GVmMdNLwBdItIr9o6rxOA/exec";

// 2. Secret Security Token (Must match SECRET_API_KEY in Code.gs)
const API_KEY = "COA_SEMINAR_2026_SECURE_TOKEN_9981";

const DEPLOYMENT_ID = (SCRIPT_URL.split("/s/")[1] || SCRIPT_URL).split("/")[0];
const QUEUE_STORAGE_KEY = "attendance_offline_queue_" + DEPLOYMENT_ID;

// Local Audio Elements & Status Badge
const successAudio = document.getElementById("scan-sound");
const errorAudio = document.getElementById("error-sound");
const queueBadge = document.getElementById("queue-status-badge");

// Global timer variable for clearing results
let resultDisplayTimeout = null;

// Prevents two syncs from running at the same time
let isSyncing = false;

// Initialize Offline Queue on startup
let offlineQueue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");

// Network Status Listeners
window.addEventListener("online", syncOfflineQueue);
window.addEventListener("offline", updateNetworkUI);

// ====================================================
// PRIMARY SCAN & NETWORK ENGINE
// ====================================================

function onScanSuccess(decodedText, decodedResult) {
  // Cooldown Lock: Prevent rapid double-scans (also paused while the Manual Check-in window is open)
  if (window.isProcessingScan || manualOpen) return;
  window.isProcessingScan = true;

  // Clean raw scanned text (supports raw IDs and URLs containing ?id=)
  let scannedId = decodedText.trim();
  if (scannedId.includes("id=")) {
    scannedId = scannedId.split("id=")[1];
    if (scannedId.includes("&")) scannedId = scannedId.split("&")[0];
    scannedId = scannedId.trim();
  }

  const scanData = {
    id: scannedId,
    timestamp: new Date().toISOString(), // Actual moment of the scan (kept even if synced later)
    userAgent: navigator.userAgent // Metadata for audit log
  };

  if (navigator.onLine) {
    sendScanToBackend(scanData);
  } else {
    saveToOfflineQueue(scanData);
  }

  // Release camera cooldown lock after 3 seconds
  setTimeout(() => {
    window.isProcessingScan = false;
  }, 3000);
}

function onScanError(errorMessage) {
  // Ignore continuous frame-scan errors
}

// Builds the request body so live scans and queued scans are sent identically
function buildPayload(item) {
  return JSON.stringify({
    id: item.id,
    apiKey: API_KEY,
    userAgent: item.userAgent,
    timestamp: item.timestamp // Server uses this as the real scan time
  });
}

function sendScanToBackend(scanData) {
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: buildPayload(scanData)
  })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      return response.json();
    })
    .then(data => {
      if (data.status === "success") {
        playSuccess(data.message);
        refreshAttendanceCount();
      } else {
        playError(data.message || "ID Not Found or Cooldown Active");
      }
    })
    .catch(err => {
      console.warn("Network request failed. Saving scan to offline queue.", err);
      saveToOfflineQueue(scanData);
    });
}

function saveToOfflineQueue(scanData) {
  offlineQueue.push(scanData);
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
  
  playSuccess(`Offline: Saved ID ${scanData.id} locally`);
  updateNetworkUI();
}

// Sends queued scans one at a time, oldest first.
// Each scan is removed from the queue only after the server has answered it,
// so a dropped connection never loses or duplicates scans.
async function syncOfflineQueue() {
  updateNetworkUI();

  if (isSyncing || !navigator.onLine || offlineQueue.length === 0) return;
  isSyncing = true;

  let synced = 0;
  let skipped = 0;

  try {
    while (offlineQueue.length > 0) {
      const item = offlineQueue[0];

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: buildPayload(item)
      });
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const result = await response.json();
      const msg = result.message || "";

      // Final answers: logged, already logged, or ID not in Masterlist.
      // Anything else (bad key, missing sheet, server error) keeps the scan queued.
      const isFinal =
        result.status === "success" ||
        msg.includes("Already Logged") ||
        msg.includes("ID Not Found");
      if (!isFinal) throw new Error(msg || "Unexpected server response");

      if (result.status === "success") synced++; else skipped++;

      offlineQueue.shift();
      if (offlineQueue.length > 0) {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
      } else {
        localStorage.removeItem(QUEUE_STORAGE_KEY);
      }
      updateNetworkUI();
    }

    if (skipped === 0) {
      playSuccess(`All offline scans successfully synced! (${synced})`);
    } else {
      playSuccess(`Synced ${synced} offline scan(s). ${skipped} skipped (duplicate or ID not found).`);
    }
    refreshAttendanceCount();
  } catch (err) {
    console.error("Failed to sync offline queue:", err);
  } finally {
    isSyncing = false;
    updateNetworkUI();
  }
}

// ====================================================
// UI & AUDIO FEEDBACK HELPERS
// ====================================================

function playSuccess(msg) {
  if (successAudio) {
    successAudio.currentTime = 0;
    successAudio.play().catch(() => {});
  }
  displayResultOnScreen(msg, "text-success");
}

function playError(msg) {
  if (errorAudio) {
    errorAudio.currentTime = 0;
    errorAudio.play().catch(() => {});
  }
  displayResultOnScreen(msg, "text-danger");
}

function displayResultOnScreen(msg, textClass) {
  const idleNotice = document.getElementById("idle-notice");
  const resultBox = document.getElementById("scan-result");

  if (!resultBox) return;

  // Clear any pending timeout from previous scans
  if (resultDisplayTimeout) {
    clearTimeout(resultDisplayTimeout);
  }

  // Hide idle message and show result box
  if (idleNotice) idleNotice.style.display = "none";
  
  const alertClass = textClass.includes("success") ? "alert-success" : "alert-danger";
  resultBox.className = `alert ${alertClass} fw-bold text-center w-100 my-2 shadow-sm fs-5`;
  resultBox.innerHTML = msg;
  resultBox.style.display = "block";

  // Auto-disappear after 4 seconds and return to idle state
  resultDisplayTimeout = setTimeout(() => {
    resultBox.style.display = "none";
    resultBox.innerHTML = "";
    if (idleNotice) idleNotice.style.display = "block";
  }, 6000);
}

function updateNetworkUI() {
  if (!queueBadge) return;

  if (!navigator.onLine) {
    queueBadge.className = "badge bg-warning text-dark px-3 py-2";
    queueBadge.innerHTML = `⚠️ Offline Mode (${offlineQueue.length} Queued)`;
  } else if (offlineQueue.length > 0) {
    queueBadge.className = "badge bg-info text-dark px-3 py-2";
    queueBadge.innerHTML = `🔄 Syncing ${offlineQueue.length} Scans...`;
  } else {
    queueBadge.className = "badge bg-success px-3 py-2";
    queueBadge.innerHTML = `✓ Online & Synced`;
  }
}

// Updates the "Present today: X / Y" counter from the server
async function refreshAttendanceCount() {
  const presentEl = document.getElementById("counter-present");
  const totalEl = document.getElementById("counter-total");
  if (!presentEl || !totalEl || !navigator.onLine) return;

  try {
    const sep = SCRIPT_URL.includes("?") ? "&" : "?";
    const res = await fetch(SCRIPT_URL + sep + "t=" + Date.now(), { redirect: "follow" });
    const data = await res.json();
    if (typeof data.present === "number" && typeof data.total === "number") {
      presentEl.textContent = data.present;
      totalEl.textContent = data.total;
    }
  } catch (err) {
    console.warn("Could not refresh attendance counter:", err);
  }
}

// ====================================================
// MANUAL CHECK-IN (coordinator only)
// ====================================================
// The security code is verified by the server (Code.gs). The participant list is only
// sent after the correct code is entered, and nothing is stored in the browser.

const MANUAL_AUTO_LOCK_MS = 5 * 60 * 1000; // re-lock after 5 minutes without use

let manualOpen = false;       // true while the manual check-in window is showing
let manualPin = null;         // kept in memory only
let manualParticipants = [];
let manualSelected = null;
let manualLockTimer = null;
let manualBusy = false;

function manualEl(id) {
  return document.getElementById(id);
}

// Sends a request to the backend with the API key and device info attached
async function postToBackend(payload) {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ apiKey: API_KEY, userAgent: navigator.userAgent, ...payload })
  });
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  return response.json();
}

function manualShowStep(step) {
  ["pin", "search", "confirm"].forEach(name => {
    manualEl("manual-step-" + name).hidden = (name !== step);
  });
}

function resetManualLockTimer() {
  clearTimeout(manualLockTimer);
  manualLockTimer = setTimeout(lockManual, MANUAL_AUTO_LOCK_MS);
}

// Forget the code and the participant list; the next opening asks for the code again
function lockManual() {
  clearTimeout(manualLockTimer);
  manualPin = null;
  manualParticipants = [];
  manualSelected = null;
  if (manualOpen) showManualPinStep();
}

function showManualPinStep() {
  manualShowStep("pin");
  manualEl("manual-pin").value = "";
  manualEl("manual-pin-error").textContent = "";
  setTimeout(() => manualEl("manual-pin").focus(), 50);
}

function goToManualSearch() {
  manualSelected = null;
  manualShowStep("search");
  manualEl("manual-search").value = "";
  renderManualResults("");
  resetManualLockTimer();
  setTimeout(() => manualEl("manual-search").focus(), 50);
}

function openManualModal() {
  if (!navigator.onLine) {
    playError("Manual check-in needs an internet connection.");
    return;
  }
  manualOpen = true;
  manualEl("manual-overlay").hidden = false;

  if (manualPin && manualParticipants.length > 0) {
    goToManualSearch();       // still unlocked from a recent use
  } else {
    showManualPinStep();
  }
}

function closeManualModal() {
  manualOpen = false;
  manualEl("manual-overlay").hidden = true;
}

async function unlockManual() {
  if (manualBusy) return;

  const pin = manualEl("manual-pin").value.trim();
  const errorEl = manualEl("manual-pin-error");
  const unlockBtn = manualEl("manual-unlock");

  if (!pin) {
    errorEl.textContent = "Please enter the security code.";
    return;
  }

  manualBusy = true;
  unlockBtn.disabled = true;
  unlockBtn.textContent = "Checking...";
  errorEl.textContent = "";

  try {
    const result = await postToBackend({ action: "listParticipants", pin: pin });
    if (result.status === "success") {
      manualPin = pin;
      manualParticipants = result.participants || [];
      goToManualSearch();
    } else {
      errorEl.textContent = result.message || "Incorrect security code.";
      manualEl("manual-pin").select();
    }
  } catch (err) {
    console.warn("Manual unlock failed:", err);
    errorEl.textContent = "Connection problem. Please try again.";
  } finally {
    manualBusy = false;
    unlockBtn.disabled = false;
    unlockBtn.textContent = "Unlock";
  }
}

// Shows up to 8 participants matching ALL typed words (name, number or office, any order)
function renderManualResults(query) {
  const box = manualEl("manual-results");
  box.innerHTML = "";

  const addHint = text => {
    const hint = document.createElement("div");
    hint.className = "manual-hint";
    hint.textContent = text;
    box.appendChild(hint);
  };

  const tokens = query.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    addHint("Type a name, participant number or office.");
    return;
  }

  const matches = manualParticipants.filter(p => {
    const haystack = `${p.name} ${p.id} ${p.office}`.toLowerCase();
    return tokens.every(t => haystack.includes(t));
  });

  if (matches.length === 0) {
    addHint("No match found. Check the spelling or try the surname only.");
    return;
  }

  matches.slice(0, 8).forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "manual-result";

    const nameEl = document.createElement("div");
    nameEl.className = "manual-result-name";
    nameEl.textContent = p.name;

    const metaEl = document.createElement("div");
    metaEl.className = "manual-result-meta";
    metaEl.textContent = "No. " + p.id + (p.office ? "  •  " + p.office : "");

    btn.append(nameEl, metaEl);
    btn.addEventListener("click", () => selectManualParticipant(p));
    box.appendChild(btn);
  });

  if (matches.length > 8) {
    addHint(`Showing 8 of ${matches.length}. Keep typing to narrow the list.`);
  }
}

function selectManualParticipant(p) {
  manualSelected = p;
  manualEl("manual-confirm-name").textContent = p.name;
  manualEl("manual-confirm-meta").textContent = "No. " + p.id + (p.office ? "  •  " + p.office : "");
  manualShowStep("confirm");
  resetManualLockTimer();
}

async function confirmManual() {
  if (manualBusy || !manualSelected) return;

  if (!navigator.onLine) {
    closeManualModal();
    playError("Manual check-in needs an internet connection.");
    return;
  }

  const confirmBtn = manualEl("manual-confirm");
  manualBusy = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Checking in...";

  try {
    const result = await postToBackend({
      action: "manualCheckIn",
      pin: manualPin,
      id: manualSelected.id,
      timestamp: new Date().toISOString()
    });

    if (result.status === "success") {
      closeManualModal();
      playSuccess(result.message);
      refreshAttendanceCount();
    } else if (result.code === "PIN") {
      // The code stopped being valid (changed or locked out): ask for it again
      lockManual();
      manualEl("manual-pin-error").textContent = result.message || "Incorrect security code.";
    } else {
      closeManualModal();
      playError(result.message || "Could not check in this participant.");
    }
  } catch (err) {
    console.warn("Manual check-in failed:", err);
    closeManualModal();
    playError("Connection problem. Manual check-in was not saved. Please try again.");
  } finally {
    manualBusy = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm";
    resetManualLockTimer();
  }
}

function initManualCheckin() {
  const openBtn = manualEl("manual-open-btn");
  if (!openBtn) return; // page without the manual check-in markup

  openBtn.addEventListener("click", openManualModal);
  manualEl("manual-close").addEventListener("click", closeManualModal);
  manualEl("manual-overlay").addEventListener("click", e => {
    if (e.target.id === "manual-overlay") closeManualModal();
  });
  manualEl("manual-unlock").addEventListener("click", unlockManual);
  manualEl("manual-pin").addEventListener("keydown", e => {
    if (e.key === "Enter") unlockManual();
  });
  manualEl("manual-search").addEventListener("input", e => {
    resetManualLockTimer();
    renderManualResults(e.target.value);
  });
  manualEl("manual-back").addEventListener("click", () => {
    manualShowStep("search");
    setTimeout(() => manualEl("manual-search").focus(), 50);
  });
  manualEl("manual-confirm").addEventListener("click", confirmManual);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && manualOpen) closeManualModal();
  });
}

// ====================================================
// INITIALIZE SCANNER ENGINE
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  updateNetworkUI();

  // If scans were left in the queue (e.g. page was closed while offline), send them now
  syncOfflineQueue();

  // Manual check-in button & window
  initManualCheckin();

  // Live counter: load once now, then refresh every 30 seconds
  refreshAttendanceCount();
  setInterval(refreshAttendanceCount, 30000);

  const html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { 
      fps: 10, 
      qrbox: { width: 250, height: 250 },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    },
    false
  );
  html5QrcodeScanner.render(onScanSuccess, onScanError);
});
