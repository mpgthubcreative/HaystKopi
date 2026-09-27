// Order confirmation — reads ONLY the safe fields create-order.js returned,
// handed off via sessionStorage right before the redirect from checkout.js.
// Makes zero Firestore/network calls itself: this page must not require
// making all orders publicly readable just to show one customer their own
// just-placed order. Refreshing this page re-reads the same sessionStorage
// entry — it never re-creates or re-fetches anything.
//
// The payment-proof upload/OCR/confirm flow (GCash/Bank Transfer orders
// only) is the SAME shared module order-status.js uses for a resumed
// payment later — see payment-proof-ui.js.

import { initPaymentProofUI, formatPeso, formatPaymentMethod } from "./payment-proof-ui.js";

document.addEventListener("DOMContentLoaded", () => {
  const emptyEl = document.getElementById("confirmationEmpty");
  const contentEl = document.getElementById("confirmationContent");

  const raw = sessionStorage.getItem("lastOrderConfirmation");
  const data = raw ? safeParse(raw) : null;

  if (!data || !data.orderNumber) {
    emptyEl.hidden = false;
    return;
  }

  document.getElementById("confCustomerName").textContent = data.customerName || "";
  document.getElementById("confOrderNumber").textContent = data.orderNumber;
  document.getElementById("confProduct").textContent = data.productName || "";
  document.getElementById("confQuantity").textContent = String(data.quantity ?? "");
  document.getElementById("confTotal").textContent = formatPeso(data.total);
  document.getElementById("confFulfillment").textContent = formatFulfillment(data.fulfillmentMethod);
  document.getElementById("confPayment").textContent = formatPaymentMethod(data.paymentMethod);
  document.getElementById("confStatus").textContent = data.orderStatus || "PENDING";

  const trackLink = document.getElementById("trackOrderLink");
  if (trackLink) trackLink.href = `order-status.html?order=${encodeURIComponent(data.orderNumber)}`;

  contentEl.hidden = false;

  if (data.paymentUploadToken) {
    initPaymentProofUI({
      orderId: data.orderId,
      uploadToken: data.paymentUploadToken,
      total: data.total,
      paymentMethod: data.paymentMethod,
      paymentInstructions: data.paymentInstructions,
      onConfirmed: () => {
        document.getElementById("confStatus").textContent = "PENDING";
      },
    });
  }
});

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function formatFulfillment(value) {
  return value === "delivery" ? "Delivery" : "Pickup";
}
