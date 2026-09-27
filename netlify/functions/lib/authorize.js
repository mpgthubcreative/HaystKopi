// Caller authorization for privileged functions (cancel-order, delete-order).
// The browser sends a Firebase Auth ID token; we verify it server-side and
// look up the SAME users/{uid} document the Firestore rules trust, so admin
// authorization logic has exactly one definition across client rules and
// backend functions.

async function getCallerProfile(admin, db, event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    const snap = await db.collection("users").doc(decoded.uid).get();
    if (!snap.exists) return null;
    return { uid: decoded.uid, ...snap.data() };
  } catch (err) {
    return null;
  }
}

function isActiveAdminProfile(profile) {
  return Boolean(profile) && profile.status === "active" && (profile.role === "owner" || profile.role === "admin");
}

function isOwnerProfile(profile) {
  return Boolean(profile) && profile.status === "active" && profile.role === "owner";
}

module.exports = { getCallerProfile, isActiveAdminProfile, isOwnerProfile };
