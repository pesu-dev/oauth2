import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getUserInfo, POST as postUserInfo } from '@/app/userinfo/route';
import { User } from '@/lib/db/models';
import { mintAccessToken } from '@/lib/oidc/jwt';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Userinfo Endpoint (/userinfo)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns claims for valid Bearer token via GET and POST', async () => {
    const token = await mintAccessToken({
      issuer: 'http://localhost:3000',
      sub: 'usr_test',
      clientId: 'cli_test',
      scopes: ['openid', 'profile'],
    });

    vi.spyOn(User, 'findOne').mockResolvedValue({
      sub: 'usr_test',
      name: 'Test Student',
      prn: 'PES1UG20CS001',
      srn: 'PES1202000001',
      program: 'B.Tech',
      branch: 'CSE',
      semester: 'Sem-6',
      section: 'A',
      campus: 'RR',
    } as unknown as InstanceType<typeof User>);

    const reqGet = new Request('http://localhost:3000/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const respGet = await getUserInfo(reqGet);
    expect(respGet.status).toBe(200);

    const reqPost = new Request('http://localhost:3000/userinfo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const respPost = await postUserInfo(reqPost);
    expect(respPost.status).toBe(200);
  });

  it('rejects missing Authorization header', async () => {
    const req = new Request('http://localhost:3000/userinfo');
    const resp = await getUserInfo(req);
    expect(resp.status).toBe(401);
  });
});
