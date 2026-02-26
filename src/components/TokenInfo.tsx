'use client';

import { useState, useEffect, useCallback } from 'react';
import { RPC_URL } from '@/lib/contracts';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type Props = {
    contractAddress: string;
    wallet: WalletState;
};

type TokenData = {
    name: string;
    symbol: string;
    totalSupply: string;
    decimals: number;
    userBalance: string | null;
};

function formatTokenAmount(raw: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

export function TokenInfo({ contractAddress, wallet }: Props) {
    const [tokenData, setTokenData] = useState<TokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTokenInfo = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const { JSONRpcProvider, getContract, OP_20_ABI } = await import('opnet');
            const { networks } = await import('@btc-vision/bitcoin');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            const contract = getContract(
                contractAddress,
                OP_20_ABI as any,
                provider,
                networks.testnet,
            );

            // Fetch name, symbol, decimals, totalSupply in parallel
            const [nameRes, symbolRes, decimalsRes, supplyRes] = await Promise.all([
                (contract as any).name().catch((e: any) => {
                    console.error('[TokenInfo] name() failed:', e?.message);
                    return null;
                }),
                (contract as any).symbol().catch((e: any) => {
                    console.error('[TokenInfo] symbol() failed:', e?.message);
                    return null;
                }),
                (contract as any).decimals().catch((e: any) => {
                    console.error('[TokenInfo] decimals() failed:', e?.message);
                    return null;
                }),
                (contract as any).totalSupply().catch((e: any) => {
                    console.error('[TokenInfo] totalSupply() failed:', e?.message);
                    return null;
                }),
            ]);

            console.log('[TokenInfo] nameRes:', nameRes);
            console.log('[TokenInfo] symbolRes:', symbolRes);
            console.log('[TokenInfo] decimalsRes:', decimalsRes);
            console.log('[TokenInfo] supplyRes:', supplyRes);

            const name = nameRes?.properties?.name ?? 'Unknown';
            const symbol = symbolRes?.properties?.symbol ?? '???';
            const decimals = Number(decimalsRes?.properties?.decimals ?? 18);
            const rawSupply = supplyRes?.properties?.totalSupply ?? BigInt(0);
            const totalSupply = formatTokenAmount(BigInt(rawSupply.toString()), decimals);

            // Fetch user balance if wallet connected
            let userBalance: string | null = null;
            if (wallet.connected && wallet.address) {
                try {
                    const { Address } = await import('@btc-vision/transaction');
                    const { toOutputScript } = await import('@btc-vision/bitcoin');

                    // Detect correct network for the wallet address prefix
                    const prefix = wallet.address.split('1')[0];
                    const addrNetwork = prefix === networks.regtest.bech32
                        ? networks.regtest
                        : networks.testnet;

                    const script = toOutputScript(wallet.address, addrNetwork);
                    const ownerAddress = Address.wrap(script.subarray(2));

                    const balRes = await (contract as any).balanceOf(ownerAddress).catch((e: any) => {
                        console.error('[TokenInfo] balanceOf() failed:', e?.message);
                        return null;
                    });

                    console.log('[TokenInfo] balanceOf result:', balRes);

                    const rawBal = balRes?.properties?.balance ?? null;
                    if (rawBal !== null) {
                        userBalance = formatTokenAmount(BigInt(rawBal.toString()), decimals);
                    }
                } catch (balErr: any) {
                    console.error('[TokenInfo] balance fetch error:', balErr?.message);
                }
            }

            setTokenData({ name, symbol, totalSupply, decimals, userBalance });
        } catch (err: any) {
            console.error('[TokenInfo] fetch failed:', err);
            setError(err?.message ?? 'Failed to fetch token info');
        } finally {
            setLoading(false);
        }
    }, [contractAddress, wallet.connected, wallet.address]);

    useEffect(() => {
        fetchTokenInfo();
    }, [fetchTokenInfo]);

    if (loading) {
        return (
            <div
                className="rounded-xl border-3 border-black nb-shadow p-6 text-center"
                style={{ backgroundColor: 'var(--card-bg)', borderWidth: '3px' }}
            >
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: '#888' }}>
                    Loading token info...
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="rounded-xl border-3 border-black nb-shadow p-6"
                style={{ backgroundColor: 'var(--card-bg)', borderWidth: '3px' }}
            >
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--red)' }}>
                    Error: {error}
                </p>
                <code className="mt-2 block truncate text-xs" style={{ color: '#666' }}>
                    {contractAddress}
                </code>
            </div>
        );
    }

    if (!tokenData) return null;

    return (
        <div
            className="rounded-xl border-3 border-black nb-shadow p-6 flex flex-col gap-4"
            style={{ backgroundColor: 'var(--card-bg)', borderWidth: '3px' }}
        >
            {/* Token header */}
            <div className="flex items-center justify-between">
                <div>
                    <span
                        className="nb-shadow-sm inline-flex items-center rounded-xl border-2 border-black px-4 py-2"
                        style={{ backgroundColor: 'var(--purple, #c084fc)' }}
                    >
                        <span className="text-2xl font-black tracking-tight">{tokenData.symbol}</span>
                    </span>
                    <p className="mt-2 text-sm font-semibold" style={{ color: '#555' }}>
                        {tokenData.name}
                    </p>
                </div>
                <div
                    className="rounded-lg border-2 border-black px-2 py-1 text-xs font-bold uppercase"
                    style={{ backgroundColor: '#000', color: 'var(--purple, #c084fc)' }}
                >
                    OP-20
                </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border-2 border-black p-3" style={{ backgroundColor: '#f3e8ff' }}>
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                        Total Supply
                    </p>
                    <p className="mt-0.5 text-sm font-black">{tokenData.totalSupply}</p>
                </div>
                <div className="rounded-lg border-2 border-black p-3" style={{ backgroundColor: '#f3e8ff' }}>
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                        Decimals
                    </p>
                    <p className="mt-0.5 text-sm font-black">{tokenData.decimals}</p>
                </div>
            </div>

            {/* User balance */}
            {wallet.connected && (
                <div className="rounded-lg border-2 border-black p-3" style={{ backgroundColor: '#f3e8ff' }}>
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#666' }}>
                        Your Balance
                    </p>
                    <p className="mt-0.5 text-lg font-black">
                        {tokenData.userBalance !== null
                            ? `${tokenData.userBalance} ${tokenData.symbol}`
                            : `— ${tokenData.symbol}`
                        }
                    </p>
                </div>
            )}

            {/* Contract address */}
            <div className="rounded-lg border-2 border-black p-2" style={{ backgroundColor: '#f8f8f0' }}>
                <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#888' }}>
                    Contract
                </p>
                <code className="block truncate text-xs font-bold" style={{ color: '#333' }}>
                    {contractAddress}
                </code>
            </div>
        </div>
    );
}
