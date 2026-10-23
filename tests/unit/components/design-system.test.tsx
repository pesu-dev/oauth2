// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DotGrid } from '@/components/ui/dot-grid';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { CodeBlock, highlightJson } from '@/components/ui/code-block';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

function fakeContext() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  };
}

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }),
  });
}

describe('DotGrid', () => {
  let ctx: ReturnType<typeof fakeContext>;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    ctx = fakeContext();
    rafCallbacks = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    window.innerWidth = 100;
    window.innerHeight = 60;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flushFrames = () => {
    const pending = rafCallbacks.splice(0);
    pending.forEach((cb) => cb(0));
  };

  it('draws the grid on mount and resizes to the viewport', () => {
    mockMatchMedia(false);
    render(<DotGrid />);
    const canvas = screen.getByTestId('dot-grid') as HTMLCanvasElement;
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.width).toBe('100px');
    expect(ctx.arc).toHaveBeenCalled();

    ctx.arc.mockClear();
    window.innerWidth = 200;
    fireEvent(window, new Event('resize'));
    expect(canvas.style.width).toBe('200px');
    expect(ctx.arc).toHaveBeenCalled();
  });

  it('enlarges dots near the pointer and resets on mouseleave', () => {
    mockMatchMedia(false);
    render(<DotGrid />);
    ctx.arc.mockClear();

    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 12, clientY: 12 }); // coalesced into one frame
    expect(rafCallbacks).toHaveLength(1);
    flushFrames();
    const radii = ctx.arc.mock.calls.map((call) => call[2] as number);
    expect(Math.max(...radii)).toBeGreaterThan(1);

    ctx.arc.mockClear();
    fireEvent.mouseLeave(document);
    flushFrames();
    expect(Math.max(...ctx.arc.mock.calls.map((call) => call[2] as number))).toBe(1);
  });

  it('redraws when the theme attribute changes', async () => {
    mockMatchMedia(false);
    render(<DotGrid />);
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    expect(rafCallbacks.length).toBeGreaterThan(0);
    document.documentElement.removeAttribute('data-theme');
  });

  it('ignores the pointer under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    render(<DotGrid />);
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    expect(rafCallbacks).toHaveLength(0);
  });

  it('cancels a pending frame on unmount', () => {
    mockMatchMedia(false);
    const { unmount } = render(<DotGrid />);
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('does nothing without a 2d context', () => {
    mockMatchMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<DotGrid />);
    expect(screen.getByTestId('dot-grid')).toBeDefined();
  });
});

describe('Drawer', () => {
  function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
    return (
      <Drawer onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>
          <button type="button">Open</button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Sheet title</DrawerTitle>
          <DrawerDescription>Sheet body</DrawerDescription>
          <DrawerClose asChild>
            <button type="button">Cancel</button>
          </DrawerClose>
        </DrawerContent>
      </Drawer>
    );
  }

  it('opens from the trigger as a labelled modal dialog', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Open'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByText('Sheet title').id);
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Sheet body').id);
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes via DrawerClose, Escape and the overlay', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByTestId('drawer-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange.mock.calls.map((c) => c[0])).toEqual([true, false, true, false, true, false]);
  });

  it('respects controlled open state and a prevented child click', () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open={false} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>
          <button type="button" onClick={(e) => e.preventDefault()}>Blocked</button>
        </DrawerTrigger>
        <DrawerTrigger>Plain trigger</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Hidden</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    fireEvent.click(screen.getByText('Blocked'));
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Plain trigger'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders open by default and throws outside a Drawer', () => {
    render(
      <Drawer defaultOpen>
        <DrawerContent>
          <DrawerTitle>Default open</DrawerTitle>
        </DrawerContent>
      </Drawer>
    );
    expect(screen.getByRole('dialog')).toBeDefined();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DrawerTitle>Orphan</DrawerTitle>)).toThrow('inside <Drawer>');
    spy.mockRestore();
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return <button type="button" onClick={() => toast('Copied')}>Copy</button>;
  }

  it('shows a message and hides it after a delay', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    const status = screen.getByText('', { selector: '[aria-live="polite"]' });
    fireEvent.click(screen.getByText('Copy'));
    fireEvent.click(screen.getByText('Copy'));
    expect(status.textContent).toBe('Copied');
    expect(status.className).toContain('opacity-100');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(status.className).toContain('opacity-0');
    vi.useRealTimers();
  });

  it('is a no-op outside the provider', () => {
    render(<Trigger />);
    expect(() => fireEvent.click(screen.getByText('Copy'))).not.toThrow();
  });
});

describe('JSON highlighting', () => {
  it('colors keys, strings, numbers and literals', () => {
    const { container } = render(
      <CodeBlock code={'{\n  "sub": "usr_1",\n  "n": -1.5e2,\n  "ok": true,\n  "x": null\n}'} />
    );
    expect(container.querySelector('.text-json-key')?.textContent).toBe('"sub"');
    expect(container.querySelector('.text-json-string')?.textContent).toBe('"usr_1"');
    expect(container.querySelector('.text-json-number')?.textContent).toBe('-1.5e2');
    expect(container.querySelectorAll('.text-json-literal')).toHaveLength(2);
    expect(container.querySelector('pre')?.textContent).toContain('"sub": "usr_1"');
  });

  it('leaves non-JSON code untouched', () => {
    const { container } = render(<CodeBlock code="curl -X POST https://x" />);
    expect(container.querySelector('span')).toBeNull();
    const { container: brace } = render(<CodeBlock code="{ not json" />);
    expect(brace.querySelector('span')).toBeNull();
  });

  it('keeps plain text between tokens', () => {
    const nodes = highlightJson('[1, 2]');
    expect(nodes[0]).toBe('[');
    expect(nodes[nodes.length - 1]).toBe(']');
  });
});
