// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { ThemeProvider } from '@/components/ui/theme-provider';

const mockSetTheme = vi.fn();
let mockResolvedTheme = 'light';

vi.mock('next-themes', () => ({
  useTheme: () => ({
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Theme Components', () => {
  it('renders ThemeProvider with children', () => {
    render(
      <ThemeProvider>
        <div>Child Content</div>
      </ThemeProvider>
    );
    expect(screen.getByText('Child Content')).toBeDefined();
  });

  it('renders ThemeToggle and switches from light to dark', () => {
    mockResolvedTheme = 'light';
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeDefined();

    fireEvent.click(button);
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('renders ThemeToggle and switches from dark to light', () => {
    mockResolvedTheme = 'dark';
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    fireEvent.click(button);
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('renders placeholder skeleton in SSR via renderToString', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('w-9 h-9 rounded-full');
    expect(html).not.toContain('<button');
  });
});
