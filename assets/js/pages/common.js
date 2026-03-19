import { clearSession, getSession } from "../utils/session.js";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notificationService.js";

const THEME_KEY = "bondify-theme";
const TRANSITION_MS = 190;
let isNavigating = false;

function detectDefaultTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);

  const toggleButtons = document.querySelectorAll("[data-theme-toggle]");
  toggleButtons.forEach((button) => {
    button.classList.add("theme-toggle");
    button.classList.toggle("is-dark", theme === "dark");

    const icon = button.querySelector(".theme-icon i");
    const label = button.querySelector(".theme-label");
    if (icon) {
      icon.classList.remove("fa-sun", "fa-moon");
      icon.classList.add(theme === "dark" ? "fa-sun" : "fa-moon");
    }
    if (label) {
      label.textContent = theme === "dark" ? "Light" : "Dark";
    }

    button.classList.remove("morphing");
    // Triggered reflow lets the icon animation replay on each mode switch.
    void button.offsetWidth;
    button.classList.add("morphing");
    button.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  });
}

function wireThemeToggle() {
  const currentTheme = detectDefaultTheme();
  setTheme(currentTheme);

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    if (button.dataset.boundThemeToggle === "true") {
      return;
    }

    button.dataset.boundThemeToggle = "true";
    button.addEventListener("click", () => {
      const now = document.documentElement.getAttribute("data-theme") || "light";
      setTheme(now === "dark" ? "light" : "dark");
    });
  });
}

function wireActiveNav() {
  const current = window.location.pathname.split("/").pop();
  if (!current) {
    return;
  }

  const links = document.querySelectorAll(".topnav a[href]");
  links.forEach((link) => {
    const target = link.getAttribute("href")?.split("/").pop();
    if (target === current) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
  });
}

export function navigateWithTransition(url) {
  if (!url || isNavigating) {
    return;
  }

  isNavigating = true;
  document.body.classList.add("page-leave");
  window.setTimeout(() => {
    window.location.href = url;
  }, TRANSITION_MS);
}

function wireRouteTransitions() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) {
      return;
    }

    const link = event.target.closest("a[href]");
    if (!link) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || link.target === "_blank" || link.hasAttribute("download")) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const resolved = new URL(href, window.location.href);
    if (resolved.origin !== window.location.origin) {
      return;
    }

    const isHtmlRoute = resolved.pathname.endsWith(".html") || !resolved.pathname.includes(".");
    const isSamePage =
      resolved.pathname === window.location.pathname && resolved.search === window.location.search;

    if (!isHtmlRoute || isSamePage) {
      return;
    }

    event.preventDefault();
    navigateWithTransition(resolved.pathname + resolved.search + resolved.hash);
  });
}

function initPageTransitionIn() {
  document.body.classList.add("page-enter");
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.remove("page-enter");
    });
  });
}

function formatNotificationTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function notificationIcon(type) {
  if (type === "mention") {
    return "fa-at";
  }
  if (type === "new_post") {
    return "fa-square-plus";
  }
  return "fa-bell";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wireNotifications() {
  const button = document.getElementById("notifications-btn");
  const panel = document.getElementById("notifications-panel");
  const countBadge = document.getElementById("notif-count");
  const session = getSession();

  if (!button || !panel || !countBadge || !session?.token) {
    return;
  }

  let notifications = [];

  function renderPanel() {
    if (!notifications.length) {
      panel.innerHTML = `
        <div class="notifications-head">
          <strong>Notifications</strong>
        </div>
        <div class="notifications-empty">No notifications yet.</div>
      `;
      return;
    }

    const unreadCount = notifications.filter((item) => !item.read).length;

    panel.innerHTML = `
      <div class="notifications-head">
        <strong>Notifications</strong>
        <button type="button" class="notifications-read-all" ${unreadCount ? "" : "disabled"}>Mark all read</button>
      </div>
      <div class="notifications-list">
        ${notifications
          .map(
            (item) => `
              <button type="button" class="notification-item ${item.read ? "" : "unread"}" data-notification-id="${item.id}" data-post-id="${item.postId || ""}" data-comment-id="${item.commentId || ""}">
                <div class="notification-icon"><i class="fa-solid ${notificationIcon(item.type)}"></i></div>
                <div class="notification-body">
                  <div class="notification-text">${escapeHtml(item.message)}</div>
                  <div class="notification-time">${formatNotificationTime(item.createdAt)}</div>
                </div>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function updateBadge(unreadCount) {
    countBadge.textContent = String(unreadCount);
    countBadge.hidden = unreadCount <= 0;
  }

  async function refreshNotifications() {
    try {
      const data = await getNotifications();
      notifications = data.notifications || [];
      updateBadge(data.unreadCount || 0);
      renderPanel();
    } catch {
      // Keep UI non-blocking on temporary network/API issues.
    }
  }

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const isHidden = panel.hidden;
    if (isHidden) {
      await refreshNotifications();
    }
    panel.hidden = !isHidden;
  });

  panel.addEventListener("click", async (event) => {
    const readAllBtn = event.target.closest(".notifications-read-all");
    if (readAllBtn) {
      await markAllNotificationsRead();
      await refreshNotifications();
      return;
    }

    const item = event.target.closest(".notification-item");
    if (!item) {
      return;
    }

    const notificationId = item.dataset.notificationId;
    const targetPostId = String(item.dataset.postId || "").trim();
    const targetCommentId = String(item.dataset.commentId || "").trim();
    if (notificationId) {
      await markNotificationRead(notificationId);
      await refreshNotifications();
    }
    panel.hidden = true;

    const query = new URLSearchParams();
    if (targetPostId) {
      query.set("postId", targetPostId);
    }
    if (targetCommentId) {
      query.set("commentId", targetCommentId);
    }

    const targetUrl = query.toString() ? `./feed.html?${query.toString()}` : "./feed.html";
    navigateWithTransition(targetUrl);
  });

  document.addEventListener("click", (event) => {
    if (panel.hidden) {
      return;
    }
    if (panel.contains(event.target) || button.contains(event.target)) {
      return;
    }
    panel.hidden = true;
  });

  refreshNotifications();
  window.setInterval(refreshNotifications, 15000);
}

function initCommonUi() {
  wireThemeToggle();
  wireActiveNav();
  wireRouteTransitions();
  initPageTransitionIn();
  wireNotifications();
}

export function requireAuth() {
  const session = getSession();
  if (!session?.token) {
    navigateWithTransition("./login.html");
    return null;
  }
  return session;
}

export function redirectIfAuthenticated() {
  const session = getSession();
  if (session?.token) {
    navigateWithTransition("./feed.html");
  }
}

export function wireLogoutButton(buttonId = "logout-btn") {
  const logoutBtn = document.getElementById(buttonId);
  if (!logoutBtn) {
    return;
  }
  logoutBtn.addEventListener("click", () => {
    clearSession();
    navigateWithTransition("./login.html");
  });
}

initCommonUi();
