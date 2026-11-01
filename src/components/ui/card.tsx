'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative rounded-md bg-surface border border-line p-6 overflow-hidden',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
}

export function CardHeader({
  className,
  children,
  icon,
  ...props
}: CardHeaderProps) {
  if (icon) {
    return (
      <div className={cn('flex items-center gap-3 mb-4', className)} {...props}>
        <div className="w-9 h-9 rounded-md flex items-center justify-center border border-line bg-surface-soft text-soft shrink-0">
          {icon}
        </div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div className={cn('mb-4 space-y-1.5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('font-serif text-[22px] font-normal leading-tight text-fg', className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-soft leading-relaxed', className)} {...props}>
      {children}
    </p>
  );
}
