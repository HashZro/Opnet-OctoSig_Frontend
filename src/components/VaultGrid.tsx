'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
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

// ── localStorage cache ──
// Stores serializable vault data so repeat visits load instantly.
// Bigint fields are stored as strings.
const CACHE_KEY = 'octosig_vaults';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CachedVault = Omit<VaultInfo, 'balance' | 'totalProposals'> & {
    balance: string;
    totalProposals: string;
};

type VaultCache = {
    ts: number;
    vaults: CachedVault[];
};

function saveVaultsCache(vaults: VaultInfo[]) {
    try {
        const data: VaultCache = {
            ts: Date.now(),
            vaults: vaults.map((v) => ({
                ...v,
                balance: v.balance.toString(),
                totalProposals: v.totalProposals.toString(),
            })),
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded or SSR */ }
}

function loadVaultsCache(): VaultInfo[] | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const data: VaultCache = JSON.parse(raw);
        if (Date.now() - data.ts > CACHE_TTL_MS) return null;
        return data.vaults.map((v) => ({
            ...v,
            balance: BigInt(v.balance),
            totalProposals: BigInt(v.totalProposals),
        }));
    } catch { return null; }
}

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

type TokenMeta = { name: string; symbol: string; decimals: number };

async function fetchTokenMeta(tokenHex: string): Promise<TokenMeta> {
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
}

function formatBal(raw: bigint, decimals = 18): string {
    const d = BigInt(10) ** BigInt(decimals);
    const whole = raw / d;
    const frac = raw % d;
    const fs = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return fs ? `${whole.toLocaleString()}.${fs}` : whole.toLocaleString();
}

type Filter = 'all' | 'mine';

function truncateHex(hex: string): string {
    if (hex.length <= 14) return hex;
    return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
}

/** Convert opt1p... bech32 wallet address to 0x-prefixed hex for comparison with owner list */
async function walletAddrToHex(bech32Addr: string): Promise<string | null> {
    try {
        const { networks, toOutputScript } = await import('@btc-vision/bitcoin');
        const opnetNet = { ...networks.testnet, bech32: networks.testnet.bech32Opnet! };
        const script = toOutputScript(bech32Addr, opnetNet);
        const program = script.subarray(2);
        if (program.length === 32) {
            return '0x' + Array.from(program).map((b: number) => b.toString(16).padStart(2, '0')).join('');
        }
    } catch {
        // not an opt1p address — try as-is
    }
    // If already hex, return lowercase
    if (bech32Addr.startsWith('0x') || bech32Addr.startsWith('0X')) {
        return bech32Addr.toLowerCase();
    }
    return null;
}

