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
  clockTime,
  RESOURCES,
  ResourceUnavailableError,
  decodeEntities,
  istDate,
  fetchResource,
  findRows,
  menuIdOverrides,
  normalizeRows,
  pickFields,
  resolveMenuId,
  weekdayName,
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

    // Academy's bare error page for an unsupported call is not a session problem
    const errorPage = clientWith({
      status: 200,
      data: '<html><head><title>Error</title></head><body>Internal Server Error</body></html>',
    });
    const pageError = errorPage.client.dispatch(SESSION, { action: 14, mode: 2 });
    await expect(pageError).rejects.toBeInstanceOf(AcademyRequestError);
    await expect(pageError).rejects.not.toBeInstanceOf(AcademySessionExpiredError);

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

    expect(resolveMenuId(RESOURCES.seating)).toBeNull();
    expect(resolveMenuId(RESOURCES.attendance)).toBe(ACADEMY_MENU_ID);
    process.env.ACADEMY_MENU_IDS = '{"attendance":"777","seating":"778"}';
    expect(resolveMenuId(RESOURCES.attendance)).toBe('777');
    expect(resolveMenuId(RESOURCES.seating)).toBe('778');
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
    // A blank first candidate falls through to the next key
    expect(pickFields({ a: ' ', b: 'B', n: 0 }, { v: ['a', 'b'], n: ['n'] })).toEqual({ v: 'B', n: 0 });
  });

  // Fixtures follow the structure PESU Academy returned on 2026-11-03; values are made up.
  const subjects = [
    {
      SubjectId: 1,
      SubjectCode: 'UE18CS351',
      SubjectName: 'Cloud Computing',
      Status: 1,
      SubjectStatusText: 'Completed',
      Description: 'Core',
      Name: 'CC',
      BatchClassId: 9,
      StudentId: 'secret-id',
    },
  ];

  it('reads courses from STUDENT_SUBJECTS', () => {
    expect(normalizeRows(RESOURCES.courses, { STUDENT_SUBJECTS: subjects, BATCH_CLASSID: 9 })).toEqual([
      { id: 1, code: 'UE18CS351', name: 'Cloud Computing', type: 'Core', status: 'Completed', semesterId: 9 },
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
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', classesHeld: 40, classesAttended: 36, percentage: 90 },
      { courseId: 2, code: 'UE18CS352', name: 'Compilers' },
    ]);
  });

  const results = {
    STUDENT_ALL_SUBJECTS: [
      {
        SubjectId: 1,
        subjectCode: 'UE18CS351',
        SubjectName: 'Cloud Computing',
        Semester: 6,
        Description: 'MAY 2021',
        EsaId: 99,
        grade: 'A',
        Credits: 4,
        EarnedCredit: 4,
        ISARESULTS: [
          { subjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Name: 'ISA 1', Marks: '34', MaxISAMarks: '40', ISAMarksMasterId: 7 },
          { subjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Name: 'Lab', Marks: '9', MaxISAMarks: '10' },
          { subjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', Name: 'ISA 2', Marks: '30', MaxISAMarks: '  ' },
        ],
        FinalISA: [{ SubjectId: 1, Marks: '46', ISAMaster: 'Final ISA ', ISAMarksMasterId: '1' }],
      },
      {
        SubjectId: 2,
        subjectCode: 'UE18CS352',
        SubjectName: 'Compilers',
        Semester: 6,
        Description: 'MAY 2021',
        grade: 'B',
        Credits: 4,
        EarnedCredit: 4,
        FinalISA: [{ Marks: '40' }],
      },
    ],
    CGPA_SEMESTERWISE: [{ StudentId: 'secret-id', SGPA: '8.90', CGPA: '8.60', Grade: 'A' }],
  };

  it('flattens the ISA marks nested in each course and adds the final ISA total', () => {
    expect(normalizeRows(RESOURCES.isa_results, results)).toEqual([
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', assessment: 'ISA 1', marks: '34', maxMarks: '40' },
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', assessment: 'Lab', marks: '9', maxMarks: '10' },
      // A blank maximum is left out rather than sent as ""
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', assessment: 'ISA 2', marks: '30' },
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', assessment: 'Final ISA', marks: '46' },
      { courseId: 2, code: 'UE18CS352', name: 'Compilers', assessment: 'Final ISA', marks: '40' },
    ]);
  });

  it('adds the semester SGPA and CGPA to each ESA course row', () => {
    const rows = normalizeRows(RESOURCES.esa_results, results);
    const common = { semester: 6, examSession: 'MAY 2021', credits: 4, earnedCredits: 4, sgpa: '8.90', cgpa: '8.60' };
    expect(rows).toEqual([
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', grade: 'A', ...common },
      { courseId: 2, code: 'UE18CS352', name: 'Compilers', grade: 'B', ...common },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(normalizeRows(RESOURCES.esa_results, { STUDENT_ALL_SUBJECTS: [{ subjectCode: 'X' }] })).toEqual([{ code: 'X' }]);
  });

  it('reads a course syllabus in order with HTML entities decoded', () => {
    const payload = {
      COURSE_MENU: [],
      COURSE_CONTENT: [
        { SubjectId: 1, SubjectCode: 'UE18CS351', SubjectName: 'Cloud Computing', CourseContentType: 'Course Units', Heading: 'Unit 1: Basics', CourseContent: 'Models &amp; services &#8211; &lt;intro&gt; &bogus;', CourseContentOrder: 1, CreatedBy: 'secret-id' },
        { SubjectId: 1, CourseContentType: 'Reference Books', Heading: 'Text Book:', CourseContent: null, CourseContentOrder: 0 },
      ],
    };
    expect(normalizeRows(RESOURCES.syllabus, payload)).toEqual([
      { courseId: 1, code: 'UE18CS351', name: 'Cloud Computing', section: 'Course Units', heading: 'Unit 1: Basics', content: 'Models & services \u2013 <intro> &bogus;', order: 1 },
      { courseId: 1, section: 'Reference Books', heading: 'Text Book:', order: 0 },
    ]);
  });

  it('reads the overall CGPA row', () => {
    const payload = {
      StudentCGPAWISE: [{ USN: 'secret-usn', Credits: 160, EarnedCredits: 158, CGPA: '8.60' }],
      StudentSemesterWise: [{ BatchClassId: 1 }, { BatchClassId: 2 }],
    };
    expect(normalizeRows(RESOURCES.cgpa, payload)).toEqual([{ cgpa: '8.60', credits: 160, earnedCredits: 158 }]);
  });

  it('turns calendar events into inclusive IST dates and booleans', () => {
    const day = 86_400_000;
    const aug15 = Date.UTC(2026, 7, 14, 18, 30); // midnight IST on 2026-08-15
    const payload = [
      {
        name: 'Independence  Day',
        description: 'Independence Day',
        eventType: 'National Festival',
        startDate: aug15,
        endDate: aug15 + day,
        isHoliday: 1,
        isClass: 0,
        calendarOfEventName: 'Aug 2026 - Dec 2026',
        color: '#b12000',
        batchId: 7,
      },
      { name: 'Odd row', startDate: 'soon', endDate: null, isHoliday: null },
    ];
    expect(normalizeRows(RESOURCES.calendar, payload)).toEqual([
      {
        name: 'Independence Day',
        description: 'Independence Day',
        type: 'National Festival',
        startDate: '2026-08-15',
        endDate: '2026-08-15',
        holiday: true,
        classDay: false,
        term: 'Aug 2026 - Dec 2026',
      },
      { name: 'Odd row' },
    ]);
  });

  it('decodes entities and dates defensively', () => {
    expect(decodeEntities(5)).toBe(5);
    expect(decodeEntities('A &AMP; B &apos;C&apos;&nbsp;D')).toBe("A & B 'C' D");
    expect(decodeEntities('&#128218; &#0; &#99999999;')).toBe('\u{1F4DA} &#0; &#99999999;');
    expect(istDate(Number.NaN)).toBeUndefined();
    expect(istDate('2026-08-15')).toBeUndefined();
    expect(istDate(Date.UTC(2026, 7, 14, 18, 30))).toBe('2026-08-15');
  });
});

describe('fetchResource', () => {
  const ctx = (q: string = '') => ({ query: new URLSearchParams(q) });

  afterEach(() => {
    delete process.env.ACADEMY_MENU_IDS;
  });

  it('normalizes the weekly timetable, sorted by day and time, and filters by day', async () => {
    // Shape of a live 16/1 response (values are placeholders)
    const slot = (day: number | null, start: string | null, end: string | null, code: string) => ({
      timeTableId: 'tt-1',
      userId: 'u-1',
      day,
      dayNull: day === null,
      startTime: start,
      endTime: end,
      timeSlotOrder: 1,
      subjectCode: code,
      subjectName: `Course ${code}`,
      facultyName: null,
      facultyNameAbbreviation: '',
      roomName: 'B402',
      batchName: '',
      templateName: 'DEFAULT_TIME_SLOTS',
    });
    const payload = [
      slot(2, '11:30:12', '12:30:12', 'C3'),
      slot(1, '13:15:53', '14:15:53', 'C2'),
      slot(1, null, null, 'C4'),
      slot(1, '08:45:53', '09:45:53', 'C1'),
      slot(null, '10:00:00', '11:00:00', 'C5'),
    ];
    const dispatch = vi.fn().mockResolvedValue(payload);
    const client = { dispatch } as unknown as AcademyClient;

    const week = await fetchResource(client, SESSION, RESOURCES.timetable, ctx());
    expect(week).toEqual([
      { day: 'Monday', start: '08:45', end: '09:45', code: 'C1', name: 'Course C1', room: 'B402' },
      { day: 'Monday', start: '13:15', end: '14:15', code: 'C2', name: 'Course C2', room: 'B402' },
      { day: 'Monday', code: 'C4', name: 'Course C4', room: 'B402' },
      { day: 'Tuesday', start: '11:30', end: '12:30', code: 'C3', name: 'Course C3', room: 'B402' },
      { start: '10:00', end: '11:00', code: 'C5', name: 'Course C5', room: 'B402' },
    ]);
    for (const day of ['tue', 'Tuesday', '2']) {
      expect((await fetchResource(client, SESSION, RESOURCES.timetable, ctx(`day=${day}`))).map((r) => r.code)).toEqual(['C3']);
    }
    expect(await fetchResource(client, SESSION, RESOURCES.timetable, ctx('day=sun'))).toEqual([]);
  });

  it('reads weekday names and clock times', () => {
    expect(weekdayName('mon')).toBe('Monday');
    expect(weekdayName('SATURDAY')).toBe('Saturday');
    expect(weekdayName('7')).toBe('Sunday');
    expect(weekdayName('xyz')).toBeUndefined();
    expect(clockTime('08:45:53')).toBe('08:45');
    expect(clockTime('9:45')).toBeUndefined();
    expect(clockTime(null)).toBeUndefined();
  });

  it('refuses to guess when no menu id is configured', async () => {
    const dispatch = vi.fn();
    await expect(
      fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.seating, ctx())
    ).rejects.toBeInstanceOf(ResourceUnavailableError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with the menu id and resource params', async () => {
    process.env.ACADEMY_MENU_IDS = JSON.stringify({ announcements: '14' });
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
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 1, menuId: M });
    // Academy's per-day mode returns nothing, so `day` is applied to the weekly list instead
    await fetchResource(client, SESSION, RESOURCES.timetable, ctx('day=mon'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 16, mode: 1, menuId: M });

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

  it('sends the course id for a syllabus', async () => {
    const dispatch = vi.fn().mockResolvedValue({ COURSE_CONTENT: [] });
    await fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.syllabus, ctx('course=42'));
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 18, mode: 11, menuId: ACADEMY_MENU_ID, subjectId: '42' });
    await fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.cgpa, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 7, mode: 6, menuId: ACADEMY_MENU_ID });
    await fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.calendar, ctx());
    expect(dispatch).toHaveBeenLastCalledWith(SESSION, { action: 14, mode: 1, menuId: ACADEMY_MENU_ID });
  });

  it('falls back to the first listed semester when Academy sends no order', async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce([{ batchClassId: 8, batchClassOrder: null }, { batchClassId: 3 }])
      .mockResolvedValueOnce({ STUDENT_SUBJECTS: [] });
    await fetchResource({ dispatch } as unknown as AcademyClient, SESSION, RESOURCES.courses, ctx());
    expect(dispatch).toHaveBeenNthCalledWith(2, SESSION, { action: 18, mode: 2, menuId: ACADEMY_MENU_ID, batchClassId: '8' });
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
