// Orders admin page — accessible to OWNER and ADMIN.
// Reads orders directly via the client SDK (Firestore rules already
// restrict this to admin/owner); every WRITE happens through
// order-actions.js -> the secure Netlify Functions instead.
//
// Search/filtering is client-side over whatever pages have been loaded so
// far (50 at a time via "Load More") — fine at this business's order volume.
// If that stops being true, fetchOrdersPage() in
// firebase/orders-helpers.js is the function to change to server-side
// where() queries (composite indexes would then be needed).

import {
  fetchOrdersPage,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_AREA_LABELS,
  PAYMENT_METHOD_LABELS,
} from "../firebase/orders-helpers.js";
import { requestOrdersExport, downloadBlob } from "./export-actions.js";
import { updateOrderStatus, updatePaymentStatus, cancelOrder, getPaymentProof } from "./order-actions.js";

const stateEl = document.getElementById("ordersState");
const listEl = document.getElementById("ordersList");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const searchInput = document.getElementById("orderSearchInput");
const sortSelect = document.getElementById("sortSelect");
const statusFilter = document.getElementById("statusFilter");
const fulfillmentFilter = document.getElementById("fulfillmentFilter");
const paymentFilter = document.getElementById("paymentFilter");
const testFilter = document.getElementById("testFilter");
const deliveryAreaFilter = document.getElementById("deliveryAreaFilter");

const exportBtn = document.getElementById("exportBtn");
const exportModal = document.getElementById("exportModal");
const exportCancelBtn = document.getElementById("exportCancelBtn");
const exportDatePreset = document.getElementById("exportDatePreset");
const exportCustomDates = document.getElementById("exportCustomDates");
const exportDateFrom = document.getElementById("exportDateFrom");
const exportDateTo = document.getElementById("exportDateTo");
const exportOrderType = document.getElementById("exportOrderType");
const exportOrderStatus = document.getElementById("exportOrderStatus");
const exportPaymentStatus = document.getElementById("exportPaymentStatus");
const exportFulfillment = document.getElementById("exportFulfillment");
const exportPaymentMethod = document.getElementById("exportPaymentMethod");
const exportDeliveryArea = document.getElementById("exportDeliveryArea");
const exportStatus = document.getElementById("exportStatus");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalBody = document.getElementById("confirmModalBody");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalConfirmBtn = document.getElementById("confirmModalConfirmBtn");

const proofModal = document.getElementById("proofModal");
const proofModalTitle = document.getElementById("proofModalTitle");
const proofModalMsg = document.getElementById("proofModalMsg");
const proofModalImageWrap = document.getElementById("proofModalImageWrap");
const proofModalImage = document.getElementById("proofModalImage");
const proofModalCloseBtn = document.getElementById("proofModalCloseBtn");

let loadedOrders = [];
let cursor = null;
let hasMore = false;
let sortDirection = "desc";
let isLoading = false;

// Which order document is currently open in the proof modal — needed so a
// late-arriving signed URL from a stale request can never land on the
// wrong order if the admin closes/reopens quickly.
let proofModalOrderId = null;

document.addEventListener("admin:ready", async () => {
  await loadPage(true);
});

async function loadPage(reset) {
  if (isLoading) return;
  isLoading = true;

  if (reset) {
    loadedOrders = [];
    cursor = null;
    listEl.innerHTML = "";
    stateEl.textContent = "Loading orders…";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading…";
  }

  try {
    const page = await fetchOrdersPage({ sortDirection, cursor });
    loadedOrders = loadedOrders.concat(page.orders);
    cursor = page.cursor;
    hasMore = page.hasMore;
  } catch (err) {
    stateEl.textContent = "We couldn't load orders right now. Please refresh the page.";
    stateEl.classList.add("is-error");
    isLoading = false;
    return;
  }

  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "Load More";
  isLoading = false;
  render();
}

