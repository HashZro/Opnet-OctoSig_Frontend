'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { VAULT_ADDRESS, VAULT_ABI, RPC_URL } from '@/lib/contracts';

type VaultInfo = {
    threshold: number;
    ownerCount: number;
    token: string;
    balance: bigint;
    totalProposals: number;
    hasProposal: boolean;
    owners: string[];
};

type ProposalInfo = {
    to: string;
    amount: bigint;
    approvals: number;
};

type TokenMeta = {
    name: string;
    symbol: string;
    decimals: number;
};

type LoadState = 'loading' | 'done' | 'error';

async function loadSdk() {
    const { getContract, JSONRpcProvider } = await import('opnet');
    const { networks } = await import('@btc-vision/bitcoin');
    const { BinaryWriter } = await import('@btc-vision/transaction');
    const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
    const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
    return { provider, contract, networks, BinaryWriter };
}

function toHexString(calldata: Uint8Array): string {
    return '0x' + Array.from(calldata).map((b: number) => b.toString(16).padStart(2, '0')).join('');
}

function addrToHex(addr: any): string {
    if (typeof addr === 'string') return addr;
    if (addr.toHex) return addr.toHex();
    return `0x${Buffer.from(addr as any).toString('hex')}`;
}

function formatTokenAmount(raw: bigint, decimals: number): string {
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
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

    const sim = await sdk.provider.call(VAULT_ADDRESS, toHexString(calldata) as any);
    if (sim && 'error' in sim) throw new Error((sim as any).error);

    const reader = (sim as any).result;
    if (!reader) throw new Error('No data returned from getVaultInfo');

    const threshold = reader.readU256();
    const ownerCount = reader.readU256();
    const token = reader.readAddress();
    const balance = reader.readU256();
    const totalProposals = reader.readU256();
    const hasProposalVal = reader.readU256();

    const owners: string[] = [];
    try {
        const arrLen = reader.readU16();
        for (let i = 0; i < arrLen; i++) {
            owners.push(addrToHex(reader.readAddress()));
        }
    } catch {
        // fallback — array reading failed
    }

    return {
        threshold: Number(threshold.toString()),
        ownerCount: Number(ownerCount.toString()),
        token: addrToHex(token),
        balance: BigInt(balance.toString()),
        totalProposals: Number(totalProposals.toString()),
        hasProposal: BigInt(hasProposalVal.toString()) !== BigInt(0),
        owners,
    };
}

async function fetchProposal(vaultId: number): Promise<ProposalInfo> {
    const sdk = await loadSdk();
    const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('getProposal', []);

    const params = new sdk.BinaryWriter();
    params.writeU256(BigInt(vaultId));
    const paramsBuf = params.getBuffer();

    const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
    calldata.set(selectorBuf, 0);
    calldata.set(paramsBuf, selectorBuf.length);

    const sim = await sdk.provider.call(VAULT_ADDRESS, toHexString(calldata) as any);
    if (sim && 'error' in sim) throw new Error((sim as any).error);

    const reader = (sim as any).result;
    if (!reader) throw new Error('No data returned from getProposal');

    const to = reader.readAddress();
    const amount = reader.readU256();
    const approvals = reader.readU256();

    return {
        to: addrToHex(to),
        amount: BigInt(amount.toString()),
        approvals: Number(approvals.toString()),
    };
}

async function fetchTokenMeta(tokenHex: string): Promise<TokenMeta | null> {
    try {
        const { getContract, JSONRpcProvider, OP_20_ABI } = await import('opnet');
        const { networks } = await import('@btc-vision/bitcoin');
        const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
        const token = getContract(tokenHex, OP_20_ABI as any, provider, networks.testnet);

        const [nameRes, symbolRes, decimalsRes] = await Promise.all([
            (token as any).name().catch(() => null),
            (token as any).symbol().catch(() => null),
            (token as any).decimals().catch(() => null),
        ]);

        return {
            name: nameRes?.properties?.name?.toString() ?? 'Unknown',
            symbol: symbolRes?.properties?.symbol?.toString() ?? '???',
            decimals: Number(decimalsRes?.properties?.decimals ?? 18),
        };
    } catch {
        return null;
    }
}

