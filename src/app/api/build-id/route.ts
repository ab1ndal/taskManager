import { BUILD_ID } from '@/lib/build-id';

export const runtime = 'nodejs';
// The whole point is to report the *running* deployment, so this must never be prerendered or
// served from a cache between the client and the function.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ buildId: BUILD_ID }, { headers: { 'Cache-Control': 'no-store' } });
}
