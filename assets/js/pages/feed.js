import { getMe } from "../services/authService.js";
import { addComment, createPost, likePost, listPosts, unlikePost } from "../services/postService.js";
import { followUser, getSuggestedUsers, searchUsersByName, unfollowUser } from "../services/userService.js";
import { renderEmptyStateCard, renderPostCard, renderUserMiniCard, showToast } from "../utils/ui.js";
import { requireAuth, wireLogoutButton } from "./common.js";

const session = requireAuth();

if (!session) {
  throw new Error("Unauthorized");
}

wireLogoutButton();

const postForm = document.getElementById("post-form");
const contentInput = document.getElementById("post-content");
const postFileInput = document.getElementById("post-file");
const postDropzone = document.getElementById("post-dropzone");
const postFileMeta = document.getElementById("post-file-meta");
const postFileList = document.getElementById("post-file-list");
const postsList = document.getElementById("posts-list");
const suggestedUsersEl = document.getElementById("suggested-users");
const userSearchForm = document.getElementById("user-search-form");
const userSearchInput = document.getElementById("user-search-input");
const userSearchResults = document.getElementById("user-search-results");

let currentUser = session.user;
let posts = [];
let suggestedUsers = [];
let searchedUsers = [];
const mentionRequestVersion = new WeakMap();
let pendingNotificationTarget = {
  postId: new URLSearchParams(window.location.search).get("postId") || "",
  commentId: new URLSearchParams(window.location.search).get("commentId") || "",
};

const MAX_ATTACHMENT_BYTES = 1100 * 1024;
const MAX_ATTACHMENTS_PER_POST = 5;
let selectedPostFiles = [];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read selected file"));
    reader.readAsDataURL(file);
  });
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to process image"));
    image.src = dataUrl;
  });
}

async function optimizeImageAttachment(file) {
  const sourceData = await fileToDataUrl(file);
  const image = await loadImage(sourceData);
  const ratio = Math.min(1, 1500 / image.width, 1100 / image.height);
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

  let quality = 0.84;
  let output = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlByteLength(output) > MAX_ATTACHMENT_BYTES && quality > 0.52) {
    quality -= 0.08;
    output = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrlByteLength(output) > MAX_ATTACHMENT_BYTES) {
    throw new Error("Image is too large. Please choose a smaller image.");
  }

  return {
    name: file.name,
    type: "image/jpeg",
    data: output,
  };
}

async function buildAttachmentPayload(file) {
  if (!file) {
    return null;
  }

  if (String(file.type || "").startsWith("image/")) {
    return optimizeImageAttachment(file);
  }

  const data = await fileToDataUrl(file);
  if (dataUrlByteLength(data) > MAX_ATTACHMENT_BYTES) {
    throw new Error("File is too large. Max size is around 1.1MB.");
  }

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    data,
  };
}

async function buildAttachmentPayloads(fileList) {
  const files = Array.from(fileList || []).slice(0, 5);
  const attachments = [];

  for (const file of files) {
    const payload = await buildAttachmentPayload(file);
    if (payload) {
      attachments.push(payload);
    }
  }

  return attachments;
}

function clearComposer() {
  contentInput.value = "";
  if (postFileInput) {
    postFileInput.value = "";
  }
  selectedPostFiles = [];
  if (postFileMeta) {
    postFileMeta.textContent = "";
  }
  if (postFileList) {
    postFileList.innerHTML = "";
  }
}

function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function syncInputWithSelectedFiles() {
  if (!postFileInput) {
    return;
  }
  try {
    const transfer = new DataTransfer();
    selectedPostFiles.forEach((file) => transfer.items.add(file));
    postFileInput.files = transfer.files;
  } catch {
    // Some browsers may disallow assigning files programmatically.
  }
}

function renderSelectedFiles() {
  if (!postFileMeta || !postFileList) {
    return;
  }

  if (!selectedPostFiles.length) {
    postFileMeta.textContent = "";
    postFileList.innerHTML = "";
    return;
  }

  const totalBytes = selectedPostFiles.reduce((sum, file) => sum + file.size, 0);
  postFileMeta.textContent = `Selected ${selectedPostFiles.length} file(s) | Total ${formatBytes(totalBytes)}`;

  postFileList.innerHTML = selectedPostFiles
    .map(
      (file, index) => `
        <div class="post-file-chip" data-file-index="${index}">
          <span class="post-file-chip-name" title="${file.name}">${file.name}</span>
          <span class="post-file-chip-size">${formatBytes(file.size)}</span>
          <button type="button" class="post-file-remove" data-file-index="${index}" aria-label="Remove ${file.name}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `
    )
    .join("");
}

