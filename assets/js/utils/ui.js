export function showMessage(element, text, isError = false) {
  if (!element) {
    return;
  }
  element.textContent = text;
  element.style.color = isError ? "#b91c1c" : "#065f46";
}

let toastTimer = null;

export function showToast(message, type = "success") {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }

  let container = document.getElementById("app-toast");
  if (!container) {
    container = document.createElement("div");
    container.id = "app-toast";
    container.className = "app-toast";
    document.body.appendChild(container);
  }

  container.textContent = text;
  container.classList.remove("error", "info", "show");
  if (type === "error") {
    container.classList.add("error");
  } else if (type === "info") {
    container.classList.add("info");
  }

  // Restart enter animation cleanly for repeated toasts.
  void container.offsetWidth;
  container.classList.add("show");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    container?.classList.remove("show");
  }, 1800);
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString();
}

function renderMentionsInText(value) {
  const escaped = escapeHtml(value || "");
  return escaped.replace(/(^|\s)@([A-Za-z0-9_]+)/g, "$1<span class=\"mention-tag\">@$2</span>");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function avatarFromUser(user) {
  const name = user.displayName || user.username || "User";
  return (
    user.profilePhoto ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2f9e65&color=ffffff`
  );
}

export function renderEmptyStateCard({
  icon = "fa-box-open",
  title = "Nothing to show",
  description = "There is no content right now.",
  actionText = "Create one",
} = {}) {
  return `
    <article class="empty-state-card">
      <div class="empty-state-icon"><i class="fa-solid ${icon}"></i></div>
      <h3>${title}</h3>
      <p class="muted">${description}</p>
      <span class="empty-state-action"><i class="fa-solid fa-sparkles"></i> ${actionText}</span>
    </article>
  `;
}

export function renderUserMiniCard(user, options = {}) {
  const {
    buttonClass = "",
    buttonText = "",
    buttonIcon = "fa-user-plus",
    buttonDataAttr = "",
    showButton = false,
    subtitle = "",
  } = options;

  const fullName = user.displayName || user.username || "Unknown";
  const handle = user.username ? `@${user.username}` : "";
  const avatar = avatarFromUser(user);

  return `
    <article class="network-user-card">
      <img src="${escapeHtml(avatar)}" alt="${escapeHtml(fullName)} avatar" class="network-user-avatar" />
      <div class="network-user-body">
        <div class="network-user-name">${escapeHtml(fullName)}</div>
        <div class="muted network-user-handle">${escapeHtml(handle)}</div>
        ${subtitle ? `<div class="muted network-user-subtitle">${escapeHtml(subtitle)}</div>` : ""}
      </div>
      ${
        showButton
          ? `<button class="btn small ${buttonClass}" ${buttonDataAttr}><i class="fa-solid ${buttonIcon}"></i> ${escapeHtml(buttonText)}</button>`
          : ""
      }
    </article>
  `;
}

export function renderPostCard(post, currentUserId, options = {}) {
  const isLiked = post.likes.includes(currentUserId);
  const canFollow = post.author && post.author.id !== currentUserId;
  const amFollowing = options.followingSet?.has(post.author?.id);
  const authorName = post.author?.displayName || post.author?.username || "Unknown";
  const authorHandle = post.author?.username ? `@${post.author.username}` : "";
  const followButton = canFollow
    ? `<button class="btn small js-follow" data-user-id="${post.author.id}"><i class="fa-solid ${amFollowing ? "fa-user-minus" : "fa-user-plus"}"></i> ${amFollowing ? "Unfollow" : "Follow"}</button>`
    : "";

  const commentsHtml = post.comments
    .map(
      (comment) =>
        `<div class="comment" data-comment-id="${escapeHtml(comment.id || "")}"><strong>${escapeHtml(comment.author?.username || "Unknown")}</strong>: ${renderMentionsInText(comment.text)}</div>`
    )
    .join("");

  const attachments = Array.isArray(post.attachments)
    ? post.attachments
    : post.attachment
      ? [post.attachment]
      : [];

  if (!attachments.length) {
    const legacyData = post.postMediaData || post.post_media_data || "";
    const legacyName = post.postMediaName || post.post_media_name || "attachment";
    const legacyType = post.postMediaType || post.post_media_type || "application/octet-stream";
    if (legacyData) {
      attachments.push({
        name: legacyName,
        type: legacyType,
        data: legacyData,
      });
    }
  }

  const imageAttachments = attachments.filter(
    (item) => item?.data && String(item.type || "").startsWith("image/")
  );
  const fileAttachments = attachments.filter(
    (item) => item?.data && !String(item.type || "").startsWith("image/")
  );

  const imageHtml = imageAttachments.length
    ? `<div class="post-attachment-gallery">${imageAttachments
        .map(
          (attachment) =>
            `<div class="post-attachment image"><img src="${escapeHtml(attachment.data)}" alt="Post image attachment" /></div>`
        )
        .join("")}</div>`
    : "";

  const fileHtml = fileAttachments.length
    ? `<div class="post-attachment-files">${fileAttachments
        .map(
          (attachment) => `
            <div class="post-attachment file">
              <div class="post-attachment-meta">
                <i class="fa-solid fa-paperclip"></i>
                <span>${escapeHtml(attachment.name || "Attached file")}</span>
              </div>
              <a class="post-attachment-download" href="${escapeHtml(attachment.data)}" download="${escapeHtml(
                attachment.name || "attachment"
              )}">
                <i class="fa-solid fa-download"></i> Download
              </a>
            </div>
          `
        )
        .join("")}</div>`
    : "";

  const attachmentHtml = imageHtml || fileHtml ? `<div class="post-attachments-wrap">${imageHtml}${fileHtml}</div>` : "";

  return `
    <article class="post" data-post-id="${post.id}">
      <div class="post-meta">
        <span class="post-author"><i class="fa-solid fa-circle-user"></i><strong>${authorName}</strong> <span class="muted">${authorHandle}</span></span>
        <span class="post-time"><i class="fa-regular fa-clock"></i> ${formatDate(post.createdAt)}</span>
      </div>
      <div class="post-content">${post.content}</div>
      ${attachmentHtml}
      <div class="post-actions">
        <button class="btn small js-like" data-post-id="${post.id}"><i class="fa-solid ${isLiked ? "fa-heart-crack" : "fa-heart"}"></i> ${isLiked ? "Unlike" : "Like"} (${post.likes.length})</button>
        ${followButton}
      </div>
      <div class="comments">
        <div class="muted comments-title"><i class="fa-regular fa-comments"></i> Comments (${post.comments.length})</div>
        <div>${commentsHtml || "<div class='muted'>No comments yet.</div>"}</div>
        <form class="comment-form" data-post-id="${post.id}">
          <input type="text" name="comment" placeholder="Write a comment (use @username to mention)" required />
          <button class="btn small" type="submit"><i class="fa-solid fa-reply"></i> Comment</button>
          <div class="mention-suggestions" hidden></div>
        </form>
      </div>
    </article>
  `;
}
