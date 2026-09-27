// POST /.netlify/functions/update-settings
// OWNER-only (Authorization: Bearer <Firebase ID token>). ADMIN's valid
// token is authenticated the same way but rejected by isOwnerProfile() —
// the same pattern as delete-order.js and update-order-test-flag.js. This
// is the actual enforcement point; the client-side rule that never even
// shows Settings to ADMIN (Phase 2's owner-only route guard) is UX only.
//
// One endpoint, a `section` discriminator — each section maps to exactly
// one Firestore settings document, validated by its own function in
// lib/settings-validate.js (delivery reuses lib/delivery.js's existing
// bracket/zone validation rather than duplicating it).

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { validateDeliverySettings } = require("./lib/delivery");
const {
  validateBusinessSettings,
  validateOrdersSettings,
  validateDeliveryPayload,
  validatePaymentsPayload,
} = require("./lib/settings-validate");
const { respond } = require("./lib/http");

const MAX_BODY_BYTES = 20000;

const SECTION_CONFIG = {
  business: { doc: "business", validate: (payload) => validateBusinessSettings(payload) },
  orders: { doc: "orders", validate: (payload) => validateOrdersSettings(payload) },
  delivery: { doc: "delivery", validate: (payload) => validateDeliveryPayload(payload, validateDeliverySettings) },
  payments: { doc: "payments", validate: (payload) => validatePaymentsPayload(payload) },
};

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
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to change settings." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "Settings could not be saved." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "Settings could not be saved." });
  }

  const section = typeof payload.section === "string" ? payload.section : "";
  const config = SECTION_CONFIG[section];
  if (!config) {
    return respond(400, { success: false, error: "invalid-section", message: "Unknown settings section." });
  }

  const sectionData = payload.data && typeof payload.data === "object" ? payload.data : {};
  const { ok, errors, data } = config.validate(sectionData);

  if (!ok) {
    return respond(400, { success: false, error: "validation-error", message: "Please fix the highlighted fields.", fieldErrors: errors });
  }

  try {
    await db.collection("settings").doc(config.doc).set(
      {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: profile.uid,
        updatedByName: profile.name || profile.email || "",
      },
      { merge: true }
    );

    return respond(200, { success: true, section });
  } catch (err) {
    console.error("update-settings failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Settings could not be saved. Please try again." });
  }
};
