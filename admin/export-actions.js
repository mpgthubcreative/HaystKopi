// Thin wrapper around the secure export-orders Netlify Function — same
// pattern as settings-actions.js/order-actions.js. Attaches the signed-in
// admin/owner's Firebase ID token; the backend re-derives role from
// Firestore itself and rejects anything but an active OWNER/ADMIN
// regardless of what this page shows.
//
// The endpoint responds one of two ways: a JSON envelope (validation error,
// empty-result notice, or server error — Content-Type application/json), or
// the actual file bytes (Content-Type xlsx/csv, with Content-Disposition
// carrying the filename) — the caller branches on Content-Type rather than
// guessing from the HTTP status alone.

import { auth } from "../firebase/firebase-init.js";

export async function requestOrdersExport(filters, format) {
  let idToken;
  try {
    idToken = await auth.currentUser.getIdToken();
  } catch (err) {
    return { ok: false, message: "Your session expired. Please sign in again." };
  }

  let response;
  try {
    response = await fetch("/.netlify/functions/export-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ ...filters, format }),
    });
  } catch (err) {
    return { ok: false, message: "Network error. Please try again." };
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    let result;
    try {
      result = await response.json();
    } catch (err) {
      return { ok: false, message: "Export could not be generated. Please try again." };
    }

    if (result && result.empty) {
      return { ok: true, empty: true, message: result.message };
    }

    return { ok: false, message: (result && result.message) || "Export could not be generated. Please try again." };
  }

  if (!response.ok) {
    return { ok: false, message: "Export could not be generated. Please try again." };
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match ? match[1] : format === "csv" ? "orders.csv" : "orders.xlsx";

  return { ok: true, blob, filename };
}

// Triggers a real browser download of an in-memory blob — an explicit
// admin-initiated save of their own just-generated export file, not an
// untrusted link. No file is ever written to Storage or a public URL to
// produce this.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
