import { config } from "../config.js";
import { handleMockRequest } from "./mockServer.js";

function withBase(url) {
  return `${config.API_BASE_URL}${url}`;
}

export async function request(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const payload = {
    ...options,
    headers
  };

  const response = config.USE_MOCK_API
    ? await handleMockRequest(url, payload)
    : await fetch(withBase(url), payload);

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }
  return data;
}
