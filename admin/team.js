// Team management page — OWNER-only (enforced both by the page's own route
// guard, data-required-role="owner", and independently by every backend
// endpoint this calls — see team-actions.js). Reads/writes never touch
// Firestore directly; everything goes through the secure Netlify Functions
// so role assignment, Auth account creation/deletion, and Owner Protection
// are enforced in exactly one place (the backend), never trusted from
// what this page happens to show or hide.

import {
  fetchTeamList,
  createAdmin,
  updateAdminStatus,
  removeAdmin,
  updateAdminName,
} from "./team-actions.js";

const addAdminForm = document.getElementById("addAdminForm");
const newAdminName = document.getElementById("newAdminName");
const newAdminEmail = document.getElementById("newAdminEmail");
const addAdminBtn = document.getElementById("addAdminBtn");
const addAdminStatus = document.getElementById("addAdminStatus");
const passwordLinkBox = document.getElementById("passwordLinkBox");
const passwordLinkText = document.getElementById("passwordLinkText");
const copyPasswordLinkBtn = document.getElementById("copyPasswordLinkBtn");

const teamState = document.getElementById("teamState");
const teamList = document.getElementById("teamList");

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalBody = document.getElementById("confirmModalBody");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalConfirmBtn = document.getElementById("confirmModalConfirmBtn");

document.addEventListener("admin:ready", () => {
  loadTeam();
});

/* ---------- Field error helpers (mirrors settings.js) ---------- */

