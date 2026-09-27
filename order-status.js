// Customer order tracking — no account, no login. Both order number AND
// mobile number must match (verified entirely server-side by
// get-order-status.js); this page never learns which field was wrong on a
// failed lookup, matching the backend's deliberately generic response.
//
// Nothing about the lookup is persisted client-side (no sessionStorage) —
// refreshing this page always returns to the plain lookup form, which is
// the intended behavior: this page must work even when a customer arrives
// with nothing but their order number and phone, days after the original
// checkout tab is long gone.
//
// The payment-resume flow reuses the EXACT same upload/OCR/confirm module
// as the just-placed-order confirmation page — see payment-proof-ui.js —
// via a freshly issued token from resume-payment.js.

import { initPaymentProofUI, formatPeso, formatPaymentMethod } from "./payment-proof-ui.js";

const STATUS_DESCRIPTIONS = {
  PENDING: "Order received",
  CONFIRMED: "Order confirmed",
  PREPARING: "Your Hayst Kopi is being prepared",
  READY_FOR_PICKUP: "Ready for pickup",
  OUT_FOR_DELIVERY: "Your order is on the way",
  COMPLETED: "Order completed",
  CANCELLED: "Order cancelled",
};

const PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  AWAITING_VERIFICATION: "Awaiting Verification",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

const PAYMENT_STATUS_EXPLANATIONS = {
  UNPAID: "Payment has not been submitted yet.",
  AWAITING_VERIFICATION: "We received your payment proof and are checking it.",
  PAID: "Payment confirmed.",
  REFUNDED: "Payment refunded.",
};

const PROOF_REQUIRED_METHODS = ["gcash", "bank-transfer"];

const lookupSection = document.getElementById("lookupSection");
const resultSection = document.getElementById("resultSection");
const lookupForm = document.getElementById("lookupForm");
const lookupOrderNumberInput = document.getElementById("lookupOrderNumber");
const lookupPhoneInput = document.getElementById("lookupPhone");
const lookupBtn = document.getElementById("lookupBtn");
const lookupMessage = document.getElementById("lookupMessage");

let currentOrderNumber = "";
let currentPhone = "";

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const prefillOrder = params.get("order");
  if (prefillOrder) lookupOrderNumberInput.value = prefillOrder;
});

function setMessage(el, message, isError) {
  el.textContent = message;
  el.hidden = !message;
  el.classList.toggle("is-error", Boolean(isError));
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const orderNumber = lookupOrderNumberInput.value.trim();
  const phone = lookupPhoneInput.value.trim();

  setMessage(lookupMessage, "", false);

  if (!orderNumber || !phone) {
    setMessage(lookupMessage, "Please enter your order number and mobile number.", true);
    return;
  }

  lookupBtn.disabled = true;
  lookupBtn.textContent = "Looking up…";

  let response;
  let result;
  try {
    response = await fetch("/.netlify/functions/get-order-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber, phone }),
    });
    result = await response.json();
  } catch (err) {
    lookupBtn.disabled = false;
    lookupBtn.textContent = "Track Order";
    setMessage(lookupMessage, "We couldn't reach our servers. Please check your connection and try again.", true);
    return;
  }

  lookupBtn.disabled = false;
  lookupBtn.textContent = "Track Order";

  if (!response.ok || !result || !result.success || !result.found) {
    setMessage(lookupMessage, (result && result.message) || "We couldn't find an order matching those details.", true);
    return;
  }

  currentOrderNumber = orderNumber;
  currentPhone = phone;

  renderOrder(result.order);
  lookupSection.hidden = true;
  resultSection.hidden = false;
});

document.getElementById("trackAnotherBtn").addEventListener("click", () => {
  resultSection.hidden = true;
  lookupSection.hidden = false;
  lookupOrderNumberInput.value = "";
  lookupPhoneInput.value = "";
  setMessage(lookupMessage, "", false);
});

function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatFulfillment(value) {
  return value === "delivery" ? "Delivery" : "Pickup";
}

const DELIVERY_AREA_LABELS = {
  rosewood: "Rosewood",
  acacia: "Acacia Estates",
  external: "Outside Acacia Estates",
};

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

