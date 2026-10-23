'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    // pesu-auth `.action` / `.copy`: monospace uppercase labels, hairline borders, 5px radius
    const baseStyles =
      'relative inline-flex items-center justify-center font-mono font-bold uppercase tracking-[0.02em] rounded-[5px] select-none cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none';

    const variants = {
      primary: 'bg-button text-button-fg border border-button hover:opacity-90',
      secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-soft',
      destructive: 'bg-danger text-bg border border-danger hover:opacity-90',
      ghost: 'bg-transparent text-muted border border-transparent hover:text-fg hover:bg-surface-soft',
      outline: 'bg-transparent text-fg border border-line-strong hover:bg-surface-soft',
    };

    const sizes = {
      sm: 'text-[10px] px-2.5 py-1.5 h-8 gap-1.5',
      md: 'text-[10px] px-4 py-2 h-10 gap-2',
      lg: 'text-[11px] px-6 py-3 h-12 gap-2.5',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
