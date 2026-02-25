'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenCard } from './TokenCard';
import { WalletBar } from './WalletBar';
import { useToast } from '@/contexts/ToastContext';
import { ALPHA_ADDRESS, BETA_ADDRESS, NETWORK_NAME, MINE_REWARD_TOKENS, MINE_COST_SATS, RPC_URL } from '@/lib/contracts';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

function CopyAddress({ address, label }: { address: string; label: string }) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(address);
        } catch {
            // Fallback for older browsers
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
        <span className="inline-flex items-center gap-1">
            <code className="rounded px-1" style={{ backgroundColor: '#f0f0f0' }}>{address}</code>
            <span style={{ color: '#666' }}>({label})</span>
            <button
                type="button"
                onClick={handleCopy}
                title={copied ? 'Copied!' : `Copy ${label} address`}
                className="inline-flex items-center justify-center rounded border-2 border-black transition-all"
                style={{
                    width: '22px',
                    height: '22px',
                    backgroundColor: copied ? 'var(--teal)' : 'var(--card-bg, #fff)',
                    transform: copied ? 'translate(1px, 1px)' : 'translate(0, 0)',
                    boxShadow: copied ? '0 0 0 0 #000' : '2px 2px 0 0 #000',
                    transitionDuration: '100ms',
                    cursor: 'pointer',
                }}
            >
                {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                )}
            </button>
        </span>
    );
}

const WALLET_STORAGE_KEY = 'octosig_wallet';

