'use client';

import * as React from 'react';

type ToastFn = (message: string) => void;

const ToastContext = React.createContext<ToastFn>(() => {});

/** pesu-auth `.toast`: one transient status line, bottom-right. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState('');
  const [visible, setVisible] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = React.useCallback<ToastFn>((next) => {
    setMessage(next);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 1800);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`fixed right-5 bottom-5 z-[11000] px-3 py-2 rounded-[5px] bg-fg text-bg font-mono text-[11px] pointer-events-none transition-all duration-200 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  return React.useContext(ToastContext);
}
