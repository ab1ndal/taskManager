import { localParts, type Digest, type DigestTask } from './digest';

export type DigestLinks = { app: string; settings: string };
const SECTIONS = [
  { key: 'overdue', heading: 'Overdue', accent: '#b3261e' },
  { key: 'today', heading: 'Due today', accent: '#6d6a7b' },
  { key: 'soon', heading: 'Due soon', accent: '#6d6a7b' },
] as const;
// The app's own tokens, resolved to literal hex: email clients drop custom properties, and several
// drop <style> blocks entirely, so every colour has to travel inline on the element that uses it.
const BG = '#faf9f7', SURFACE = '#ffffff', BORDER = '#e8e4f0';
const TEXT = '#1c1a24', MUTED = '#6d6a7b', ACCENT = '#7c5cbf', ACCENT_TEXT = '#5b3fa8';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const fmt = (timezone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options });
// Calendar days apart, counted from local dates rather than elapsed milliseconds so a 23- or
// 25-hour DST day cannot shift a label by one.
function daysApart(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

export function formatDue(due: Date, now: Date, timezone: string) {
  const dueLocal = localParts(due, timezone), today = localParts(now, timezone).date;
  const time = fmt(timezone, { hour: 'numeric', minute: '2-digit' }).format(due);
  const date = fmt(timezone, { month: 'short', day: 'numeric' }).format(due);
  const days = daysApart(today, dueLocal.date);
  if (due < now) {
    if (days === 0) return `earlier today, ${time}`;
    if (days === -1) return 'yesterday';
    return days >= -7 ? `${-days} days ago` : date;
  }
  if (days === 0) return time;
  return days <= 7 ? `${fmt(timezone, { weekday: 'short' }).format(due)}, ${time}` : date;
}

function sections(digest: Digest, timezone: string, now: Date) {
  return SECTIONS.filter(section => digest[section.key].length).map(section => ({
    ...section,
    label: `${section.heading} (${digest[section.key].length})`,
    tasks: digest[section.key].map((task: DigestTask) => ({ title: task.title, due: formatDue(new Date(task.due_at!), now, timezone) })),
  }));
}

export function digestText(digest: Digest, timezone: string, links: DigestLinks, now: Date) {
  const body = sections(digest, timezone, now)
    .map(section => `${section.label}\n${section.tasks.map(task => `• ${task.title} — ${task.due}`).join('\n')}`).join('\n\n');
  return `${body}\n\nOpen Hearth: ${links.app}\nManage reminders: ${links.settings}`;
}

// Task titles are user input. In the text part they are inert; here they are not.
const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function digestHtml(digest: Digest, timezone: string, links: DigestLinks, now: Date) {
  const rows = sections(digest, timezone, now).map(section => `
      <tr><td style="padding:24px 24px 8px 24px;font:600 12px/1.4 ${FONT};letter-spacing:0.08em;text-transform:uppercase;color:${section.accent};">${section.label}</td></tr>
      ${section.tasks.map(task => `
      <tr><td style="padding:0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${BORDER};font:400 16px/1.5 ${FONT};color:${TEXT};">${escape(task.title)}</td>
            <td align="right" style="padding:10px 0 10px 12px;border-bottom:1px solid ${BORDER};font:400 14px/1.5 ${FONT};color:${MUTED};white-space:nowrap;">${escape(task.due)}</td>
          </tr>
        </table>
      </td></tr>`).join('')}`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${BG};margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;background-color:${BG};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;max-width:600px;width:100%;background-color:${SURFACE};border:1px solid ${BORDER};border-radius:8px;">
      ${rows}
      <tr><td style="padding:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr><td style="border-radius:6px;background-color:${ACCENT};">
            <a href="${links.app}" style="display:inline-block;padding:12px 24px;font:600 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;">Open Hearth</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 24px 24px 24px;font:400 13px/1.5 ${FONT};color:${MUTED};">
        <a href="${links.settings}" style="color:${ACCENT_TEXT};text-decoration:underline;">Manage reminders</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
