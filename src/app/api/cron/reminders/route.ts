import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runReminders } from '@/lib/reminders/delivery';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');
  if (!expected || !provided || Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // The cron secret authorizes this service-role operation across users.
    return Response.json(await runReminders(createAdminClient()), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Reminder run failed' }, { status: 500 });
  }
}
