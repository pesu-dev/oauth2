// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { ThemeProvider, THEME_STORAGE_KEY } from '@/components/ui/theme-provider';

const mockSetTheme = vi.fn();
let mockTheme: string | undefined = 'light';
const providerProps = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
  ThemeProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    providerProps(props);
    return <div>{children}</div>;
  },
}));

describe('Theme Components', () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    providerProps.mockClear();
  });

  it('renders ThemeProvider with the data-theme attribute and pesu storage key', () => {
    render(
      <ThemeProvider>
        <div>Child Content</div>
      </ThemeProvider>
    );
    expect(screen.getByText('Child Content')).toBeDefined();
    expect(providerProps).toHaveBeenCalledWith(
      expect.objectContaining({ attribute: 'data-theme', storageKey: THEME_STORAGE_KEY, defaultTheme: 'system' })
    );
  });

  it('renders a three-way radiogroup with the current theme checked', () => {
    mockTheme = 'light';
    render(<ThemeToggle />);

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Use light theme' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Use dark theme' }).getAttribute('aria-checked')).toBe('false');
  });

  it('switches to dark, light and system', () => {
    mockTheme = 'light';
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('radio', { name: 'Use dark theme' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Use system theme' }));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
    fireEvent.click(screen.getByRole('radio', { name: 'Use light theme' }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('treats an unset theme as system', () => {
    mockTheme = undefined;
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'Use system theme' }).getAttribute('aria-checked')).toBe('true');
  });

  it('server-renders with system checked before hydration', async () => {
    mockTheme = 'dark';
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(<ThemeToggle />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true" aria-label="Use system theme"/);
  });
});
