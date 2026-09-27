// Shared "is this a valid target for a destructive/status-changing Team
// Management action" check — the actual enforcement point for Owner
// Protection (Phase 12 spec section 3). Every mutating team endpoint
// (update-admin-status, remove-admin, update-admin-name) calls this
// FIRST, so there is exactly one place that decides "no, you can't touch
// that account" rather than three slightly-different copies of the same
// safety check.
//
// A target is only ever mutable here if it exists, is role == "admin",
// and isn't the caller's own uid. Since there is currently exactly one
// owner and this never allows role == "owner" as a target, the Owner can
// never disable/remove/rename themselves (or any other owner) through
// these endpoints — regardless of what the client sends.

const { RequestError } = require("./http");

async function loadMutableAdminTarget(db, callerUid, targetUid) {
  if (!targetUid || typeof targetUid !== "string") {
    throw new RequestError("invalid-request", "Missing account.", 400);
  }

  if (targetUid === callerUid) {
    throw new RequestError("cannot-modify-self", "You cannot modify your own account here.", 400);
  }

  const ref = db.collection("users").doc(targetUid);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new RequestError("not-found", "That account doesn't exist.", 404);
  }

  const data = snap.data();
  if (data.role !== "admin") {
    throw new RequestError("owner-protected", "Owner accounts can't be changed here.", 400);
  }

  return { ref, data };
}

module.exports = { loadMutableAdminTarget };
