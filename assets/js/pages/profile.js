import { getMe } from "../services/authService.js";
import { getFollowers, getFollowing, getPostsByUser, updateMyProfile } from "../services/userService.js";
import { saveSession } from "../utils/session.js";
import { renderEmptyStateCard, renderPostCard, renderUserMiniCard, showMessage } from "../utils/ui.js";
import { requireAuth, wireLogoutButton } from "./common.js";

const session = requireAuth();

if (!session) {
  throw new Error("Unauthorized");
}

wireLogoutButton();

const profileCard = document.getElementById("profile-card");
const userPosts = document.getElementById("user-posts");
const followersList = document.getElementById("followers-list");
const followingList = document.getElementById("following-list");
const profileForm = document.getElementById("profile-form");
const profileMessage = document.getElementById("profile-message");

const displayNameInput = document.getElementById("profile-display-name");
const bioInput = document.getElementById("profile-bio");
const profilePhotoInput = document.getElementById("profile-photo");
const coverPhotoInput = document.getElementById("cover-photo");
const profilePhotoPreview = document.getElementById("profile-photo-preview");
const coverPhotoPreview = document.getElementById("cover-photo-preview");

let currentProfileUser = null;
const MAX_PROFILE_IMAGE_BYTES = 450 * 1024;
const MAX_COVER_IMAGE_BYTES = 900 * 1024;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function avatarFromName(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2f9e65&color=ffffff`;
}

function fillProfileForm(user) {
  displayNameInput.value = user.displayName || user.username || "";
  bioInput.value = user.bio || "";
  profilePhotoInput.value = "";
  coverPhotoInput.value = "";
  profilePhotoPreview.src = user.profilePhoto || avatarFromName(user.displayName || user.username || "User");
  coverPhotoPreview.src =
    user.coverPhoto ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='280'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%232f9e65'/%3E%3Cstop offset='1' stop-color='%2343b97a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='280' fill='url(%23g)'/%3E%3C/svg%3E";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to process image"));
    image.src = dataUrl;
  });
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function optimizeImageFile(file, options = {}) {
  const {
    maxWidth = 1400,
    maxHeight = 1400,
    maxBytes = 900 * 1024,
    outputType = "image/jpeg",
    initialQuality = 0.84,
  } = options;

  const sourceDataUrl = await fileToDataUrl(file);
  if (!sourceDataUrl.startsWith("data:image/")) {
    throw new Error("Selected file must be an image");
  }

  const image = await loadImage(sourceDataUrl);

  const ratio = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to process image");
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = initialQuality;
  let result = canvas.toDataURL(outputType, quality);

  while (dataUrlByteLength(result) > maxBytes && quality > 0.52) {
    quality -= 0.08;
    result = canvas.toDataURL(outputType, quality);
  }

  if (dataUrlByteLength(result) > maxBytes) {
    throw new Error("Image is too large. Please choose a smaller image.");
  }

  return result;
}

async function toImagePayload(fileInput, existingValue, label) {
  const file = fileInput.files?.[0];
  if (!file) {
    return existingValue || "";
  }

  const options =
    label === "Profile photo"
      ? { maxWidth: 700, maxHeight: 700, maxBytes: MAX_PROFILE_IMAGE_BYTES }
      : { maxWidth: 1600, maxHeight: 900, maxBytes: MAX_COVER_IMAGE_BYTES };

  return optimizeImageFile(file, options);
}

function renderSkeleton() {
  profileCard.innerHTML = `
    <div class="skeleton skeleton-line title"></div>
    <div class="skeleton skeleton-line medium"></div>
    <div class="skeleton skeleton-line long"></div>
    <div class="skeleton-actions">
      <div class="skeleton skeleton-pill"></div>
      <div class="skeleton skeleton-pill"></div>
    </div>
  `;

  userPosts.innerHTML = new Array(2)
    .fill(
      `<article class="skeleton-card">
        <div class="skeleton skeleton-line title"></div>
        <div class="skeleton skeleton-line long"></div>
        <div class="skeleton skeleton-line medium"></div>
      </article>`
    )
    .join("");
}

function renderProfile(user) {
  const fullName = user.displayName || user.username || "Unknown";
  const profilePhoto = user.profilePhoto || avatarFromName(fullName);
  const coverPhoto = user.coverPhoto || "";

  profileCard.innerHTML = `
    <div class="profile-cover ${coverPhoto ? "has-image" : ""}">
      ${coverPhoto ? `<img src="${escapeHtml(coverPhoto)}" alt="Cover photo" />` : "<div class='profile-cover-fallback'></div>"}
    </div>
    <div class="profile-identity-row">
      <img class="profile-avatar" src="${escapeHtml(profilePhoto)}" alt="Profile photo" />
      <div>
        <h2><i class="fa-solid fa-address-card"></i> ${escapeHtml(fullName)}</h2>
        <div class="profile-handle muted">@${escapeHtml(user.username)}</div>
      </div>
    </div>
    <div class="muted"><i class="fa-solid fa-envelope"></i> ${user.email}</div>
    <p>${escapeHtml(user.bio || "No bio yet.")}</p>
    <div class="profile-stats">
      <span><i class="fa-solid fa-users"></i> Followers: ${user.followers.length}</span>
      <span><i class="fa-solid fa-user-check"></i> Following: ${user.following.length}</span>
    </div>
  `;
}

function renderUserPosts(posts, currentUserId, followingSet) {
  userPosts.innerHTML = posts.length
    ? posts.map((post) => renderPostCard(post, currentUserId, { followingSet })).join("")
    : renderEmptyStateCard({
        icon: "fa-image",
        title: "No posts in this profile",
        description: "Share your first moment and your profile timeline will appear here.",
        actionText: "Create your first post",
      });
}

function renderNetworkList(element, users, emptyTitle) {
  if (!element) {
    return;
  }

  element.innerHTML = users.length
    ? users
        .map((user) =>
          renderUserMiniCard(user, {
            subtitle: `${user.followers.length} followers`,
          })
        )
        .join("")
    : renderEmptyStateCard({
        icon: "fa-users",
        title: emptyTitle,
        description: "Connect with more people to grow your social circle.",
        actionText: "Explore users",
      });
}

async function loadNetworkLists(userId) {
  const [followersData, followingData] = await Promise.all([
    getFollowers(userId),
    getFollowing(userId),
  ]);

  renderNetworkList(followersList, followersData.users || [], "No followers yet");
  renderNetworkList(followingList, followingData.users || [], "Not following anyone yet");
}

renderSkeleton();
const meData = await getMe();
const me = meData.user;
currentProfileUser = me;
renderProfile(me);
fillProfileForm(me);
saveSession({ token: session.token, user: me });

const postsData = await getPostsByUser(me.id);
renderUserPosts(postsData.posts, me.id, new Set(me.following || []));
await loadNetworkLists(me.id);

profileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const displayName = displayNameInput.value.trim();
  if (!displayName) {
    showMessage(profileMessage, "Display name is required", true);
    return;
  }

  try {
    const profilePhoto = await toImagePayload(
      profilePhotoInput,
      currentProfileUser?.profilePhoto,
      "Profile photo"
    );
    const coverPhoto = await toImagePayload(
      coverPhotoInput,
      currentProfileUser?.coverPhoto,
      "Cover photo"
    );

    const payload = {
      displayName,
      bio: bioInput.value.trim(),
      profilePhoto,
      coverPhoto,
    };

    const updated = await updateMyProfile(payload);
    currentProfileUser = updated.user;
    renderProfile(updated.user);
    fillProfileForm(updated.user);
    saveSession({ token: session.token, user: updated.user });
    showMessage(profileMessage, "Profile updated successfully");
    await loadNetworkLists(updated.user.id);
  } catch (error) {
    showMessage(profileMessage, error.message, true);
  }
});

profilePhotoInput?.addEventListener("change", async () => {
  const file = profilePhotoInput.files?.[0];
  if (!file) {
    profilePhotoPreview.src =
      currentProfileUser?.profilePhoto || avatarFromName(currentProfileUser?.displayName || currentProfileUser?.username || "User");
    return;
  }
  try {
    profilePhotoPreview.src = await toImagePayload(profilePhotoInput, "", "Profile photo");
  } catch (error) {
    showMessage(profileMessage, error.message, true);
    profilePhotoInput.value = "";
  }
});

coverPhotoInput?.addEventListener("change", async () => {
  const file = coverPhotoInput.files?.[0];
  if (!file) {
    coverPhotoPreview.src =
      currentProfileUser?.coverPhoto ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='280'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%232f9e65'/%3E%3Cstop offset='1' stop-color='%2343b97a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='280' fill='url(%23g)'/%3E%3C/svg%3E";
    return;
  }
  try {
    coverPhotoPreview.src = await toImagePayload(coverPhotoInput, "", "Cover photo");
  } catch (error) {
    showMessage(profileMessage, error.message, true);
    coverPhotoInput.value = "";
  }
});
