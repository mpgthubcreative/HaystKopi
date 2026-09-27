// Order details admin page — accessible to OWNER and ADMIN (Delete Order
// and the Test/Live flag are OWNER-only, hidden here for ADMIN and rejected
// server-side regardless of what the UI shows — see order-actions.js and
// the corresponding Netlify Functions).

import { fetchOrderById, orderStatusOptionsForFulfillment, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, DELIVERY_AREA_LABELS, PAYMENT_METHOD_LABELS } from "../firebase/orders-helpers.js";
import { updateOrderStatus, updatePaymentStatus, updateOrderNotes, updateOrderTestFlag, cancelOrder, deleteOrder, getPaymentProof } from "./order-actions.js";

const stateEl = document.getElementById("orderState");
const contentEl = document.getElementById("orderContent");

let orderId = null;
let order = null;
let isOwner = false;

document.addEventListener("admin:ready", async (event) => {
  isOwner = event.detail.profile.role === "owner";

  const params = new URLSearchParams(window.location.search);
  orderId = params.get("id");

  if (!orderId) {
    stateEl.textContent = "No order specified.";
    stateEl.classList.add("is-error");
    return;
  }

  await loadOrder();
});

async function loadOrder() {
  stateEl.textContent = "Loading order…";
  stateEl.hidden = false;
  stateEl.classList.remove("is-error");
  contentEl.hidden = true;

  try {
    order = await fetchOrderById(orderId);
  } catch (err) {
    stateEl.textContent = "We couldn't load this order right now. Please refresh the page.";
    stateEl.classList.add("is-error");
    return;
  }

  if (!order) {
    stateEl.textContent = "That order doesn't exist.";
    stateEl.classList.add("is-error");
    return;
  }

  stateEl.hidden = true;
  contentEl.hidden = false;
  render();
}

