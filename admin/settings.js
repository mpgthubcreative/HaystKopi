// Owner Settings page. Reads settings/business, settings/orders,
// settings/delivery, settings/payments directly via the client SDK (rules
// already restrict this to an active owner/admin, and this page is
// owner-only gated since Phase 2). ALL WRITES go through
// settings-actions.js -> update-settings.js (OWNER-only, re-validated
// server-side regardless of what this page already checked).

import { fetchAllSettings } from "../firebase/settings-helpers.js";
import { uploadBusinessImage } from "../firebase/storage-helpers.js";
import { updateSettingsSection } from "./settings-actions.js";

const stateEl = document.getElementById("settingsState");
const contentEl = document.getElementById("settingsContent");

let brackets = [];
let pendingQrUrl = null;

document.addEventListener("admin:ready", async () => {
  await loadSettings();
});

async function loadSettings() {
  stateEl.textContent = "Loading settings…";
  stateEl.hidden = false;
  stateEl.classList.remove("is-error");

  let settings;
  try {
    settings = await fetchAllSettings();
  } catch (err) {
    stateEl.textContent = "We couldn't load settings right now. Please refresh the page.";
    stateEl.classList.add("is-error");
    return;
  }

  populateGeneral(settings.business);
  populateOrders(settings.orders);
  populateDelivery(settings.delivery);
  populatePayments(settings.payments);

  stateEl.hidden = true;
  contentEl.hidden = false;
}

/* ---------- Populate from Firestore (blank/default if unset — never invented) ---------- */

function populateGeneral(business) {
  const b = business || {};
  document.getElementById("businessName").value = b.businessName || "";
  document.getElementById("bizPhone").value = b.phone || "";
  document.getElementById("bizEmail").value = b.email || "";
  document.getElementById("bizFacebook").value = b.facebook || "";
  document.getElementById("bizInstagram").value = b.instagram || "";
}

function populateOrders(orders) {
  const o = orders || {};
  const pickup = o.pickup || {};
  document.getElementById("acceptingOrders").checked = o.acceptingOrders === true;
  document.getElementById("pickupEnabled").checked = pickup.enabled === true;
  document.getElementById("pickupAddress").value = pickup.address || "";
  document.getElementById("pickupHours").value = pickup.hours || "";
  document.getElementById("pickupInstructions").value = pickup.instructions || "";
}

function populateDelivery(delivery) {
  const d = delivery || {};
  const origin = d.origin || {};
  const zones = d.specialZones || {};
  const dp = d.distancePricing || {};

  document.getElementById("deliveryEnabled").checked = d.enabled === true;
  document.getElementById("originAddress").value = origin.address || "";
  document.getElementById("originLat").value = origin.lat != null ? origin.lat : "";
  document.getElementById("originLng").value = origin.lng != null ? origin.lng : "";

  document.getElementById("rosewoodEnabled").checked = Boolean(zones.rosewood && zones.rosewood.enabled);
  document.getElementById("rosewoodFee").value = (zones.rosewood && zones.rosewood.fee) ?? 0;
  document.getElementById("acaciaEnabled").checked = Boolean(zones.acacia && zones.acacia.enabled);
  document.getElementById("acaciaFee").value = (zones.acacia && zones.acacia.fee) ?? 0;

  document.getElementById("distancePricingEnabled").checked = dp.enabled === true;
  document.getElementById("maxDistanceKm").value = dp.maxDistanceKm ?? "";

  brackets = Array.isArray(dp.brackets)
    ? dp.brackets.map((b) => ({ minKm: b.minKm, maxKm: b.maxKm, fee: b.fee }))
    : [];
  renderBrackets();
}

function populatePayments(payments) {
  const p = payments || {};
  const gcash = p.gcash || {};
  const bank = p.bankTransfer || {};
  const codP = p.cashOnPickup || {};
  const codD = p.cashOnDelivery || {};

  document.getElementById("gcashEnabled").checked = gcash.enabled === true;
  document.getElementById("gcashAccountName").value = gcash.accountName || "";
  document.getElementById("gcashNumber").value = gcash.number || "";
  pendingQrUrl = gcash.qrImagePath || null;
  if (pendingQrUrl) {
    document.getElementById("gcashQrPreviewWrap").hidden = false;
    document.getElementById("gcashQrPreview").src = pendingQrUrl;
  }

  document.getElementById("bankEnabled").checked = bank.enabled === true;
  document.getElementById("bankName").value = bank.bankName || "";
  document.getElementById("bankAccountName").value = bank.accountName || "";
  document.getElementById("bankAccountNumber").value = bank.accountNumber || "";

  document.getElementById("codPickupEnabled").checked = codP.enabled === true;
  document.getElementById("codDeliveryEnabled").checked = codD.enabled === true;
}

/* ---------- Delivery bracket editor ---------- */
// Built with direct DOM node updates (not innerHTML re-render) on every
// keystroke — a full re-render would steal focus mid-typing. Only ADD/
// DELETE trigger a full renderBrackets().

