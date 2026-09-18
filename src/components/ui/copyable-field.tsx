'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button } from '@/components/ui/button';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface CopyableFieldProps {
  value: string;
  label?: string;
  masked?: boolean;
  className?: string;
}

export function CopyableField({ value, label, masked = false, className }: CopyableFieldProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const displayValue = masked ? '•'.repeat(Math.min(value.length, 32)) : value;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 font-mono text-xs">
        <span className="truncate text-zinc-800 dark:text-zinc-200 select-all">{displayValue}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="shrink-0 h-6 w-6 p-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          title={`Copy ${label ?? 'value'}`}
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <Copy className="w-3.5 h-3.5" />
          }
        </Button>
      </div>
    </div>
  );
}