function getFilteredOrders() {
  const searchTerm = searchInput.value.trim().toLowerCase();

  return loadedOrders.filter((order) => {
    if (statusFilter.value !== "all" && order.orderStatus !== statusFilter.value) return false;
    if (fulfillmentFilter.value !== "all" && order.fulfillmentMethod !== fulfillmentFilter.value) return false;
    if (paymentFilter.value !== "all" && order.paymentStatus !== paymentFilter.value) return false;
    if (testFilter.value === "live" && order.isTest) return false;
    if (testFilter.value === "test" && !order.isTest) return false;
    if (deliveryAreaFilter.value !== "all" && order.deliveryArea !== deliveryAreaFilter.value) return false;

    if (searchTerm) {
      const haystack = [order.orderNumber, order.customerName, order.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });
}

function render() {
  listEl.innerHTML = "";

  if (loadedOrders.length === 0) {
    stateEl.textContent = "No orders yet.";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
    loadMoreBtn.hidden = true;
    return;
  }

  const filtered = getFilteredOrders();

  if (filtered.length === 0) {
    stateEl.textContent = "No orders match your search or filters.";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
  } else {
    stateEl.hidden = true;
  }

  filtered.forEach((order) => listEl.appendChild(buildOrderCard(order)));
  loadMoreBtn.hidden = !hasMore;
}

// Mirrors lib/order-status.js's isStatusValidForFulfillment — CANCELLED is
// deliberately never in this list; cancellation only ever happens through
// the separate Cancel action/endpoint (see cancelOrder below).
const QUICK_STATUS_BY_FULFILLMENT = {
  pickup: ["PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "COMPLETED"],
  delivery: ["PENDING", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "COMPLETED"],
};

function getQuickStatusOptions(fulfillmentMethod) {
  return QUICK_STATUS_BY_FULFILLMENT[fulfillmentMethod] || QUICK_STATUS_BY_FULFILLMENT.pickup;
}

// One "obvious next step" shortcut per current status, fulfillment-aware
// only where PREPARING branches (pickup vs delivery finish differently).
function getStatusShortcut(order) {
  const isDelivery = order.fulfillmentMethod === "delivery";
  switch (order.orderStatus) {
    case "PENDING":
      return { next: "CONFIRMED", label: "Confirm" };
    case "CONFIRMED":
      return { next: "PREPARING", label: "Start Preparing" };
    case "PREPARING":
      return isDelivery
        ? { next: "OUT_FOR_DELIVERY", label: "Out for Delivery" }
        : { next: "READY_FOR_PICKUP", label: "Ready for Pickup" };
    case "READY_FOR_PICKUP":
    case "OUT_FOR_DELIVERY":
      return { next: "COMPLETED", label: "Complete" };
    default:
      return null;
  }
}

function formatPeso(amount) {
  return `₱${Number(amount || 0).toFixed(2)}`;
}

function buildOrderCard(order) {
  const card = document.createElement("div");
  card.className = "order-card";
  card.dataset.orderId = order.id;

  const firstItem = (order.items || [])[0] || {};
  const fulfillmentLabel = order.fulfillmentMethod === "delivery"
    ? `Delivery — ${DELIVERY_AREA_LABELS[order.deliveryArea] || order.deliveryArea || ""}`
    : "Pickup";

  const isCancelled = order.orderStatus === "CANCELLED";
  const isCompleted = order.orderStatus === "COMPLETED";
  const isAwaitingVerification = order.paymentStatus === "AWAITING_VERIFICATION";

  card.innerHTML = `
    <div class="order-card-top">
      <span class="order-number">${escapeHtml(order.orderNumber || order.id)}</span>
      <span class="order-date">${escapeHtml(formatDate(order.createdAt))}</span>
      <span class="badge ${order.isTest ? "badge-test" : "badge-live"}">${order.isTest ? "TEST" : "LIVE"}</span>
      <span class="status-pill status-${escapeAttr(order.orderStatus)}" data-role="status-pill">${escapeHtml(ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus)}</span>
    </div>
    <div class="order-card-meta">
      <span>${escapeHtml(order.customerName || "")}</span>
      <span>${escapeHtml(order.phone || "")}</span>
      <span>${escapeHtml(firstItem.name || "")} × ${Number(firstItem.quantity) || 0}</span>
      <span>${escapeHtml(fulfillmentLabel)}</span>
      <span>${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "")}</span>
      <span class="payment-pill payment-${escapeAttr(order.paymentStatus)}" data-role="payment-pill">${escapeHtml(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</span>
      <span class="order-total">${formatPeso(order.total)}</span>
    </div>

    <div class="quick-actions">
      ${isCancelled ? "" : `
      <div class="quick-action-row">
        <label class="quick-label" for="status-${escapeAttr(order.id)}">Status</label>
        <select class="quick-select" data-role="status-select" id="status-${escapeAttr(order.id)}"></select>
        <button type="button" class="btn-quiet" data-action="update-status">Update</button>
      </div>
      `}
      <div class="quick-action-row">
        <label class="quick-label" for="payment-${escapeAttr(order.id)}">Payment</label>
        <select class="quick-select" data-role="payment-select" id="payment-${escapeAttr(order.id)}">
          <option value="UNPAID">Unpaid</option>
          <option value="AWAITING_VERIFICATION">Awaiting Verification</option>
          <option value="PAID">Paid</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <button type="button" class="btn-quiet" data-action="update-payment">Update</button>
      </div>
      <p class="quick-action-msg save-status" data-role="quick-msg" hidden></p>
    </div>

    <div class="payment-review-box" data-role="payment-review" ${isAwaitingVerification ? "" : "hidden"}>
      <div class="payment-review-top">
        <span>${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "")}</span>
        <span class="payment-pill payment-AWAITING_VERIFICATION">Awaiting Verification</span>
      </div>
      <div class="reference-row">
        <span class="info-label">Ref:</span>
        <span class="reference-value" data-role="reference-value">${escapeHtml(order.paymentReference || "—")}</span>
        ${order.paymentReference ? `<button type="button" class="copy-btn" data-action="copy-reference">Copy</button>` : ""}
      </div>
      <div class="payment-review-meta">
        <span>Total: ${formatPeso(order.total)}</span>
        <span>${order.paymentProofPath ? "Proof: Uploaded" : "Proof: Not uploaded"}</span>
      </div>
      <div class="payment-warnings" data-role="payment-warnings">${buildWarningBadges(order)}</div>
      <div class="payment-review-actions">
        <button type="button" class="btn-quiet" data-action="view-proof" ${order.paymentProofPath ? "" : "disabled"}>View Proof</button>
        <button type="button" class="btn-success" data-action="mark-paid">Mark Paid</button>
      </div>
      <p class="quick-action-msg save-status" data-role="review-msg" hidden></p>
    </div>

    <div class="order-card-actions">
      <a href="order.html?id=${encodeURIComponent(order.id)}" class="btn-quiet">View Details</a>
      ${isCancelled || isCompleted ? "" : `<button type="button" class="btn-danger" data-action="cancel">Cancel</button>`}
    </div>
  `;

  if (!isCancelled) {
    const statusSelect = card.querySelector('[data-role="status-select"]');
    const options = getQuickStatusOptions(order.fulfillmentMethod);
    statusSelect.innerHTML = options
      .map((value) => `<option value="${value}">${escapeHtml(ORDER_STATUS_LABELS[value] || value)}</option>`)
      .join("");
    // The order's current status may briefly not be in the quick list right
    // after a fulfillment-incompatible status existed historically — guard
    // rather than leave the select on an unintended default.
    statusSelect.value = options.includes(order.orderStatus) ? order.orderStatus : options[0];

    const shortcut = getStatusShortcut(order);
    if (shortcut) {
      const shortcutBtn = document.createElement("button");
      shortcutBtn.type = "button";
      shortcutBtn.className = "btn-primary-sm quick-shortcut-btn";
      shortcutBtn.dataset.action = "shortcut-status";
      shortcutBtn.dataset.target = shortcut.next;
      shortcutBtn.textContent = shortcut.label;
      card.querySelector(".quick-action-row").appendChild(shortcutBtn);
    }
  }

  // Payment status is independent of order status (see update-payment-status.js)
  // and stays editable even on a cancelled order — e.g. marking REFUNDED
  // after cancelling an order that had already been paid.
  card.querySelector('[data-role="payment-select"]').value = order.paymentStatus;

  wireCardActions(card, order);

  return card;
}

function buildWarningBadges(order) {
  const warnings = [];
  if (order.duplicatePaymentReference) warnings.push("DUPLICATE REFERENCE");
  if (order.paymentAmountMismatch) warnings.push("AMOUNT MISMATCH");
  if (order.paymentReferenceDetected && Number(order.paymentReferenceConfidence) < 0.5) warnings.push("OCR LOW CONFIDENCE");
  return warnings.map((w) => `<span class="warning-badge">${escapeHtml(w)}</span>`).join("");
}

/* ---------- Per-card quick-action wiring ---------- */
// Every handler here only ever touches ITS OWN card's controls while a
// request is in flight (spec: don't disable the whole page) and only
// mutates `loadedOrders` + re-renders on confirmed backend success — a
// failure leaves the card exactly as it was, with an inline error message.

function setButtonsBusy(buttons, busy) {
  buttons.forEach((btn) => { btn.disabled = busy; });
}

// `scopeEl` is the specific container that owns the message element being
// targeted — `.quick-actions` for status/payment-select updates, or
// `.payment-review-box` for Mark Paid — so a Mark Paid error always shows
// inside the review box, never in the unrelated quick-actions row above it.
function showCardMessage(scopeEl, message, variant) {
  const msgEl = scopeEl.querySelector('[data-role="quick-msg"], [data-role="review-msg"]');
  if (!msgEl) return;
  msgEl.hidden = false;
  msgEl.textContent = message;
  msgEl.classList.remove("is-error", "is-success");
  if (variant) msgEl.classList.add(variant);
}

// Applies a confirmed backend change to local state and re-renders from
// that state — never a network refetch, never a full page reload. This is
// also what lets a now-filtered-out card (e.g. Awaiting Verification ->
// Paid while that filter is active) disappear automatically.
function applyOrderPatch(orderId, patch) {
  const order = loadedOrders.find((o) => o.id === orderId);
  if (!order) return;
  Object.assign(order, patch);
  render();
}

function wireCardActions(card, order) {
  const quickActionsEl = card.querySelector(".quick-actions");
  const reviewBoxEl = card.querySelector('[data-role="payment-review"]');

  const updateStatusBtn = card.querySelector('[data-action="update-status"]');
  const statusSelect = card.querySelector('[data-role="status-select"]');
  const shortcutBtn = card.querySelector('[data-action="shortcut-status"]');

  if (updateStatusBtn && statusSelect) {
    updateStatusBtn.addEventListener("click", async () => {
      const buttons = [updateStatusBtn, shortcutBtn].filter(Boolean);
      setButtonsBusy(buttons, true);
      showCardMessage(quickActionsEl, "Updating…");

      const { ok, result } = await updateOrderStatus(order.id, statusSelect.value);

      if (!ok) {
        setButtonsBusy(buttons, false);
        showCardMessage(quickActionsEl, (result && result.message) || "This order could not be updated.", "is-error");
        return;
      }

      applyOrderPatch(order.id, { orderStatus: result.orderStatus });
    });
  }

  if (shortcutBtn) {
    shortcutBtn.addEventListener("click", async () => {
      const buttons = [updateStatusBtn, shortcutBtn].filter(Boolean);
      setButtonsBusy(buttons, true);
      showCardMessage(quickActionsEl, "Updating…");

      const { ok, result } = await updateOrderStatus(order.id, shortcutBtn.dataset.target);

      if (!ok) {
        setButtonsBusy(buttons, false);
        showCardMessage(quickActionsEl, (result && result.message) || "This order could not be updated.", "is-error");
        return;
      }

      applyOrderPatch(order.id, { orderStatus: result.orderStatus });
    });
  }

  const updatePaymentBtn = card.querySelector('[data-action="update-payment"]');
  const paymentSelect = card.querySelector('[data-role="payment-select"]');
  if (updatePaymentBtn && paymentSelect) {
    updatePaymentBtn.addEventListener("click", async () => {
      setButtonsBusy([updatePaymentBtn], true);
      showCardMessage(quickActionsEl, "Updating…");

      const { ok, result } = await updatePaymentStatus(order.id, paymentSelect.value);

      if (!ok) {
        setButtonsBusy([updatePaymentBtn], false);
        showCardMessage(quickActionsEl, (result && result.message) || "This order could not be updated.", "is-error");
        return;
      }

      applyOrderPatch(order.id, { paymentStatus: result.paymentStatus });
    });
  }

  const markPaidBtn = card.querySelector('[data-action="mark-paid"]');
  if (markPaidBtn) {
    markPaidBtn.addEventListener("click", async () => {
      const viewProofBtn = card.querySelector('[data-action="view-proof"]');
      const buttons = [markPaidBtn, viewProofBtn].filter(Boolean);
      setButtonsBusy(buttons, true);
      showCardMessage(reviewBoxEl, "Marking paid…");

      const { ok, result } = await updatePaymentStatus(order.id, "PAID");

      if (!ok) {
        setButtonsBusy(buttons, false);
        showCardMessage(reviewBoxEl, (result && result.message) || "Could not mark this order paid.", "is-error");
        return;
      }

      applyOrderPatch(order.id, { paymentStatus: result.paymentStatus });
    });
  }

  const viewProofBtn = card.querySelector('[data-action="view-proof"]');
  if (viewProofBtn) {
    viewProofBtn.addEventListener("click", () => openProofModal(order));
  }

  const copyBtn = card.querySelector('[data-action="copy-reference"]');
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(order.paymentReference || "");
        const original = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch (err) {
        // Clipboard API unavailable/denied — the reference is already
        // visible and selectable on the card, so this is a soft failure.
      }
    });
  }

  const cancelBtn = card.querySelector('[data-action="cancel"]');
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      showConfirmModal({
        title: `Cancel order ${order.orderNumber || order.id}?`,
        body: "Inventory reserved for this order will be returned.",
        confirmLabel: "CANCEL ORDER",
        cancelLabel: "KEEP ORDER",
        onConfirm: async () => {
          setButtonsBusy([cancelBtn], true);
          if (quickActionsEl) showCardMessage(quickActionsEl, "Cancelling…");

          const { ok, result } = await cancelOrder(order.id);

          if (!ok) {
            setButtonsBusy([cancelBtn], false);
            if (quickActionsEl) showCardMessage(quickActionsEl, (result && result.message) || "This order could not be cancelled.", "is-error");
            return;
          }

          applyOrderPatch(order.id, { orderStatus: result.orderStatus });
        },
      });
    });
  }
}

