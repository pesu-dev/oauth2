import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';

describe('robots.txt metadata', () => {
  it('disallows crawling /portal', () => {
    const rules = robots().rules;
    const disallow = Array.isArray(rules) ? rules[0].disallow : rules?.disallow;
    expect(disallow).toContain('/portal');
  });

  it('allows crawling /terms and public documentation', () => {
    const rules = robots().rules;
    const allow = Array.isArray(rules) ? rules[0].allow : rules?.allow;
    expect(allow).toContain('/terms');
    expect(allow).toContain('/privacy');
  });
});
