'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface PageHeaderProps {
  eyebrow?: {
    icon?: React.ReactNode;
    label: string;
  };
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, className }: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {eyebrow && (
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
          {eyebrow.icon}
          {eyebrow.label}
        </div>
      )}
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
      )}
    </div>
  );
}