/* ---------- Confirm modal (shared by Cancel, same pattern as order.js) ---------- */

function showConfirmModal({ title, body, confirmLabel, cancelLabel, onConfirm }) {
  confirmModalTitle.textContent = title;
  confirmModalBody.textContent = body;
  confirmModalConfirmBtn.textContent = confirmLabel;
  confirmModalCancelBtn.textContent = cancelLabel;
  confirmModal.hidden = false;

  function cleanup() {
    confirmModal.hidden = true;
    confirmModalConfirmBtn.removeEventListener("click", onConfirmClick);
    confirmModalCancelBtn.removeEventListener("click", onCancelClick);
  }
  function onConfirmClick() {
    cleanup();
    onConfirm();
  }
  function onCancelClick() {
    cleanup();
  }

  confirmModalConfirmBtn.addEventListener("click", onConfirmClick);
  confirmModalCancelBtn.addEventListener("click", onCancelClick);
}

/* ---------- View Proof modal ----------
   Fetches a fresh short-lived signed URL only when actually opened — never
   preloaded for every card on the list (see get-payment-proof.js). Stays
   on the Orders page the whole time; never navigates away. */

async function openProofModal(order) {
  proofModalOrderId = order.id;
  proofModalTitle.textContent = `Payment Proof — ${order.orderNumber || order.id}`;
  proofModalImageWrap.hidden = true;
  proofModalImage.src = "";
  proofModalMsg.textContent = "Loading…";
  proofModalMsg.classList.remove("is-error");
  proofModal.hidden = false;

  const { ok, result } = await getPaymentProof(order.id);

  // The admin may have closed this modal (or opened a different order's)
  // before the signed URL came back — never let a stale response paint
  // over whatever's open now.
  if (proofModalOrderId !== order.id) return;

  if (!ok) {
    proofModalMsg.textContent = (result && result.message) || "We couldn't load the payment proof.";
    proofModalMsg.classList.add("is-error");
    return;
  }

  proofModalMsg.textContent = `Link valid for ${result.expiresInMinutes} minutes.`;
  proofModalImage.src = result.url;
  proofModalImageWrap.hidden = false;
}

