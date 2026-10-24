'use client';

import * as React from 'react';

export interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = 'Loading…' }: PageLoaderProps) {
  return (
    <div role="status" className="py-16 text-center eyebrow">
      {message}
    </div>
  );
}
