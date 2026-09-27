// POST /.netlify/functions/update-admin-name
// Requires an active OWNER. Body: { uid, name }.
//
// Deliberately has no `role` field at all — this endpoint can only ever
// change a display name, never promote/demote anyone (Phase 12 spec
// section 17). loadMutableAdminTarget() also guarantees the target is an
// existing admin, never an owner or the caller themselves.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { respond, RequestError } = require("./lib/http");
const { loadMutableAdminTarget } = require("./lib/team-guard");

const MAX_BODY_BYTES = 500;
const MAX_NAME_LENGTH = 100;

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
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!name) {
    return respond(400, { success: false, error: "validation-error", message: "Name is required.", fieldErrors: { name: "Name is required." } });
  }

  try {
    const { ref } = await loadMutableAdminTarget(db, profile.uid, uid);

    await ref.update({ name, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await admin.auth().updateUser(uid, { displayName: name });

    return respond(200, { success: true, uid, name });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("update-admin-name failed:", err);
    return respond(500, { success: false, error: "server-error", message: "This account could not be updated." });
  }
};