function closeProofModal() {
  proofModalOrderId = null;
  proofModal.hidden = true;
  proofModalImage.src = "";
}

proofModalCloseBtn.addEventListener("click", closeProofModal);

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

[searchInput].forEach((el) => el.addEventListener("input", render));
[statusFilter, fulfillmentFilter, paymentFilter, testFilter, deliveryAreaFilter].forEach((el) => el.addEventListener("change", render));

sortSelect.addEventListener("change", () => {
  sortDirection = sortSelect.value;
  loadPage(true);
});

loadMoreBtn.addEventListener("click", () => loadPage(false));

/* ---------- Export ---------- */
// Deliberately queries the backend/Firestore directly (see export-actions.js
// -> export-orders.js) rather than exporting `loadedOrders` — the admin may
// only have paginated in the most recent 50, but export must cover the
// full requested date range regardless of what's currently on screen.

function resetExportStatus() {
  exportStatus.hidden = true;
  exportStatus.textContent = "";
  exportStatus.classList.remove("is-error", "is-success");
}

function openExportModal() {
  resetExportStatus();
  exportModal.hidden = false;
}

function closeExportModal() {
  exportModal.hidden = true;
}

function collectExportFilters() {
  const filters = {
    datePreset: exportDatePreset.value,
    orderType: exportOrderType.value,
  };

  if (exportDatePreset.value === "custom") {
    filters.dateFrom = exportDateFrom.value;
    filters.dateTo = exportDateTo.value;
  }

  if (exportOrderStatus.value !== "all") filters.orderStatus = exportOrderStatus.value;
  if (exportPaymentStatus.value !== "all") filters.paymentStatus = exportPaymentStatus.value;
  if (exportFulfillment.value !== "all") filters.fulfillment = exportFulfillment.value;
  if (exportPaymentMethod.value !== "all") filters.paymentMethod = exportPaymentMethod.value;
  if (exportDeliveryArea.value !== "all") filters.deliveryArea = exportDeliveryArea.value;

  return filters;
}

async function runExport(format) {
  downloadCsvBtn.disabled = true;
  downloadExcelBtn.disabled = true;
  exportStatus.hidden = false;
  exportStatus.textContent = "Preparing export…";
  exportStatus.classList.remove("is-error", "is-success");

  const result = await requestOrdersExport(collectExportFilters(), format);

  downloadCsvBtn.disabled = false;
  downloadExcelBtn.disabled = false;

  if (!result.ok) {
    exportStatus.textContent = result.message || "Export could not be generated. Please try again.";
    exportStatus.classList.add("is-error");
    return;
  }

  if (result.empty) {
    exportStatus.textContent = result.message || "No orders matched the selected filters.";
    return;
  }

  downloadBlob(result.blob, result.filename);
  exportStatus.textContent = "Export downloaded.";
  exportStatus.classList.add("is-success");
}

exportBtn.addEventListener("click", openExportModal);
exportCancelBtn.addEventListener("click", closeExportModal);

exportDatePreset.addEventListener("change", () => {
  exportCustomDates.hidden = exportDatePreset.value !== "custom";
});

downloadCsvBtn.addEventListener("click", () => runExport("csv"));
downloadExcelBtn.addEventListener("click", () => runExport("xlsx"));
