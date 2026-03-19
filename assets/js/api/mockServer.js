import { config } from "../config.js";

function now() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMedia(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^data:image\/[^;,]+(?:;[^;,=]+=[^;,]+)*;base64,[a-z0-9+/=\r\n]+$/i.test(raw)) {
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) {
    return "";
  }
  try {
    new URL(raw);
    return raw;
  } catch {
    return "";
  }
}

function normalizeAttachment(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const name = String(value.name || "").trim().slice(0, 255);
  const type = String(value.type || "application/octet-stream").trim().slice(0, 120);
  const data = String(value.data || "").trim();

  if (!name || !data) {
    return null;
  }

  if (!/^data:[^;,]+\/[^;,]+(?:;[^;,=]+=[^;,]+)*;base64,[a-z0-9+/=\r\n]+$/i.test(data)) {
    return null;
  }

  return { name, type, data };
}

function normalizeAttachments(body) {
  const list = [];
  const items = Array.isArray(body?.attachments) ? body.attachments : [];

  items.forEach((item) => {
    const entry = normalizeAttachment(item);
    if (entry && list.length < 5) {
      list.push(entry);
    }
  });

  if (!list.length) {
    const single = normalizeAttachment(body?.attachment);
    if (single) {
      list.push(single);
    }
  }

  return list;
}

function parseToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }
  if (!token.startsWith("mock-token:")) {
    return null;
  }
  return token.split(":")[1] || null;
}

function getInitialDb() {
  return {
    users: [],
    posts: [],
    notifications: []
  };
}

function loadDb() {
  const raw = localStorage.getItem(config.STORAGE_DB_KEY);
  if (!raw) {
    const initial = getInitialDb();
    localStorage.setItem(config.STORAGE_DB_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const reset = getInitialDb();
    localStorage.setItem(config.STORAGE_DB_KEY, JSON.stringify(reset));
    return reset;
  }
}

function saveDb(db) {
  try {
    localStorage.setItem(config.STORAGE_DB_KEY, JSON.stringify(db));
  } catch {
    throw new Error("Storage limit exceeded. Use smaller images and try again.");
  }
}

function ensureNotifications(db) {
  if (!Array.isArray(db.notifications)) {
    db.notifications = [];
  }
}

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

function enrichPost(db, post) {
  const author = db.users.find((u) => u.id === post.userId);
  const attachments = Array.isArray(post.attachments)
    ? post.attachments
    : post.attachment
      ? [post.attachment]
      : [];
  return {
    ...post,
    attachments,
    attachment: attachments[0] || null,
    author: author ? sanitizeUser(author) : null,
    comments: post.comments.map((comment) => {
      const user = db.users.find((u) => u.id === comment.userId);
      return {
        ...comment,
        author: user ? sanitizeUser(user) : null
      };
    })
  };
}

function overlapCount(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return 0;
  }
  const setB = new Set(b);
  return a.reduce((acc, item) => (setB.has(item) ? acc + 1 : acc), 0);
}

function extractMentionUsernames(text) {
  const matches = String(text || "").match(/(?:^|\s)@([A-Za-z0-9_]+)/g) || [];
  const seen = new Set();
  const users = [];

  matches.forEach((entry) => {
    const username = entry.replace(/^\s*@/, "").trim();
    const key = username.toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    users.push(username);
  });

  return users;
}

function createNotification(db, payload) {
  const userId = String(payload?.userId || "").trim();
  const type = String(payload?.type || "").trim();
  const message = String(payload?.message || "").trim();

  if (!userId || !type || !message) {
    return;
  }

  ensureNotifications(db);
  db.notifications.unshift({
    id: uid("ntf"),
    userId,
    type,
    message,
    relatedUserId: payload?.relatedUserId || null,
    postId: payload?.postId || null,
    commentId: payload?.commentId || null,
    read: false,
    createdAt: now(),
    readAt: null,
  });
}

function notifyFollowersOnPost(db, authorId, postId) {
  const author = db.users.find((u) => u.id === authorId);
  if (!author) {
    return;
  }

  const displayName = String(author.displayName || author.username || "Someone");
  db.users.forEach((user) => {
    if (user.id === authorId) {
      return;
    }
    if ((user.following || []).includes(authorId)) {
      createNotification(db, {
        userId: user.id,
        type: "new_post",
        message: `${displayName} posted a new update.`,
        relatedUserId: authorId,
        postId,
      });
    }
  });
}

