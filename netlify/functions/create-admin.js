// POST /.netlify/functions/create-admin
// Requires an active OWNER (Authorization: Bearer <Firebase ID token>).
//
// Onboarding flow (Phase 12 spec sections 5/6):
//   Owner submits name + email
//     -> Firebase Auth user created with NO password set (email/password
//        sign-in is unusable until one exists)
//     -> a Firebase password-reset link is generated server-side and
//        returned to the Owner to send however they like (no email
//        delivery is configured yet — see Phase 12 summary)
//     -> the new Admin opens that link, sets their own password
//     -> they can then sign in normally at /admin/login.html
// No plaintext password is ever generated, stored, or returned by this
// endpoint.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { respond, RequestError } = require("./lib/http");

const MAX_BODY_BYTES = 2000;
const MAX_NAME_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return respond(400, { success: false, error: "invalid-request", message: "This account could not be created." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "This account could not be created." });
  }

  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, MAX_NAME_LENGTH) : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  const fieldErrors = {};
  if (!name) fieldErrors.name = "Name is required.";
  if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (Object.keys(fieldErrors).length > 0) {
    return respond(400, { success: false, error: "validation-error", message: "Please check the form and try again.", fieldErrors });
  }

  let uid = null;

  try {
    // Duplicate check — Admin SDK throws auth/user-not-found when the email
    // is free, which is the "good" path here.
    try {
      await admin.auth().getUserByEmail(email);
      return respond(409, { success: false, error: "email-exists", message: "An account with this email already exists." });
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
    }

    // No `password` field at all — the account has no usable credential
    // until the Owner sends the reset link below and the new Admin sets
    // their own password through it.
    const userRecord = await admin.auth().createUser({ email, displayName: name });
    uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      name,
      email,
      role: "admin",
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: profile.uid,
    });

    // Best-effort — no custom continueUrl is configured yet (no verified
    // custom domain/action-handler set up), so this uses Firebase's default
    // hosted reset page. After setting a password there, the new Admin
    // needs to navigate to /admin/login.html themselves (documented
    // limitation — see Phase 12 summary).
    const passwordSetupLink = await admin.auth().generatePasswordResetLink(email);

    return respond(200, { success: true, uid, name, email, passwordSetupLink });
  } catch (err) {
    // Roll back the orphaned Auth user if Firestore/link-generation failed
    // after it was created — best effort, failure here doesn't change the
    // response (an orphaned Auth user with no Firestore profile simply can
    // never sign in, per validateAdminAccess, so it isn't a security gap
    // even if this cleanup itself fails).
    if (uid) {
      try {
        await admin.auth().deleteUser(uid);
      } catch (cleanupErr) {
        console.error("create-admin cleanup (deleteUser) failed:", cleanupErr);
      }
    }

    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("create-admin failed:", err);
    return respond(500, { success: false, error: "server-error", message: "This account could not be created." });
  }
};
