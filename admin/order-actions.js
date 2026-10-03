// Thin wrapper around the secure order-mutation Netlify Functions. Every
// call attaches the signed-in admin/owner's Firebase ID token — the
// backend re-derives role/status from Firestore itself (see
// netlify/functions/lib/authorize.js); nothing here is trusted client-side.

import { auth } from "../firebase/firebase-init.js";

async function callSecureEndpoint(path, body) {
  let idToken;
  try {
    idToken = await auth.currentUser.getIdToken();
  } catch (err) {
    return { ok: false, status: 401, result: { success: false, message: "Your session expired. Please sign in again." } };
  }

  let response;
  let result;
  try {
    response = await fetch(`/.netlify/functions/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    result = await response.json();
  } catch (err) {
    return { ok: false, status: 0, result: { success: false, message: "Network error. Please try again." } };
  }

  return { ok: response.ok && Boolean(result && result.success), status: response.status, result };
}

export const updateOrderStatus = (orderId, status) =>
  callSecureEndpoint("update-order-status", { orderId, status });

export const updatePaymentStatus = (orderId, paymentStatus) =>
  callSecureEndpoint("update-payment-status", { orderId, paymentStatus });

export const updateOrderNotes = (orderId, adminNotes) =>
  callSecureEndpoint("update-order-notes", { orderId, adminNotes });

export const updateOrderTestFlag = (orderId, isTest) =>
  callSecureEndpoint("update-order-test-flag", { orderId, isTest });

export const cancelOrder = (orderId) =>
  callSecureEndpoint("cancel-order", { orderId });

// Returns a short-lived (15 min) signed Storage URL — never a permanent
// public link. Fetch this only when the admin actually clicks "View
// Payment Proof," not preemptively for every order in a list.
export const getPaymentProof = (orderId) =>
  callSecureEndpoint("get-payment-proof", { orderId });

export const deleteOrder = (orderId) =>
  callSecureEndpoint("delete-order", { orderId });

// Records a sale received outside the website (Facebook, Instagram,
// Messenger, phone, walk-in) into the SAME orders collection — see
// netlify/functions/create-admin-order.js. `payload` matches
// lib/validate-admin-order.js's expected shape.
export const createAdminOrder = (payload) =>
  callSecureEndpoint("create-admin-order", payload);