function notifyMentionsOnComment(db, actorId, postId, commentId, text) {
  const actor = db.users.find((u) => u.id === actorId);
  const displayName = String(actor?.displayName || actor?.username || "Someone");
  const mentions = extractMentionUsernames(text);
  const delivered = new Set();

  mentions.forEach((username) => {
    const target = db.users.find(
      (u) =>
        String(u.username || "").toLowerCase() === username.toLowerCase() ||
        String(u.displayName || u.username || "").toLowerCase() === username.toLowerCase()
    );

    if (!target || target.id === actorId || delivered.has(target.id)) {
      return;
    }

    delivered.add(target.id);
    createNotification(db, {
      userId: target.id,
      type: "mention",
      message: `${displayName} mentioned you in a comment.`,
      relatedUserId: actorId,
      postId,
      commentId,
    });
  });
}

function notificationsPayload(db, userId) {
  ensureNotifications(db);
  const notifications = db.notifications
    .filter((item) => item.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40)
    .map((item) => ({
      id: item.id,
      type: item.type,
      message: item.message,
      read: Boolean(item.read),
      createdAt: item.createdAt,
      postId: item.postId || null,
      commentId: item.commentId || null,
    }));

  const unreadCount = notifications.reduce((acc, item) => (item.read ? acc : acc + 1), 0);
  return { notifications, unreadCount };
}

function extractPostSignals(db, userId) {
  const posts = db.posts
    .filter((post) => post.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);

  const hashtags = new Set();
  const keywords = new Map();
  let latestPostTs = 0;

  posts.forEach((post) => {
    const content = String(post.content || "");
    const ts = new Date(post.createdAt).getTime() || 0;
    if (ts > latestPostTs) {
      latestPostTs = ts;
    }

    const tags = content.match(/#([A-Za-z0-9_]+)/g) || [];
    tags.forEach((tag) => hashtags.add(tag.slice(1).toLowerCase()));

    const words = content.toLowerCase().split(/[^A-Za-z0-9_]+/).filter(Boolean);
    words.forEach((word) => {
      if (word.length < 4) {
        return;
      }
      keywords.set(word, (keywords.get(word) || 0) + 1);
    });
  });

  const topKeywords = [...keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map((entry) => entry[0]);

  return {
    hashtags: [...hashtags],
    keywords: topKeywords,
    latestPostTs,
  };
}

function userInterestSignals(db, user) {
  const signals = extractPostSignals(db, user.id);
  const bioTerms = String(user.bio || "")
    .toLowerCase()
    .split(/[^A-Za-z0-9_]+/)
    .filter((term) => term.length >= 4);

  return [...new Set([...signals.hashtags, ...signals.keywords, ...bioTerms])];
}

function recencyScoreFromTimestamp(timestamp) {
  if (!timestamp) {
    return 0;
  }
  const days = Math.max(0, (Date.now() - timestamp) / 86400000);
  return 28 * Math.exp(-days / 14);
}

function newUserBoostScore(createdAt) {
  const ts = new Date(createdAt).getTime() || 0;
  if (!ts) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - ts) / 86400000);
  if (ageDays > 30) {
    return 0;
  }
  return 14 * (1 - ageDays / 30);
}

function suggestedUsers(db, meUser) {
  const followingSet = new Set(meUser.following || []);
  const meFollowers = meUser.followers || [];
  const meInterests = userInterestSignals(db, meUser);

  return db.users
    .filter((user) => user.id !== meUser.id && !followingSet.has(user.id))
    .map((candidate) => {
      const candidateInterests = userInterestSignals(db, candidate);
      const postSignals = extractPostSignals(db, candidate.id);
      const recentTs = postSignals.latestPostTs || new Date(candidate.createdAt).getTime() || 0;

      const mutualFollowers = overlapCount(candidate.followers || [], meUser.following || []);
      const mutualFollowing = overlapCount(candidate.following || [], meFollowers);
      const sharedInterests = overlapCount(candidateInterests, meInterests);

      const networkScore = mutualFollowers * 7 + mutualFollowing * 5;
      const interestScore = Math.min(28, sharedInterests * 4.5);
      const recentScore = recencyScoreFromTimestamp(recentTs);
      const newUserBoost = newUserBoostScore(candidate.createdAt);
      const popularitySafety = Math.min(18, (candidate.followers?.length || 0) * 1.6);
      const coldStartCompensation =
        (candidate.followers?.length || 0) === 0 && (candidate.following?.length || 0) === 0
          ? 6
          : 0;

      return {
        user: candidate,
        score:
          networkScore +
          interestScore +
          recentScore +
          newUserBoost +
          popularitySafety +
          coldStartCompensation,
      };
    })
    .sort((a, b) => {
      return b.score - a.score;
    })
    .slice(0, 8)
    .map((entry) => sanitizeUser(entry.user));
}

function requireAuth(headers, db) {
  const token = headers?.Authorization?.replace("Bearer ", "");
  const userId = parseToken(token);
  if (!userId) {
    throw new Error("Unauthorized");
  }
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data
  };
}

