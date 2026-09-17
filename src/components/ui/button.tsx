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
    const baseStyles =
      'relative inline-flex items-center justify-center font-medium rounded-xl select-none cursor-pointer transition-all duration-100 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

    const variants = {
      primary:
        'bg-blue-600 hover:bg-blue-500 text-white shadow-sm active:bg-blue-700 border border-blue-700/20',
      secondary:
        'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-zinc-900 dark:text-zinc-100 border border-black/5 dark:border-white/10 backdrop-blur-md',
      destructive:
        'bg-red-600 hover:bg-red-500 text-white shadow-sm active:bg-red-700 border border-red-700/20',
      ghost:
        'bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-zinc-800 dark:text-zinc-200',
      outline:
        'bg-transparent border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-zinc-900 dark:text-zinc-100',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 h-8 gap-1.5',
      md: 'text-sm px-4 py-2 h-10 gap-2',
      lg: 'text-base px-6 py-2.5 h-12 gap-2.5',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
