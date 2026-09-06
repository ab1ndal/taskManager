import { buildDigest, type DigestTask } from './digest';
import { digestHtml, digestText, formatDue } from './render';
const task = (id: string, due_at: string | null, member_sort_key = 0, title = id): DigestTask => ({ id, title, due_at, member_sort_key, completed_at: null });
const zone = 'America/Los_Angeles';
const now = new Date('2026-09-05T22:00:00Z'); // 15:00 local
const links = { app: 'https://hearth.example/tasks', settings: 'https://hearth.example/settings?tab=notifications' };

describe('formatDue', () => {
  it('keeps the clock time for something already late today', () => {
    expect(formatDue(new Date('2026-09-05T16:00:00Z'), now, zone)).toBe('earlier today, 9:00 AM');
  });
  it('names yesterday rather than counting one day', () => {
    expect(formatDue(new Date('2026-09-04T20:00:00Z'), now, zone)).toBe('yesterday');
  });
  it('counts days for the rest of the past week', () => {
    expect(formatDue(new Date('2026-08-30T20:00:00Z'), now, zone)).toBe('6 days ago');
  });
  it('falls back to a date once the past week is gone', () => {
    expect(formatDue(new Date('2026-08-20T20:00:00Z'), now, zone)).toBe('Aug 20');
  });
  it('shows only the time for today', () => {
    expect(formatDue(new Date('2026-09-06T02:30:00Z'), now, zone)).toBe('7:30 PM');
  });
  it('shows the weekday within the coming week', () => {
    expect(formatDue(new Date('2026-09-08T16:00:00Z'), now, zone)).toBe('Tue, 9:00 AM');
  });
  it('falls back to a date beyond the coming week', () => {
    expect(formatDue(new Date('2026-09-15T16:00:00Z'), now, zone)).toBe('Sep 15');
  });
  it('counts calendar days across a fall-back boundary rather than elapsed hours', () => {
    // 2026-11-01 is a 25-hour local day; an hour-based difference would call this two days.
    expect(formatDue(new Date('2026-11-01T19:00:00Z'), new Date('2026-11-02T20:00:00Z'), zone)).toBe('yesterday');
  });
});

describe('digestText', () => {
  const digest = buildDigest([task('late', '2026-09-04T20:00:00Z'), task('now', '2026-09-06T02:30:00Z')], now, zone, 3);
  it('counts each section it prints', () => {
    expect(digestText(digest, zone, links, now)).toContain('Overdue (1)');
  });
  it('omits a section with nothing in it', () => {
    expect(digestText(digest, zone, links, now)).not.toContain('Due soon');
  });
  it('never prints the old None placeholder', () => {
    expect(digestText(digest, zone, links, now)).not.toContain('None');
  });
  it('uses the relative due format', () => {
    expect(digestText(digest, zone, links, now)).toContain('late — yesterday');
  });
  it('carries both links', () => {
    expect(digestText(digest, zone, links, now)).toContain(links.app);
    expect(digestText(digest, zone, links, now)).toContain(links.settings);
  });
});

describe('digestHtml', () => {
  const digest = buildDigest([task('late', '2026-09-04T20:00:00Z'), task('now', '2026-09-06T02:30:00Z')], now, zone, 3);
  const html = digestHtml(digest, zone, links, now);
  it('escapes markup in a task title so it cannot become an element', () => {
    const hostile = buildDigest([task('x', '2026-09-04T20:00:00Z', 0, '<script>alert(1)</script> & "quoted"')], now, zone, 3);
    const rendered = digestHtml(hostile, zone, links, now);
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
  });
  it('lists exactly the tasks the text version lists', () => {
    const text = digestText(digest, zone, links, now);
    for (const title of ['late', 'now']) {
      expect(html).toContain(title);
      expect(text).toContain(title);
    }
    expect(html).not.toContain('Due soon');
  });
  it('lays out with tables, which is what Outlook renders reliably', () => {
    expect(html).toContain('<table');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });
  it('carries no style block or remote asset, both of which get stripped', () => {
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('http://');
  });
  it('states an explicit background and text colour rather than inheriting the client theme', () => {
    expect(html).toContain('background-color:#faf9f7');
    expect(html).toContain('#1c1a24');
  });
  it('links the button to the app', () => {
    expect(html).toContain(`href="${links.app}"`);
  });
});
