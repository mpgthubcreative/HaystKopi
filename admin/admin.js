// Shared dashboard shell logic — imported by every page under /admin/
// except login.html. Runs the route guard, then renders the account area,
// applies role-based nav visibility, and wires logout. Page-specific content
// (Dashboard, Orders placeholder, etc.) lives in each page's own HTML.

import { guardDashboardPage, logout } from "./admin-auth.js";

const OWNER_ONLY_NAV = ["inventory", "team", "settings"];

// A page declares its own access level via <body data-required-role="owner">.
// Omit the attribute for any active owner/admin page.
const requiredRole = document.body.dataset.requiredRole || null;

guardDashboardPage(
  (profile) => {
    document.getElementById("authChecking").hidden = true;
    document.getElementById("appShell").hidden = false;

    renderAccountArea(profile);
    applyRoleBasedNav(profile.role);
    highlightActiveNav();
    showAccessDeniedNoticeIfPresent();

    // Lets a page-specific module (products.js, inventory.js) start its own
    // Firestore fetch only once the guard has actually authorized this user,
    // without duplicating any guard/shell logic per page.
    document.dispatchEvent(new CustomEvent("admin:ready", { detail: { profile } }));
  },
  { requiredRole }
);

function renderAccountArea(profile) {
  const nameEl = document.getElementById("accountName");
  const badgeEl = document.getElementById("roleBadge");

  if (nameEl) nameEl.textContent = profile.name || profile.email || "Account";

  if (badgeEl) {
    badgeEl.textContent = profile.role.toUpperCase();
    badgeEl.classList.toggle("role-admin", profile.role === "admin");
  }
}

function applyRoleBasedNav(role) {
  if (role === "owner") return;

  OWNER_ONLY_NAV.forEach((key) => {
    const link = document.querySelector(`[data-nav="${key}"]`);
    if (link) link.hidden = true;
  });
}

function highlightActiveNav() {
  const currentPage = document.body.dataset.page;
  if (!currentPage) return;

  const link = document.querySelector(`[data-nav="${currentPage}"]`);
  if (link) link.classList.add("is-active");
}

// Shown on the dashboard after the guard redirects here because a valid
// admin tried to open an owner-only page (?denied=1) — not an auth failure,
// just a permissions notice.
function showAccessDeniedNoticeIfPresent() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("denied") !== "1") return;

  const notice = document.getElementById("accessNotice");
  if (notice) {
    notice.hidden = false;
    notice.textContent = "You don't have permission to access that page.";
  }

  window.history.replaceState({}, "", window.location.pathname);
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    logout();
  });
}
