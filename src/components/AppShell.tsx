'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { WalletBar } from './WalletBar';
import { useWallet } from '@/contexts/WalletContext';
import { NETWORK_NAME } from '@/lib/contracts';

const NAV_ITEMS: { label: string; href: string; icon?: React.ReactNode }[] = [
    { label: 'Vaults', href: '/vaults' },
    {
        label: 'New Vault',
        href: '/vault/new',
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
        ),
    },
    { label: 'My Vaults', href: '/my-vaults' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { wallet, opnetAvailable, connectWallet } = useWallet();

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)' }}>
            {/* Header */}
            <header style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="flex items-center gap-2"
                            style={{ cursor: 'pointer', textDecoration: 'none' }}
                        >
                            <img
                                src="/mainlogo.svg"
                                alt="OctoSig"
                                style={{ height: '28px', width: 'auto', transition: 'opacity 100ms ease' }}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            />
                            <div className="flex flex-col">
                                <h1
                                    className="text-sm font-semibold tracking-tight leading-none"
                                    style={{ color: 'var(--text)' }}
                                >
                                    OctoSig
                                </h1>
                                <span
                                    className="text-[9px] font-medium uppercase tracking-wider leading-none mt-0.5"
                                    style={{ color: 'var(--text-tertiary)' }}
                                >
                                    {NETWORK_NAME}
                                </span>
                            </div>
                        </Link>
                        <nav className="flex items-center gap-1">
                            {NAV_ITEMS.map((item) => {
                                const active = pathname === item.href;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="nav-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
                                        style={{
                                            backgroundColor: active ? 'var(--accent)' : 'transparent',
                                            color: active ? '#FFFFFF' : 'var(--text-secondary)',
                                            border: active
                                                ? '1px solid var(--accent)'
                                                : '1px solid transparent',
                                            cursor: 'pointer',
                                            transition: 'background-color 100ms ease, color 100ms ease, border-color 100ms ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!active) {
                                                e.currentTarget.style.backgroundColor = '#F0F0F0';
                                                e.currentTarget.style.borderColor = 'var(--border)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!active) {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.borderColor = 'transparent';
                                            }
                                        }}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>
                    <WalletBar
                        wallet={wallet}
                        opnetAvailable={opnetAvailable}
                        onConnect={connectWallet}
                    />
                </div>
            </header>

            {/* Testnet banner */}
            <div style={{ backgroundColor: 'var(--cyan-light)', borderBottom: '1px solid var(--cyan)' }}>
                <div className="mx-auto max-w-7xl px-6 py-1.5 flex items-center justify-center gap-2 text-xs font-medium" style={{ color: 'var(--cyan-mid)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    This is testnet. All tokens are for testing purposes only and hold no real value.
                </div>
            </div>

            {/* Main content */}
            <main className="flex-1">
                <div className="mx-auto max-w-7xl px-6">{children}</div>
            </main>

            {/* Footer */}
            <footer style={{ borderTop: '1px solid var(--border)' }}>
                <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img
                            src="/mainlogo.svg"
                            alt="OctoSig"
                            style={{ height: '16px', width: 'auto' }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            OctoSig
                        </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        OPNet Testnet
                    </span>
                </div>
            </footer>
        </div>
    );
}
