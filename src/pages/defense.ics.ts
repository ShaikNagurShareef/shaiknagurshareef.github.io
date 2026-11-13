import type { APIRoute } from "astro";
import { getDefense, toIcs } from "../lib/defense";

/** Add-to-calendar file for the Ph.D. defense (Apple Calendar, Outlook, Google import). */
export const GET: APIRoute = async () => {
  const d = await getDefense();
  if (!d) return new Response("No defense scheduled.", { status: 404 });
  return new Response(toIcs(d), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="phd-defense.ics"' },
  });
};
