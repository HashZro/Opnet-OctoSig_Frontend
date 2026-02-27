'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { VAULT_ADDRESS, VAULT_ABI, RPC_URL } from '@/lib/contracts';

type VaultInfo = {
    id: number;
    threshold: number;
    ownerCount: number;
    token: string;
    balance: bigint;
    totalProposals: bigint;
    hasProposal: boolean;
    owners: string[];
};

type LoadState = 'idle' | 'loading' | 'done' | 'error';

async function loadSdk() {
    const { getContract, JSONRpcProvider } = await import('opnet');
    const { networks } = await import('@btc-vision/bitcoin');
    const { BinaryWriter } = await import('@btc-vision/transaction');
    const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
    const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
    return { provider, contract, networks, BinaryWriter };
}

async function fetchVaultCount(): Promise<number> {
    const { contract } = await loadSdk();
    const result = await (contract as any).getVaultCount();
    const raw = result?.properties?.count ?? result?.decoded?.[0] ?? null;
    return raw !== null ? Number(raw.toString()) : 0;
}

async function fetchVaultInfo(vaultId: number): Promise<VaultInfo> {
    const sdk = await loadSdk();
    const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('getVaultInfo', []);

    const params = new sdk.BinaryWriter();
    params.writeU256(BigInt(vaultId));
    const paramsBuf = params.getBuffer();

    const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
    calldata.set(selectorBuf, 0);
    calldata.set(paramsBuf, selectorBuf.length);

    // provider.call() expects a hex string, not Uint8Array
    const calldataHex = '0x' + Array.from(calldata).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    const sim = await sdk.provider.call(VAULT_ADDRESS, calldataHex as any);
    if (sim && 'error' in sim) throw new Error((sim as any).error);

    // sim.result is already a BinaryReader (from CallResult)
    const reader = (sim as any).result;
    if (!reader) throw new Error('No data returned from getVaultInfo');

    const threshold = reader.readU256();
    const ownerCount = reader.readU256();
    const token = reader.readAddress();
    const balance = reader.readU256();
    const totalProposals = reader.readU256();
    const hasProposalVal = reader.readU256();

    // Read owners array (contract uses writeAddressArray: u16 count + N * address)
    const owners: string[] = [];
    try {
        const arrLen = reader.readU16();
        for (let i = 0; i < arrLen; i++) {
            const addr = reader.readAddress();
            const hex = typeof addr === 'string' ? addr
                : addr.toHex ? addr.toHex()
                : `0x${Buffer.from(addr as any).toString('hex')}`;
            owners.push(hex);
        }
    } catch {
        // If array reading fails, we still have ownerCount
    }

    const tokenHex = typeof token === 'string' ? token
        : token.toHex ? token.toHex()
        : `0x${Buffer.from(token as any).toString('hex')}`;

    return {
        id: vaultId,
        threshold: Number(threshold.toString()),
        ownerCount: Number(ownerCount.toString()),
        token: tokenHex,
        balance: BigInt(balance.toString()),
        totalProposals: BigInt(totalProposals.toString()),
        hasProposal: BigInt(hasProposalVal.toString()) !== BigInt(0),
        owners,
    };
}

function truncateHex(hex: string): string {
    if (hex.length <= 14) return hex;
    return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
}

