'use client';

import { useState, useEffect } from 'react';

type TransactionAlertProps = {
    txId: string;
    label?: string;
    onDismiss?: () => void;
};

export function TransactionAlert({ txId, label = 'Transaction Submitted', onDismiss }: TransactionAlertProps) {
    const [visible, setVisible] = useState(true);
    const [pulsing, setPulsing] = useState(true);

    // Stop the pulse animation after ~6s (3 cycles)
    useEffect(() => {
        const timer = setTimeout(() => setPulsing(false), 6000);
        return () => clearTimeout(timer);
    }, []);

    if (!visible) return null;

    return (
        <>
            <style>{`
                @keyframes txAlertSlideIn {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes txAlertPulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.35), 0 4px 20px rgba(22, 163, 74, 0.12); }
                    50% { box-shadow: 0 0 0 10px rgba(22, 163, 74, 0), 0 4px 28px rgba(22, 163, 74, 0.2); }
                }
                @keyframes txAlertCheckDraw {
                    from { stroke-dashoffset: 24; }
                    to { stroke-dashoffset: 0; }
                }
                @keyframes txAlertClockSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div
                style={{
                    marginBottom: '1.5rem',
                    padding: '1.25rem 1.5rem',
                    backgroundColor: '#F0FDF4',
                    border: '3px solid #16A34A',
                    borderRadius: '8px',
                    animation: `txAlertSlideIn 0.35s ease-out${pulsing ? ', txAlertPulse 2s ease-in-out 3' : ''}`,
                    boxShadow: pulsing ? undefined : '0 4px 20px rgba(22, 163, 74, 0.12)',
                }}
            >
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        backgroundColor: '#16A34A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 24, animation: 'txAlertCheckDraw 0.5s ease-out 0.2s both' }}>
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                    <p style={{ fontSize: '1rem', fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {label}
                    </p>
                    {onDismiss && (
                        <button
                            type="button"
                            onClick={() => { setVisible(false); onDismiss(); }}
                            style={{
                                marginLeft: 'auto',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#16A34A',
                                opacity: 0.5,
                                fontSize: '1.25rem',
                                lineHeight: 1,
                                padding: '0 4px',
                            }}
                            aria-label="Dismiss"
                        >
                            &times;
                        </button>
                    )}
                </div>

                {/* TX hash */}
                <code style={{
                    display: 'block',
                    fontSize: '0.8125rem',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    color: 'var(--text)',
                    backgroundColor: '#DCFCE7',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '4px',
                }}>
                    {txId}
                </code>

                {/* OPScan link */}
                <a
                    href={`https://opscan.org/transactions/${txId}?network=op_testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: 'inline-block',
                        marginTop: '0.75rem',
                        padding: '0.5rem 1.25rem',
                        backgroundColor: '#16A34A',
                        color: '#FFF',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        textDecoration: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        transition: 'background-color 150ms ease, transform 150ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803D'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16A34A'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                    Track on OPScan
                </a>

                {/* Mining time warning */}
                <div style={{
                    marginTop: '1rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    backgroundColor: '#FEF9C3',
                    border: '2px solid #FACC15',
                    borderRadius: '6px',
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#854D0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1, animation: 'txAlertClockSpin 3s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#854D0E', lineHeight: 1.6 }}>
                        This transaction needs to be mined into a block before changes appear on site.
                        This usually takes 1–3 minutes depending on network activity.
                    </p>
                </div>
            </div>
        </>
    );
}
