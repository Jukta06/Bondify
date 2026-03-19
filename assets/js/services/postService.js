import { endpoints } from "../api/endpoints.js";
import { request } from "../api/http.js";
import { authHeader } from "../utils/session.js";

export async function listPosts() {
  return request(endpoints.posts.list, { method: "GET" });
}

export async function createPost(content, attachments = []) {
  return request(endpoints.posts.create, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ content, attachments })
  });
}

export async function likePost(postId) {
  return request(endpoints.posts.like(postId), {
    method: "POST",
    headers: authHeader()
  });
}

export async function unlikePost(postId) {
  return request(endpoints.posts.like(postId), {
    method: "DELETE",
    headers: authHeader()
  });
}

export async function addComment(postId, text) {
  return request(endpoints.posts.comments(postId), {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ text })
  });
}
