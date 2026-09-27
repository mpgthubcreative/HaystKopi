// Auth + role-lookup helpers.
// Shared by the admin login page and the admin route guard so both agree on
// exactly one definition of "allowed to use the dashboard".

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

// Subscribe to sign-in/sign-out. Returns the unsubscribe function.
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// Reads users/{uid} — the source of truth for role + status.
// Returns null if the user has no profile document yet.
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function getUserRole(uid) {
  const profile = await getUserProfile(uid);
  return profile ? profile.role : null;
}

export async function isActiveAdmin(uid) {
  const profile = await getUserProfile(uid);
  if (!profile) return false;
  return profile.status === "active" && (profile.role === "owner" || profile.role === "admin");
}

export async function isOwner(uid) {
  const profile = await getUserProfile(uid);
  if (!profile) return false;
  return profile.status === "active" && profile.role === "owner";
}

// Single source of truth for "can this uid use the admin dashboard".
// Mirrors the Firestore rules exactly: a missing profile, a disabled status,
// or a role other than owner/admin all mean no access — this function just
// also tells the caller WHY, so the UI can show a specific friendly message.
//
// Returns one of:
//   { ok: true, profile }
//   { ok: false, reason: "no-profile" | "disabled" | "unauthorized" }
export async function validateAdminAccess(uid) {
  const profile = await getUserProfile(uid);
  if (!profile) {
    return { ok: false, reason: "no-profile" };
  }
  if (profile.status !== "active") {
    return { ok: false, reason: "disabled", profile };
  }
  if (profile.role !== "owner" && profile.role !== "admin") {
    return { ok: false, reason: "unauthorized", profile };
  }
  return { ok: true, profile };
}