export async function handleMockRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  const body = options.body ? JSON.parse(options.body) : null;

  const db = loadDb();
  ensureNotifications(db);

  try {
    if (url === "/api/auth/register" && method === "POST") {
      const { username, displayName, email, password, bio, profilePhoto, coverPhoto } = body || {};
      if (!username || !email || !password) {
        return jsonResponse({ message: "All fields are required" }, false, 400);
      }
      const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        return jsonResponse({ message: "Email already registered" }, false, 409);
      }

      const user = {
        id: uid("usr"),
        username,
        displayName: String(displayName || "").trim() || username,
        email,
        password,
        bio: String(bio || "").trim(),
        profilePhoto: normalizeMedia(profilePhoto),
        coverPhoto: normalizeMedia(coverPhoto),
        followers: [],
        following: [],
        createdAt: now()
      };
      db.users.push(user);
      saveDb(db);
      return jsonResponse({ user: sanitizeUser(user) }, true, 201);
    }

    if (url === "/api/auth/login" && method === "POST") {
      const { email, password } = body || {};
      const user = db.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
      if (!user || user.password !== password) {
        return jsonResponse({ message: "Invalid credentials" }, false, 401);
      }
      return jsonResponse({
        token: `mock-token:${user.id}`,
        user: sanitizeUser(user)
      });
    }

    if (url === "/api/users/me" && method === "GET") {
      const current = requireAuth(headers, db);
      return jsonResponse({ user: sanitizeUser(current) });
    }

    if (url === "/api/users/suggestions" && method === "GET") {
      const current = requireAuth(headers, db);
      return jsonResponse({ users: suggestedUsers(db, current) });
    }

    const searchMatch = url.match(/^\/api\/users\/search\?q=(.*)$/);
    if (searchMatch && method === "GET") {
      const current = requireAuth(headers, db);
      const query = decodeURIComponent(searchMatch[1] || "").trim().toLowerCase();
      if (!query) {
        return jsonResponse({ users: [] });
      }

      const users = db.users
        .filter((user) => user.id !== current.id)
        .filter((user) => {
          const displayName = String(user.displayName || user.username || "").toLowerCase();
          const username = String(user.username || "").toLowerCase();
          const email = String(user.email || "").toLowerCase();
          return displayName.includes(query) || username.includes(query) || email.includes(query);
        })
        .slice(0, 12)
        .map((user) => sanitizeUser(user));

      return jsonResponse({ users });
    }

    if (url === "/api/users/me/profile" && (method === "PUT" || method === "PATCH")) {
      const current = requireAuth(headers, db);
      const displayName = String(body?.displayName || "").trim();
      const bio = String(body?.bio || "").trim();

      if (!displayName) {
        return jsonResponse({ message: "Display name is required" }, false, 400);
      }

      const dbUser = db.users.find((u) => u.id === current.id);
      dbUser.displayName = displayName;
      dbUser.bio = bio;
      dbUser.profilePhoto = normalizeMedia(body?.profilePhoto);
      dbUser.coverPhoto = normalizeMedia(body?.coverPhoto);
      saveDb(db);
      return jsonResponse({ user: sanitizeUser(dbUser) });
    }

    if (url === "/api/posts" && method === "GET") {
      const posts = db.posts
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => enrichPost(db, p));
      return jsonResponse({ posts });
    }

    if (url === "/api/posts" && method === "POST") {
      const current = requireAuth(headers, db);
      const content = String(body?.content || "").trim();
      const attachments = normalizeAttachments(body);
      if (!content && !attachments.length) {
        return jsonResponse({ message: "Post content or attachment is required" }, false, 400);
      }
      const post = {
        id: uid("pst"),
        userId: current.id,
        content,
        attachments,
        likes: [],
        comments: [],
        createdAt: now()
      };
      db.posts.push(post);
      notifyFollowersOnPost(db, current.id, post.id);
      saveDb(db);
      return jsonResponse({ post: enrichPost(db, post) }, true, 201);
    }

    if (url === "/api/notifications" && method === "GET") {
      const current = requireAuth(headers, db);
      return jsonResponse(notificationsPayload(db, current.id));
    }

    if (url === "/api/notifications/read-all" && (method === "PUT" || method === "PATCH")) {
      const current = requireAuth(headers, db);
      db.notifications.forEach((item) => {
        if (item.userId === current.id && !item.read) {
          item.read = true;
          item.readAt = now();
        }
      });
      saveDb(db);
      return jsonResponse(notificationsPayload(db, current.id));
    }

    const notificationReadMatch = url.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (notificationReadMatch && (method === "PUT" || method === "PATCH")) {
      const current = requireAuth(headers, db);
      const notification = db.notifications.find(
        (item) => item.id === notificationReadMatch[1] && item.userId === current.id
      );

      if (notification) {
        notification.read = true;
        notification.readAt = now();
      }

      saveDb(db);
      return jsonResponse(notificationsPayload(db, current.id));
    }

    const userByIdMatch = url.match(/^\/api\/users\/([^/]+)$/);
    if (userByIdMatch && method === "GET") {
      const user = db.users.find((u) => u.id === userByIdMatch[1]);
      if (!user) {
        return jsonResponse({ message: "User not found" }, false, 404);
      }
      return jsonResponse({ user: sanitizeUser(user) });
    }

    const userPostsMatch = url.match(/^\/api\/users\/([^/]+)\/posts$/);
    if (userPostsMatch && method === "GET") {
      const userId = userPostsMatch[1];
      const posts = db.posts
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((p) => enrichPost(db, p));
      return jsonResponse({ posts });
    }

    const followersMatch = url.match(/^\/api\/users\/([^/]+)\/followers$/);
    if (followersMatch && method === "GET") {
      const user = db.users.find((u) => u.id === followersMatch[1]);
      if (!user) {
        return jsonResponse({ message: "User not found" }, false, 404);
      }
      const users = (user.followers || [])
        .map((id) => db.users.find((u) => u.id === id))
        .filter(Boolean)
        .map((entry) => sanitizeUser(entry));
      return jsonResponse({ users });
    }

    const followingMatch = url.match(/^\/api\/users\/([^/]+)\/following$/);
    if (followingMatch && method === "GET") {
      const user = db.users.find((u) => u.id === followingMatch[1]);
      if (!user) {
        return jsonResponse({ message: "User not found" }, false, 404);
      }
      const users = (user.following || [])
        .map((id) => db.users.find((u) => u.id === id))
        .filter(Boolean)
        .map((entry) => sanitizeUser(entry));
      return jsonResponse({ users });
    }

    const followMatch = url.match(/^\/api\/users\/([^/]+)\/follow$/);
    if (followMatch && (method === "POST" || method === "DELETE")) {
      const current = requireAuth(headers, db);
      const targetId = followMatch[1];
      const target = db.users.find((u) => u.id === targetId);

      if (!target) {
        return jsonResponse({ message: "User not found" }, false, 404);
      }
      if (target.id === current.id) {
        return jsonResponse({ message: "Cannot follow yourself" }, false, 400);
      }

      const currentDbUser = db.users.find((u) => u.id === current.id);

      if (method === "POST") {
        if (!currentDbUser.following.includes(target.id)) {
          currentDbUser.following.push(target.id);
        }
        if (!target.followers.includes(currentDbUser.id)) {
          target.followers.push(currentDbUser.id);
        }
      } else {
        currentDbUser.following = currentDbUser.following.filter((id) => id !== target.id);
        target.followers = target.followers.filter((id) => id !== currentDbUser.id);
      }

      saveDb(db);
      return jsonResponse({ user: sanitizeUser(target), me: sanitizeUser(currentDbUser) });
    }

    const likeMatch = url.match(/^\/api\/posts\/([^/]+)\/likes$/);
    if (likeMatch && (method === "POST" || method === "DELETE")) {
      const current = requireAuth(headers, db);
      const post = db.posts.find((p) => p.id === likeMatch[1]);
      if (!post) {
        return jsonResponse({ message: "Post not found" }, false, 404);
      }

      if (method === "POST") {
        if (!post.likes.includes(current.id)) {
          post.likes.push(current.id);
        }
      } else {
        post.likes = post.likes.filter((id) => id !== current.id);
      }

      saveDb(db);
      return jsonResponse({ post: enrichPost(db, post) });
    }

    const commentsMatch = url.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if (commentsMatch && method === "POST") {
      const current = requireAuth(headers, db);
      const post = db.posts.find((p) => p.id === commentsMatch[1]);
      if (!post) {
        return jsonResponse({ message: "Post not found" }, false, 404);
      }

      const text = String(body?.text || "").trim();
      if (!text) {
        return jsonResponse({ message: "Comment text is required" }, false, 400);
      }

      const comment = {
        id: uid("cmt"),
        userId: current.id,
        text,
        createdAt: now()
      };
      post.comments.push(comment);
      notifyMentionsOnComment(db, current.id, post.id, comment.id, text);
      saveDb(db);
      return jsonResponse({ post: enrichPost(db, post) }, true, 201);
    }

    return jsonResponse({ message: "Not found" }, false, 404);
  } catch (error) {
    if (error.message === "Unauthorized") {
      return jsonResponse({ message: "Unauthorized" }, false, 401);
    }
    if (error.message.includes("Storage limit exceeded")) {
      return jsonResponse({ message: error.message }, false, 413);
    }
    return jsonResponse({ message: "Server error" }, false, 500);
  }
}
