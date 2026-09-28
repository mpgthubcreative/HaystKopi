// Caller authorization for privileged functions (cancel-order, delete-order).
// The browser sends a Firebase Auth ID token; we verify it server-side and
// look up the SAME users/{uid} document the Firestore rules trust, so admin
// authorization logic has exactly one definition across client rules and
// backend functions.

async function getCallerProfile(admin, db, event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    console.error("getCallerProfile: no Authorization: Bearer header present");
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    const snap = await db.collection("users").doc(decoded.uid).get();
    if (!snap.exists) {
      console.error(`getCallerProfile: token verified for uid ${decoded.uid}, but no users/${decoded.uid} Firestore doc exists`);
      return null;
    }
    const profile = { uid: decoded.uid, ...snap.data() };
    console.error(`getCallerProfile: uid=${decoded.uid} role=${profile.role} status=${profile.status}`);
    return profile;
  } catch (err) {
    // Logged deliberately — this previously failed silently, making a real
    // credential/project mismatch indistinguishable from a legitimate
    // permission denial. err.code (e.g. "auth/argument-error",
    // "auth/project-not-found", "auth/id-token-expired") is the key thing
    // to read from Netlify's function logs when diagnosing a "you don't
    // have permission" report that shouldn't be happening.
    console.error("getCallerProfile: verifyIdToken/profile lookup failed:", err.code || err.message || err);
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