export function VaultGrid({ filterDefault = 'all' }: { filterDefault?: Filter }) {
    const { wallet } = useWallet();
    const [state, setState] = useState<LoadState>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [vaults, setVaults] = useState<VaultInfo[]>([]);
    const filter = filterDefault;
    const [walletHex, setWalletHex] = useState<string | null>(null);
    const [tokenMetas, setTokenMetas] = useState<Record<string, TokenMeta>>({});
    const fetchedTokens = useRef<Set<string>>(new Set());

    // Convert wallet address to hex whenever it changes
    useEffect(() => {
        if (!wallet.address) {
            setWalletHex(null);
            return;
        }
        walletAddrToHex(wallet.address).then(setWalletHex);
    }, [wallet.address]);

    const fetchAll = useCallback(async (): Promise<VaultInfo[]> => {
        const count = await fetchVaultCount();
        if (count === 0) return [];
        const results: VaultInfo[] = [];
        for (let i = 0; i < count; i++) {
            try {
                results.push(await fetchVaultInfo(i));
            } catch (err) {
                console.error(`Failed to load vault ${i}:`, err);
            }
        }
        return results;
    }, []);

    const load = useCallback(async () => {
        // Try cache first for instant rendering
        const cached = loadVaultsCache();
        if (cached && cached.length > 0) {
            setVaults(cached);
            setState('done');
            // Refresh from chain in background (silent update)
            fetchAll().then((fresh) => {
                setVaults(fresh);
                saveVaultsCache(fresh);
            }).catch(() => {});
            return;
        }

        setState('loading');
        setErrorMsg(null);
        setVaults([]);

        try {
            const results = await fetchAll();
            setVaults(results);
            saveVaultsCache(results);
            setState('done');
        } catch (err: any) {
            console.error('VaultGrid load failed:', err);
            setErrorMsg(err?.message ?? 'Failed to load vaults');
            setState('error');
        }
    }, [fetchAll]);

    useEffect(() => {
        load();
    }, [load]);

    // Fetch token metadata for unique tokens across vaults
    useEffect(() => {
        const uniqueTokens = [...new Set(vaults.map((v) => v.token))].filter(
            (t) => !fetchedTokens.current.has(t),
        );
        if (uniqueTokens.length === 0) return;
        uniqueTokens.forEach((t) => fetchedTokens.current.add(t));
        Promise.all(
            uniqueTokens.map(async (t) => {
                try {
                    const meta = await fetchTokenMeta(t);
                    setTokenMetas((prev) => ({ ...prev, [t]: meta }));
                } catch {
                    // non-critical
                }
            }),
        );
    }, [vaults]);

    // Compute filtered vaults
    const filteredVaults = filter === 'all' || !walletHex
        ? vaults
        : vaults.filter((v) =>
            v.owners.some((o) => o.toLowerCase() === walletHex.toLowerCase())
        );

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
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                            {filter === 'mine' ? 'My Vaults' : 'Vaults'}
                        </h2>
                        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {filter === 'mine'
                                ? `${filteredVaults.length} of ${vaults.length} vault${vaults.length !== 1 ? 's' : ''} where you are an owner.`
                                : `${vaults.length} vault${vaults.length !== 1 ? 's' : ''} found on-chain.`}
                        </p>
                    </div>
                    <Link
                        href="/vault/new"
                        className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold"
                        style={{
                            backgroundColor: 'var(--cyan)',
                            color: '#fff',
                            border: '1px solid var(--cyan)',
                            cursor: 'pointer',
                            transition: 'background-color 100ms ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--cyan-mid)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--cyan)'; }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create Vault
                    </Link>
                </div>
            </section>

            <div
                className="flex items-center gap-3 px-4 py-3 mb-6 text-xs font-medium"
                style={{
                    backgroundColor: 'var(--cyan-light)',
                    border: '1px solid var(--cyan)',
                    color: 'var(--cyan-mid)',
                }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Currently single-token vaults only. Multi-token and OP-721 (NFT) support coming soon.
            </div>

            {/* Empty state for "My Vaults" filter */}
            {filter === 'mine' && filteredVaults.length === 0 && (
                <div
                    className="mb-8 p-6 text-center"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    {!wallet.connected ? (
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Connect your wallet to see your vaults.
                        </p>
                    ) : (
                        <>
                            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                                You are not an owner in any vault.
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                Create a vault or ask to be added as an owner.
                            </p>
                        </>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
                {filteredVaults.map((vault) => {
                    const meta = tokenMetas[vault.token];
                    const MAX_SHOWN = 3;
                    const shown = vault.owners.slice(0, MAX_SHOWN);
                    const remaining = vault.owners.length - MAX_SHOWN;
                    return (
                        <Link
                            key={vault.id}
                            href={`/vault/${vault.id}`}
                            className="block p-6 transition-colors flex flex-col"
                            style={{
                                backgroundColor: 'var(--card-bg)',
                                border: '1px solid var(--border)',
                                height: 280,
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

                            {/* Token + Balance */}
                            <div className="mb-3 p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                            Token
                                        </p>
                                        <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text)' }}>
                                            {meta ? meta.name : '...'}
                                            {meta && (
                                                <span className="text-xs font-normal ml-1.5" style={{ color: 'var(--text-tertiary)' }}>
                                                    {meta.symbol}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                            Balance
                                        </p>
                                        <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text)' }}>
                                            {meta ? formatBal(vault.balance, meta.decimals) : formatBal(vault.balance)}
                                            {meta && (
                                                <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-tertiary)' }}>
                                                    {meta.symbol}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Creator */}
                            <div className="mb-3">
                                <p
                                    className="text-[10px] font-medium uppercase tracking-wider mb-1"
                                    style={{ color: 'var(--text-tertiary)' }}
                                >
                                    Creator
                                </p>
                                <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                                    {vault.owners.length > 0 ? truncateHex(vault.owners[0]) : 'Unknown'}
                                </p>
                            </div>

                            {/* Participants — capped at 3 */}
                            <div className="mt-auto">
                                <p
                                    className="text-[10px] font-medium uppercase tracking-wider mb-1"
                                    style={{ color: 'var(--text-tertiary)' }}
                                >
                                    Participants ({vault.owners.length})
                                </p>
                                <div className="flex flex-col gap-1">
                                    {shown.map((addr, i) => (
                                        <p
                                            key={i}
                                            className="text-xs font-mono"
                                            style={{ color: 'var(--text-secondary)' }}
                                        >
                                            {truncateHex(addr)}
                                        </p>
                                    ))}
                                    {remaining > 0 && (
                                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                            +{remaining} more
                                        </p>
                                    )}
                                    {vault.owners.length === 0 && (
                                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                                            {vault.ownerCount} participants
                                        </p>
                                    )}
                                </div>
                            </div>
                        </Link>
                    );
                })}

                {/* Empty placeholder cards */}
                {(() => {
                    const cols = 3;
                    const remainder = filteredVaults.length % cols;
                    const fillCount = remainder === 0
                        ? Math.max(0, cols * 2 - filteredVaults.length)
                        : cols - remainder + cols;
                    const count = Math.max(0, Math.min(fillCount, 9 - filteredVaults.length));
                    return Array.from({ length: count }, (_, i) => (
                        <div
                            key={`empty-${i}`}
                            className="p-6 flex flex-col items-center justify-center"
                            style={{
                                backgroundColor: '#FAFAFA',
                                border: '1px dashed var(--border)',
                                height: 280,
                            }}
                        >
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--border-dark)', marginBottom: 10 }}>
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No vault</p>
                        </div>
                    ));
                })()}
            </div>
        </>
    );
}
