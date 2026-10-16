/**
 * Early diagnostics: remembers uncaught errors so the headless self-test
 * (and the log) can show them. Loaded as a classic script, before ui.js.
 */
window.__uiErrors = [];
window.addEventListener("error", (e) => {
  const msg = String((e && e.message) || e);
  window.__uiErrors.push(msg);
  console.error("[sf-ui]", msg, (e && e.filename) || "", (e && e.lineno) || "");
});
window.addEventListener("unhandledrejection", (e) => {
  const msg =
    "promise: " +
    String((e && e.reason && e.reason.message) || (e && e.reason));
  window.__uiErrors.push(msg);
  console.error("[sf-ui]", msg);
});
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("desktop-app");
});
