export type Preferences = {
  email_enabled: boolean;
  work_email: string;
  personal_email: string;
  push_enabled: boolean;
  digest_time: string;
  timezone: string;
  soon_window_days: number;
};
export type DigestTask = { workspace_kind?: 'work' | 'household'; id: string; title: string; due_at: string | null; completed_at: string | null; member_sort_key: number };
export type Digest = { overdue: DigestTask[]; today: DigestTask[]; soon: DigestTask[] };

export function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function buildDigest(tasks: DigestTask[], now: Date, timezone: string, window: number): Digest {
  const today = localParts(now, timezone).date;
  // Calendar arithmetic, deliberately independent of 23/25-hour DST days.
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + window);
  const lastDate = end.toISOString().slice(0, 10);
  const digest: Digest = { overdue: [], today: [], soon: [] };
  const seen = new Set<string>();
  for (const task of [...tasks].sort((a, b) => a.member_sort_key - b.member_sort_key || a.id.localeCompare(b.id))) {
    if (seen.has(task.id) || task.completed_at || !task.due_at) continue;
    seen.add(task.id);
    const due = new Date(task.due_at);
    if (!Number.isFinite(due.getTime())) continue;
    const day = localParts(due, timezone).date;
    if (due < now) digest.overdue.push(task);
    else if (day === today) digest.today.push(task);
    else if (day > today && day <= lastDate) digest.soon.push(task);
  }
  return digest;
}
export function digestCount(digest: Digest) {
  return digest.overdue.length + digest.today.length + digest.soon.length;
}
export function digestText(digest: Digest, timezone: string) {
  return (['overdue', 'today', 'soon'] as const).map((key, index) => {
    const heading = ['Overdue', 'Due today', 'Due soon'][index];
    return `${heading}\n${digest[key].map(task => `• ${task.title} — ${new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.due_at!))}`).join('\n') || 'None'}`;
  }).join('\n\n');
}
