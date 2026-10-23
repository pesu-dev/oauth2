'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

/*
 * Modal sheet with the same API the pages used with vaul, rebuilt on plain React:
 * centered on desktop, bottom-anchored on narrow screens, Escape / backdrop to close,
 * focus moved in on open and restored on close.
 */

interface DrawerContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const DrawerContext = React.createContext<DrawerContextValue | null>(null);

function useDrawer(): DrawerContextValue {
  const ctx = React.useContext(DrawerContext);
  if (!ctx) throw new Error('Drawer components must be used inside <Drawer>');
  return ctx;
}

export interface DrawerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accepted for API compatibility with the previous vaul drawer; no effect. */
  shouldScaleBackground?: boolean;
  children?: React.ReactNode;
}

export function Drawer({ open: openProp, defaultOpen = false, onOpenChange, children }: DrawerProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const baseId = React.useId();

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange]
  );

  const value = React.useMemo(
    () => ({ open, setOpen, titleId: `${baseId}-title`, descriptionId: `${baseId}-description` }),
    [open, setOpen, baseId]
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

type SlotProps = {
  asChild?: boolean;
  children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

function withClick(asChild: boolean | undefined, children: React.ReactNode, props: SlotProps, onClick: () => void) {
  if (asChild && React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)) {
    const child = children;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) onClick();
      },
    });
  }
  return (
    <button type="button" {...props} onClick={(event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) onClick();
    }}>
      {children}
    </button>
  );
}

export function DrawerTrigger({ asChild, children, ...props }: SlotProps) {
  const { setOpen } = useDrawer();
  return withClick(asChild, children, props, () => setOpen(true));
}

export function DrawerClose({ asChild, children, ...props }: SlotProps) {
  const { setOpen } = useDrawer();
  return withClick(asChild, children, props, () => setOpen(false));
}

export function DrawerPortal({ children }: { children?: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function DrawerOverlay({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = useDrawer();
  return (
    <div
      data-testid="drawer-overlay"
      className={cn('fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur-[2px]', className)}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DrawerContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen, titleId, descriptionId } = useDrawer();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <DrawerPortal>
      <DrawerOverlay />
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none min-[701px]:inset-0 min-[701px]:items-center p-0 min-[701px]:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={cn(
            'pointer-events-auto w-full max-h-[90vh] overflow-y-auto bg-surface border border-line shadow-panel rounded-t-md min-[701px]:rounded-md focus:outline-none',
            className
          )}
          {...props}
        >
          <div className="p-6">{children}</div>
        </div>
      </div>
    </DrawerPortal>
  );
}

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-2 pb-4 mb-4 border-b border-line text-left', className)} {...props} />;
}

export function DrawerTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDrawer();
  return (
    <h2
      id={titleId}
      className={cn('font-serif text-[27px] font-normal leading-tight text-fg', className)}
      {...props}
    />
  );
}

export function DrawerDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDrawer();
  return <p id={descriptionId} className={cn('text-sm text-soft leading-relaxed', className)} {...props} />;
}
