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
        'relative rounded-2xl bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.12] shadow-sm p-6 overflow-hidden transition-colors',
        'before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-white/50 dark:before:via-white/20 before:to-transparent',
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
  iconColor?: string;
}

export function CardHeader({
  className,
  children,
  icon,
  iconColor = 'blue',
  ...props
}: CardHeaderProps) {
  if (icon) {
    return (
      <div className={cn('flex items-center gap-2.5 mb-4', className)} {...props}>
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center bg-${iconColor}-600/10 text-${iconColor}-600 dark:text-${iconColor}-400 shrink-0`}
        >
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
      className={cn(
        'text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50',
        className
      )}
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
    <p
      className={cn('text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed', className)}
      {...props}
    >
      {children}
    </p>
  );
}
