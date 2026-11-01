'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button } from '@/components/ui/button';
import { labelStyles } from '@/components/ui/input';

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
      {label && <p className={labelStyles}>{label}</p>}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[5px] bg-code border border-line font-mono text-xs">
        <span className="truncate text-fg select-all">{displayValue}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="shrink-0 h-6 w-6 p-0"
          title={`Copy ${label ?? 'value'}`}
          aria-label={`Copy ${label ?? 'value'}`}
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-success" />
            : <Copy className="w-3.5 h-3.5" />
          }
        </Button>
      </div>
    </div>
  );
}