function renderBrackets() {
  const container = document.getElementById("bracketList");
  container.innerHTML = "";
  brackets.forEach((bracket, index) => buildBracketRow(bracket, index, container));
}

function buildBracketRow(bracket, index, container) {
  const row = document.createElement("div");
  row.className = "bracket-row";
  row.dataset.index = String(index);

  const labelEl = document.createElement("div");
  labelEl.className = "bracket-label";
  row.appendChild(labelEl);

  function updateLabel() {
    labelEl.textContent = index === 0
      ? `0 to ${bracket.maxKm ?? "?"} km`
      : `Over ${bracket.minKm ?? "?"} to ${bracket.maxKm ?? "?"} km`;
  }
  updateLabel();

  const minField = buildNumberField("Min km", bracket.minKm, "minKm", index === 0);
  const maxField = buildNumberField("Max km", bracket.maxKm, "maxKm", false);
  const feeField = buildNumberField("Fee (₱)", bracket.fee, "fee", false);
  row.appendChild(minField.wrapper);
  row.appendChild(maxField.wrapper);
  row.appendChild(feeField.wrapper);

  minField.input.addEventListener("input", () => {
    bracket.minKm = minField.input.value === "" ? null : Number(minField.input.value);
    updateLabel();
  });

  maxField.input.addEventListener("input", () => {
    bracket.maxKm = maxField.input.value === "" ? null : Number(maxField.input.value);
    updateLabel();

    // The fixed "no gap, no overlap" convention: the next bracket always
    // starts exactly where this one ends. The Owner only ever edits a max
    // distance; the following bracket's start follows automatically.
    const next = brackets[index + 1];
    if (next) {
      next.minKm = bracket.maxKm;
      const nextRow = container.querySelector(`[data-index="${index + 1}"]`);
      if (nextRow) {
        const nextMinInput = nextRow.querySelector('input[data-field="minKm"]');
        if (nextMinInput) nextMinInput.value = next.minKm ?? "";
        const nextLabel = nextRow.querySelector(".bracket-label");
        if (nextLabel) nextLabel.textContent = `Over ${next.minKm ?? "?"} to ${next.maxKm ?? "?"} km`;
      }
    }
  });

  feeField.input.addEventListener("input", () => {
    bracket.fee = feeField.input.value === "" ? null : Number(feeField.input.value);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-quiet";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    brackets.splice(index, 1);
    renderBrackets();
  });
  row.appendChild(deleteBtn);

  container.appendChild(row);
}

function buildNumberField(labelText, value, field, disabled) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = field === "fee" ? "1" : "0.1";
  input.value = value ?? "";
  input.dataset.field = field;
  if (disabled) input.disabled = true;
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return { wrapper, input };
}

document.getElementById("addBracketBtn").addEventListener("click", () => {
  const last = brackets[brackets.length - 1];
  const nextMin = last ? last.maxKm : 0;
  brackets.push({ minKm: nextMin ?? 0, maxKm: null, fee: null });
  renderBrackets();
});

/* ---------- Field error helpers ---------- */

function setFieldError(name, message) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function clearFieldError(name) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (el) {
    el.hidden = true;
    el.textContent = "";
  }
}

function showSaveStatus(el, message, variant) {
  el.textContent = message;
  el.classList.remove("is-error", "is-success");
  if (variant) el.classList.add(variant);
}

/* ---------- Save: General ---------- */

document.getElementById("saveGeneralBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveGeneralBtn");
  const msgEl = document.getElementById("saveGeneralMsg");

  btn.disabled = true;
  showSaveStatus(msgEl, "Saving…", null);

  const data = {
    businessName: document.getElementById("businessName").value.trim(),
    phone: document.getElementById("bizPhone").value.trim(),
    email: document.getElementById("bizEmail").value.trim(),
    facebook: document.getElementById("bizFacebook").value.trim(),
    instagram: document.getElementById("bizInstagram").value.trim(),
  };

  const { ok, result } = await updateSettingsSection("business", data);
  btn.disabled = false;

  if (!ok) {
    showSaveStatus(msgEl, (result && result.message) || "Settings could not be saved.", "is-error");
    return;
  }
  showSaveStatus(msgEl, "Settings saved.", "is-success");
});

/* ---------- Save: Orders (accepting orders + pickup) ---------- */

document.getElementById("saveOrdersBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveOrdersBtn");
  const msgEl = document.getElementById("saveOrdersMsg");

  clearFieldError("pickupAddress");
  btn.disabled = true;
  showSaveStatus(msgEl, "Saving…", null);

  const data = {
    acceptingOrders: document.getElementById("acceptingOrders").checked,
    pickup: {
      enabled: document.getElementById("pickupEnabled").checked,
      address: document.getElementById("pickupAddress").value.trim(),
      hours: document.getElementById("pickupHours").value.trim(),
      instructions: document.getElementById("pickupInstructions").value.trim(),
    },
  };

  const { ok, result } = await updateSettingsSection("orders", data);
  btn.disabled = false;

  if (!ok) {
    showSaveStatus(msgEl, (result && result.message) || "Settings could not be saved.", "is-error");
    if (result && result.fieldErrors) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => setFieldError(field, message));
    }
    return;
  }
  showSaveStatus(msgEl, "Settings saved.", "is-success");
});

