import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  AcademyClient,
  AcademyRequestError,
  AcademySessionExpiredError,
  DISPATCHER_URL,
  unwrapJsonStrings,
} from '@/lib/academy/client';
import {
  RESOURCES,
  ResourceUnavailableError,
  fetchResource,
  findRows,
  menuIdOverrides,
  normalizeRows,
  pickFields,
  resolveMenuId,
} from '@/lib/academy/resources';
import { getScope } from '@/lib/oidc/scopes';

const SESSION = { token: 'mob_tok', accessToken: 'acc_tok', userId: 'u1', expiresAt: null };

function clientWith(response: { status: number; data: unknown }) {
  const post = vi.fn().mockResolvedValue(response);
  return { client: new AcademyClient({ post } as unknown as AxiosInstance), post };
}

function formEntries(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

describe('AcademyClient.dispatch', () => {
  it('posts action, mode, userId and a cache buster with session headers', async () => {
    const { client, post } = clientWith({ status: 200, data: { rows: [] } });
    await client.dispatch(SESSION, { action: 18, mode: 6, menuId: '99', skip: undefined });

    const [url, form, options] = post.mock.calls[0];
    expect(url).toBe(DISPATCHER_URL);
    const fields = formEntries(form);
    expect(fields).toMatchObject({ action: '18', mode: '6', menuId: '99', userId: 'u1' });
    expect(fields).not.toHaveProperty('skip');
    expect(Number(fields.randomNum)).toBeGreaterThanOrEqual(0);
    expect(options.headers).toEqual({ mobileappauthenticationtoken: 'mob_tok', authorization: 'Bearer acc_tok' });
  });

  it('omits bearer and userId when the session lacks them, and keeps an explicit userId', async () => {
    const { client, post } = clientWith({ status: 200, data: [] });
    await client.dispatch({ ...SESSION, accessToken: null, userId: null }, { action: 1, mode: 1 });
    expect(post.mock.calls[0][2].headers).toEqual({ mobileappauthenticationtoken: 'mob_tok' });
    expect(formEntries(post.mock.calls[0][1])).not.toHaveProperty('userId');

    await client.dispatch(SESSION, { action: 1, mode: 1, userId: 'explicit' });
    expect(formEntries(post.mock.calls[1][1]).userId).toBe('explicit');
  });

  it('parses JSON strings and unwraps nested JSON documents', async () => {
    const { client } = clientWith({ status: 200, data: JSON.stringify({ list: '[{"a":1}]' }) });
    await expect(client.dispatch(SESSION, { action: 1, mode: 1 })).resolves.toEqual({ list: [{ a: 1 }] });
  });

  it('returns null for an empty body', async () => {
    const { client } = clientWith({ status: 200, data: '   ' });
    await expect(client.dispatch(SESSION, { action: 20, mode: 5 })).resolves.toBeNull();
  });

  it.each([
    [{ status: 401, data: '' }],
    [{ status: 403, data: '' }],
    [{ status: 200, data: '<html><body>login</body></html>' }],
    [{ status: 200, data: { mobileAppTokenError: 'ERROR' } }],
  ])('treats %j as an expired session', async (response) => {
    const { client } = clientWith(response);
    await expect(client.dispatch(SESSION, { action: 1, mode: 1 })).rejects.toBeInstanceOf(AcademySessionExpiredError);
  });

  it('surfaces error envelopes, bad status, bad JSON and network failures as request errors', async () => {
    const envelope = clientWith({
      status: 200,
      data: { status: 400, message: 'Menu ID is required', errorCode: null, timestamp: 1 },
    });
    await expect(envelope.client.dispatch(SESSION, { action: 18, mode: 1 })).rejects.toThrow('Menu ID is required');

    const http = clientWith({ status: 500, data: '' });
    await expect(http.client.dispatch(SESSION, { action: 1, mode: 1 })).rejects.toBeInstanceOf(AcademyRequestError);

    const bad = clientWith({ status: 200, data: 'not json' });
    await expect(bad.client.dispatch(SESSION, { action: 1, mode: 1 })).rejects.toThrow('Invalid dispatcher response format');

    const net = new AcademyClient({ post: vi.fn().mockRejectedValue(new Error('ECONNRESET')) } as unknown as AxiosInstance);
    await expect(net.dispatch(SESSION, { action: 1, mode: 1 })).rejects.toThrow('Dispatcher connection failed: ECONNRESET');

    const netStr = new AcademyClient({ post: vi.fn().mockRejectedValue('down') } as unknown as AxiosInstance);
    await expect(netStr.dispatch(SESSION, { action: 1, mode: 1 })).rejects.toThrow('down');
  });

  it('unwraps JSON strings recursively with a depth limit and leaves plain strings alone', () => {
    expect(unwrapJsonStrings('{"a":"[1,2]"}')).toEqual({ a: [1, 2] });
    expect(unwrapJsonStrings('{broken')).toBe('{broken');
    expect(unwrapJsonStrings('{not: json}')).toBe('{not: json}');
    expect(unwrapJsonStrings('plain')).toBe('plain');
    expect(unwrapJsonStrings(5)).toBe(5);
    expect(unwrapJsonStrings('"x"', 5)).toBe('"x"');
  });
});

describe('resource catalog', () => {
  afterEach(() => {
    delete process.env.ACADEMY_MENU_IDS;
  });

  it('maps every resource to a registered resource scope', () => {
    for (const def of Object.values(RESOURCES)) {
      expect(getScope(def.scope)?.kind).toBe('resource');
    }
  });

  it('reads verified menu ids from ACADEMY_MENU_IDS and ignores junk', () => {
    expect(menuIdOverrides(undefined)).toEqual({});
    expect(menuIdOverrides('not json')).toEqual({});
    expect(menuIdOverrides('[1]')).toEqual({});
    expect(menuIdOverrides('null')).toEqual({});
    expect(
      menuIdOverrides('{"attendance":"123","seating":456,"bogus":"1","courses":"12a","timetable":{}}')
    ).toEqual({ attendance: '123', seating: '456' });

    expect(resolveMenuId(RESOURCES.attendance)).toBeNull();
    process.env.ACADEMY_MENU_IDS = '{"attendance":"777"}';
    expect(resolveMenuId(RESOURCES.attendance)).toBe('777');
  });

  it('finds the largest nested row array and keeps only allowlisted scalar fields', () => {
    const payload = {
      meta: { count: 2 },
      data: {
        small: [{ x: 1 }],
        list: [
          { subjectCode: ' UE20CS301 ', subjectName: 'DBMS', totalClasses: 40, attendedClasses: 36, FatherName: 'secret' },
          { SubjectCode: 'UE20CS302', attendancePercentage: '90', nested: { a: 1 } },
          'stray',
        ],
      },
    };
    const rows = normalizeRows(RESOURCES.attendance, payload);
    expect(rows).toEqual([
      { code: 'UE20CS301', name: 'DBMS', classesHeld: 40, classesAttended: 36 },
      { code: 'UE20CS302', percentage: '90' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('handles arrays, empty payloads and rows without known fields', () => {
    expect(findRows([1, 2])).toEqual([]);
    expect(findRows(null)).toEqual([]);
    expect(findRows({ a: { b: { c: { d: { e: [{ deep: 1 }] } } } } })).toEqual([]);
    expect(normalizeRows(RESOURCES.seating, [{ unrelated: true }])).toEqual([]);
    expect(pickFields({ status: true, title: 'A' }, { status: ['status'], title: ['title'], gone: ['x'] })).toEqual({
      status: true,
      title: 'A',
    });
  });
});

describe('fetchResource', () => {
  const ctx = (q: string = '', username = 'PES1UG20CS001') => ({ query: new URLSearchParams(q), username });

  afterEach(() => {
    delete process.env.ACADEMY_MENU_IDS;
  });

  it('refuses to guess when no menu id is configured', async () => {
    const dispatch = vi.fn();
    await expect(
      fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.attendance, ctx())
    ).rejects.toBeInstanceOf(ResourceUnavailableError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with the configured menu id and resource params', async () => {
    process.env.ACADEMY_MENU_IDS = JSON.stringify({ courses: '11', esa_results: '12', timetable: '13', announcements: '14', semesters: '15' });
    const dispatch = vi.fn().mockResolvedValue([{ subjectCode: 'C1' }]);
    const client = { dispatch } as unknown as AcademyClient;

    await expect(fetchResource(client, SESSION, RESOURCES.courses, ctx('semester=5'))).resolves.toEqual([{ code: 'C1' }]);
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 2, menuId: '11', selectedSemester: '5' });

    await fetchResource(client, SESSION, RESOURCES.esa_results, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 7, mode: 3, menuId: '12', usn: 'PES1UG20CS001' });

    await fetchResource(client, SESSION, RESOURCES.timetable, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 1, menuId: '13' });
    await fetchResource(client, SESSION, RESOURCES.timetable, ctx('day=mon'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 2, menuId: '13', day: 'mon' });

    await fetchResource(client, SESSION, RESOURCES.announcements, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 20, mode: 5, menuId: '14', pageNo: '1' });
    await fetchResource(client, SESSION, RESOURCES.announcements, ctx('page=3'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 20, mode: 5, menuId: '14', pageNo: '3' });

    await fetchResource(client, SESSION, RESOURCES.semesters, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 1, menuId: '15' });

    await fetchResource(client, SESSION, RESOURCES.courses, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 2, menuId: '11', selectedSemester: undefined });
  });
});
