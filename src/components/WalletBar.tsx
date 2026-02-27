'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { RPC_URL } from '@/lib/contracts';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type Props = {
    wallet: WalletState;
    opnetAvailable: boolean;
    onConnect: () => void;
};

function truncateAddress(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const GITHUB_REPOS = [
    { label: 'Frontend', url: 'https://github.com/HashZro/Opnet-OctoSig_Frontend' },
    { label: 'Contracts', url: 'https://github.com/HashZro/Opnet-Octosig_Contracts' },
];

function GitHubButton() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen((v) => !v)}
                title="View on GitHub"
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--cyan)',
                    transition: 'opacity 100ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.6'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
            </button>

            {open && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        backgroundColor: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 50,
                        minWidth: 180,
                    }}
                >
                    {GITHUB_REPOS.map((repo) => (
                        <a
                            key={repo.label}
                            href={repo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium"
                            style={{
                                color: 'var(--text)',
                                textDecoration: 'none',
                                cursor: 'pointer',
                                transition: 'background-color 100ms ease',
                                borderBottom: repo.label === 'Frontend' ? '1px solid var(--border)' : 'none',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--cyan-light)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--cyan)', flexShrink: 0 }}>
                                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                            </svg>
                            {repo.label}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
}

function ChallengeButton() {
    return (
        <a
            href="https://vibecode.finance/apps/o-mm3v4ija"
            target="_blank"
            rel="noopener noreferrer"
            title="Vibe Code Challenge"
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                color: 'var(--cyan)',
                transition: 'opacity 100ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.6'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="1" y="14" width="7" height="10" rx="1" />
                <rect x="8.5" y="6" width="7" height="18" rx="1" />
                <rect x="16" y="10" width="7" height="14" rx="1" />
            </svg>
        </a>
    );
}

function CopyableAddress({ address }: { address: string }) {
    const [flash, setFlash] = useState(false);

    const handleClick = () => {
        navigator.clipboard.writeText(address).then(() => {
            setFlash(true);
            setTimeout(() => setFlash(false), 400);
        });
    };

    const display = truncateAddress(address);

    return (
        <button
            onClick={handleClick}
            className="px-3 py-1.5 text-xs font-mono font-medium"
            style={{
                backgroundColor: flash ? '#DCFCE7' : '#F5F5F5',
                color: 'var(--text)',
                border: flash ? '1px solid var(--green)' : '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'background-color 80ms ease, border-color 80ms ease',
                position: 'relative',
                overflow: 'hidden',
            }}
            title={address}
        >
            {display}
            {flash && (
                <span
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#DCFCE7',
                        color: 'var(--green)',
                        fontSize: 10,
                        fontFamily: 'inherit',
                    }}
                >
                    copied
                </span>
            )}
        </button>
    );
}

function OpscanButton() {
    return (
        <a
            href="https://opscan.org/accounts/0x3e91ca44a8a6bf585644485ffab376bc1a292d84ce4cbf357a4cf95e0717f586?network=op_testnet"
            target="_blank"
            rel="noopener noreferrer"
            title="View contract on OPScan"
            style={{
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                color: 'var(--text-secondary)',
                transition: 'opacity 100ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.6'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
            <img src="/opsan.png" alt="OPScan" style={{ height: 18, width: 'auto', objectFit: 'contain' }} />
        </a>
    );
}

function BtcBalance({ address }: { address: string }) {
    const [balance, setBalance] = useState<string | null>(null);

    const fetchBalance = useCallback(async () => {
        try {
            const { JSONRpcProvider } = await import('opnet');
            const { networks } = await import('@btc-vision/bitcoin');
            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            const satoshis = await provider.getBalance(address);
            const btc = Number(satoshis) / 1e8;
            const str = btc.toString();
            const dot = str.indexOf('.');
            setBalance(dot === -1 ? str : str.slice(0, dot + 9));
        } catch {
            setBalance(null);
        }
    }, [address]);

    useEffect(() => { fetchBalance(); }, [fetchBalance]);

    if (balance === null) return null;

    // Split into leading zeros and significant part for styling
    const renderBalance = () => {
        const dot = balance.indexOf('.');
        if (dot === -1) return <>{balance}</>;
        const whole = balance.slice(0, dot);
        const decimals = balance.slice(dot + 1);
        // Find first non-zero digit in decimals
        const firstSig = decimals.search(/[1-9]/);
        if (firstSig <= 0) return <>{balance}</>;
        const leadingZeros = decimals.slice(0, firstSig);
        const significant = decimals.slice(firstSig);
        return (
            <>
                {whole}.<span style={{ fontSize: '0.65em', opacity: 0.6 }}>{leadingZeros}</span>{significant}
            </>
        );
    };

    return (
        <span
            className="px-2.5 py-1.5 text-xs font-semibold font-mono"
            style={{
                backgroundColor: '#FFF7ED',
                color: '#92400E',
                border: '1px solid #FDE68A',
            }}
            title={`${balance} BTC`}
        >
            {renderBalance()} <span style={{ fontWeight: 500, color: 'var(--amber)' }}>BTC</span>
        </span>
    );
}

export function WalletBar({ wallet, opnetAvailable, onConnect }: Props) {
    if (wallet.connected && wallet.address) {
        return (
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <div className="flex items-center gap-1 sm:gap-2">
                    <OpscanButton />
                    <ChallengeButton />
                    <GitHubButton />
                </div>
                <BtcBalance address={wallet.address} />
                <CopyableAddress address={wallet.address} />
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-1 sm:gap-2">
                <OpscanButton />
                <ChallengeButton />
                <GitHubButton />
            </div>
            <button
                onClick={onConnect}
                disabled={!opnetAvailable}
                className="px-3 sm:px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                style={{
                    backgroundColor: opnetAvailable ? 'var(--accent)' : '#E5E5E5',
                    color: opnetAvailable ? '#FFFFFF' : 'var(--text-tertiary)',
                    border: '1px solid transparent',
                    cursor: opnetAvailable ? 'pointer' : 'not-allowed',
                }}
                title={!opnetAvailable ? 'OPWallet extension not detected' : undefined}
            >
                {opnetAvailable ? 'Connect Wallet' : 'Wallet Not Found'}
            </button>
        </div>
    );
}
