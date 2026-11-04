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
  ACADEMY_MENU_ID,
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

    expect(resolveMenuId(RESOURCES.timetable)).toBeNull();
    expect(resolveMenuId(RESOURCES.attendance)).toBe(ACADEMY_MENU_ID);
    process.env.ACADEMY_MENU_IDS = '{"attendance":"777","timetable":"778"}';
    expect(resolveMenuId(RESOURCES.attendance)).toBe('777');
    expect(resolveMenuId(RESOURCES.timetable)).toBe('778');
  });

  it('finds the largest nested row array and keeps only allowlisted scalar fields', () => {
    const payload = {
      meta: { count: 2 },
      data: {
        small: [{ x: 1 }],
        list: [
          { batchClassId: 11, className: ' Sem-1 ', FatherName: 'secret' },
          { batchClassId: 12, nested: { a: 1 } },
          'stray',
        ],
      },
    };
    const rows = normalizeRows(RESOURCES.semesters, payload);
    expect(rows).toEqual([{ id: 11, name: 'Sem-1' }, { id: 12 }]);
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

  // Fixtures follow the structure PESU Academy returned on 2026-11-03; values are made up.
  const subjects = [
    { SubjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Status: 1, SubjectStatusText: 'Enrolled', StudentId: 'secret-id' },
  ];

  it('reads courses from STUDENT_SUBJECTS', () => {
    expect(normalizeRows(RESOURCES.courses, { STUDENT_SUBJECTS: subjects, BATCH_CLASSID: 9 })).toEqual([
      { id: 1, code: 'UE18CS351', name: 'Cloud Computing', status: 'Enrolled' },
    ]);
    expect(normalizeRows(RESOURCES.courses, 'unexpected')).toEqual([]);
  });

  it('reads attendance from ATTENDANCE_LIST, Academy spelling included, and omits null counts', () => {
    const payload = {
      STUDENT_SUBJECTS: [...subjects, ...subjects],
      ATTENDANCE_LIST: [
        { SubjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', TotalClasses: 40, AttendedClasses: 36, AttendancePercenrage: 90 },
        { SubjectId: 2, SubjectCode: 'UE18CS352', SubjectName: 'Compilers', TotalClasses: null, AttendedClasses: null, AttendancePercenrage: null },
      ],
    };
    expect(normalizeRows(RESOURCES.attendance, payload)).toEqual([
      { code: 'UE18CS351', name: 'Cloud Computing', classesHeld: 40, classesAttended: 36, percentage: 90 },
      { code: 'UE18CS352', name: 'Compilers' },
    ]);
  });

  const results = {
    STUDENT_ALL_SUBJECTS: [
      {
        subjectCode: 'UE18CS351',
        SubjectName: 'Cloud Computing',
        Semester: 6,
        grade: 'A',
        Credits: 4,
        EarnedCredit: 4,
        ISARESULTS: [
          { SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Name: 'ISA 1', Marks: '34', MaxISAMarks: '40', ISAMarksMasterId: 7 },
          { SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Name: 'ISA 2', Marks: '30', MaxISAMarks: '40' },
        ],
      },
      { subjectCode: 'UE18CS352', SubjectName: 'Compilers', Semester: 6, grade: 'B', Credits: 4, EarnedCredit: 4 },
    ],
    CGPA_SEMESTERWISE: [{ StudentId: 'secret-id', SGPA: '8.90', CGPA: '8.60', Grade: 'A' }],
  };

  it('flattens the ISA marks nested in each course', () => {
    expect(normalizeRows(RESOURCES.isa_results, results)).toEqual([
      { code: 'UE18CS351', name: 'Cloud Computing', assessment: 'ISA 1', marks: '34', maxMarks: '40' },
      { code: 'UE18CS351', name: 'Cloud Computing', assessment: 'ISA 2', marks: '30', maxMarks: '40' },
    ]);
  });

  it('adds the semester SGPA and CGPA to each ESA course row', () => {
    const rows = normalizeRows(RESOURCES.esa_results, results);
    expect(rows).toEqual([
      { code: 'UE18CS351', name: 'Cloud Computing', semester: 6, grade: 'A', credits: 4, earnedCredits: 4, sgpa: '8.90', cgpa: '8.60' },
      { code: 'UE18CS352', name: 'Compilers', semester: 6, grade: 'B', credits: 4, earnedCredits: 4, sgpa: '8.90', cgpa: '8.60' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(normalizeRows(RESOURCES.esa_results, { STUDENT_ALL_SUBJECTS: [{ subjectCode: 'X' }] })).toEqual([{ code: 'X' }]);
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
      fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.seating, ctx())
    ).rejects.toBeInstanceOf(ResourceUnavailableError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with the menu id and resource params', async () => {
    process.env.ACADEMY_MENU_IDS = JSON.stringify({ timetable: '13', announcements: '14' });
    const dispatch = vi.fn().mockResolvedValue({ STUDENT_SUBJECTS: [{ SubjectCode: 'C1' }] });
    const client = { dispatch } as unknown as AcademyClient;
    const M = ACADEMY_MENU_ID;

    await expect(fetchResource(client, SESSION, RESOURCES.courses, ctx('semester=5'))).resolves.toEqual([{ code: 'C1' }]);
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 2, menuId: M, batchClassId: '5' });

    await fetchResource(client, SESSION, RESOURCES.esa_results, ctx('semester=6'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 7, mode: 11, menuId: M, batchClassId: '6' });
    await fetchResource(client, SESSION, RESOURCES.isa_results, ctx('semester=6'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 7, mode: 11, menuId: M, batchClassId: '6' });

    await fetchResource(client, SESSION, RESOURCES.timetable, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 1, menuId: '13' });
    await fetchResource(client, SESSION, RESOURCES.timetable, ctx('day=mon'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 2, menuId: '13', day: 'mon' });

    await fetchResource(client, SESSION, RESOURCES.announcements, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 20, mode: 5, menuId: '14', pageNo: '1' });
    await fetchResource(client, SESSION, RESOURCES.announcements, ctx('page=3'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 20, mode: 5, menuId: '14', pageNo: '3' });

    await fetchResource(client, SESSION, RESOURCES.semesters, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 1, menuId: M });
  });

  it('defaults to the latest semester by batchClassOrder', async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce([
        { batchClassId: 8, className: 'Sem-8', batchClassOrder: 2021081099 },
        { batchClassId: 3, className: 'Sem-3', batchClassOrder: 2019070199 },
        { batchClassId: 9, className: 'Sem-9' },
        { batchClassOrder: 2030010199 },
      ])
      .mockResolvedValueOnce({ ATTENDANCE_LIST: [{ SubjectCode: 'C1' }] });
    const client = { dispatch } as unknown as AcademyClient;

    await expect(fetchResource(client, SESSION, RESOURCES.attendance, ctx())).resolves.toEqual([{ code: 'C1' }]);
    expect(dispatch).toHaveBeenNthCalledWith(1, SESSION, { action: 18, mode: 1, menuId: ACADEMY_MENU_ID });
    expect(dispatch).toHaveBeenNthCalledWith(2, SESSION, { action: 18, mode: 6, menuId: ACADEMY_MENU_ID, batchClassId: '8' });
  });

  it('returns no rows when the student has no semesters', async () => {
    const dispatch = vi.fn().mockResolvedValueOnce([]);
    await expect(
      fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.courses, ctx())
    ).resolves.toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('refuses the semester default when the semesters menu id is cleared', async () => {
    const original = RESOURCES.semesters.menuId;
    RESOURCES.semesters.menuId = null;
    const dispatch = vi.fn();
    try {
      await expect(
        fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.courses, ctx())
      ).rejects.toBeInstanceOf(ResourceUnavailableError);
    } finally {
      RESOURCES.semesters.menuId = original;
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});
