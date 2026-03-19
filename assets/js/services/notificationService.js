import { endpoints } from "../api/endpoints.js";
import { request } from "../api/http.js";
import { authHeader } from "../utils/session.js";

export async function getNotifications() {
  return request(endpoints.notifications.list, {
    method: "GET",
    headers: authHeader(),
  });
}

export async function markNotificationRead(notificationId) {
  return request(endpoints.notifications.read(notificationId), {
    method: "PUT",
    headers: authHeader(),
  });
}

export async function markAllNotificationsRead() {
  return request(endpoints.notifications.readAll, {
    method: "PUT",
    headers: authHeader(),
  });
}
