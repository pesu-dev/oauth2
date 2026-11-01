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

// pesu-auth `.status-chip`: hairline pill, monospace label, semantic text color
export function Badge({
  className,
  variant = 'neutral',
  children,
  ...props
}: BadgeProps) {
  const variants = {
    testing: 'text-warning border-warning/40',
    pending: 'text-get border-get/40',
    pending_production: 'text-get border-get/40',
    production: 'text-success border-success/40',
    suspended: 'text-danger border-danger/40',
    identity: 'text-get border-get/40',
    delegated: 'text-json-key border-json-key/40',
    neutral: 'text-muted border-line-strong',
    required: 'text-danger border-danger/40',
    optional: 'text-muted border-line',
  };

  return (
    <span
      data-variant={variant}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full border bg-surface font-mono text-[10px] uppercase tracking-[0.02em] whitespace-nowrap',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
