'use client';

import * as React from 'react';

export interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = 'Loading…' }: PageLoaderProps) {
  return (
    <div className="py-16 text-center text-sm text-zinc-400">{message}</div>
  );
}
