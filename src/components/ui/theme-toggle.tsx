'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

const OPTIONS = [
  {
    value: 'system',
    label: 'Use system theme',
    title: 'System theme',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
  {
    value: 'light',
    label: 'Use light theme',
    title: 'Light theme',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Use dark theme',
    title: 'Dark theme',
    icon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const current = mounted ? theme ?? 'system' : 'system';

  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow text-[9px] max-[700px]:hidden">Theme</span>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex p-[3px] border border-line rounded-full bg-surface shadow-panel"
      >
        {OPTIONS.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.label}
              title={option.title}
              onClick={() => setTheme(option.value)}
              className={`relative grid place-items-center w-[30px] h-[30px] rounded-full cursor-pointer transition-colors ${
                active
                  ? 'text-fg bg-surface-soft shadow-[inset_0_0_0_1px_var(--line-strong)]'
                  : 'text-muted hover:text-fg'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-[15px] h-[15px]"
                aria-hidden="true"
              >
                {option.icon}
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
