import { createResourceHandler } from '@/lib/api/resource-route';

export const dynamic = 'force-dynamic';

export const GET = createResourceHandler('timetable', ['day']);
