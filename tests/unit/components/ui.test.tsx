// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyableField } from '@/components/ui/copyable-field';
import { Textarea } from '@/components/ui/textarea';
import { fireEvent, act } from '@testing-library/react';

describe('Apple-Style UI Components', () => {
  it('renders Button with variants and sizes', () => {
    render(<Button variant="primary">Click Me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeDefined();
    expect(button.className).toContain('active:scale-[0.98]');
  });

  it('renders Card with title and description', () => {
    render(
      <Card>
        <CardTitle>Test Title</CardTitle>
        <CardDescription>Test Description</CardDescription>
      </Card>
    );
    expect(screen.getByText('Test Title')).toBeDefined();
    expect(screen.getByText('Test Description')).toBeDefined();
  });

  it('renders Badge with status colors', () => {
    render(<Badge variant="production">Production</Badge>);
    const badge = screen.getByText('Production');
    expect(badge.className).toContain('text-emerald-700');
  });

  describe('CodeBlock', () => {
    it('renders code without copy button when onCopy not provided', () => {
      const { container } = render(<CodeBlock code="const a = 1;" />);
      expect(screen.getByText('const a = 1;')).toBeDefined();
      expect(container.querySelector('button')).toBeNull();
    });

    it('renders with copy button, custom className and triggers onCopy', () => {
      const onCopy = vi.fn();
      render(
        <CodeBlock
          code="const b = 2;"
          copyId="test-id"
          onCopy={onCopy}
          className="custom-code-class"
          title="Custom copy title"
        />
      );

      const btn = screen.getByRole('button');
      expect(btn).toBeDefined();
      expect(btn.getAttribute('title')).toBe('Custom copy title');
      fireEvent.click(btn);
      expect(onCopy).toHaveBeenCalledWith('test-id');
    });

    it('renders Check icon when copied=true', () => {
      const onCopy = vi.fn();
      render(
        <CodeBlock
          code="const c = 3;"
          copyId="test-id-2"
          copied={true}
          onCopy={onCopy}
        />
      );
      const btn = screen.getByRole('button');
      expect(btn.querySelector('.text-emerald-500')).toBeDefined();
    });
  });

  describe('CopyableField', () => {
    it('renders without label and copies on click', async () => {
      vi.useFakeTimers();
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<CopyableField value="secret-token-123" />);
      expect(screen.getByText('secret-token-123')).toBeDefined();

      const copyBtn = screen.getByTitle('Copy value');
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(writeTextMock).toHaveBeenCalledWith('secret-token-123');

      // Check icon is visible
      expect(copyBtn.querySelector('.text-emerald-500')).toBeDefined();

      // Fast-forward timeout to revert copied state
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      vi.useRealTimers();
    });

    it('renders with label, custom className, and masked value', () => {
      render(
        <CopyableField
          value="my-very-long-secret-key-1234567890"
          label="Client Secret"
          masked={true}
          className="extra-class"
        />
      );

      expect(screen.getByText('Client Secret')).toBeDefined();
      expect(screen.getByTitle('Copy Client Secret')).toBeDefined();
      // Masked with bullet characters
      const bulletSpan = screen.getByText('•'.repeat(32));
      expect(bulletSpan).toBeDefined();
    });
  });

  describe('Textarea', () => {
    it('renders with minimal props (no id, no label, no error, no helperText)', () => {
      const { container } = render(<Textarea placeholder="Type here..." />);
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
      expect(textarea?.getAttribute('id')).toBeNull();
    });

    it('generates id from label when id is not provided', () => {
      render(<Textarea label="Redirect URIs" />);
      const textarea = screen.getByLabelText('Redirect URIs');
      expect(textarea.getAttribute('id')).toBe('redirect-uris');
    });

    it('uses custom id when provided', () => {
      render(<Textarea label="Notes" id="custom-notes-id" />);
      const textarea = screen.getByLabelText('Notes');
      expect(textarea.getAttribute('id')).toBe('custom-notes-id');
    });

    it('displays error and applies error styles', () => {
      render(<Textarea label="Description" error="Description is required" helperText="Help info" />);
      expect(screen.getByText('Description is required')).toBeDefined();
      // helperText should not be rendered when error is present
      expect(screen.queryByText('Help info')).toBeNull();
      const textarea = screen.getByLabelText('Description');
      expect(textarea.className).toContain('border-red-500');
    });

    it('displays helperText when error is absent', () => {
      render(<Textarea label="Bio" helperText="Max 200 characters" />);
      expect(screen.getByText('Max 200 characters')).toBeDefined();
    });

    it('forwards ref properly', () => {
      const ref = React.createRef<HTMLTextAreaElement>();
      render(<Textarea ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });
  });
});