/* ---------- Save: Delivery ---------- */

document.getElementById("saveDeliveryBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveDeliveryBtn");
  const msgEl = document.getElementById("saveDeliveryMsg");
  const bracketErrorEl = document.getElementById("bracketError");

  clearFieldError("origin");
  bracketErrorEl.hidden = true;
  btn.disabled = true;
  showSaveStatus(msgEl, "Saving…", null);

  const latVal = document.getElementById("originLat").value.trim();
  const lngVal = document.getElementById("originLng").value.trim();

  const data = {
    enabled: document.getElementById("deliveryEnabled").checked,
    origin: {
      address: document.getElementById("originAddress").value.trim(),
      lat: latVal === "" ? null : Number(latVal),
      lng: lngVal === "" ? null : Number(lngVal),
    },
    specialZones: {
      rosewood: {
        enabled: document.getElementById("rosewoodEnabled").checked,
        fee: Number(document.getElementById("rosewoodFee").value) || 0,
      },
      acacia: {
        enabled: document.getElementById("acaciaEnabled").checked,
        fee: Number(document.getElementById("acaciaFee").value) || 0,
      },
    },
    distancePricing: {
      enabled: document.getElementById("distancePricingEnabled").checked,
      maxDistanceKm: Number(document.getElementById("maxDistanceKm").value) || 0,
      brackets: brackets.map((b) => ({ minKm: b.minKm, maxKm: b.maxKm, fee: b.fee })),
    },
  };

  const { ok, result } = await updateSettingsSection("delivery", data);
  btn.disabled = false;

  if (!ok) {
    showSaveStatus(msgEl, (result && result.message) || "Settings could not be saved.", "is-error");
    if (result && result.fieldErrors) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => {
        if (field === "brackets") {
          bracketErrorEl.textContent = message;
          bracketErrorEl.hidden = false;
        } else {
          setFieldError(field, message);
        }
      });
    }
    return;
  }
  showSaveStatus(msgEl, "Settings saved.", "is-success");
});

/* ---------- Payments: QR upload + Save ---------- */

document.getElementById("gcashQrFile").addEventListener("change", async () => {
  const fileInput = document.getElementById("gcashQrFile");
  const msgEl = document.getElementById("qrUploadMsg");
  const file = fileInput.files[0];
  if (!file) return;

  showSaveStatus(msgEl, "Uploading…", null);
  fileInput.disabled = true;

  try {
    // Fixed path — a repeat upload overwrites, so replacing the QR never
    // leaves an orphaned old image in Storage.
    const url = await uploadBusinessImage("gcash-qr", file);
    pendingQrUrl = url;
    document.getElementById("gcashQrPreviewWrap").hidden = false;
    document.getElementById("gcashQrPreview").src = url;
    showSaveStatus(msgEl, "Uploaded — click Save Changes to apply.", "is-success");
  } catch (err) {
    showSaveStatus(msgEl, "Couldn't upload that image. Please try again.", "is-error");
  }

  fileInput.disabled = false;
  fileInput.value = "";
});

document.getElementById("savePaymentsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("savePaymentsBtn");
  const msgEl = document.getElementById("savePaymentsMsg");

  clearFieldError("gcash");
  clearFieldError("bankTransfer");
  btn.disabled = true;
  showSaveStatus(msgEl, "Saving…", null);

  const data = {
    gcash: {
      enabled: document.getElementById("gcashEnabled").checked,
      accountName: document.getElementById("gcashAccountName").value.trim(),
      number: document.getElementById("gcashNumber").value.trim(),
      qrImagePath: pendingQrUrl || "",
    },
    bankTransfer: {
      enabled: document.getElementById("bankEnabled").checked,
      bankName: document.getElementById("bankName").value.trim(),
      accountName: document.getElementById("bankAccountName").value.trim(),
      accountNumber: document.getElementById("bankAccountNumber").value.trim(),
    },
    cashOnPickup: { enabled: document.getElementById("codPickupEnabled").checked },
    cashOnDelivery: { enabled: document.getElementById("codDeliveryEnabled").checked },
  };

  const { ok, result } = await updateSettingsSection("payments", data);
  btn.disabled = false;

  if (!ok) {
    showSaveStatus(msgEl, (result && result.message) || "Settings could not be saved.", "is-error");
    if (result && result.fieldErrors) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => setFieldError(field, message));
    }
    return;
  }
  showSaveStatus(msgEl, "Settings saved.", "is-success");
});
