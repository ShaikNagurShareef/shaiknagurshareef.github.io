/** Ph.D. defense: one source of truth (content/research.json) for the banner, page, calendar file and links. */
import { getEntry } from "astro:content";

export async function getDefense() {
  const { dissertation } = (await getEntry("research", "research"))!.data;
  const d = dissertation.defense;
  if (!d) return null;
  const start = new Date(d.start);
  const end = new Date(d.end);
  const tz = "America/New_York";
  const dateLabel = start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz });
  const t = (x: Date) => x.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const timeLabel = `${t(start)} – ${t(end)} EST`;
  const title = "Ph.D. Dissertation Defense: Nagur Shareef Shaik";
  const location = `${d.venue}, ${d.address}`;
  const details = [
    `Dissertation: ${dissertation.title}`,
    `Advisor: Dr. ${dissertation.advisor}`,
    "",
    `In person: ${location}`,
    `Online (Microsoft Teams): ${d.teamsUrl}`,
    `Meeting ID: ${d.meetingId}`,
    `Passcode: ${d.passcode}`,
    "",
    "Details: https://shaiknagurshareef.github.io/defense/",
  ].join("\n");
  const utc = (x: Date) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const google = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE", text: title, dates: `${utc(start)}/${utc(end)}`, details, location,
  }).toString();
  const outlook = "https://outlook.office.com/calendar/0/deeplink/compose?" + new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: title,
    startdt: start.toISOString(), enddt: end.toISOString(), location, body: details,
  }).toString();

  return { ...d, start, end, dateLabel, timeLabel, title, location, details, utc, google, outlook, dissertation };
}

/** RFC 5545 calendar file for the defense (CRLF line endings, escaped text, folded long lines). */
export function toIcs(x: NonNullable<Awaited<ReturnType<typeof getDefense>>>, stamp = new Date()) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const fold = (line: string) => line.match(/.{1,73}/g)!.join("\r\n ");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//shaiknagurshareef.github.io//PhD defense//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:phd-defense-20261116@shaiknagurshareef.github.io",
    `DTSTAMP:${x.utc(stamp)}`, `DTSTART:${x.utc(x.start)}`, `DTEND:${x.utc(x.end)}`,
    `SUMMARY:${esc(x.title)}`, `LOCATION:${esc(x.location)}`, `DESCRIPTION:${esc(x.details)}`,
    "URL:https://shaiknagurshareef.github.io/defense/",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc(x.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}