export function VaultDetail({ vaultId }: { vaultId: number }) {
    const [state, setState] = useState<LoadState>('loading');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [vault, setVault] = useState<VaultInfo | null>(null);
    const [proposal, setProposal] = useState<ProposalInfo | null>(null);
    const [tokenMeta, setTokenMeta] = useState<TokenMeta | null>(null);

    const load = useCallback(async () => {
        setState('loading');
        setErrorMsg(null);
        setVault(null);
        setProposal(null);
        setTokenMeta(null);

        try {
            const info = await fetchVaultInfo(vaultId);
            setVault(info);

            // Fetch proposal and token meta in parallel
            const promises: Promise<any>[] = [fetchTokenMeta(info.token)];
            if (info.hasProposal) {
                promises.push(fetchProposal(vaultId));
            }

            const [meta, prop] = await Promise.all(promises);
            if (meta) setTokenMeta(meta);
            if (prop) setProposal(prop);

            setState('done');
        } catch (err: any) {
            console.error('VaultDetail load failed:', err);
            setErrorMsg(err?.message ?? 'Failed to load vault');
            setState('error');
        }
    }, [vaultId]);

    useEffect(() => {
        load();
    }, [load]);

    const decimals = tokenMeta?.decimals ?? 18;
    const symbol = tokenMeta?.symbol ?? '???';

    // ── Loading ──
    if (state === 'loading') {
        return (
            <>
                <section className="py-16">
                    <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                        Vault #{vaultId}
                    </h2>
                    <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Loading vault data from chain...
                    </p>
                </section>
                <div className="flex flex-col gap-4 pb-20">
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="p-6 animate-pulse"
                            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                        >
                            <div className="h-4 w-32 mb-4" style={{ backgroundColor: '#E5E5E5' }} />
                            <div className="h-3 w-full mb-2" style={{ backgroundColor: '#F0F0F0' }} />
                            <div className="h-3 w-3/4" style={{ backgroundColor: '#F0F0F0' }} />
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
                        Vault #{vaultId}
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
                    <div className="flex gap-3 mt-3">
                        <button
                            type="button"
                            onClick={load}
                            className="px-3 py-1.5 text-xs font-medium"
                            style={{
                                backgroundColor: '#FFFFFF',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                            }}
                        >
                            Retry
                        </button>
                        <Link
                            href="/vaults"
                            className="px-3 py-1.5 text-xs font-medium"
                            style={{
                                backgroundColor: '#FFFFFF',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            Back to Vaults
                        </Link>
                    </div>
                </div>
            </>
        );
    }

    if (!vault) return null;

    // ── Vault Detail ──
    return (
        <>
            {/* Header */}
            <section className="py-16">
                <div className="flex items-center gap-3 mb-2">
                    <Link
                        href="/vaults"
                        className="text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--text-tertiary)' }}
                    >
                        Vaults
                    </Link>
                    <span style={{ color: 'var(--text-tertiary)' }}>/</span>
                </div>
                <div className="flex items-center gap-4">
                    <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                        Vault #{vaultId}
                    </h2>
                    <span
                        className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                        style={{
                            backgroundColor: vault.hasProposal ? '#F0FDF4' : '#F5F5F5',
                            color: vault.hasProposal ? 'var(--green)' : 'var(--text-tertiary)',
                            border: vault.hasProposal ? '1px solid #BBF7D0' : '1px solid var(--border)',
                        }}
                    >
                        {vault.hasProposal ? 'Active Proposal' : 'No Active Proposal'}
                    </span>
                </div>
            </section>

            {/* Overview */}
            <div
                className="mb-6 p-6"
                style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
            >
                <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-4"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    Overview
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <InfoCell label="Threshold" value={`${vault.threshold} of ${vault.ownerCount}`} />
                    <InfoCell label="Balance" value={`${formatTokenAmount(vault.balance, decimals)} ${symbol}`} />
                    <InfoCell label="Total Proposals" value={vault.totalProposals.toString()} />
                    <InfoCell label="Owners" value={vault.ownerCount.toString()} />
                </div>

                <div style={{ borderTop: '1px solid var(--border)', marginBottom: '16px' }} />

                {/* Token info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Token Name
                        </p>
                        <p className="mt-1 text-sm font-semibold">{tokenMeta?.name ?? '...'}</p>
                    </div>
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Token Symbol
                        </p>
                        <p className="mt-1 text-sm font-semibold">{symbol}</p>
                    </div>
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Decimals
                        </p>
                        <p className="mt-1 text-sm font-semibold">{decimals}</p>
                    </div>
                </div>

                <div className="mt-3">
                    <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                        Token Address
                    </p>
                    <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                        {vault.token}
                    </code>
                </div>
            </div>

            {/* Owners */}
            <div
                className="mb-6 p-6"
                style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
            >
                <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-4"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    Owners ({vault.owners.length})
                </h3>

                <div className="flex flex-col gap-2">
                    {vault.owners.map((addr, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 p-3"
                            style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}
                        >
                            <span
                                className="text-[10px] font-semibold uppercase tracking-wider shrink-0"
                                style={{ color: 'var(--text-tertiary)', width: '20px', textAlign: 'right' }}
                            >
                                {i + 1}
                            </span>
                            <code className="text-xs font-mono break-all flex-1" style={{ color: 'var(--text-secondary)' }}>
                                {addr}
                            </code>
                            {i === 0 && (
                                <span
                                    className="px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider shrink-0"
                                    style={{
                                        backgroundColor: '#EFF6FF',
                                        color: '#2563EB',
                                        border: '1px solid #BFDBFE',
                                    }}
                                >
                                    Creator
                                </span>
                            )}
                        </div>
                    ))}

                    {vault.owners.length === 0 && (
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                            {vault.ownerCount} owners (addresses could not be loaded)
                        </p>
                    )}
                </div>
            </div>

            {/* Active Proposal */}
            {vault.hasProposal && proposal && (
                <div
                    className="mb-6 p-6"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-4"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        Active Proposal
                    </h3>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <InfoCell
                            label="Amount"
                            value={`${formatTokenAmount(proposal.amount, decimals)} ${symbol}`}
                        />
                        <InfoCell
                            label="Approvals"
                            value={`${proposal.approvals} / ${vault.threshold}`}
                        />
                    </div>

                    {/* Progress bar */}
                    <div className="mb-4">
                        <div
                            className="h-2 w-full"
                            style={{ backgroundColor: '#F0F0F0', borderRadius: '4px' }}
                        >
                            <div
                                className="h-2"
                                style={{
                                    width: `${Math.min(100, (proposal.approvals / vault.threshold) * 100)}%`,
                                    backgroundColor: proposal.approvals >= vault.threshold ? 'var(--green)' : 'var(--accent)',
                                    borderRadius: '4px',
                                    transition: 'width 0.3s ease',
                                }}
                            />
                        </div>
                        <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            {proposal.approvals >= vault.threshold
                                ? 'Threshold reached — ready to execute'
                                : `${vault.threshold - proposal.approvals} more approval${vault.threshold - proposal.approvals !== 1 ? 's' : ''} needed`}
                        </p>
                    </div>

                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            Recipient
                        </p>
                        <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                            {proposal.to}
                        </code>
                    </div>
                </div>
            )}

            {vault.hasProposal && !proposal && (
                <div
                    className="mb-6 p-6"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-2"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        Active Proposal
                    </h3>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Proposal exists but details could not be loaded.
                    </p>
                </div>
            )}

            {/* Contract info */}
            <div
                className="mb-6 p-6"
                style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
            >
                <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-3"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    Contract
                </h3>
                <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    MultSigVault Address
                </p>
                <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                    {VAULT_ADDRESS}
                </code>
            </div>

            <div className="pb-20" />
        </>
    );
}

function InfoCell({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {label}
            </p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
        </div>
    );
}
