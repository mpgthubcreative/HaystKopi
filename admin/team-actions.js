// Thin wrappers around the secure Team Management Netlify Functions — same
// pattern as settings-actions.js/export-actions.js. Each attaches the
// signed-in owner's Firebase ID token; the backend re-derives role from
// Firestore itself and rejects anything but an active OWNER regardless of
// what this page shows.

import { auth } from "../firebase/firebase-init.js";

async function callTeamEndpoint(endpoint, body) {
  let idToken;
  try {
    idToken = await auth.currentUser.getIdToken();
  } catch (err) {
    return { ok: false, result: { message: "Your session expired. Please sign in again." } };
  }

  let response;
  let result;
  try {
    response = await fetch(`/.netlify/functions/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    result = await response.json();
  } catch (err) {
    return { ok: false, result: { message: "Network error. Please try again." } };
  }

  return { ok: response.ok && Boolean(result && result.success), result };
}

export const fetchTeamList = () => callTeamEndpoint("list-team", {});
export const createAdmin = (name, email) => callTeamEndpoint("create-admin", { name, email });
export const updateAdminStatus = (uid, status) => callTeamEndpoint("update-admin-status", { uid, status });
export const removeAdmin = (uid) => callTeamEndpoint("remove-admin", { uid });
export const updateAdminName = (uid, name) => callTeamEndpoint("update-admin-name", { uid, name });
