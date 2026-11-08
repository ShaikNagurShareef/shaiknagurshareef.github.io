/**
 * Shared behaviour for the contact and feedback forms: native validation, a honeypot field and the
 * time-to-fill signal for the server's spam check, a busy state on the submit button, and an
 * accessible status region for errors.
 */
import { SPACE_API } from "./api";

export const apiBase = () => new URLSearchParams(location.search).get("visit_api") || SPACE_API;

export function wireForm(
  form: HTMLFormElement,
  endpoint: string,
  build: (data: FormData) => Record<string, unknown>,
  onSuccess: (data: FormData, response: Record<string, unknown>) => void,
) {
  const started = Date.now();
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const label = button.innerHTML;
  const status = form.querySelector<HTMLElement>("[data-form-status]")!;

  // Live character counters for any <textarea data-counter>.
  form.querySelectorAll<HTMLTextAreaElement>("textarea[data-counter]").forEach((ta) => {
    const out = form.querySelector<HTMLElement>(`[data-count-for="${ta.name}"]`);
    const update = () => { if (out) out.textContent = `${ta.value.length.toLocaleString()} / ${ta.maxLength.toLocaleString()}`; };
    ta.addEventListener("input", update);
    update();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    status.hidden = true;
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      const r = await fetch(apiBase() + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...build(data), website: String(data.get("website") || ""), elapsed: Date.now() - started }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = Array.isArray(body.detail) ? "Please check the highlighted fields." : body.detail;
        throw new Error(detail || `Something went wrong (HTTP ${r.status}).`);
      }
      onSuccess(data, body);
    } catch (err) {
      const msg = err instanceof TypeError
        ? "Couldn't reach the server. It may be waking up after being idle; please try again in a minute."
        : (err as Error).message;
      status.textContent = msg;
      status.hidden = false;
    } finally {
      button.disabled = false;
      button.innerHTML = label;
    }
  });
}
