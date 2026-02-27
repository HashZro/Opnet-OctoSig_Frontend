'use client';

import { useState } from 'react';
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
    const [mobileNav, setMobileNav] = useState(false);

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)' }}>
            {/* Header */}
            <header style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
                    <div className="flex items-center gap-3 sm:gap-4">
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
                        {/* Desktop nav */}
                        <nav className="hidden sm:flex items-center gap-1">
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
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:block">
                            <WalletBar
                                wallet={wallet}
                                opnetAvailable={opnetAvailable}
                                onConnect={connectWallet}
                            />
                        </div>
                        {/* Mobile hamburger */}
                        <button
                            className="sm:hidden flex items-center justify-center"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                            onClick={() => setMobileNav((v) => !v)}
                            aria-label="Menu"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round">
                                {mobileNav ? (
                                    <>
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </>
                                ) : (
                                    <>
                                        <line x1="3" y1="6" x2="21" y2="6" />
                                        <line x1="3" y1="12" x2="21" y2="12" />
                                        <line x1="3" y1="18" x2="21" y2="18" />
                                    </>
                                )}
                            </svg>
                        </button>
                    </div>
                </div>
                {/* Mobile nav dropdown */}
                {mobileNav && (
                    <div className="sm:hidden flex flex-col gap-1 px-4 pb-3" style={{ borderTop: '1px solid var(--border)' }}>
                        {NAV_ITEMS.map((item) => {
                            const active = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMobileNav(false)}
                                    className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium"
                                    style={{
                                        backgroundColor: active ? 'var(--accent)' : 'transparent',
                                        color: active ? '#FFFFFF' : 'var(--text-secondary)',
                                    }}
                                >
                                    {item.icon}
                                    {item.label}
                                </Link>
                            );
                        })}
                        <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                            <WalletBar
                                wallet={wallet}
                                opnetAvailable={opnetAvailable}
                                onConnect={connectWallet}
                            />
                        </div>
                    </div>
                )}
            </header>

            {/* Testnet banner */}
            <div style={{ backgroundColor: 'var(--cyan-light)', borderBottom: '1px solid var(--cyan)' }}>
                <div className="mx-auto max-w-7xl px-4 sm:px-6 py-1.5 flex items-center justify-center gap-2 text-[11px] sm:text-xs font-medium text-center" style={{ color: 'var(--cyan-mid)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="hidden sm:inline">This is testnet. All tokens are for testing purposes only and hold no real value.</span>
                    <span className="sm:hidden">Testnet only — tokens have no real value.</span>
                </div>
            </div>

            {/* Main content */}
            <main className="flex-1">
                <div className="mx-auto max-w-7xl px-4 sm:px-6">{children}</div>
            </main>

            {/* Footer */}
            <footer style={{ borderTop: '1px solid var(--border)' }}>
                <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
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
