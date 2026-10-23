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

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function isJson(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Colorizes JSON keys, strings, numbers and literals with React nodes (never innerHTML). */
export function highlightJson(code: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(code.slice(last, index));
    const [token, str, colon, literal, num] = match;
    if (str !== undefined) {
      nodes.push(
        <span key={key++} className={colon ? 'text-json-key' : 'text-json-string'}>
          {str}
        </span>
      );
      if (colon) nodes.push(colon);
    } else if (literal !== undefined) {
      nodes.push(<span key={key++} className="text-json-literal">{literal}</span>);
    } else if (num !== undefined) {
      nodes.push(<span key={key++} className="text-json-number">{num}</span>);
    } else {
      nodes.push(token);
    }
    last = index + token.length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
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
  const content = React.useMemo(() => (isJson(code) ? highlightJson(code) : code), [code]);

  return (
    <div className={`relative group${className ? ` ${className}` : ''}`}>
      <pre className="overflow-x-auto p-4 rounded-md bg-code font-mono text-xs leading-relaxed text-fg border border-line">
        {content}
      </pre>
      {showCopyButton && (
        <Button
          variant="secondary"
          size="sm"
          title={title}
          aria-label={title}
          onClick={() => onCopy!(copyId!)}
          className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-success" />
            : <Copy className="w-3.5 h-3.5" />
          }
        </Button>
      )}
    </div>
  );
}
