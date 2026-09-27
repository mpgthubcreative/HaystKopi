// Order-specific proof-upload authorization.
//
// A customer never logs in, so orderId alone can't authorize anything — one
// order number "guessed" or shared in a chat screenshot must not let a
// stranger overwrite someone else's payment proof. Instead, create-order.js
// generates a random opaque token, returns the PLAINTEXT once in its
// response (never persisted anywhere in that form again), and stores only
// its SHA-256 hash on the order. Every later call to upload-payment-proof
// or confirm-payment-reference must present the plaintext token again;
// this module hashes it and compares to the stored hash.
//
// Two TTLs, both defined here so callers never disagree on the numbers:
//   - CHECKOUT_TOKEN_TTL_MS (48h): the token create-order.js hands out right
//     after a fresh order — generous on purpose, since a customer may check
//     their banking app and come back later the same day.
//   - RESUME_TOKEN_TTL_MS (30min): the token resume-payment.js issues when a
//     customer tracks an order later to finish paying — short-lived on
//     purpose, since issuing it is itself a deliberate "I'm doing this
//     right now" action, not a standing invitation like the checkout one.
// Either one INVALIDATES any previous token for that order the moment it's
// written (a fresh hash simply overwrites the old one on the order doc).

const crypto = require("crypto");

const CHECKOUT_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
const RESUME_TOKEN_TTL_MS = 30 * 60 * 1000;

function generateUploadToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashUploadToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenExpiryTimestamp(admin, ttlMs, now = new Date()) {
  return admin.firestore.Timestamp.fromMillis(now.getTime() + ttlMs);
}

// Returns true only if the token matches AND hasn't expired.
function isUploadTokenValid({ admin, providedToken, storedHash, expiresAt }) {
  if (!providedToken || !storedHash || !expiresAt) return false;
  if (hashUploadToken(providedToken) !== storedHash) return false;

  const expiryMs = typeof expiresAt.toMillis === "function" ? expiresAt.toMillis() : new Date(expiresAt).getTime();
  return Date.now() <= expiryMs;
}

module.exports = {
  generateUploadToken,
  hashUploadToken,
  tokenExpiryTimestamp,
  isUploadTokenValid,
  CHECKOUT_TOKEN_TTL_MS,
  RESUME_TOKEN_TTL_MS,
};