export function VaultGrid() {
    const [state, setState] = useState<LoadState>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [vaults, setVaults] = useState<VaultInfo[]>([]);

    const load = useCallback(async () => {
        setState('loading');
        setErrorMsg(null);
        setVaults([]);

        try {
            const count = await fetchVaultCount();
            if (count === 0) {
                setState('done');
                return;
            }

            const results: VaultInfo[] = [];
            for (let i = 0; i < count; i++) {
                try {
                    const info = await fetchVaultInfo(i);
                    results.push(info);
                } catch (err) {
                    console.error(`Failed to load vault ${i}:`, err);
                }
            }
            setVaults(results);
            setState('done');
        } catch (err: any) {
            console.error('VaultGrid load failed:', err);
            setErrorMsg(err?.message ?? 'Failed to load vaults');
            setState('error');
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // ── Loading ──
    if (state === 'loading') {
        return (
            <>
                <section className="py-16">
                    <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                        Vaults
                    </h2>
                    <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Loading vaults from the MultSigVault contract...
                    </p>
                </section>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="p-6 animate-pulse"
                            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                        >
                            <div className="h-4 w-20 mb-4" style={{ backgroundColor: '#E5E5E5' }} />
                            <div className="h-3 w-full mb-2" style={{ backgroundColor: '#F0F0F0' }} />
                            <div className="h-3 w-3/4 mb-2" style={{ backgroundColor: '#F0F0F0' }} />
                            <div className="h-3 w-1/2" style={{ backgroundColor: '#F0F0F0' }} />
                        </div>
                    ))}
                </div>
            </>
        );
    }

    // ── Error ──
    if (state === 'error') {
        return (
            <>
                <section className="py-16">
                    <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                        Vaults
                    </h2>
                </section>
                <div
                    className="mb-8 p-6"
                    style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}
                >
                    <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-2"
                        style={{ color: 'var(--red)' }}
                    >
                        Error
                    </h3>
                    <p className="text-sm break-all" style={{ color: 'var(--text-secondary)' }}>
                        {errorMsg}
                    </p>
                    <button
                        type="button"
                        onClick={load}
                        className="mt-3 px-3 py-1.5 text-xs font-medium"
                        style={{
                            backgroundColor: '#FFFFFF',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        Retry
                    </button>
                </div>
            </>
        );
    }

    // ── Empty ──
    if (state === 'done' && vaults.length === 0) {
        return (
            <>
                <section className="py-16">
                    <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                        Vaults
                    </h2>
                </section>
                <div
                    className="mb-8 p-6 text-center"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                        No vaults created yet.
                    </p>
                    <Link
                        href="/vault/new"
                        className="inline-block px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                        style={{
                            backgroundColor: 'var(--accent)',
                            color: '#FFFFFF',
                            border: '1px solid transparent',
                        }}
                    >
                        Create a Vault
                    </Link>
                </div>
            </>
        );
    }

    // ── Grid ──
    return (
        <>
            <section className="py-16">
                <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                    Vaults
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {vaults.length} vault{vaults.length !== 1 ? 's' : ''} found on-chain.
                </p>
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
                {vaults.map((vault) => (
                    <Link
                        key={vault.id}
                        href={`/vault/${vault.id}`}
                        className="block p-6 transition-colors"
                        style={{
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                        }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                Vault #{vault.id}
                            </h3>
                            <span
                                className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                                style={{
                                    backgroundColor: '#F5F5F5',
                                    color: 'var(--text-tertiary)',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                {vault.threshold} of {vault.ownerCount}
                            </span>
                        </div>

                        {/* Owner (creator = first address) */}
                        <div className="mb-3">
                            <p
                                className="text-[10px] font-medium uppercase tracking-wider mb-1"
                                style={{ color: 'var(--text-tertiary)' }}
                            >
                                Owner
                            </p>
                            <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                                {vault.owners.length > 0 ? truncateHex(vault.owners[0]) : 'Unknown'}
                            </p>
                        </div>

                        {/* Participants */}
                        <div>
                            <p
                                className="text-[10px] font-medium uppercase tracking-wider mb-1"
                                style={{ color: 'var(--text-tertiary)' }}
                            >
                                Participants ({vault.owners.length})
                            </p>
                            <div className="flex flex-col gap-1">
                                {vault.owners.map((addr, i) => (
                                    <p
                                        key={i}
                                        className="text-xs font-mono"
                                        style={{ color: 'var(--text-secondary)' }}
                                    >
                                        {truncateHex(addr)}
                                    </p>
                                ))}
                                {vault.owners.length === 0 && (
                                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                        {vault.ownerCount} participants
                                    </p>
                                )}
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </>
    );
}
