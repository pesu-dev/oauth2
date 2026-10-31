'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// pesu-auth `.control`: hairline field on the surface color, monospace label
export const controlStyles =
  'w-full px-3 py-2.5 rounded-[5px] text-sm bg-surface border border-line text-fg placeholder:text-muted transition-colors focus:border-line-strong focus-visible:outline-2 focus-visible:outline-fg focus-visible:outline-offset-1';

export const labelStyles = 'block font-mono text-[10px] uppercase tracking-[0.02em] text-muted';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const messageId = inputId && (error || helperText) ? `${inputId}-message` : undefined;

    return (
      <div className="w-full space-y-1.5">
        {label ? (
          <label htmlFor={inputId} className={labelStyles}>
            {label}
          </label>
        ) : null}
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className={cn(controlStyles, error ? 'border-danger focus:border-danger' : '', className)}
          {...props}
        />
        {error ? (
          <p id={messageId} className="text-xs text-danger mt-1">{error}</p>
        ) : helperText ? (
          <p id={messageId} className="text-xs text-muted mt-1">{helperText}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';
