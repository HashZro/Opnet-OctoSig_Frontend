'use client';

import { useState, useEffect, useCallback } from 'react';
import { TokenCard } from './TokenCard';
import { WalletBar } from './WalletBar';
import { ALPHA_ADDRESS, BETA_ADDRESS, NETWORK_NAME, MINE_REWARD_TOKENS, MINE_COST_SATS } from '@/lib/contracts';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

export function FaucetClient() {
    const [wallet, setWallet] = useState<WalletState>({
        connected: false,
        address: null,
        network: null,
    });
    const [opnetAvailable, setOpnetAvailable] = useState(false);

    useEffect(() => {
        // Check for OPWallet injection
        const check = () => {
            if (typeof window !== 'undefined' && 'opnet' in window) {
                setOpnetAvailable(true);
            }
        };
        check();
        window.addEventListener('opnet#initialized', check);
        // Give the extension a moment to inject
        const t = setTimeout(check, 500);
        return () => {
            window.removeEventListener('opnet#initialized', check);
            clearTimeout(t);
        };
    }, []);

    const connectWallet = useCallback(async () => {
        const opnet = (window as any).opnet;
        if (!opnet) {
            alert('OPWallet not detected. Install it from the Chrome Web Store.');
            return;
        }
        try {
            const accounts: string[] = await opnet.requestAccounts();
            const network: string = await opnet.getNetwork();
            setWallet({ connected: true, address: accounts[0] ?? null, network });
        } catch (err: any) {
            console.error('Wallet connection failed:', err);
            alert(`Connection failed: ${err?.message ?? 'Unknown error'}`);
        }
    }, []);

    const disconnectWallet = useCallback(() => {
        setWallet({ connected: false, address: null, network: null });
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
                        onDisconnect={disconnectWallet}
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
                    <p className="mt-4 text-xs font-medium" style={{ color: '#666' }}>
                        Contract addresses:{' '}
                        <code className="rounded px-1" style={{ backgroundColor: '#f0f0f0' }}>{ALPHA_ADDRESS}</code>{' '}
                        (ALPHA) ·{' '}
                        <code className="rounded px-1" style={{ backgroundColor: '#f0f0f0' }}>{BETA_ADDRESS}</code>{' '}
                        (BETA)
                    </p>
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
