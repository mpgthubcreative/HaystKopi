// Thin wrapper around the secure update-settings Netlify Function — same
// pattern as order-actions.js. Attaches the signed-in owner's Firebase ID
// token; the backend re-derives role from Firestore itself and rejects
// anything but an active OWNER regardless of what this page shows.

import { auth } from "../firebase/firebase-init.js";

export async function updateSettingsSection(section, data) {
  let idToken;
  try {
    idToken = await auth.currentUser.getIdToken();
  } catch (err) {
    return { ok: false, result: { message: "Your session expired. Please sign in again." } };
  }

  let response;
  let result;
  try {
    response = await fetch("/.netlify/functions/update-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ section, data }),
    });
    result = await response.json();
  } catch (err) {
    return { ok: false, result: { message: "Network error. Please try again." } };
  }

  return { ok: response.ok && Boolean(result && result.success), result };
}