function formatDateTime(timestamp) {
  if (!timestamp) return "";
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatPeso(amount) {
  return `₱${Number(amount || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render() {
  const firstItem = (order.items || [])[0] || {};

  document.getElementById("odOrderNumber").textContent = order.orderNumber || order.id;
  document.getElementById("odDate").textContent = formatDateTime(order.createdAt);

  const testBadge = document.getElementById("odTestBadge");
  testBadge.textContent = order.isTest ? "TEST" : "LIVE";
  testBadge.className = `badge ${order.isTest ? "badge-test" : "badge-live"}`;

  const statusPill = document.getElementById("odStatusPill");
  statusPill.textContent = ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus;
  statusPill.className = `status-pill status-${order.orderStatus}`;

  const paymentPill = document.getElementById("odPaymentPill");
  paymentPill.textContent = PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus;
  paymentPill.className = `payment-pill payment-${order.paymentStatus}`;

  document.getElementById("odCustomerName").textContent = order.customerName || "";
  document.getElementById("odPhone").textContent = order.phone || "";
  document.getElementById("odEmail").textContent = order.email || "—";

  document.getElementById("odProductImage").src = firstItem.image || "";
  document.getElementById("odProductName").textContent = firstItem.name || "";
  document.getElementById("odBottleSize").textContent = firstItem.bottleSize || "";
  document.getElementById("odQuantity").textContent = String(firstItem.quantity || 0);
  // Historical price integrity: always the STORED item snapshot, never a
  // fresh product lookup — if the live price changes later, this order
  // must keep showing what the customer actually paid.
  document.getElementById("odUnitPrice").textContent = formatPeso(firstItem.price);
  document.getElementById("odSubtotal").textContent = formatPeso(order.subtotal);

  document.getElementById("odFulfillment").textContent = order.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup";

  const deliveryFields = document.getElementById("odDeliveryFields");
  if (order.fulfillmentMethod === "delivery") {
    deliveryFields.hidden = false;
    document.getElementById("odDeliveryArea").textContent = DELIVERY_AREA_LABELS[order.deliveryArea] || order.deliveryArea || "";
    document.getElementById("odDeliveryAddress").textContent = formatDeliveryAddress(order.deliveryArea, order.deliveryAddress);
    document.getElementById("odDistance").textContent = order.deliveryDistanceKm != null ? `${order.deliveryDistanceKm} km` : "—";
    document.getElementById("odDeliveryFee").textContent = formatPeso(order.deliveryFee);
    document.getElementById("odPricingType").textContent = order.deliveryPricingType || "—";
    document.getElementById("odPricingSnapshot").textContent = formatPricingSnapshot(order.deliveryPricingType, order.deliveryPricingSnapshot);
  } else {
    deliveryFields.hidden = true;
  }

  document.getElementById("odPaymentMethod").textContent = PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "";
  document.getElementById("odPaymentStatusText").textContent = PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus;
  document.getElementById("odPaymentReference").textContent = order.paymentReference || "—";
  document.getElementById("paymentStatusSelect").value = order.paymentStatus;

  renderPaymentProofFields();

  document.getElementById("odTotalsSubtotal").textContent = formatPeso(order.subtotal);
  document.getElementById("odTotalsDeliveryFee").textContent = formatPeso(order.deliveryFee);
  document.getElementById("odGrandTotal").textContent = formatPeso(order.total);

  renderOrderStatusSelect();

  document.getElementById("odCustomerNotes").textContent = order.customerNotes || "—";
  document.getElementById("adminNotesInput").value = order.adminNotes || "";

  renderStatusHistory();

  document.getElementById("testFlagSection").hidden = !isOwner;
  document.getElementById("deleteOrderBtn").hidden = !isOwner;

  const isTerminalCancelled = order.orderStatus === "CANCELLED";
  const isTerminalCompleted = order.orderStatus === "COMPLETED";
  const cancelBtn = document.getElementById("cancelOrderBtn");
  cancelBtn.hidden = isTerminalCancelled || isTerminalCompleted;
}

function formatDeliveryAddress(area, address) {
  if (!address) return "";
  if (area === "rosewood") {
    return [address.building, address.unitNumber && `Unit ${address.unitNumber}`].filter(Boolean).join(", ");
  }
  if (area === "acacia") {
    return [address.addressLine, address.barangay].filter(Boolean).join(", ");
  }
  return [address.addressLine, address.barangay, address.city].filter(Boolean).join(", ");
}

function formatPricingSnapshot(pricingType, snapshot) {
  if (!snapshot) return "—";
  if (pricingType === "distance") {
    return `${snapshot.minKm}–${snapshot.maxKm} km bracket, ${formatPeso(snapshot.fee)}`;
  }
  return formatPeso(snapshot.fee);
}

function renderOrderStatusSelect() {
  const select = document.getElementById("orderStatusSelect");
  const options = orderStatusOptionsForFulfillment(order.fulfillmentMethod);
  select.innerHTML = options
    .map((value) => `<option value="${value}">${escapeHtml(ORDER_STATUS_LABELS[value] || value)}</option>`)
    .join("");
  // CANCELLED is handled exclusively through the Cancel Order action below,
  // never through this dropdown (see update-order-status.js).
  select.value = order.orderStatus === "CANCELLED" ? options[0] : order.orderStatus;
}

function renderStatusHistory() {
  const container = document.getElementById("odStatusHistory");
  const history = Array.isArray(order.statusHistory) ? [...order.statusHistory].reverse() : [];

  if (history.length === 0) {
    container.innerHTML = '<p class="readonly-value">No status history yet.</p>';
    return;
  }

  container.innerHTML = history
    .map((entry) => `
      <div class="status-history-entry">
        <div class="status-history-top">
          <span class="status-pill status-${escapeHtml(entry.status)}">${escapeHtml(ORDER_STATUS_LABELS[entry.status] || entry.status)}</span>
          <span class="status-history-date">${escapeHtml(formatDateTime(entry.at))}</span>
        </div>
        <div class="status-history-note">${escapeHtml(entry.note || "")}${entry.updatedByName ? ` — ${escapeHtml(entry.updatedByName)}` : ""}</div>
      </div>
    `)
    .join("");
}

function renderPaymentProofFields() {
  const proofFields = document.getElementById("odProofFields");
  const proofRequired = order.paymentMethod === "gcash" || order.paymentMethod === "bank-transfer";

  if (!proofRequired || !order.paymentProofPath) {
    proofFields.hidden = true;
    return;
  }

  proofFields.hidden = false;

  document.getElementById("odOcrReference").textContent = order.paymentReferenceDetected || "—";
  document.getElementById("odConfirmedReference").textContent = order.paymentReference
    ? `${order.paymentReference}${order.paymentReferenceSource ? ` (${order.paymentReferenceSource})` : ""}`
    : "Not yet confirmed by customer";
  document.getElementById("odOcrAmount").textContent = order.ocrDetectedAmount != null ? formatPeso(order.ocrDetectedAmount) : "—";
  document.getElementById("odOcrOrderTotal").textContent = formatPeso(order.total);

  const warningsEl = document.getElementById("odPaymentWarnings");
  const warnings = [];
  if (order.duplicatePaymentReference) warnings.push("REFERENCE DUPLICATE");
  if (order.paymentAmountMismatch) warnings.push("AMOUNT MISMATCH");
  if (order.paymentReferenceDetected && Number(order.paymentReferenceConfidence) < 0.5) warnings.push("OCR LOW CONFIDENCE");
  warningsEl.innerHTML = warnings.map((w) => `<span class="warning-badge">${escapeHtml(w)}</span>`).join("");

  // Reset the preview each render — a stale signed URL from a previous
  // order/view must never linger on screen.
  document.getElementById("proofPreview").hidden = true;
  document.getElementById("proofPreviewImg").src = "";
  document.getElementById("proofViewMsg").textContent = "";
}

document.getElementById("viewProofBtn").addEventListener("click", async () => {
  const btn = document.getElementById("viewProofBtn");
  const msgEl = document.getElementById("proofViewMsg");
  const previewEl = document.getElementById("proofPreview");
  const previewImg = document.getElementById("proofPreviewImg");

  btn.disabled = true;
  msgEl.textContent = "Loading…";
  msgEl.classList.remove("is-error");

  const { ok, result } = await getPaymentProof(orderId);

  btn.disabled = false;

  if (!ok) {
    msgEl.textContent = (result && result.message) || "We couldn't load the payment proof.";
    msgEl.classList.add("is-error");
    return;
  }

  msgEl.textContent = `Link valid for ${result.expiresInMinutes} minutes.`;
  previewImg.src = result.url;
  previewEl.hidden = false;
});

/* ---------- Confirm modal (shared by Cancel + Delete) ---------- */

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalBody = document.getElementById("confirmModalBody");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalConfirmBtn = document.getElementById("confirmModalConfirmBtn");

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

/* ---------- Action wiring ---------- */

function setButtonsBusy(buttons, busy) {
  buttons.forEach((btn) => { btn.disabled = busy; });
}

function showSaveMessage(el, message, isError) {
  el.textContent = message;
  el.classList.toggle("is-error", Boolean(isError));
}

document.getElementById("saveOrderStatusBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveOrderStatusBtn");
  const select = document.getElementById("orderStatusSelect");
  const msgEl = document.getElementById("orderStatusSaveMsg");

  setButtonsBusy([btn], true);
  showSaveMessage(msgEl, "Saving…", false);

  const { ok, result } = await updateOrderStatus(orderId, select.value);

  setButtonsBusy([btn], false);

  if (!ok) {
    showSaveMessage(msgEl, (result && result.message) || "Order could not be updated.", true);
    return;
  }

  showSaveMessage(msgEl, "Updated.", false);
  await loadOrder();
});

document.getElementById("savePaymentStatusBtn").addEventListener("click", async () => {
  const btn = document.getElementById("savePaymentStatusBtn");
  const select = document.getElementById("paymentStatusSelect");
  const msgEl = document.getElementById("paymentStatusSaveMsg");

  setButtonsBusy([btn], true);
  showSaveMessage(msgEl, "Saving…", false);

  const { ok, result } = await updatePaymentStatus(orderId, select.value);

  setButtonsBusy([btn], false);

  if (!ok) {
    showSaveMessage(msgEl, (result && result.message) || "Order could not be updated.", true);
    return;
  }

  showSaveMessage(msgEl, "Updated.", false);
  await loadOrder();
});

document.getElementById("saveNotesBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveNotesBtn");
  const textarea = document.getElementById("adminNotesInput");
  const msgEl = document.getElementById("notesSaveMsg");

  setButtonsBusy([btn], true);
  showSaveMessage(msgEl, "Saving…", false);

  const { ok, result } = await updateOrderNotes(orderId, textarea.value);

  setButtonsBusy([btn], false);

  if (!ok) {
    showSaveMessage(msgEl, (result && result.message) || "Order could not be updated.", true);
    return;
  }

  showSaveMessage(msgEl, "Saved.", false);
  await loadOrder();
});

document.getElementById("markTestBtn").addEventListener("click", () => setTestFlag(true));
document.getElementById("markLiveBtn").addEventListener("click", () => setTestFlag(false));

async function setTestFlag(isTest) {
  const buttons = [document.getElementById("markTestBtn"), document.getElementById("markLiveBtn")];
  const msgEl = document.getElementById("testFlagSaveMsg");

  setButtonsBusy(buttons, true);
  showSaveMessage(msgEl, "Saving…", false);

  const { ok, result } = await updateOrderTestFlag(orderId, isTest);

  setButtonsBusy(buttons, false);

  if (!ok) {
    showSaveMessage(msgEl, (result && result.message) || "Order could not be updated.", true);
    return;
  }

  showSaveMessage(msgEl, "Updated.", false);
  await loadOrder();
}

document.getElementById("cancelOrderBtn").addEventListener("click", () => {
  showConfirmModal({
    title: `Cancel order ${order.orderNumber || order.id}?`,
    body: "Inventory reserved for this order will be returned.",
    confirmLabel: "CANCEL ORDER",
    cancelLabel: "KEEP ORDER",
    onConfirm: async () => {
      const btn = document.getElementById("cancelOrderBtn");
      const msgEl = document.getElementById("dangerActionMsg");

      setButtonsBusy([btn], true);
      showSaveMessage(msgEl, "Cancelling…", false);

      const { ok, result } = await cancelOrder(orderId);

      setButtonsBusy([btn], false);

      if (!ok) {
        showSaveMessage(msgEl, (result && result.message) || "This order could not be cancelled.", true);
        return;
      }

      showSaveMessage(msgEl, "Order cancelled.", false);
      await loadOrder();
    },
  });
});

document.getElementById("deleteOrderBtn").addEventListener("click", () => {
  showConfirmModal({
    title: `Permanently delete ${order.orderNumber || order.id}?`,
    body: "This action cannot be undone.",
    confirmLabel: "DELETE PERMANENTLY",
    cancelLabel: "Cancel",
    onConfirm: async () => {
      const btn = document.getElementById("deleteOrderBtn");
      const msgEl = document.getElementById("dangerActionMsg");

      setButtonsBusy([btn], true);
      showSaveMessage(msgEl, "Deleting…", false);

      const { ok, result } = await deleteOrder(orderId);

      if (!ok) {
        setButtonsBusy([btn], false);
        showSaveMessage(msgEl, (result && result.message) || "You don't have permission to delete this order.", true);
        return;
      }

      window.location.href = "orders.html";
    },
  });
});
