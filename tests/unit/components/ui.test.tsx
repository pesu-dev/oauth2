// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

describe('Apple-Style UI Components', () => {
  it('renders Button with variants and sizes', () => {
    render(<Button variant="primary">Click Me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeDefined();
    expect(button.className).toContain('active:scale-[0.98]');
  });

  it('renders Card with title and description', () => {
    render(
      <Card>
        <CardTitle>Test Title</CardTitle>
        <CardDescription>Test Description</CardDescription>
      </Card>
    );
    expect(screen.getByText('Test Title')).toBeDefined();
    expect(screen.getByText('Test Description')).toBeDefined();
  });

  it('renders Badge with status colors', () => {
    render(<Badge variant="production">Production</Badge>);
    const badge = screen.getByText('Production');
    expect(badge.className).toContain('text-emerald-700');
  });
});
