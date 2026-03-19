import { endpoints } from "../api/endpoints.js";
import { request } from "../api/http.js";
import { authHeader } from "../utils/session.js";

export async function getUserById(userId) {
  return request(endpoints.users.byId(userId), { method: "GET" });
}

export async function getPostsByUser(userId) {
  return request(endpoints.users.posts(userId), { method: "GET" });
}

export async function updateMyProfile(payload) {
  return request(endpoints.users.updateProfile, {
    method: "PUT",
    headers: authHeader(),
    body: JSON.stringify(payload)
  });
}

export async function getSuggestedUsers() {
  return request(endpoints.users.suggestions, {
    method: "GET",
    headers: authHeader()
  });
}

export async function searchUsersByName(query) {
  return request(endpoints.users.search(query), {
    method: "GET",
    headers: authHeader()
  });
}

export async function getFollowers(userId) {
  return request(endpoints.users.followers(userId), { method: "GET" });
}

export async function getFollowing(userId) {
  return request(endpoints.users.following(userId), { method: "GET" });
}

export async function followUser(userId) {
  return request(endpoints.users.follow(userId), {
    method: "POST",
    headers: authHeader()
  });
}

export async function unfollowUser(userId) {
  return request(endpoints.users.follow(userId), {
    method: "DELETE",
    headers: authHeader()
  });
}
