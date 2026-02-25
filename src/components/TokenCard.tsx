'use client';

import { useState, useEffect, useCallback } from 'react';
import { MINE_COST_SATS, MINE_REWARD_TOKENS, MINE_ABI, RPC_URL } from '@/lib/contracts';
import { useToast } from '@/contexts/ToastContext';
import { networks } from '@btc-vision/bitcoin';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type Props = {
    symbol: string;
    name: string;
    contractAddress: string;
    accentColor: string;
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
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export function TokenCard({ symbol, name, contractAddress, accentColor, wallet }: Props) {
    const [status, setStatus] = useState<MineStatus>('idle');
    const [txId, setTxId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const { toast } = useToast();

    // Restore any previously submitted pending tx from localStorage
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
            const { toOutputScript } = await import('@btc-vision/bitcoin');
            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            const contract = getContract(
                contractAddress,
                OP_20_ABI as any,
                provider,
                networks.testnet,
            );

            // balanceOf expects an Address object — decode bech32 to raw bytes
            const OPNET_NET = { ...networks.testnet, bech32: networks.testnet.bech32Opnet! };
            const script = toOutputScript(wallet.address!, OPNET_NET);
            const ownerAddress = Address.wrap(script.subarray(2));

            // Fetch balance and decimals in parallel
            const [balResult, decResult] = await Promise.all([
                (contract as any).balanceOf(ownerAddress),
                (contract as any).decimals().catch(() => null),
            ]);

            const raw = balResult?.properties?.balance
                ?? balResult?.result
                ?? balResult?.decoded?.[0]
                ?? null;

            if (raw !== null) {
                const decimals = Number(
                    decResult?.properties?.decimals
                    ?? decResult?.result
                    ?? decResult?.decoded?.[0]
                    ?? 8
                );
                setBalance(formatBalance(BigInt(raw.toString()), decimals));
            }
        } catch (err) {
            console.error(`Failed to fetch ${symbol} balance:`, err);
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
            setErrorMsg('OPWallet not found');
            setStatus('error');
            toast.error('OPWallet not found');
            return;
        }

        // Check if a previously submitted tx is still pending in the mempool
        const storedTxId = localStorage.getItem(pendingTxKey(contractAddress, wallet.address));
        if (storedTxId) {
            try {
                const { JSONRpcProvider } = await import('opnet');
                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const receipt = await provider.getTransactionReceipt(storedTxId);
                if (!receipt) {
                    // Still unconfirmed
                    console.log(`[${symbol}] mine() already pending in mempool — tx: ${storedTxId}`);
                    toast.warning(`${symbol} mine already pending in mempool. Tx: ${storedTxId.slice(0, 16)}…`);
                    return;
                }
                // Confirmed — clear it and proceed
                localStorage.removeItem(pendingTxKey(contractAddress, wallet.address));
            } catch {
                // Receipt lookup threw → treat as still pending
                console.log(`[${symbol}] mine() already pending in mempool — tx: ${storedTxId}`);
                toast.warning(`${symbol} mine already pending in mempool. Tx: ${storedTxId.slice(0, 16)}…`);
                return;
            }
        }

        setStatus('pending');
        setTxId(null);
        setErrorMsg(null);

        try {
            // Dynamically import opnet to avoid SSR issues
            const { JSONRpcProvider, getContract } = await import('opnet');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);

            // Build contract instance for simulation (sender is optional; mine() has no calldata)
            const contract = getContract(
                contractAddress,
                MINE_ABI as any,
                provider,
                networks.testnet,
            );

            // Simulate the mine() call
            const simulation = await (contract as any).mine();

            if (simulation.revert) {
                throw new Error(`Simulation reverted: ${simulation.revert}`);
            }

            // Send the transaction via OPWallet with BTC payment attached
            const receipt = await simulation.sendTransaction({
                signer: opnet,
                refundTo: wallet.address,
                maximumAllowedSatToSpend: BigInt(500_000),
                feeRate: 10,
                network: networks.testnet,
                extraOutputs: [
                    {
                        address: contractAddress,
                        value: Number(MINE_COST_SATS),
                    },
                ],
            });

            const submittedTxId = receipt?.transactionId ?? receipt?.[1] ?? 'submitted';

            // Persist pending tx so we can detect double-submits across page loads
            if (submittedTxId !== 'submitted') {
                localStorage.setItem(pendingTxKey(contractAddress, wallet.address), submittedTxId);
            }

            setTxId(submittedTxId);
            setStatus('success');
            toast.success(`Mined ${MINE_REWARD_TOKENS} ${symbol}!`);
            // Refresh balance after successful mine
            setTimeout(() => fetchBalance(), 2000);
        } catch (err: any) {
            console.error(`mine ${symbol} failed:`, err);
            setErrorMsg(err?.message ?? 'Transaction failed');
            setStatus('error');
            toast.error(`${symbol} mine failed: ${err?.message ?? 'Transaction failed'}`);
        }
    }

    const canMine = wallet.connected && status !== 'pending';

    return (
        <div
            className="nb-shadow-lg rounded-2xl border-3 border-black p-6 flex flex-col gap-5"
            style={{
                backgroundColor: 'var(--card-bg)',
                borderWidth: '3px',
            }}
        >
            {/* Token header */}
            <div className="flex items-start justify-between">
                <div>
                    <div
                        className="nb-shadow-sm mb-3 inline-flex items-center rounded-xl border-2 border-black px-4 py-2"
                        style={{ backgroundColor: accentColor }}
                    >
                        <span className="text-2xl font-black tracking-tight">{symbol}</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: '#555' }}>
                        {name}
                    </p>
                </div>
                <div
                    className="rounded-lg border-2 border-black px-2 py-1 text-xs font-bold uppercase"
                    style={{ backgroundColor: '#000', color: accentColor }}
                >
                    OP-20
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                <Stat label="Cost" value="0.00001 BTC" accent={accentColor} />
                <Stat label="Reward" value={`${MINE_REWARD_TOKENS} ${symbol}`} accent={accentColor} />
            </div>

            {/* Balance */}
            {wallet.connected && (
                <div
                    className="rounded-lg border-2 border-black p-3"
                    style={{ backgroundColor: accentColor + '22' }}
                >
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                        Your Balance
                    </p>
                    <p className="mt-0.5 text-lg font-black">
                        {balanceLoading
                            ? '...'
                            : balance !== null
                                ? `${balance} ${symbol}`
                                : `— ${symbol}`
                        }
                    </p>
                </div>
            )}

            {/* Address — click to copy */}
            <div
                onClick={() => {
                    navigator.clipboard.writeText(contractAddress);
                    setCopied(true);
                    toast.success('Address copied!');
                    setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg border-2 border-black p-2 cursor-pointer transition-all duration-150 active:scale-95 hover:border-[3px]"
                style={{ backgroundColor: copied ? accentColor + '33' : '#f8f8f0' }}
            >
                <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#888' }}>
                        Contract
                    </p>
                    <span
                        className="text-xs font-bold uppercase transition-opacity duration-300"
                        style={{ color: accentColor, opacity: copied ? 1 : 0 }}
                    >
                        Copied!
                    </span>
                </div>
                <code className="block truncate text-xs font-bold" style={{ color: '#333' }}>
                    {contractAddress}
                </code>
            </div>

            {/* Status feedback */}
            {status === 'success' && txId && (
                <div
                    className="nb-shadow-sm rounded-lg border-2 border-black px-4 py-3"
                    style={{ backgroundColor: 'var(--green)' }}
                >
                    <p className="text-sm font-black">MINED! +{MINE_REWARD_TOKENS} {symbol}</p>
                    <code className="mt-1 block truncate text-xs">{txId}</code>
                </div>
            )}
            {status === 'error' && errorMsg && (
                <div
                    className="nb-shadow-sm rounded-lg border-2 border-black px-4 py-3"
                    style={{ backgroundColor: 'var(--red)', color: '#fff' }}
                >
                    <p className="text-xs font-bold">{errorMsg}</p>
                </div>
            )}

            {/* Mine button */}
            <button
                onClick={handleMine}
                disabled={!canMine}
                className="nb-press nb-shadow rounded-xl border-3 border-black py-4 text-lg font-black uppercase tracking-widest"
                style={{
                    backgroundColor: canMine ? accentColor : '#ccc',
                    color: '#000',
                    borderWidth: '3px',
                }}
            >
                {status === 'pending' ? 'MINING...' : `MINE ${symbol}`}
            </button>

            {!wallet.connected && (
                <p className="text-center text-xs font-bold uppercase" style={{ color: '#888' }}>
                    Connect wallet to mine
                </p>
            )}
        </div>
    );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
    return (
        <div
            className="rounded-lg border-2 border-black p-3"
            style={{ backgroundColor: accent + '22' }}
        >
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                {label}
            </p>
            <p className="mt-0.5 text-sm font-black">{value}</p>
        </div>
    );
}
