const form = document.getElementById("loginForm");
const error = document.getElementById("loginError");
const button = document.getElementById("loginBtn");
const url = (path) => new URL(path, location.origin + location.pathname);
let setupMode = false;

// First start: no login exists yet, so this page creates one.
fetch(url("api/auth-state")).then(r => r.json()).then(state => {
  if (!state.setup_needed) return;
  setupMode = true;
  document.title = "Create your login · Glancer";
  document.getElementById("loginLead").textContent =
    "Welcome! Choose the username and password you will use to sign in to Glancer.";
  document.getElementById("confirmField").hidden = false;
  document.getElementById("passwordHint").hidden = false;
  form.password.autocomplete = "new-password";
  button.textContent = "Create login";
}).catch(() => {});

function fail(message) {
  error.textContent = message;
  error.hidden = false;
  button.disabled = false;
  button.textContent = setupMode ? "Create login" : "Sign in";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  if (setupMode && form.password.value !== form.confirm.value) {
    fail("The two passwords are different.");
    form.confirm.select();
    return;
  }
  button.disabled = true;
  button.textContent = setupMode ? "Creating…" : "Signing in…";
  try {
    const r = await fetch(url(setupMode ? "api/setup" : "api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.username.value, password: form.password.value }),
    });
    if (r.ok) {
      location.replace("./" + (location.hash || ""));
      return;
    }
    const data = await r.json().catch(() => ({}));
    fail(data.detail || `Sign-in failed (HTTP ${r.status})`);
  } catch {
    fail("Cannot reach Glancer.");
  }
  form.password.select();
});
