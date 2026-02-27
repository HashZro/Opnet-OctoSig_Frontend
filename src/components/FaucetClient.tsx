'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenCard } from './TokenCard';
import { useToast } from '@/contexts/ToastContext';
import { useWallet } from '@/contexts/WalletContext';
import { OCT_ADDRESS, MINE_REWARD_TOKENS, RPC_URL } from '@/lib/contracts';

function CopyAddress({ address, label }: { address: string; label: string }) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(address);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = address;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    }, [address]);

    useEffect(() => {
        return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
    }, []);

    return (
        <span className="inline-flex items-center gap-2">
            <code
                className="px-2 py-0.5 text-xs font-mono"
                style={{ backgroundColor: '#F5F5F5', border: '1px solid var(--border)' }}
            >
                {address}
            </code>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>({label})</span>
            <button
                type="button"
                onClick={handleCopy}
                title={copied ? 'Copied!' : `Copy ${label} address`}
                className="inline-flex items-center justify-center transition-colors"
                style={{
                    width: '24px',
                    height: '24px',
                    backgroundColor: copied ? '#F0FDF4' : '#F5F5F5',
                    border: `1px solid ${copied ? 'var(--green)' : 'var(--border)'}`,
                    cursor: 'pointer',
                }}
            >
                {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="1" ry="1" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                )}
            </button>
        </span>
    );
}

export function FaucetClient() {
    const { wallet } = useWallet();
    const { toast } = useToast();
    const [btcBalance, setBtcBalance] = useState<string | null>(null);
    const [octBalance, setOctBalance] = useState<string | null>(null);

    // Suppress unused-var lint for toast (used by child callbacks indirectly)
    void toast;

    useEffect(() => {
        if (!wallet.connected || !wallet.address) {
            setBtcBalance(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { JSONRpcProvider } = await import('opnet');
                const { networks } = await import('@btc-vision/bitcoin');
                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const satoshis = await provider.getBalance(wallet.address!);
                if (!cancelled) {
                    const btc = Number(satoshis) / 1e8;
                    setBtcBalance(btc.toFixed(8));
                }
            } catch (err) {
                console.error('Failed to fetch BTC balance:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [wallet.connected, wallet.address]);

    useEffect(() => {
        if (!wallet.connected || !wallet.address) {
            setOctBalance(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { JSONRpcProvider, getContract, OP_20_ABI } = await import('opnet');
                const { Address } = await import('@btc-vision/transaction');
                const { toOutputScript, networks } = await import('@btc-vision/bitcoin');

                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const contract = getContract(OCT_ADDRESS, OP_20_ABI as any, provider, networks.testnet);

                const prefix = wallet.address!.split('1')[0];
                const addrNetwork = prefix === networks.regtest.bech32 ? networks.regtest : networks.testnet;
                const script = toOutputScript(wallet.address!, addrNetwork);
                const ownerAddress = Address.wrap(script.subarray(2));

                const [balRes, decRes] = await Promise.all([
                    (contract as any).balanceOf(ownerAddress).catch(() => null),
                    (contract as any).decimals().catch(() => null),
                ]);

                if (!cancelled) {
                    const raw = balRes?.properties?.balance ?? null;
                    const decimals = Number(decRes?.properties?.decimals ?? 18);
                    if (raw !== null) {
                        const divisor = BigInt(10 ** decimals);
                        const whole = BigInt(raw.toString()) / divisor;
                        const frac = BigInt(raw.toString()) % divisor;
                        const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
                        setOctBalance(fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString());
                    } else {
                        setOctBalance('0');
                    }
                }
            } catch (err) {
                console.error('Failed to fetch OCT balance:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [wallet.connected, wallet.address]);

    return (
        <>
            {/* Hero */}
            <section className="py-16">
                <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                    Faucet
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Claim free test tokens. Each mine rewards{' '}
                    <strong>{MINE_REWARD_TOKENS} OCT</strong> to your wallet.
                </p>
            </section>

            {/* Connect prompt */}
            {!wallet.connected && (
                <div
                    className="mb-8 px-4 py-3 text-sm"
                    style={{
                        backgroundColor: '#FFFBEB',
                        border: '1px solid #FDE68A',
                        color: 'var(--amber)',
                    }}
                >
                    Connect your OPWallet to start mining tokens.
                </div>
            )}

            {/* External faucet link */}
            <div className="mb-8">
                <a
                    href="https://faucet.opnet.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                    Need testnet BTC? Get it from the OPNet Faucet
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17L17 7" />
                        <path d="M7 7h10v10" />
                    </svg>
                </a>
            </div>

            {/* Balances */}
            {wallet.connected && (
                <div className="grid gap-px mb-8" style={{ border: '1px solid var(--border)' }}>
                    {btcBalance !== null && (
                        <div
                            className="flex items-center justify-between px-4 py-3"
                            style={{ backgroundColor: 'var(--card-bg)' }}
                        >
                            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                BTC Balance
                            </span>
                            <span className="text-sm font-semibold font-mono">{btcBalance}</span>
                        </div>
                    )}
                    <div
                        className="flex items-center justify-between px-4 py-3"
                        style={{
                            backgroundColor: 'var(--card-bg)',
                            borderTop: btcBalance !== null ? '1px solid var(--border)' : 'none',
                        }}
                    >
                        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            OCT Balance
                        </span>
                        <span className="text-sm font-semibold font-mono">{octBalance ?? '—'}</span>
                    </div>
                </div>
            )}

            {/* Token cards grid */}
            <div className="grid gap-6 sm:grid-cols-2 pb-20">
                <TokenCard
                    contractAddress={OCT_ADDRESS}
                    wallet={wallet}
                />

                {/* Coming soon placeholder */}
                <div
                    className="flex flex-col gap-4 p-6 select-none"
                    style={{
                        backgroundColor: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        opacity: 0.4,
                        pointerEvents: 'none',
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div
                                className="flex h-10 w-10 items-center justify-center text-sm font-bold"
                                style={{ backgroundColor: '#F5F5F5', border: '1px solid var(--border)' }}
                            >
                                ?
                            </div>
                            <div>
                                <p className="text-sm font-semibold">???</p>
                                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Coming Soon</p>
                            </div>
                        </div>
                        <span
                            className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                                backgroundColor: '#F5F5F5',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            OP-20
                        </span>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)' }} />
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Cost</p>
                            <p className="mt-1 text-sm font-semibold">—</p>
                        </div>
                        <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Reward</p>
                            <p className="mt-1 text-sm font-semibold">—</p>
                        </div>
                    </div>
                    <button
                        disabled
                        className="w-full py-3 text-xs font-semibold uppercase tracking-wider"
                        style={{
                            backgroundColor: '#E5E5E5',
                            color: 'var(--text-tertiary)',
                            border: 'none',
                            cursor: 'not-allowed',
                        }}
                    >
                        Coming Soon
                    </button>
                </div>
            </div>

            {/* How it works */}
            <div
                className="mb-16 p-6"
                style={{
                    backgroundColor: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                }}
            >
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    How it works
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li>Connect your <strong>OPWallet</strong> (testnet)</li>
                    <li>Click <strong>Mine OCT</strong> on the token card</li>
                    <li>OPWallet will ask you to sign a transaction (gas fees only)</li>
                    <li>The contract mints <strong>{MINE_REWARD_TOKENS} OCT</strong> to your address</li>
                    <li>Tokens appear in your wallet after confirmation</li>
                </ol>
                <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                        Contract Address
                    </p>
                    <CopyAddress address={OCT_ADDRESS} label="OCT" />
                </div>
            </div>
        </>
    );
}
