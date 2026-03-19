import { config } from "../config.js";

export function saveSession(session) {
  localStorage.setItem(config.STORAGE_SESSION_KEY, JSON.stringify(session));
}

export function getSession() {
  const raw = localStorage.getItem(config.STORAGE_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(config.STORAGE_SESSION_KEY);
}

export function authHeader() {
  const session = getSession();
  if (!session?.token) {
    return {};
  }
  return {
    Authorization: `Bearer ${session.token}`
  };
}
