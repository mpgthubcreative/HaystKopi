// Order read helpers for the admin Orders pages. Reading is done via the
// client SDK directly — Firestore rules restrict orders/{orderId} reads to
// an active owner/admin (see firestore.rules), so this is safe and avoids
// building a backend endpoint just to list/sort/paginate. ALL WRITES go
// through the Netlify Functions in netlify/functions/ instead (see
// admin/order-actions.js) — this file is read-only.

import { doc, getDoc, getDocs, limit, orderBy, query, startAfter } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { ordersCollection } from "./collections.js";

export const ORDER_STATUS_VALUES = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];

export const PAYMENT_STATUS_VALUES = ["UNPAID", "AWAITING_VERIFICATION", "PAID", "REFUNDED"];

export const ORDER_STATUS_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY_FOR_PICKUP: "Ready for Pickup",
  OUT_FOR_DELIVERY: "Out for Delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  AWAITING_VERIFICATION: "Awaiting Verification",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

export const DELIVERY_AREA_LABELS = {
  rosewood: "Rosewood",
  acacia: "Acacia Estates",
  external: "Outside Acacia Estates",
};

export const PAYMENT_METHOD_LABELS = {
  gcash: "GCash",
  "bank-transfer": "Bank Transfer",
  "cash-on-pickup": "Cash on Pickup",
  "cash-on-delivery": "Cash on Delivery",
};

// Mirrors netlify/functions/lib/order-source.js — duplicated here for the
// same reason as the label maps above (that one is server-side CommonJS,
// this is a browser ES module). Orders from before this field existed have
// no orderSource stored at all; they were all placed through the website.
export const ORDER_SOURCE_LABELS = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  phone: "Phone",
  "walk-in": "Walk-in",
  manual: "Manual / Other",
};

export function orderSourceLabel(order) {
  const value = (order && order.orderSource) || "website";
  return ORDER_SOURCE_LABELS[value] || value;
}

// Same fulfillment/status compatibility rule the backend enforces
// (netlify/functions/lib/order-status.js) — kept here too so the status
// dropdown never even offers an option the backend would reject.
export function orderStatusOptionsForFulfillment(fulfillmentMethod) {
  return ORDER_STATUS_VALUES.filter((status) => {
    if (fulfillmentMethod === "pickup" && status === "OUT_FOR_DELIVERY") return false;
    if (fulfillmentMethod === "delivery" && status === "READY_FOR_PICKUP") return false;
    return true;
  });
}

const PAGE_SIZE = 50;

// Loads one page of orders, newest-or-oldest first by createdAt. Pass the
// previous result's `cursor` to load the next page ("Load More"). Filtering
// and search happen client-side on top of this — see admin/orders.js — which
// is fine at the order volumes this business handles today; if that stops
// being true, this is the function to change to server-side `where()`
// queries (composite indexes would then be needed — see Phase 6 summary).
export async function fetchOrdersPage({ sortDirection = "desc", cursor = null } = {}) {
  let q = query(ordersCollection, orderBy("createdAt", sortDirection), limit(PAGE_SIZE));
  if (cursor) {
    q = query(ordersCollection, orderBy("createdAt", sortDirection), startAfter(cursor), limit(PAGE_SIZE));
  }

  const snap = await getDocs(q);
  const orders = [];
  snap.forEach((docSnap) => orders.push({ id: docSnap.id, ...docSnap.data() }));

  return {
    orders,
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

export async function fetchOrderById(orderId) {
  const snap = await getDoc(doc(db, "orders", orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
