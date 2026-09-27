// Thin wrapper around the secure get-dashboard-analytics Netlify Function —
// same pattern as settings-actions.js/export-actions.js. Attaches the
// signed-in admin/owner's Firebase ID token; the backend re-derives role
// from Firestore itself.

import { auth } from "../firebase/firebase-init.js";

export async function fetchDashboardAnalytics(filters) {
  let idToken;
  try {
    idToken = await auth.currentUser.getIdToken();
  } catch (err) {
    return { ok: false, message: "Your session expired. Please sign in again." };
  }

  let response;
  let result;
  try {
    response = await fetch("/.netlify/functions/get-dashboard-analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(filters),
    });
    result = await response.json();
  } catch (err) {
    return { ok: false, message: "Network error. Please try again." };
  }

  if (!response.ok || !result || !result.success) {
    return { ok: false, message: (result && result.message) || "We couldn't load analytics right now. Please try again." };
  }

  return { ok: true, data: result };
}
