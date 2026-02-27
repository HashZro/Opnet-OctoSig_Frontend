'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info' | 'warning';

type Toast = {
    id: string;
    type: ToastType;
    message: string;
    exiting: boolean;
};

type ToastContextValue = {
    addToast: (type: ToastType, message: string) => void;
    removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 4000;
const EXIT_ANIMATION_MS = 150;

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, EXIT_ANIMATION_MS);
    }, []);

    const addToast = useCallback(
        (type: ToastType, message: string) => {
            const id = `toast-${++nextId}`;
            setToasts((prev) => {
                const next = [...prev, { id, type, message, exiting: false }];
                if (next.length > MAX_TOASTS) {
                    return next.slice(next.length - MAX_TOASTS);
                }
                return next;
            });
            setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
        },
        [removeToast],
    );

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within <ToastProvider>');

    return {
        toast: {
            success: (msg: string) => ctx.addToast('success', msg),
            error: (msg: string) => ctx.addToast('error', msg),
            info: (msg: string) => ctx.addToast('info', msg),
            warning: (msg: string) => ctx.addToast('warning', msg),
        },
    };
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || toasts.length === 0) return null;

    return createPortal(
        <div
            aria-live="polite"
            style={{
                position: 'fixed',
                bottom: '1.5rem',
                right: '1.5rem',
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: '0.5rem',
                zIndex: 9999,
                pointerEvents: 'none',
            }}
        >
            {toasts.map((t) => (
                <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
            ))}
        </div>,
        document.body,
    );
}

const TYPE_CONFIG: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
    success: { bg: '#F0FDF4', border: '#BBF7D0', color: '#16A34A', icon: '\u2713' },
    error:   { bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', icon: '\u2717' },
    info:    { bg: '#F0F9FF', border: '#BAE6FD', color: '#0284C7', icon: 'i' },
    warning: { bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', icon: '!' },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
    const cfg = TYPE_CONFIG[toast.type];

    return (
        <div
            role="alert"
            style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                minWidth: '280px',
                maxWidth: 'min(420px, calc(100vw - 2rem))',
                padding: '0.75rem 1rem',
                backgroundColor: cfg.bg,
                border: `1px solid ${cfg.border}`,
                color: cfg.color,
                animation: toast.exiting
                    ? 'toast-exit 150ms ease forwards'
                    : 'toast-enter 150ms ease forwards',
            }}
        >
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    minWidth: '20px',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    color: cfg.color,
                }}
            >
                {cfg.icon}
            </span>

            <span
                style={{
                    flex: 1,
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    letterSpacing: '0.01em',
                    color: cfg.color,
                }}
            >
                {toast.message}
            </span>

            <button
                type="button"
                onClick={onClose}
                aria-label="Dismiss"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    minWidth: '20px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontSize: '1rem',
                    lineHeight: 1,
                    color: cfg.color,
                    opacity: 0.6,
                    padding: 0,
                }}
            >
                &times;
            </button>
        </div>
    );
}
