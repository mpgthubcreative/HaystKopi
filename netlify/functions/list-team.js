// POST /.netlify/functions/list-team
// Requires an active OWNER (Authorization: Bearer <Firebase ID token>).
//
// Combines each users/{uid} Firestore profile with its Firebase Auth
// metadata (specifically lastSignInTime — Firestore has no login-tracking
// of its own) and returns only the safe, display-ready fields. Never
// returns password hashes, provider tokens, or any other raw Auth
// metadata.
//
// Scaling note: this does one admin.auth().getUser() call per team member
// to fetch lastSignInAt. Fine at a handful of admins; would need batching
// (or dropping last-login) if the team ever grew into the hundreds.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { respond } = require("./lib/http");

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

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
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to view the team." });
  }

  try {
    const snap = await db.collection("users").get();

    const members = await Promise.all(
      snap.docs.map(async (docSnap) => {
        const data = docSnap.data();
        let lastSignInAt = null;

        try {
          const userRecord = await admin.auth().getUser(docSnap.id);
          lastSignInAt = isoOrNull(userRecord.metadata.lastSignInTime);
        } catch (err) {
          // Auth record missing/unreachable — still show the Firestore
          // profile rather than dropping the row; last-login just reads
          // blank for this member.
          console.error(`list-team: could not read Auth record for ${docSnap.id}:`, err.code || err);
        }

        return {
          uid: docSnap.id,
          name: data.name || "",
          email: data.email || "",
          role: data.role || "",
          status: data.status || "",
          createdAt: data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : null,
          lastSignInAt,
        };
      })
    );

    // Owner(s) first, then admins alphabetically by name — a stable,
    // predictable order rather than whatever Firestore happened to return.
    members.sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return respond(200, { success: true, members });
  } catch (err) {
    console.error("list-team failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't load the team list right now. Please try again." });
  }
};
