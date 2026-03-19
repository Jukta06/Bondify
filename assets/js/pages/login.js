import { login } from "../services/authService.js";
import { saveSession } from "../utils/session.js";
import { showMessage } from "../utils/ui.js";
import { navigateWithTransition, redirectIfAuthenticated } from "./common.js";

redirectIfAuthenticated();

const form = document.getElementById("login-form");
const message = document.getElementById("message");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;

  try {
    const data = await login({ email, password });
    saveSession({ token: data.token, user: data.user });
    showMessage(message, "Login successful");
    navigateWithTransition("./feed.html");
  } catch (error) {
    showMessage(message, error.message, true);
  }
});
