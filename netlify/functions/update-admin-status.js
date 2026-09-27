// POST /.netlify/functions/update-admin-status
// Requires an active OWNER. Body: { uid, status: "active" | "disabled" }.
//
// Writes both enforcement layers (Phase 12 spec section 8/9):
//   users/{uid}.status        — what the app's own route guard/rules check
//   Firebase Auth disabled    — an extra layer that blocks sign-in itself,
//                               independent of anything Firestore-based
// Reactivating reverses both. loadMutableAdminTarget() guarantees this can
// never target an owner or the caller's own account.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { respond, RequestError } = require("./lib/http");
const { loadMutableAdminTarget } = require("./lib/team-guard");

const MAX_BODY_BYTES = 500;
const VALID_STATUSES = ["active", "disabled"];

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  const profile = await getCallerProfile(admin, db, event);
  if (!isOwnerProfile(profile)) {
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to perform this action." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "This account could not be updated." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "This account could not be updated." });
  }

  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
  const status = typeof payload.status === "string" ? payload.status : "";

  if (!VALID_STATUSES.includes(status)) {
    return respond(400, { success: false, error: "invalid-status", message: "This account could not be updated." });
  }

  try {
    const { ref } = await loadMutableAdminTarget(db, profile.uid, uid);

    await ref.update({ status, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await admin.auth().updateUser(uid, { disabled: status === "disabled" });

    return respond(200, { success: true, uid, status });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("update-admin-status failed:", err);
    return respond(500, { success: false, error: "server-error", message: "This account could not be updated." });
  }
};
