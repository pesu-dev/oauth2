'use client';

import * as React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CodeBlockProps {
  code: string;
  copyId?: string;
  copied?: boolean;
  onCopy?: (id: string) => void;
  title?: string;
  className?: string;
}

export function CodeBlock({
  code,
  copyId,
  copied = false,
  onCopy,
  title = 'Copy code',
  className,
}: CodeBlockProps) {
  const showCopyButton = Boolean(copyId && onCopy);

  return (
    <div className={`relative group${className ? ` ${className}` : ''}`}>
      <pre className="overflow-x-auto p-4 rounded-xl bg-black/5 dark:bg-black/60 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 border border-black/5 dark:border-white/5">
        {code}
      </pre>
      {showCopyButton && (
        <Button
          variant="ghost"
          size="sm"
          title={title}
          onClick={() => onCopy!(copyId!)}
          className="absolute top-2.5 right-2.5 h-7 w-7 p-0 bg-white/80 dark:bg-zinc-800/80 hover:bg-white dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity shadow-xs border border-black/5 dark:border-white/5"
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <Copy className="w-3.5 h-3.5" />
          }
        </Button>
      )}
    </div>
  );
}
