import { describe, it, expect } from 'vitest';
import { RESOURCE_ENDPOINTS } from '@/proxy';

const ROUTES = [
  ['semesters', () => import('@/app/api/v1/semesters/route')],
  ['courses', () => import('@/app/api/v1/courses/route')],
  ['attendance', () => import('@/app/api/v1/attendance/route')],
  ['results/isa', () => import('@/app/api/v1/results/isa/route')],
  ['results/esa', () => import('@/app/api/v1/results/esa/route')],
  ['timetable', () => import('@/app/api/v1/timetable/route')],
  ['announcements', () => import('@/app/api/v1/announcements/route')],
  ['assignments', () => import('@/app/api/v1/assignments/route')],
  ['seating', () => import('@/app/api/v1/seating/route')],
] as const;

describe('resource API route modules', () => {
  it.each(ROUTES)('/api/v1/%s exports a dynamic GET handler and is proxied', async (path, load) => {
    const mod = await load();
    expect(typeof mod.GET).toBe('function');
    expect(mod.dynamic).toBe('force-dynamic');
    expect(RESOURCE_ENDPOINTS).toContain(path.split('/')[0]);
  });
});