function setFieldError(name, message) {
  const el = document.querySelector(`[data-error-for="${name}"]`);
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function clearFieldErrors() {
  document.querySelectorAll("[data-error-for]").forEach((el) => {
    el.hidden = true;
    el.textContent = "";
  });
}

/* ---------- Confirm modal (mirrors order.js) ---------- */

function showConfirmModal({ title, body, confirmLabel, cancelLabel, onConfirm }) {
  confirmModalTitle.textContent = title;
  confirmModalBody.textContent = body;
  confirmModalConfirmBtn.textContent = confirmLabel;
  confirmModalCancelBtn.textContent = cancelLabel;
  confirmModal.hidden = false;

  const cleanup = () => {
    confirmModal.hidden = true;
    confirmModalConfirmBtn.removeEventListener("click", onConfirmClick);
    confirmModalCancelBtn.removeEventListener("click", onCancelClick);
  };

  function onConfirmClick() {
    cleanup();
    onConfirm();
  }

  function onCancelClick() {
    cleanup();
  }

  confirmModalConfirmBtn.addEventListener("click", onConfirmClick);
  confirmModalCancelBtn.addEventListener("click", onCancelClick);
}

/* ---------- Team list ---------- */

async function loadTeam() {
  teamState.hidden = false;
  teamState.textContent = "Loading team…";
  teamState.classList.remove("is-error");
  teamList.innerHTML = "";

  const { ok, result } = await fetchTeamList();

  if (!ok) {
    teamState.textContent = (result && result.message) || "We couldn't load the team list right now. Please try again.";
    teamState.classList.add("is-error");
    return;
  }

  teamState.hidden = true;
  render(result.members);
}

function render(members) {
  teamList.innerHTML = "";

  if (!members.length) {
    teamState.hidden = false;
    teamState.textContent = "No team members found.";
    return;
  }

  members.forEach((member) => teamList.appendChild(buildTeamCard(member)));
}

function buildTeamCard(member) {
  const card = document.createElement("div");
  card.className = "team-card";

  const isOwnerRow = member.role === "owner";
  const isActive = member.status === "active";

  card.innerHTML = `
    <div class="team-card-top">
      <span class="team-card-name">${escapeHtml(member.name || "(no name)")}</span>
      <span class="role-chip role-${escapeAttr(member.role)}">${escapeHtml(member.role)}</span>
      <span class="status-chip status-${escapeAttr(member.status)}">${escapeHtml(member.status)}</span>
    </div>
    <div class="team-card-meta">
      <span class="team-card-email">${escapeHtml(member.email || "")}</span>
      <span>Added: ${escapeHtml(formatDate(member.createdAt))}</span>
      <span>Last login: ${escapeHtml(formatDate(member.lastSignInAt))}</span>
    </div>
    <div class="team-card-actions"></div>
  `;

  const actionsRow = card.querySelector(".team-card-actions");

  if (!isOwnerRow) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-quiet";
    editBtn.textContent = "Edit Name";
    actionsRow.appendChild(editBtn);

    const statusBtn = document.createElement("button");
    statusBtn.type = "button";
    statusBtn.className = "btn-quiet";
    statusBtn.textContent = isActive ? "Disable" : "Reactivate";
    actionsRow.appendChild(statusBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-danger";
    removeBtn.textContent = "Remove";
    actionsRow.appendChild(removeBtn);

    const editPanel = buildEditNamePanel(member, card);
    editPanel.hidden = true;
    card.appendChild(editPanel);

    editBtn.addEventListener("click", () => {
      editPanel.hidden = !editPanel.hidden;
    });

    statusBtn.addEventListener("click", () => {
      if (isActive) {
        showConfirmModal({
          title: "Disable this Admin?",
          body: `${member.name || member.email} will immediately lose dashboard access. You can reactivate them later — nothing is deleted.`,
          confirmLabel: "Disable",
          cancelLabel: "Cancel",
          onConfirm: () => runStatusChange(member.uid, "disabled", [editBtn, statusBtn, removeBtn]),
        });
      } else {
        runStatusChange(member.uid, "active", [editBtn, statusBtn, removeBtn]);
      }
    });

    removeBtn.addEventListener("click", () => {
      showConfirmModal({
        title: `Permanently remove ${member.name || member.email}?`,
        body: "This account will lose dashboard access and be permanently deleted. Their name will still appear on historical orders they handled.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        onConfirm: () => runRemove(member.uid, [editBtn, statusBtn, removeBtn]),
      });
    });
  }

  return card;
}

function buildEditNamePanel(member, card) {
  const panel = document.createElement("form");
  panel.className = "edit-panel";
  panel.innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>Name</label>
        <input type="text" name="name" value="${escapeAttr(member.name || "")}" required>
      </div>
    </div>
    <button type="submit" class="btn-primary-sm">Save Name</button>
    <p class="save-status" hidden></p>
  `;

  const statusEl = panel.querySelector(".save-status");
  const submitBtn = panel.querySelector('button[type="submit"]');

  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = panel.querySelector('input[name="name"]').value.trim();
    if (!name) return;

    submitBtn.disabled = true;
    statusEl.hidden = false;
    statusEl.textContent = "Saving…";
    statusEl.classList.remove("is-error", "is-success");

    const { ok, result } = await updateAdminName(member.uid, name);

    submitBtn.disabled = false;

    if (!ok) {
      statusEl.textContent = (result && result.message) || "This account could not be updated.";
      statusEl.classList.add("is-error");
      return;
    }

    statusEl.textContent = "Name updated.";
    statusEl.classList.add("is-success");
    loadTeam();
  });

  return panel;
}

async function runStatusChange(uid, status, buttons) {
  buttons.forEach((btn) => { btn.disabled = true; });
  const { ok, result } = await updateAdminStatus(uid, status);
  buttons.forEach((btn) => { btn.disabled = false; });

  if (!ok) {
    teamState.hidden = false;
    teamState.textContent = (result && result.message) || "This account could not be updated.";
    teamState.classList.add("is-error");
    return;
  }

  await loadTeam();
}

async function runRemove(uid, buttons) {
  buttons.forEach((btn) => { btn.disabled = true; });
  const { ok, result } = await removeAdmin(uid);
  buttons.forEach((btn) => { btn.disabled = false; });

  if (!ok) {
    teamState.hidden = false;
    teamState.textContent = (result && result.message) || "This account could not be removed.";
    teamState.classList.add("is-error");
    return;
  }

  await loadTeam();
}

/* ---------- Add Admin ---------- */

addAdminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFieldErrors();
  passwordLinkBox.hidden = true;

  const name = newAdminName.value.trim();
  const email = newAdminEmail.value.trim();

  addAdminBtn.disabled = true;
  addAdminStatus.hidden = false;
  addAdminStatus.textContent = "Creating account…";
  addAdminStatus.classList.remove("is-error", "is-success");

  const { ok, result } = await createAdmin(name, email);
  addAdminBtn.disabled = false;

  if (!ok) {
    addAdminStatus.textContent = (result && result.message) || "This account could not be created.";
    addAdminStatus.classList.add("is-error");
    if (result && result.fieldErrors) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => setFieldError(field, message));
    }
    return;
  }

  addAdminStatus.textContent = "Admin created.";
  addAdminStatus.classList.add("is-success");
  passwordLinkText.textContent = result.passwordSetupLink;
  passwordLinkBox.hidden = false;
  addAdminForm.reset();
  loadTeam();
});

copyPasswordLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(passwordLinkText.textContent);
    copyPasswordLinkBtn.textContent = "Copied!";
    setTimeout(() => { copyPasswordLinkBtn.textContent = "Copy Link"; }, 2000);
  } catch (err) {
    // Clipboard API unavailable/denied — the link is already visible and
    // selectable in the box, so this is a soft failure only.
  }
});

/* ---------- Formatting ---------- */

function formatDate(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
