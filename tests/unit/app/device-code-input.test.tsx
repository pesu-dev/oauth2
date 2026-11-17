// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceCodeInput } from '@/app/device/device-code-input';

describe('DeviceCodeInput component', () => {
  it('renders with label and 8 slot boxes', () => {
    const { container } = render(<DeviceCodeInput />);
    const input = screen.getByLabelText('Device code');
    expect(input).toBeDefined();

    // 8 slot boxes should be rendered
    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(slots.length).toBe(8);
  });

  it('pre-populates slots from defaultValue, capitalizing and removing hyphens', () => {
    const { container } = render(<DeviceCodeInput defaultValue="bdfg-hjkl" />);
    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    const letters = Array.from(slots).map((s) => s.textContent);
    expect(letters).toEqual(['B', 'D', 'F', 'G', 'H', 'J', 'K', 'L']);

    const input = screen.getByLabelText('Device code') as HTMLInputElement;
    expect(input.value).toBe('BDFGHJKL');
  });

  it('handles typing letter by letter and advancing slots', () => {
    const { container } = render(<DeviceCodeInput />);
    const input = screen.getByLabelText('Device code') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'b' });
    fireEvent.keyDown(input, { key: 'd' });
    fireEvent.keyDown(input, { key: 'f' });

    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(slots[0].textContent).toBe('B');
    expect(slots[1].textContent).toBe('D');
    expect(slots[2].textContent).toBe('F');
    expect(slots[3].textContent).toBe('');
    expect(input.value).toBe('BDF');
  });

  it('handles backspace to delete characters and step back', () => {
    const { container } = render(<DeviceCodeInput defaultValue="BDF" />);
    const input = screen.getByLabelText('Device code') as HTMLInputElement;

    fireEvent.focus(input);
    // Cursor at end (pos 3)
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: 'Backspace' });

    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(slots[0].textContent).toBe('B');
    expect(slots[1].textContent).toBe('D');
    expect(slots[2].textContent).toBe('');
    expect(input.value).toBe('BD');
  });

  it('handles paste of formatted and lowercase code', () => {
    const { container } = render(<DeviceCodeInput />);
    const input = screen.getByLabelText('Device code') as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'pqrs-tvwx',
      },
    });

    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    const letters = Array.from(slots).map((s) => s.textContent);
    expect(letters).toEqual(['P', 'Q', 'R', 'S', 'T', 'V', 'W', 'X']);
    expect(input.value).toBe('PQRSTVWX');
  });

  it('formats value with hyphen on form submit when 8 characters', () => {
    const handleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={handleSubmit}>
        <DeviceCodeInput defaultValue="BDFGHJKL" />
        <button type="submit">Submit</button>
      </form>
    );

    const input = screen.getByLabelText('Device code') as HTMLInputElement;
    expect(input.value).toBe('BDFGHJKL');

    const button = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(button);

    expect(handleSubmit).toHaveBeenCalled();
    expect(input.value).toBe('BDFG-HJKL');
  });

  it('handles slot click to position cursor', () => {
    render(<DeviceCodeInput defaultValue="BDFGHJKL" />);
    const input = screen.getByLabelText('Device code') as HTMLInputElement;

    // Simulate clicking at 25% of input width (slot 2)
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 48,
      right: 400,
      bottom: 48,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.click(input, { clientX: 110 }); // 110 / 400 = 0.275 -> slot 2
    expect(input.selectionStart).toBe(2);
  });

  it('shows error styling when hasError is true', () => {
    const { container } = render(<DeviceCodeInput hasError autoFocus={false} />);
    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(slots[0].className).toContain('border-danger/60');
    expect(slots[1].className).toContain('border-danger/60');
  });

  it('shows active error styling when hasError is true and focused', () => {
    const { container } = render(<DeviceCodeInput hasError autoFocus={true} />);
    const slots = container.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(slots[0].className).toContain('border-danger ring-2 ring-danger/20');
    expect(slots[1].className).toContain('border-danger/60');
  });

  it('handles arrow navigation', () => {
    render(<DeviceCodeInput defaultValue="BDFG" />);
    const input = screen.getByLabelText('Device code') as HTMLInputElement;

    fireEvent.focus(input);
    input.setSelectionRange(4, 4);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
  });
});
