'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label ? (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            {label}
          </label>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          className={cn(
            'w-full px-3.5 py-2.5 rounded-xl text-sm transition-all duration-100 ease-out',
            'bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/15',
            'text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500',
            error
              ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
              : '',
            className
          )}
          {...props}
        />
        {error ? (
          <p className="text-xs text-red-500 mt-1">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{helperText}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';
