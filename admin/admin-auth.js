// Shared route guard for every page under /admin/ except login.html.
// Import this and call guardDashboardPage() before rendering any page
// content — it decides signed-in/signed-out/unauthorized and redirects
// to login.html when access isn't allowed, so protected content never
// has a chance to flash on screen first.

import { signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "../firebase/firebase-init.js";
import { watchAuthState, validateAdminAccess } from "../firebase/auth-helpers.js";

const REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

const FRIENDLY_MESSAGES = {
  "no-profile": "Your account is not authorized to access the dashboard.",
  "unauthorized": "Your account is not authorized to access the dashboard.",
  "disabled": "Your account has been disabled. Please contact the owner.",
};

export function friendlyAuthErrorFromReason(reason) {
  return FRIENDLY_MESSAGES[reason] || null;
}

function redirectToLogin(reason) {
  const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  window.location.replace(`login.html${suffix}`);
}

// Insufficient role (e.g. an active ADMIN on an owner-only page) is NOT a
// sign-out case — their account is perfectly valid, they just can't see this
// one page. Send them back to the dashboard instead of the login screen.
function redirectForbidden() {
  window.location.replace("index.html?denied=1");
}

// Checks the general "is this an active owner/admin" rule, plus an optional
// page-specific requiredRole ("owner"). Returns a reason string on failure:
//   - any reason from validateAdminAccess ("no-profile"/"disabled"/"unauthorized")
//   - "forbidden" when the account is valid but requiredRole isn't met
async function checkAccess(uid, requiredRole) {
  const result = await validateAdminAccess(uid);
  if (!result.ok) {
    return { ok: false, kind: "sign-out", reason: result.reason };
  }
  if (requiredRole && result.profile.role !== requiredRole) {
    return { ok: false, kind: "forbidden", profile: result.profile };
  }
  return { ok: true, profile: result.profile };
}

// Calls onAuthorized(profile) once a signed-in, active owner/admin user is
// confirmed AND (if the page set one) their role matches requiredRole.
//
// - Invalid session (signed out, no profile, disabled, wrong role entirely)
//   → signs out and redirects to login.html.
// - Valid session but requiredRole not met (e.g. ADMIN on an owner-only page)
//   → does NOT sign out, redirects to index.html?denied=1 instead.
//
// options.requiredRole: "owner" to restrict a page to owners only. Omit for
// any active owner/admin.
//
// Re-validates against Firestore every few minutes while the page stays
// open, in case status/role changes mid-session — status/role are never
// trusted from a local cache.
export function guardDashboardPage(onAuthorized, options = {}) {
  const requiredRole = options.requiredRole || null;
  let revalidateTimer = null;
  let settled = false;

  const stopRevalidating = () => {
    if (revalidateTimer) {
      clearInterval(revalidateTimer);
      revalidateTimer = null;
    }
  };

  const unsubscribe = watchAuthState(async (user) => {
    stopRevalidating();

    if (!user) {
      redirectToLogin();
      return;
    }

    const access = await checkAccess(user.uid, requiredRole);
    if (!access.ok) {
      if (access.kind === "forbidden") {
        redirectForbidden();
      } else {
        await signOut(auth);
        redirectToLogin(access.reason);
      }
      return;
    }

    if (!settled) {
      settled = true;
      onAuthorized(access.profile);
    }

    revalidateTimer = setInterval(async () => {
      const recheck = await checkAccess(user.uid, requiredRole);
      if (!recheck.ok) {
        stopRevalidating();
        if (recheck.kind === "forbidden") {
          redirectForbidden();
        } else {
          await signOut(auth);
          redirectToLogin(recheck.reason);
        }
      }
    }, REVALIDATE_INTERVAL_MS);
  });

  window.addEventListener("beforeunload", () => {
    stopRevalidating();
    unsubscribe();
  });
}

export async function logout() {
  await signOut(auth);
  window.location.replace("login.html");
}
