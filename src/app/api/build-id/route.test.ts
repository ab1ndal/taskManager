/** @jest-environment node */
import { GET } from './route';

describe('GET /api/build-id', () => {
  it('reports the build id and forbids caching', async () => {
    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ buildId: 'development' });
  });
});
