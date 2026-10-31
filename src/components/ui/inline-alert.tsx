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
  error: 'text-danger border-danger/40 bg-danger/5',
  warning: 'text-warning border-warning/40 bg-warning/5',
  info: 'text-get border-get/40 bg-get/5',
  success: 'text-success border-success/40 bg-success/5',
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
        'flex items-center gap-2 px-3 py-2.5 rounded-[5px] border text-sm',
        variantStyles[variant],
        className
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{message}</span>
    </div>
  );
}
