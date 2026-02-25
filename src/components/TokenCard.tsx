'use client';

import { useState } from 'react';
import { MINE_COST_SATS, MINE_REWARD_TOKENS, MINE_ABI, RPC_URL } from '@/lib/contracts';
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

export function TokenCard({ symbol, name, contractAddress, accentColor, wallet }: Props) {
    const [status, setStatus] = useState<MineStatus>('idle');
    const [txId, setTxId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    async function handleMine() {
        if (!wallet.connected || !wallet.address) return;

        const opnet = (window as any).opnet;
        if (!opnet) {
            setErrorMsg('OPWallet not found');
            setStatus('error');
            return;
        }

        setStatus('pending');
        setTxId(null);
        setErrorMsg(null);

        try {
            // Dynamically import opnet to avoid SSR issues
            const { JSONRpcProvider, getContract } = await import('opnet');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);

            // Build contract instance for simulation
            // sender param requires Address type, not string
            const { Address } = await import('@btc-vision/transaction');
            const senderAddr = Address.fromString(wallet.address!);
            const contract = getContract(
                contractAddress,
                MINE_ABI as any,
                provider,
                networks.testnet,
                senderAddr,
            );

            // Simulate the mine() call
            const simulation = await (contract as any).mine();

            if (simulation.revert) {
                throw new Error(`Simulation reverted: ${simulation.revert}`);
            }

            // Send the transaction via OPWallet with BTC payment attached
            const receipt = await simulation.sendTransaction({
                signer: opnet,            // OPWallet acts as signer
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

            setTxId(receipt?.transactionId ?? receipt?.[1] ?? 'submitted');
            setStatus('success');
        } catch (err: any) {
            console.error(`mine ${symbol} failed:`, err);
            setErrorMsg(err?.message ?? 'Transaction failed');
            setStatus('error');
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

            {/* Address */}
            <div
                className="rounded-lg border-2 border-black p-2"
                style={{ backgroundColor: '#f8f8f0' }}
            >
                <p className="mb-1 text-xs font-bold uppercase tracking-wider" style={{ color: '#888' }}>
                    Contract
                </p>
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