function appendSelectedFiles(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) {
    return;
  }

  const existingKeys = new Set(selectedPostFiles.map(fileKey));
  for (const file of incoming) {
    const key = fileKey(file);
    if (existingKeys.has(key)) {
      continue;
    }
    if (selectedPostFiles.length >= MAX_ATTACHMENTS_PER_POST) {
      showToast(`Only ${MAX_ATTACHMENTS_PER_POST} files are allowed`, "info");
      break;
    }
    selectedPostFiles.push(file);
    existingKeys.add(key);
  }

  syncInputWithSelectedFiles();
  renderSelectedFiles();
}

function renderPostSkeleton(count = 3) {
  const skeleton = `
    <article class="skeleton-card">
      <div class="skeleton skeleton-line title"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line long"></div>
      <div class="skeleton skeleton-line medium"></div>
      <div class="skeleton-actions">
        <div class="skeleton skeleton-pill"></div>
        <div class="skeleton skeleton-pill"></div>
      </div>
    </article>
  `;
  postsList.innerHTML = new Array(count).fill(skeleton).join("");
}

async function refreshCurrentUser() {
  const data = await getMe();
  currentUser = data.user;
}

function renderPosts() {
  const followingSet = new Set(currentUser.following || []);
  postsList.innerHTML = posts.length
    ? posts.map((post) => renderPostCard(post, currentUser.id, { followingSet })).join("")
    : renderEmptyStateCard({
        icon: "fa-seedling",
        title: "No posts in your feed yet",
        description: "Follow people or publish your first post to start building your timeline.",
        actionText: "Start your first post",
      });
}

function flashTarget(el, className) {
  if (!el) {
    return;
  }
  el.classList.remove(className);
  // Reflow ensures animation restarts even on repeated targeting.
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, 2200);
}

function clearNotificationQuery() {
  if (!window.location.search) {
    return;
  }
  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", cleanUrl);
}

function applyNotificationTargetFocus() {
  const postId = String(pendingNotificationTarget.postId || "").trim();
  if (!postId) {
    return;
  }

  const postEl = postsList?.querySelector(`.post[data-post-id="${CSS.escape(postId)}"]`);
  if (!postEl) {
    return;
  }

  const commentId = String(pendingNotificationTarget.commentId || "").trim();
  const commentEl = commentId
    ? postEl.querySelector(`.comment[data-comment-id="${CSS.escape(commentId)}"]`)
    : null;

  const target = commentEl || postEl;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  flashTarget(postEl, "post-notification-focus");
  if (commentEl) {
    flashTarget(commentEl, "comment-notification-focus");
  }

  pendingNotificationTarget = { postId: "", commentId: "" };
  clearNotificationQuery();
}

function renderSuggestedUsers() {
  if (!suggestedUsersEl) {
    return;
  }

  const followingSet = new Set(currentUser.following || []);

  suggestedUsersEl.innerHTML = suggestedUsers.length
    ? suggestedUsers
        .map((user) => {
          const isFollowing = followingSet.has(user.id);
          return renderUserMiniCard(user, {
            showButton: true,
            buttonClass: "js-suggest-follow",
            buttonIcon: isFollowing ? "fa-user-minus" : "fa-user-plus",
            buttonText: isFollowing ? "Unfollow" : "Follow",
            buttonDataAttr: `data-user-id="${user.id}"`,
            subtitle: `${user.followers.length} followers`,
          });
        })
        .join("")
    : renderEmptyStateCard({
        icon: "fa-user-check",
        title: "No suggestions right now",
        description: "You are already connected with most people in this community.",
        actionText: "Check back later",
      });
}

async function loadSuggestedUsers() {
  const data = await getSuggestedUsers();
  suggestedUsers = data.users;
  renderSuggestedUsers();
}

