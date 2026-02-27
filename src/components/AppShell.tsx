'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { WalletBar } from './WalletBar';
import { useWallet } from '@/contexts/WalletContext';
import { NETWORK_NAME } from '@/lib/contracts';

const NAV_ITEMS = [
    { label: 'Faucet', href: '/faucet' },
    { label: 'Vaults', href: '/vaults' },
    { label: 'New Vault', href: '/vault/new' },
    { label: 'Manage Vault', href: '/vault/manage' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { wallet, opnetAvailable, connectWallet } = useWallet();

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)' }}>
            {/* Header */}
            <header style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <img
                                src="/mainlogo.svg"
                                alt="OctoSig"
                                style={{ height: '28px', width: 'auto' }}
                            />
                            <h1
                                className="text-sm font-semibold tracking-tight"
                                style={{ color: 'var(--text)' }}
                            >
                                OctoSig
                            </h1>
                        </div>
                        <span
                            className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                            style={{
                                backgroundColor: '#F5F5F5',
                                color: 'var(--text-tertiary)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            {NETWORK_NAME}
                        </span>
                        <nav className="flex items-center gap-1">
                            {NAV_ITEMS.map((item) => {
                                const active = pathname === item.href;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="px-3 py-1.5 text-xs font-medium transition-colors"
                                        style={{
                                            backgroundColor: active ? 'var(--accent)' : 'transparent',
                                            color: active ? '#FFFFFF' : 'var(--text-secondary)',
                                            border: active
                                                ? '1px solid var(--accent)'
                                                : '1px solid transparent',
                                        }}
                                    >
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

            {/* Main content */}
            <main className="flex-1">
                <div className="mx-auto max-w-5xl px-6">{children}</div>
            </main>

            {/* Footer */}
            <footer style={{ borderTop: '1px solid var(--border)' }}>
                <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
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
