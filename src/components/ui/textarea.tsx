'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { controlStyles, labelStyles } from '@/components/ui/input';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const messageId = textareaId && (error || helperText) ? `${textareaId}-message` : undefined;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={textareaId} className={labelStyles}>
            {label}
          </label>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className={cn(
            controlStyles,
            'resize-y min-h-24',
            error ? 'border-danger focus:border-danger' : '',
            className
          )}
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
Textarea.displayName = 'Textarea';
