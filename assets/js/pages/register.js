import { register } from "../services/authService.js";
import { showMessage } from "../utils/ui.js";
import { navigateWithTransition, redirectIfAuthenticated } from "./common.js";

redirectIfAuthenticated();

const form = document.getElementById("register-form");
const message = document.getElementById("message");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = document.getElementById("username")?.value?.trim();
  const displayName = document.getElementById("display-name")?.value?.trim();
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;

  try {
    await register({ username, displayName, email, password });
    showMessage(message, "Registration successful. Please login.");
    form.reset();
    setTimeout(() => {
      navigateWithTransition("./login.html");
    }, 600);
  } catch (error) {
    showMessage(message, error.message, true);
  }
});
