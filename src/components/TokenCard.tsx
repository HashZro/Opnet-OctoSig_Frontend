'use client';

import { useState, useEffect, useCallback } from 'react';
import { MINE_REWARD_TOKENS, MINE_ABI, RPC_URL } from '@/lib/contracts';
import { useToast } from '@/contexts/ToastContext';
import { friendlyError } from '@/lib/errorMessages';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type Props = {
    contractAddress: string;
    wallet: WalletState;
};

type MineStatus = 'idle' | 'pending' | 'success' | 'error';

function pendingTxKey(contractAddress: string, walletAddress: string) {
    return `mine_pending_${contractAddress}_${walletAddress}`;
}

function formatBalance(raw: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

async function getNetworkForAddress(address: string) {
    const { networks } = await import('@btc-vision/bitcoin');
    const prefix = address.split('1')[0];
    if (prefix === networks.regtest.bech32) return networks.regtest;
    if (prefix === networks.testnet.bech32) return networks.testnet;
    return networks.testnet;
}

export function TokenCard({ contractAddress, wallet }: Props) {
    const [status, setStatus] = useState<MineStatus>('idle');
    const [txId, setTxId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [symbol, setSymbol] = useState<string>('...');
    const [name, setName] = useState<string>('Loading...');
    const { toast } = useToast();

    // Fetch token name and symbol from blockchain
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { JSONRpcProvider, getContract, OP_20_ABI } = await import('opnet');
                const { networks } = await import('@btc-vision/bitcoin');

                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const contract = getContract(contractAddress, OP_20_ABI as any, provider, networks.testnet);

                const [nameRes, symbolRes] = await Promise.all([
                    (contract as any).name().catch(() => null),
                    (contract as any).symbol().catch(() => null),
                ]);

                if (!cancelled) {
                    setName(nameRes?.properties?.name ?? 'Unknown');
                    setSymbol(symbolRes?.properties?.symbol ?? '???');
                }
            } catch (err) {
                console.error('[TokenCard] Failed to fetch token metadata:', err);
                if (!cancelled) {
                    setName('Unknown');
                    setSymbol('???');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [contractAddress]);

    useEffect(() => {
        if (!wallet.address) return;
        const stored = localStorage.getItem(pendingTxKey(contractAddress, wallet.address));
        if (stored) {
            setTxId(stored);
            setStatus('success');
        }
    }, [contractAddress, wallet.address]);

    const fetchBalance = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            setBalance(null);
            return;
        }
        setBalanceLoading(true);
        try {
            const { JSONRpcProvider, getContract, OP_20_ABI } = await import('opnet');
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript, networks } = await import('@btc-vision/bitcoin');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            const contract = getContract(contractAddress, OP_20_ABI as any, provider, networks.testnet);

            const addrNetwork = await getNetworkForAddress(wallet.address!);
            let script: Uint8Array;
            try {
                script = toOutputScript(wallet.address!, addrNetwork);
            } catch (addrErr: any) {
                throw new Error(`Address decode failed: ${addrErr.message}`);
            }

            const ownerAddress = Address.wrap(script.subarray(2));
            const [balResult, decResult] = await Promise.all([
                (contract as any).balanceOf(ownerAddress).catch(() => null),
                (contract as any).decimals().catch(() => null),
            ]);

            if (balResult === null) {
                setBalance('—');
                return;
            }

            const raw = balResult?.properties?.balance ?? balResult?.result ?? balResult?.decoded?.[0] ?? null;
            if (raw !== null) {
                const decimals = Number(decResult?.properties?.decimals ?? decResult?.result ?? decResult?.decoded?.[0] ?? 18);
                setBalance(formatBalance(BigInt(raw.toString()), decimals));
            } else {
                setBalance('0');
            }
        } catch (err: any) {
            console.error(`[${symbol}] fetchBalance FAILED:`, err);
        } finally {
            setBalanceLoading(false);
        }
    }, [wallet.connected, wallet.address, contractAddress, symbol]);

    useEffect(() => {
        fetchBalance();
    }, [fetchBalance]);

    async function handleMine() {
        if (!wallet.connected || !wallet.address) return;

        const opnet = (window as any).opnet;
        if (!opnet) {
            const msg = 'OPWallet extension not found';
            setErrorMsg(msg);
            setStatus('error');
            toast.error(msg);
            return;
        }

        const storedTxId = localStorage.getItem(pendingTxKey(contractAddress, wallet.address));
        if (storedTxId) {
            try {
                const { JSONRpcProvider } = await import('opnet');
                const { networks } = await import('@btc-vision/bitcoin');
                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const receipt = await provider.getTransactionReceipt(storedTxId);
                if (!receipt) {
                    toast.warning(`${symbol} mine already pending`);
                    return;
                }
                localStorage.removeItem(pendingTxKey(contractAddress, wallet.address));
            } catch {
                toast.warning(`${symbol} mine already pending`);
                return;
            }
        }

        setStatus('pending');
        setTxId(null);
        setErrorMsg(null);

        try {
            const { JSONRpcProvider, getContract } = await import('opnet');
            const { networks } = await import('@btc-vision/bitcoin');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            const contract = getContract(contractAddress, MINE_ABI as any, provider, networks.testnet);

            const simulation = await (contract as any).mine();
            if (simulation.revert) throw new Error(`Simulation reverted: ${simulation.revert}`);

            const receipt = await simulation.sendTransaction({
                signer: null,
                mldsaSigner: null,
                refundTo: wallet.address,
                maximumAllowedSatToSpend: BigInt(500_000),
                feeRate: 10,
                network: networks.testnet,
                minGas: BigInt(500_000),
            });

            const submittedTxId = receipt?.transactionId ?? receipt?.[1] ?? 'submitted';
            if (submittedTxId !== 'submitted') {
                localStorage.setItem(pendingTxKey(contractAddress, wallet.address), submittedTxId);
            }

            setTxId(submittedTxId);
            setStatus('success');
            toast.success(`Mined ${MINE_REWARD_TOKENS} ${symbol}!`);
            setTimeout(() => fetchBalance(), 2000);
        } catch (err: any) {
            const { message, isFunding } = friendlyError(err);
            setErrorMsg(message);
            setStatus('error');
            toast.error(isFunding ? message : `${symbol} mine failed: ${message}`);
        }
    }

    const canMine = wallet.connected && status !== 'pending';

    return (
        <div
            className="hover-lift flex flex-col gap-4 p-6"
            style={{
                backgroundColor: 'var(--card-bg)',
                border: '1px solid var(--border)',
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className="flex h-10 w-10 items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: '#F5F5F5', border: '1px solid var(--border)' }}
                    >
                        {symbol.charAt(0)}
                    </div>
                    <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{symbol}</p>
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{name}</p>
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

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Cost</p>
                    <p className="mt-1 text-sm font-semibold">Free</p>
                </div>
                <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Reward</p>
                    <p className="mt-1 text-sm font-semibold">{MINE_REWARD_TOKENS} {symbol}</p>
                </div>
            </div>

            {/* Balance */}
            {wallet.connected && (
                <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                    <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Your Balance</p>
                    <p className="mt-1 text-sm font-semibold">
                        {balanceLoading ? '—' : balance !== null ? `${balance} ${symbol}` : `— ${symbol}`}
                    </p>
                </div>
            )}

            {/* Contract address */}
            <button
                type="button"
                onClick={() => {
                    navigator.clipboard.writeText(contractAddress);
                    setCopied(true);
                    toast.info('Address copied');
                    setTimeout(() => setCopied(false), 1500);
                }}
                className="w-full text-left p-3 transition-colors cursor-pointer"
                style={{
                    backgroundColor: copied ? '#F0FDF4' : '#FAFAFA',
                    border: `1px solid ${copied ? 'var(--green)' : 'var(--border)'}`,
                }}
            >
                <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Contract</p>
                    {copied && (
                        <span className="text-[10px] font-medium" style={{ color: 'var(--green)' }}>Copied</span>
                    )}
                </div>
                <code className="block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {contractAddress}
                </code>
            </button>

            {/* Status feedback */}
            {status === 'success' && txId && (
                <div className="p-3" style={{ backgroundColor: '#F0FDF4', border: '2px solid #16A34A', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <p className="text-xs font-bold" style={{ color: '#16A34A' }}>
                            Mined +{MINE_REWARD_TOKENS} {symbol}
                        </p>
                    </div>
                    <code className="block truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{txId}</code>
                    <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5" style={{ backgroundColor: '#FEF9C3', border: '1px solid #FACC15', borderRadius: '4px' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#854D0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <p className="text-[10px] font-medium" style={{ color: '#854D0E', lineHeight: 1.5 }}>
                            Balance updates after the tx is mined (~1-3 min).
                        </p>
                    </div>
                </div>
            )}
            {status === 'error' && errorMsg && (
                <div className="p-3" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <p className="text-xs font-medium" style={{ color: 'var(--red)' }}>{errorMsg}</p>
                </div>
            )}

            {/* Mine button */}
            <button
                onClick={handleMine}
                disabled={!canMine}
                className="w-full py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                style={{
                    backgroundColor: canMine ? 'var(--accent)' : '#E5E5E5',
                    color: canMine ? '#FFFFFF' : 'var(--text-tertiary)',
                    border: 'none',
                    cursor: canMine ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => { if (canMine) e.currentTarget.style.backgroundColor = '#333'; }}
                onMouseLeave={(e) => { if (canMine) e.currentTarget.style.backgroundColor = 'var(--accent)'; }}
            >
                {status === 'pending' ? 'Mining...' : `Mine ${symbol}`}
            </button>

            {!wallet.connected && (
                <p className="text-center text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    Connect wallet to mine
                </p>
            )}
        </div>
    );
}