function renderSearchResults() {
  if (!userSearchResults) {
    return;
  }

  const followingSet = new Set(currentUser.following || []);
  userSearchResults.innerHTML = searchedUsers.length
    ? searchedUsers
        .map((user) => {
          const isFollowing = followingSet.has(user.id);
          return renderUserMiniCard(user, {
            showButton: true,
            buttonClass: "js-search-follow",
            buttonIcon: isFollowing ? "fa-user-minus" : "fa-user-plus",
            buttonText: isFollowing ? "Unfollow" : "Follow",
            buttonDataAttr: `data-user-id="${user.id}"`,
            subtitle: `ID: ${user.id}`,
          });
        })
        .join("")
    : renderEmptyStateCard({
        icon: "fa-user-xmark",
        title: "No user found",
        description: "Try a different name, username, or email.",
        actionText: "Search again",
      });
}

function getMentionQuery(inputElement) {
  const value = inputElement.value || "";
  const caret = inputElement.selectionStart ?? value.length;
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  return match ? match[1] : null;
}

function renderMentionSuggestions(container, users) {
  if (!container) {
    return;
  }

  if (!users.length) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }

  container.innerHTML = users
    .map((user) => {
      const displayName = user.displayName || user.username || "Unknown";
      return `
        <button type="button" class="mention-option js-mention-option" data-username="${user.username}">
          <span class="mention-option-name">${displayName}</span>
          <span class="mention-option-handle">@${user.username}</span>
        </button>
      `;
    })
    .join("");
  container.hidden = false;
}

function insertMention(inputElement, username) {
  const value = inputElement.value || "";
  const caret = inputElement.selectionStart ?? value.length;
  const prefix = value.slice(0, caret);
  const suffix = value.slice(caret);

  const replacedPrefix = prefix.replace(
    /(?:^|\s)@[A-Za-z0-9_]*$/,
    (segment) => segment.replace(/@[A-Za-z0-9_]*$/, `@${username}`)
  );
  const newValue = `${replacedPrefix} ${suffix}`;

  inputElement.value = newValue;
  const nextCaret = replacedPrefix.length + 1;
  inputElement.focus();
  inputElement.setSelectionRange(nextCaret, nextCaret);
}

async function loadPosts() {
  renderPostSkeleton();
  const data = await listPosts();
  posts = data.posts;
  renderPosts();
  applyNotificationTargetFocus();
}

postForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = contentInput.value.trim();
  const fallbackFiles = Array.from(postFileInput?.files || []);
  const sourceFiles = selectedPostFiles.length ? selectedPostFiles : fallbackFiles;
  const hasAttachments = sourceFiles.length > 0;

  if (!content && !hasAttachments) {
    showToast("Write something or add an attachment", "info");
    return;
  }

  try {
    const attachments = await buildAttachmentPayloads(sourceFiles);
    await createPost(content, attachments);
    clearComposer();
    showToast("Post published successfully", "success");
    await loadPosts();
  } catch (error) {
    showToast(error.message || "Failed to publish post", "error");
  }
});

postFileInput?.addEventListener("change", () => {
  appendSelectedFiles(postFileInput.files);
});

postFileList?.addEventListener("click", (event) => {
  const removeBtn = event.target.closest(".post-file-remove");
  if (!removeBtn) {
    return;
  }
  const index = Number(removeBtn.dataset.fileIndex);
  if (Number.isNaN(index) || index < 0 || index >= selectedPostFiles.length) {
    return;
  }
  selectedPostFiles.splice(index, 1);
  syncInputWithSelectedFiles();
  renderSelectedFiles();
});

postDropzone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  postDropzone.classList.add("active");
});

postDropzone?.addEventListener("dragleave", () => {
  postDropzone.classList.remove("active");
});

postDropzone?.addEventListener("drop", (event) => {
  event.preventDefault();
  postDropzone.classList.remove("active");
  const files = event.dataTransfer?.files;
  if (!files?.length) {
    return;
  }
  appendSelectedFiles(files);
});

