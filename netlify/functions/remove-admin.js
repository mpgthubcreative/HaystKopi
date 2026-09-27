// POST /.netlify/functions/remove-admin
// Requires an active OWNER. Body: { uid }.
//
// Permanently deletes the Firebase Auth account and the users/{uid}
// Firestore profile. Deliberately never touches any OTHER collection —
// historical order fields like updatedBy/updatedByName are plain strings
// frozen at write time (see cancel-order.js/update-order-status.js etc.);
// removing this user document does not and cannot retroactively change
// them (Phase 12 spec section 10).
//
// loadMutableAdminTarget() guarantees this can never target an owner or
// the caller's own account — see lib/team-guard.js.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { respond, RequestError } = require("./lib/http");
const { loadMutableAdminTarget } = require("./lib/team-guard");

const MAX_BODY_BYTES = 500;

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
    return respond(400, { success: false, error: "invalid-request", message: "This account could not be removed." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "This account could not be removed." });
  }

  const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";

  try {
    const { ref } = await loadMutableAdminTarget(db, profile.uid, uid);

    // Auth account first: if this throws, the Firestore profile is left
    // intact and the account is simply still there to retry against — a
    // safer partial-failure direction than deleting the profile but
    // leaving a live, still-loggable-in Auth account behind.
    await admin.auth().deleteUser(uid);
    await ref.delete();

    return respond(200, { success: true, uid });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("remove-admin failed:", err);
    return respond(500, { success: false, error: "server-error", message: "This account could not be removed." });
  }
};
