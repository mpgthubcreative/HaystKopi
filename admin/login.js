// Admin login page logic.
// If a valid owner/admin session already exists, redirects straight to the
// dashboard. Otherwise shows the sign-in form once the initial auth check
// settles, and never displays a raw Firebase error string to the user.

import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "../firebase/firebase-init.js";
import { watchAuthState, validateAdminAccess } from "../firebase/auth-helpers.js";
import { friendlyAuthErrorFromReason } from "./admin-auth.js";

const authChecking = document.getElementById("authChecking");
const loginCard = document.getElementById("loginCard");
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("signInBtn");
const errorBanner = document.getElementById("errorBanner");

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

function resetSubmitButton() {
  submitBtn.disabled = false;
  submitBtn.textContent = "Sign In";
}

function revealForm() {
  authChecking.hidden = true;
  loginCard.hidden = false;
}

// If we were bounced back here after a failed guard check on a dashboard
// page, surface why (?reason=...) and clean the URL so a refresh doesn't
// re-show the same message.
const params = new URLSearchParams(window.location.search);
const reason = params.get("reason");
if (reason) {
  const message = friendlyAuthErrorFromReason(reason);
  if (message) showError(message);
  window.history.replaceState({}, "", "login.html");
}

watchAuthState(async (user) => {
  if (!user) {
    revealForm();
    return;
  }

  const result = await validateAdminAccess(user.uid);
  if (result.ok) {
    window.location.replace("index.html");
    return;
  }

  // Signed in with Firebase Auth but not an authorized dashboard user —
  // don't leave a half-authenticated session sitting around.
  await signOut(auth);
  resetSubmitButton();
  revealForm();
  const message = friendlyAuthErrorFromReason(result.reason);
  if (message) showError(message);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Please enter your email and password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // watchAuthState above picks this up and redirects (or shows an error
    // if the account isn't an authorized dashboard user).
  } catch (err) {
    resetSubmitButton();
    showError(mapAuthError(err.code));
  }
});

function mapAuthError(code) {
  switch (code) {
    case "auth/invalid-email":
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong signing in. Please try again.";
  }
}
