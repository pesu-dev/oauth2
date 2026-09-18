'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

export interface DrawerActionsProps {
  onCancel: () => void;
  onSubmit?: () => void;
  submitLabel: string;
  loading?: boolean;
  destructive?: boolean;
}

export function DrawerActions({
  onCancel,
  onSubmit,
  submitLabel,
  loading = false,
  destructive = false,
}: DrawerActionsProps) {
  return (
    <div className="pt-2 flex gap-3">
      <Button
        type="button"
        variant="secondary"
        className="flex-1"
        onClick={onCancel}
        disabled={loading}
      >
        Cancel
      </Button>
      <Button
        type={onSubmit ? 'button' : 'submit'}
        variant={destructive ? 'destructive' : 'primary'}
        className="flex-1"
        loading={loading}
        onClick={onSubmit}
      >
        {submitLabel}
      </Button>
    </div>
  );
}
