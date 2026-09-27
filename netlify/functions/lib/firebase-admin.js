// Centralized Firebase Admin initialization for all Netlify Functions.
// Credentials come ONLY from environment variables (set in Netlify's
// dashboard, or a local .env for `netlify dev`) — never commit a service
// account file. This module is server-only; it must never be imported by
// anything served to the browser.

const admin = require("firebase-admin");

// initError stays null on a healthy deploy. If env vars are missing or the
// private key is malformed, admin.credential.cert() throws SYNCHRONOUSLY —
// without this guard that would crash the whole module at require() time,
// which for a Netlify Function means every invocation dies as an unhandled
// Lambda error instead of a clean response. Callers check initError first
// and return a friendly "temporarily unavailable" message instead.
let initError = null;
let db = null;
let bucket = null;

if (!admin.apps.length) {
  try {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      // Required for admin.storage().bucket() to work at all — Netlify
      // isn't a GCP-native runtime that can infer the bucket automatically
      // the way Cloud Functions can. Needed starting Phase 7 (payment proof
      // uploads); harmless for functions that never touch Storage.
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } catch (err) {
    initError = err;
  }
}

if (!initError) {
  try {
    db = admin.firestore();
  } catch (err) {
    initError = err;
  }
}

// Deliberately NOT folded into initError: a Storage misconfiguration must
// only break the functions that actually touch Storage (upload/get payment
// proof), not every existing Firestore-only endpoint. Those two functions
// check `bucket` for null themselves and fail gracefully on their own.
if (!initError) {
  try {
    bucket = admin.storage().bucket();
  } catch (err) {
    console.error("Storage bucket not available:", err);
  }
}

module.exports = { admin, db, bucket, initError };
