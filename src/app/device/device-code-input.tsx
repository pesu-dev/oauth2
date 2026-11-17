'use client';

import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface DeviceCodeInputProps {
  id?: string;
  name?: string;
  label?: string;
  defaultValue?: string;
  hasError?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function DeviceCodeInput({
  id = 'user_code',
  name = 'user_code',
  label = 'Device code',
  defaultValue = '',
  hasError = false,
  autoFocus = true,
  className,
}: DeviceCodeInputProps) {
  const cleanInitial = React.useMemo(
    () => defaultValue.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
    [defaultValue]
  );

  const [code, setCode] = React.useState(cleanInitial);
  const [isFocused, setIsFocused] = React.useState(false);
  const [cursorPos, setCursorPos] = React.useState(cleanInitial.length);
  const [prevDefaultValue, setPrevDefaultValue] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync if defaultValue updates (e.g. server re-render on error) during render
  if (defaultValue !== prevDefaultValue) {
    setPrevDefaultValue(defaultValue);
    const cleaned = defaultValue.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(cleaned);
    setCursorPos(cleaned.length);
  }

  // When form is submitted, format 8-character codes as XXXX-XXXX for canonical query params
  React.useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;

    const handleFormSubmit = () => {
      if (inputRef.current && code.length === 8) {
        inputRef.current.value = `${code.slice(0, 4)}-${code.slice(4)}`;
      }
    };

    form.addEventListener('submit', handleFormSubmit);
    return () => {
      form.removeEventListener('submit', handleFormSubmit);
    };
  }, [code]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const selStart = inputRef.current?.selectionStart ?? code.length;
      const selEnd = inputRef.current?.selectionEnd ?? code.length;

      if (selStart !== selEnd) {
        const newCode = code.slice(0, selStart) + code.slice(selEnd);
        setCode(newCode);
        setCursorPos(selStart);
        setTimeout(() => inputRef.current?.setSelectionRange(selStart, selStart), 0);
      } else if (selStart > 0) {
        const newCode = code.slice(0, selStart - 1) + code.slice(selStart);
        setCode(newCode);
        const newPos = selStart - 1;
        setCursorPos(newPos);
        setTimeout(() => inputRef.current?.setSelectionRange(newPos, newPos), 0);
      }
    } else if (e.key === 'ArrowLeft') {
      const pos = Math.max(0, (inputRef.current?.selectionStart ?? cursorPos) - 1);
      setCursorPos(pos);
    } else if (e.key === 'ArrowRight') {
      const pos = Math.min(code.length, (inputRef.current?.selectionStart ?? cursorPos) + 1);
      setCursorPos(pos);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (/^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        const char = e.key.toUpperCase();
        const selStart = inputRef.current?.selectionStart ?? code.length;
        const selEnd = inputRef.current?.selectionEnd ?? code.length;

        let newCode: string;
        if (selStart !== selEnd) {
          newCode = code.slice(0, selStart) + char + code.slice(selEnd);
        } else if (selStart < code.length) {
          newCode = code.slice(0, selStart) + char + code.slice(selStart + 1);
        } else if (code.length < 8) {
          newCode = code + char;
        } else {
          return;
        }

        newCode = newCode.slice(0, 8);
        setCode(newCode);
        const nextPos = Math.min(selStart + 1, 8);
        setCursorPos(nextPos);
        setTimeout(() => inputRef.current?.setSelectionRange(nextPos, nextPos), 0);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(cleaned);
    const pos = Math.min(e.target.selectionStart ?? cleaned.length, 8);
    setCursorPos(pos);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const cleaned = pasted.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(cleaned);
    const nextPos = Math.min(cleaned.length, 8);
    setCursorPos(nextPos);
    setTimeout(() => inputRef.current?.setSelectionRange(nextPos, nextPos), 0);
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const clickedSlot = Math.min(Math.floor(ratio * 8), 7);
    const target = Math.min(clickedSlot, code.length);
    e.currentTarget.setSelectionRange(target, target);
    setCursorPos(target);
  };

  const handleSelect = () => {
    if (inputRef.current) {
      const pos = inputRef.current.selectionStart ?? code.length;
      setCursorPos(pos);
    }
  };

  const renderSlot = (index: number) => {
    const char = code[index] || '';
    const isActive = isFocused && (cursorPos === index || (cursorPos === 8 && index === 7));
    const isFilled = Boolean(char);

    return (
      <div
        key={index}
        className={cn(
          'w-8 h-11 min-[380px]:w-9 min-[380px]:h-12 sm:w-10 sm:h-12',
          'rounded-[5px] border bg-surface flex items-center justify-center text-center',
          'font-mono text-base sm:text-lg font-bold text-fg select-none transition-colors',
          hasError
            ? isActive
              ? 'border-danger ring-2 ring-danger/20'
              : 'border-danger/60'
            : isActive
            ? 'border-line-strong ring-2 ring-fg/20'
            : isFilled
            ? 'border-line-strong'
            : 'border-line'
        )}
      >
        {char ? (
          <span>{char}</span>
        ) : isActive ? (
          <span className="inline-block w-[1.5px] h-5 bg-fg animate-pulse" />
        ) : null}
      </div>
    );
  };

  return (
    <div className={cn('relative inline-flex flex-col items-center justify-center', className)}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="text"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus={autoFocus}
        value={code}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleClick}
        onFocus={() => {
          setIsFocused(true);
          setCursorPos(inputRef.current?.selectionStart ?? code.length);
        }}
        onBlur={() => setIsFocused(false)}
        onSelect={handleSelect}
        maxLength={12}
        className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer caret-transparent"
        aria-label={label}
        required
      />

      {/* Visual letter-by-letter boxes */}
      <div className="flex items-center justify-center gap-1.5 sm:gap-2 pointer-events-none" aria-hidden="true">
        {/* First 4 letters */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {[0, 1, 2, 3].map((idx) => renderSlot(idx))}
        </div>

        {/* Separator dash */}
        <div className="flex items-center justify-center px-0.5 sm:px-1 text-muted select-none">
          <span className="w-2 sm:w-2.5 h-[1.5px] bg-muted/60 rounded-full" />
        </div>

        {/* Second 4 letters */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {[4, 5, 6, 7].map((idx) => renderSlot(idx))}
        </div>
      </div>
    </div>
  );
}
