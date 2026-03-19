export const endpoints = {
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login"
  },
  users: {
    me: "/api/users/me",
    updateProfile: "/api/users/me/profile",
    suggestions: "/api/users/suggestions",
    search: (query) => `/api/users/search?q=${encodeURIComponent(query)}`,
    byId: (userId) => `/api/users/${userId}`,
    posts: (userId) => `/api/users/${userId}/posts`,
    follow: (userId) => `/api/users/${userId}/follow`,
    followers: (userId) => `/api/users/${userId}/followers`,
    following: (userId) => `/api/users/${userId}/following`
  },
  posts: {
    list: "/api/posts",
    create: "/api/posts",
    like: (postId) => `/api/posts/${postId}/likes`,
    comments: (postId) => `/api/posts/${postId}/comments`
  },
  notifications: {
    list: "/api/notifications",
    readAll: "/api/notifications/read-all",
    read: (notificationId) => `/api/notifications/${notificationId}/read`
  }
};