function saveWallet(state: WalletState) {
    try { localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadWallet(): WalletState | null {
    try {
        const raw = localStorage.getItem(WALLET_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.connected && parsed?.address) return parsed;
    } catch {}
    return null;
}

export function FaucetClient() {
    const [wallet, setWallet] = useState<WalletState>({
        connected: false,
        address: null,
        network: null,
    });
    const [opnetAvailable, setOpnetAvailable] = useState(false);
    const [btcBalance, setBtcBalance] = useState<string | null>(null);
    const { toast } = useToast();

    // Fetch BTC balance via RPC
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

    // Detect OPWallet extension
    useEffect(() => {
        const check = () => {
            if (typeof window !== 'undefined' && 'opnet' in window) {
                setOpnetAvailable(true);
            }
        };
        check();
        window.addEventListener('opnet#initialized', check);
        const t = setTimeout(check, 500);
        return () => {
            window.removeEventListener('opnet#initialized', check);
            clearTimeout(t);
        };
    }, []);

    // Auto-reconnect from saved session
    useEffect(() => {
        const saved = loadWallet();
        if (!saved) return;

        const tryReconnect = async () => {
            const opnet = (window as any).opnet;
            if (!opnet) return;
            try {
                const accounts: string[] = await opnet.requestAccounts();
                const network: string = await opnet.getNetwork();
                const state: WalletState = { connected: true, address: accounts[0] ?? null, network };
                setWallet(state);
                saveWallet(state);
            } catch {
                // Extension rejected silent reconnect — clear saved state
                localStorage.removeItem(WALLET_STORAGE_KEY);
            }
        };

        // Wait for extension to inject, then reconnect
        if ((window as any).opnet) {
            tryReconnect();
        } else {
            const onInit = () => { tryReconnect(); window.removeEventListener('opnet#initialized', onInit); };
            window.addEventListener('opnet#initialized', onInit);
            const t = setTimeout(tryReconnect, 600);
            return () => { window.removeEventListener('opnet#initialized', onInit); clearTimeout(t); };
        }
    }, []);

    const connectWallet = useCallback(async () => {
        const opnet = (window as any).opnet;
        if (!opnet) {
            toast.warning('OPWallet not detected. Install it from the Chrome Web Store.');
            return;
        }
        try {
            const accounts: string[] = await opnet.requestAccounts();
            const network: string = await opnet.getNetwork();
            const state: WalletState = { connected: true, address: accounts[0] ?? null, network };
            setWallet(state);
            saveWallet(state);
        } catch (err: any) {
            console.error('Wallet connection failed:', err);
            toast.error(`Connection failed: ${err?.message ?? 'Unknown error'}`);
        }
    }, []);

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
            {/* ── Header ── */}
            <header
                className="border-b-4 border-black px-6 py-4"
                style={{ backgroundColor: '#000000' }}
            >
                <div className="mx-auto flex max-w-4xl items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span
                            className="rounded-lg border-2 border-black px-3 py-1 text-xs font-bold uppercase tracking-widest"
                            style={{ backgroundColor: 'var(--yellow)', color: '#000' }}
                        >
                            OPNet
                        </span>
                        <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--yellow)' }}>
                            MULTSIG VAULT
                        </h1>
                    </div>
                    <WalletBar
                        wallet={wallet}
                        opnetAvailable={opnetAvailable}
                        onConnect={connectWallet}
                    />
                </div>
            </header>

            {/* ── Hero ── */}
            <section className="px-6 py-14 text-center">
                <div
                    className="mx-auto inline-block rounded-xl border-3 border-black px-6 py-2 nb-shadow mb-6"
                    style={{ backgroundColor: 'var(--teal)', borderWidth: '3px' }}
                >
                    <span className="text-sm font-bold uppercase tracking-widest">{NETWORK_NAME}</span>
                </div>
                <h2
                    className="mb-4 text-5xl font-black uppercase tracking-tight leading-none"
                    style={{ WebkitTextStroke: '2px black' }}
                >
                    FAUCET
                </h2>
                <p className="mx-auto max-w-md text-lg font-medium" style={{ color: '#444' }}>
                    Mine test tokens for free (almost). Pay{' '}
                    <strong>{Number(MINE_COST_SATS) / 100_000_000} BTC</strong> per click,
                    receive <strong>{MINE_REWARD_TOKENS} tokens</strong> instantly.
                </p>
            </section>

            {/* ── Token cards ── */}
            <main className="mx-auto max-w-4xl px-6 pb-20">
                {!wallet.connected && (
                    <div
                        className="mb-10 rounded-xl border-3 border-black nb-shadow px-6 py-4 text-center font-bold text-lg"
                        style={{ backgroundColor: 'var(--yellow)', borderWidth: '3px' }}
                    >
                        Connect your OPWallet above to start mining
                    </div>
                )}

                <div className="mb-8 text-center">
                    <a
                        href="https://faucet.opnet.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border-3 border-black px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-all"
                        style={{
                            backgroundColor: 'var(--yellow)',
                            color: '#000',
                            borderWidth: '3px',
                            boxShadow: '4px 4px 0 0 #000',
                            transform: 'translate(0, 0)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translate(4px, 4px)';
                            e.currentTarget.style.boxShadow = '0 0 0 0 #000';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translate(0, 0)';
                            e.currentTarget.style.boxShadow = '4px 4px 0 0 #000';
                        }}
                    >
                        Need testnet BTC? Get it from the OPNet Faucet
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 17L17 7" />
                            <path d="M7 7h10v10" />
                        </svg>
                    </a>
                </div>

                {wallet.connected && btcBalance !== null && (
                    <div
                        className="mb-8 rounded-xl border-3 border-black nb-shadow px-6 py-4 flex items-center justify-between"
                        style={{ backgroundColor: 'var(--card-bg)', borderWidth: '3px' }}
                    >
                        <span className="text-sm font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                            Your BTC Balance
                        </span>
                        <span className="text-xl font-black">
                            {btcBalance} <span style={{ color: 'var(--orange)' }}>BTC</span>
                        </span>
                    </div>
                )}

                <div className="grid gap-8 sm:grid-cols-2">
                    <TokenCard
                        symbol="ALPHA"
                        name="Alpha Token"
                        contractAddress={ALPHA_ADDRESS}
                        accentColor="var(--yellow)"
                        wallet={wallet}
                    />
                    <TokenCard
                        symbol="BETA"
                        name="Beta Token"
                        contractAddress={BETA_ADDRESS}
                        accentColor="var(--teal)"
                        wallet={wallet}
                    />
                </div>

                {/* Info strip */}
                <div
                    className="mt-12 rounded-xl border-3 border-black nb-shadow p-6"
                    style={{ backgroundColor: 'var(--card-bg)', borderWidth: '3px' }}
                >
                    <h3 className="mb-3 text-lg font-black uppercase tracking-wide">HOW IT WORKS</h3>
                    <ol className="list-inside list-decimal space-y-2 font-medium text-sm" style={{ color: '#333' }}>
                        <li>Connect your <strong>OPWallet</strong> (testnet)</li>
                        <li>Click <strong>MINE</strong> on either token card</li>
                        <li>OPWallet will ask you to sign a transaction that includes <strong>0.00001 tBTC</strong> sent to the contract</li>
                        <li>The contract verifies the payment and mints <strong>100 tokens</strong> to your address</li>
                        <li>Tokens appear in your wallet after the transaction confirms</li>
                    </ol>
                    <div className="mt-4" style={{ color: '#666' }}>
                        <p className="mb-2 text-sm font-black uppercase tracking-wide" style={{ color: '#333' }}>
                            Contract Addresses
                        </p>
                        <div className="flex flex-col gap-2">
                            <CopyAddress address={ALPHA_ADDRESS} label="ALPHA" />
                            <CopyAddress address={BETA_ADDRESS} label="BETA" />
                        </div>
                    </div>
                </div>
            </main>

            {/* ── Footer ── */}
            <footer
                className="border-t-4 border-black px-6 py-4 text-center text-sm font-bold uppercase tracking-widest"
                style={{ backgroundColor: '#000', color: 'var(--yellow)' }}
            >
                MULTSIG VAULT · OPNET TESTNET · HASHZRO
            </footer>
        </div>
    );
}