function renderOrder(order) {
  const firstItem = (order.items || [])[0] || {};

  document.getElementById("rsOrderNumber").textContent = order.orderNumber;
  document.getElementById("rsOrderDate").textContent = formatDateTime(order.createdAt);
  document.getElementById("rsTestBadge").hidden = !order.isTest;

  document.getElementById("rsCurrentStatus").textContent = order.orderStatus;
  document.getElementById("rsCurrentStatusDesc").textContent = STATUS_DESCRIPTIONS[order.orderStatus] || "";

  renderTimeline(order.statusHistory);

  document.getElementById("rsProductImage").src = firstItem.image || "";
  document.getElementById("rsProductName").textContent = firstItem.name || "";
  document.getElementById("rsProductBottle").textContent = firstItem.bottleSize || "";
  document.getElementById("rsQuantity").textContent = String(firstItem.quantity || 0);
  document.getElementById("rsUnitPrice").textContent = formatPeso(firstItem.price);

  document.getElementById("rsSubtotal").textContent = formatPeso(order.subtotal);
  document.getElementById("rsDeliveryFee").textContent = formatPeso(order.deliveryFee);
  document.getElementById("rsTotal").textContent = formatPeso(order.total);

  document.getElementById("rsFulfillment").textContent = formatFulfillment(order.fulfillmentMethod);
  const deliveryFields = document.getElementById("rsDeliveryFields");
  if (order.fulfillmentMethod === "delivery") {
    deliveryFields.hidden = false;
    document.getElementById("rsDeliveryArea").textContent = DELIVERY_AREA_LABELS[order.deliveryArea] || order.deliveryArea || "";
    document.getElementById("rsDeliveryAddress").textContent = formatDeliveryAddress(order.deliveryArea, order.deliveryAddress);
    document.getElementById("rsDistance").textContent = order.deliveryDistanceKm != null ? `${order.deliveryDistanceKm} km` : "—";
  } else {
    deliveryFields.hidden = true;
  }

  renderPaymentCard(order);
}

function renderTimeline(statusHistory) {
  const container = document.getElementById("statusTimeline");
  const history = Array.isArray(statusHistory) ? statusHistory : [];

  if (history.length === 0) {
    container.innerHTML = '<p class="readonly-value">No status updates yet.</p>';
    return;
  }

  container.innerHTML = history
    .map((entry) => `
      <div class="timeline-entry ${entry.status === "CANCELLED" ? "is-cancelled" : ""}">
        <span class="timeline-dot"></span>
        <div>
          <div class="timeline-status">${escapeHtml(entry.status)}</div>
          <div class="timeline-desc">${escapeHtml(STATUS_DESCRIPTIONS[entry.status] || "")}</div>
          <div class="timeline-date">${escapeHtml(formatDateTime(entry.at))}</div>
        </div>
      </div>
    `)
    .join("");
}

function renderPaymentCard(order) {
  document.getElementById("rsPaymentMethod").textContent = formatPaymentMethod(order.paymentMethod);
  document.getElementById("rsPaymentStatus").textContent = PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus;
  document.getElementById("rsPaymentReference").textContent = order.paymentReference || "—";

  const resumeBtn = document.getElementById("resumePaymentBtn");
  const explanationEl = document.getElementById("rsPaymentExplanation");
  const paymentSection = document.getElementById("paymentSection");

  resumeBtn.hidden = true;
  paymentSection.hidden = true;
  setMessage(document.getElementById("resumeMessage"), "", false);

  if (order.orderStatus === "CANCELLED") {
    explanationEl.textContent = "This order has been cancelled. No payment is required.";
    return;
  }

  if (!PROOF_REQUIRED_METHODS.includes(order.paymentMethod)) {
    explanationEl.textContent = order.fulfillmentMethod === "delivery"
      ? "Pay when your order is delivered."
      : "Pay upon pickup.";
    return;
  }

  explanationEl.textContent = PAYMENT_STATUS_EXPLANATIONS[order.paymentStatus] || "";

  if (order.paymentStatus === "UNPAID") {
    resumeBtn.hidden = false;
    resumeBtn.textContent = "Complete Payment";
  } else if (order.paymentStatus === "AWAITING_VERIFICATION") {
    resumeBtn.hidden = false;
    resumeBtn.textContent = "Replace Payment Proof";
  }
  // PAID / REFUNDED: no button — backend enforces this regardless of
  // whether this button is ever shown.
}

document.getElementById("resumePaymentBtn").addEventListener("click", async () => {
  const btn = document.getElementById("resumePaymentBtn");
  const msgEl = document.getElementById("resumeMessage");

  btn.disabled = true;
  setMessage(msgEl, "Preparing payment…", false);

  let response;
  let result;
  try {
    response = await fetch("/.netlify/functions/resume-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: currentOrderNumber, phone: currentPhone }),
    });
    result = await response.json();
  } catch (err) {
    btn.disabled = false;
    setMessage(msgEl, "We couldn't reach our servers. Please check your connection and try again.", true);
    return;
  }

  btn.disabled = false;

  if (!response.ok || !result || !result.success) {
    setMessage(msgEl, (result && result.message) || "We couldn't set up your payment right now. Please try again.", true);
    return;
  }

  setMessage(msgEl, "", false);

  initPaymentProofUI({
    orderId: result.orderId,
    uploadToken: result.paymentUploadToken,
    total: result.amountDue,
    paymentMethod: result.paymentMethod,
    paymentInstructions: result.paymentInstructions,
    onConfirmed: () => {
      document.getElementById("rsPaymentStatus").textContent = PAYMENT_STATUS_LABELS.AWAITING_VERIFICATION;
      document.getElementById("rsPaymentExplanation").textContent = PAYMENT_STATUS_EXPLANATIONS.AWAITING_VERIFICATION;
    },
  });
});

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
