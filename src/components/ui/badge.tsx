'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'testing' | 'pending' | 'pending_production' | 'production' | 'suspended' | 'identity' | 'delegated' | 'neutral' | 'required' | 'optional';
}

export function Badge({
  className,
  variant = 'neutral',
  children,
  ...props
}: BadgeProps) {
  const variants = {
    testing:
      'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20',
    pending:
      'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20',
    pending_production:
      'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20',
    production:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20',
    suspended:
      'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20',
    identity:
      'bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20',
    delegated:
      'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20',
    neutral:
      'bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 border border-black/5 dark:border-white/10',
    required:
      'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
    optional:
      'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide uppercase',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
