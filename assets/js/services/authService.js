import { endpoints } from "../api/endpoints.js";
import { request } from "../api/http.js";
import { authHeader } from "../utils/session.js";

export async function register(payload) {
  return request(endpoints.auth.register, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function login(payload) {
  return request(endpoints.auth.login, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getMe() {
  return request(endpoints.users.me, {
    method: "GET",
    headers: authHeader()
  });
}