postsList?.addEventListener("click", async (event) => {
  const mentionBtn = event.target.closest(".js-mention-option");
  if (mentionBtn) {
    const username = mentionBtn.dataset.username;
    const suggestionBox = mentionBtn.closest(".mention-suggestions");
    const form = mentionBtn.closest(".comment-form");
    const input = form?.querySelector("input[name='comment']");
    if (username && input) {
      insertMention(input, username);
    }
    if (suggestionBox) {
      suggestionBox.hidden = true;
      suggestionBox.innerHTML = "";
    }
    return;
  }

  const likeBtn = event.target.closest(".js-like");
  const followBtn = event.target.closest(".js-follow");

  if (likeBtn) {
    const postId = likeBtn.dataset.postId;
    const post = posts.find((item) => item.id === postId);
    const liked = post?.likes.includes(currentUser.id);
    if (liked) {
      await unlikePost(postId);
    } else {
      await likePost(postId);
    }
    await loadPosts();
  }

  if (followBtn) {
    const userId = followBtn.dataset.userId;
    const isFollowing = (currentUser.following || []).includes(userId);
    if (isFollowing) {
      await unfollowUser(userId);
      showToast("Unfollowed successfully", "info");
    } else {
      await followUser(userId);
      showToast("Followed successfully", "success");
    }
    await refreshCurrentUser();
    await loadPosts();
    await loadSuggestedUsers();
  }
});

postsList?.addEventListener("input", async (event) => {
  const input = event.target.closest(".comment-form input[name='comment']");
  if (!input) {
    return;
  }

  const form = input.closest(".comment-form");
  const suggestionBox = form?.querySelector(".mention-suggestions");
  if (!suggestionBox) {
    return;
  }

  const query = getMentionQuery(input);
  if (query === null) {
    renderMentionSuggestions(suggestionBox, []);
    return;
  }

  const requestId = (mentionRequestVersion.get(input) || 0) + 1;
  mentionRequestVersion.set(input, requestId);

  if (!query) {
    renderMentionSuggestions(suggestionBox, []);
    return;
  }

  try {
    const data = await searchUsersByName(query);
    if (mentionRequestVersion.get(input) !== requestId) {
      return;
    }

    const users = (data.users || [])
      .filter((user) => user.username)
      .slice(0, 5);
    renderMentionSuggestions(suggestionBox, users);
  } catch {
    renderMentionSuggestions(suggestionBox, []);
  }
});

suggestedUsersEl?.addEventListener("click", async (event) => {
  const followBtn = event.target.closest(".js-suggest-follow");
  if (!followBtn) {
    return;
  }

  const userId = followBtn.dataset.userId;
  const isFollowing = (currentUser.following || []).includes(userId);

  if (isFollowing) {
    await unfollowUser(userId);
    showToast("Unfollowed successfully", "info");
  } else {
    await followUser(userId);
    showToast("Followed successfully", "success");
  }

  await refreshCurrentUser();
  await loadSuggestedUsers();
  await loadPosts();
});

userSearchResults?.addEventListener("click", async (event) => {
  const followBtn = event.target.closest(".js-search-follow");
  if (!followBtn) {
    return;
  }

  const userId = followBtn.dataset.userId;
  const isFollowing = (currentUser.following || []).includes(userId);

  if (isFollowing) {
    await unfollowUser(userId);
    showToast("Unfollowed successfully", "info");
  } else {
    await followUser(userId);
    showToast("Followed successfully", "success");
  }

  await refreshCurrentUser();
  await loadSuggestedUsers();
  await loadPosts();
  renderSearchResults();
});

userSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = userSearchInput.value.trim();
  if (!query) {
    searchedUsers = [];
    renderSearchResults();
    return;
  }

  const data = await searchUsersByName(query);
  searchedUsers = data.users || [];
  renderSearchResults();
});

postsList?.addEventListener("submit", async (event) => {
  const commentForm = event.target.closest(".comment-form");
  if (!commentForm) {
    return;
  }

  event.preventDefault();
  const postId = commentForm.dataset.postId;
  const input = commentForm.querySelector("input[name='comment']");
  const text = input.value.trim();
  if (!text) {
    return;
  }
  await addComment(postId, text);
  const suggestionBox = commentForm.querySelector(".mention-suggestions");
  if (suggestionBox) {
    suggestionBox.hidden = true;
    suggestionBox.innerHTML = "";
  }
  await loadPosts();
});

await refreshCurrentUser();
await loadPosts();
await loadSuggestedUsers();
