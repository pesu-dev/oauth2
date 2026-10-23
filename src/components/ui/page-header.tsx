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
    <div className={cn('space-y-3', className)}>
      {eyebrow && (
        <div className="eyebrow flex items-center gap-2 [&_svg]:w-3.5 [&_svg]:h-3.5">
          {eyebrow.icon}
          {eyebrow.label}
        </div>
      )}
      <h1 className="display text-fg">{title}</h1>
      {description && <p className="text-soft leading-[1.65] max-w-2xl">{description}</p>}
    </div>
  );
}
