'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface InlineAlertProps {
  message: string;
  icon?: React.ReactNode;
  variant?: 'error' | 'warning' | 'info' | 'success';
  className?: string;
}

const variantStyles = {
  error:
    'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400',
  warning:
    'bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400',
  info:
    'bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400',
  success:
    'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400',
};

export function InlineAlert({
  message,
  icon,
  variant = 'error',
  className,
}: InlineAlertProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm',
        variantStyles[variant],
        className
      )}
      role="alert"
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{message}</span>
    </div>
  );
}
