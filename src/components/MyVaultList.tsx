'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { useToast } from '@/contexts/ToastContext';
import { VAULT_ADDRESS, VAULT_ABI, RPC_URL } from '@/lib/contracts';
import { friendlyError } from '@/lib/errorMessages';
import { TransactionAlert } from './TransactionAlert';

// ── Types ──

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

type ProposalInfo = {
    to: string;
    amount: bigint;
    approvals: number;
};

type LoadState = 'idle' | 'loading' | 'done' | 'error';

// ── Cache (shared key with VaultGrid) ──

const CACHE_KEY = 'octosig_vaults';
const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedVault = Omit<VaultInfo, 'balance' | 'totalProposals'> & {
    balance: string;
    totalProposals: string;
};

function loadVaultsCache(): VaultInfo[] | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const data: { ts: number; vaults: CachedVault[] } = JSON.parse(raw);
        if (Date.now() - data.ts > CACHE_TTL_MS) return null;
        return data.vaults.map((v) => ({
            ...v,
            balance: BigInt(v.balance),
            totalProposals: BigInt(v.totalProposals),
        }));
    } catch { return null; }
}

function saveVaultsCache(vaults: VaultInfo[]) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            vaults: vaults.map((v) => ({
                ...v,
                balance: v.balance.toString(),
                totalProposals: v.totalProposals.toString(),
            })),
        }));
    } catch {}
}

// ── SDK + fetch ──

async function loadSdk() {
    const { getContract, JSONRpcProvider } = await import('opnet');
    const { networks } = await import('@btc-vision/bitcoin');
    const { BinaryWriter } = await import('@btc-vision/transaction');
    const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
    const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
    return { provider, contract, networks, BinaryWriter };
}

function toHex(calldata: Uint8Array): string {
    return '0x' + Array.from(calldata).map((b: number) => b.toString(16).padStart(2, '0')).join('');
}

function addrHex(addr: any): string {
    if (typeof addr === 'string') return addr;
    if (addr.toHex) return addr.toHex();
    return `0x${Buffer.from(addr as any).toString('hex')}`;
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

    const sim = await sdk.provider.call(VAULT_ADDRESS, toHex(calldata) as any);
    if (sim && 'error' in sim) throw new Error((sim as any).error);
    const reader = (sim as any).result;
    if (!reader) throw new Error('No data returned');

    const threshold = reader.readU256();
    const ownerCount = reader.readU256();
    const token = reader.readAddress();
    const balance = reader.readU256();
    const totalProposals = reader.readU256();
    const hasProposalVal = reader.readU256();

    const owners: string[] = [];
    try {
        const arrLen = reader.readU16();
        for (let i = 0; i < arrLen; i++) owners.push(addrHex(reader.readAddress()));
    } catch {}

    return {
        id: vaultId,
        threshold: Number(threshold.toString()),
        ownerCount: Number(ownerCount.toString()),
        token: addrHex(token),
        balance: BigInt(balance.toString()),
        totalProposals: BigInt(totalProposals.toString()),
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

    const sim = await sdk.provider.call(VAULT_ADDRESS, toHex(calldata) as any);
    if (sim && 'error' in sim) throw new Error((sim as any).error);
    const reader = (sim as any).result;
    if (!reader) throw new Error('No data returned from getProposal');

    const to = reader.readAddress();
    const amount = reader.readU256();
    const approvals = reader.readU256();

    return {
        to: addrHex(to),
        amount: BigInt(amount.toString()),
        approvals: Number(approvals.toString()),
    };
}

async function sendTx(sim: any, walletAddress: string, opts?: { maxSat?: bigint; minGas?: bigint }) {
    const { networks } = await import('@btc-vision/bitcoin');
    const receipt = await sim.sendTransaction({
        signer: null,
        mldsaSigner: null,
        refundTo: walletAddress,
        maximumAllowedSatToSpend: opts?.maxSat ?? BigInt(100_000),
        feeRate: 10,
        network: networks.testnet,
        minGas: opts?.minGas ?? BigInt(100_000),
    });
    let txId: string | null = null;
    if (receipt && typeof receipt === 'object') {
        if ('transactionId' in receipt) txId = (receipt as any).transactionId;
        else if (Array.isArray(receipt) && receipt.length > 0) txId = receipt[0];
    }
    return txId;
}

async function toAddr(
    addrStr: string,
    Address: any,
    toOutputScript: any,
    networks: any,
    provider?: any,
) {
    if (addrStr.startsWith('0x') || addrStr.startsWith('0X')) {
        return Address.fromString(addrStr);
    }
    const prefix = addrStr.split('1')[0];
    let net;
    if (prefix.startsWith('opt')) {
        net = { ...networks.testnet, bech32: networks.testnet.bech32Opnet! };
    } else if (prefix === networks.regtest.bech32) {
        net = networks.regtest;
    } else {
        net = networks.testnet;
    }
    const script = toOutputScript(addrStr, net);
    const programBytes = script.subarray(2);

    // For 32-byte witness programs (taproot / opt1p...), resolve the identity key
    // so the OP-20 token contract credits the correct address
    if (programBytes.length === 32 && provider) {
        const tweakedHex = '0x' + Array.from(programBytes as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
        const pubKeyInfo = await provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
        const identityHex = pubKeyInfo?.toString?.() ?? null;
        if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
            console.log(`[toAddr] Resolved identity key for recipient: ${identityHex}`);
            return Address.fromString(identityHex);
        }
        console.warn(`[toAddr] Could not resolve identity key for ${addrStr} — using tweaked pubkey. Recipient must have transacted on OPNet at least once.`);
    }

    return Address.wrap(programBytes);
}

async function walletAddrToHex(bech32Addr: string): Promise<string | null> {
    try {
        const { networks, toOutputScript } = await import('@btc-vision/bitcoin');
        const opnetNet = { ...networks.testnet, bech32: networks.testnet.bech32Opnet! };
        const script = toOutputScript(bech32Addr, opnetNet);
        const program = script.subarray(2);
        if (program.length === 32) return toHex(program);
    } catch {}
    if (bech32Addr.startsWith('0x') || bech32Addr.startsWith('0X')) return bech32Addr.toLowerCase();
    return null;
}

// ── Vote tracking (localStorage) ──

function voteKey(vaultId: number, wallet: string) {
    return `octosig_voted_${vaultId}_${wallet}`;
}

function markVoted(vaultId: number, wallet: string, proposalTo: string, proposalAmount: string) {
    try { localStorage.setItem(voteKey(vaultId, wallet), JSON.stringify({ to: proposalTo, amount: proposalAmount })); } catch {}
}

function hasVoted(vaultId: number, wallet: string | null, proposal: ProposalInfo | undefined): boolean {
    if (!wallet || !proposal) return false;
    try {
        const raw = localStorage.getItem(voteKey(vaultId, wallet));
        if (!raw) return false;
        const data = JSON.parse(raw);
        // Only valid if it matches the current proposal (proposals can be replaced)
        return data.to === proposal.to && data.amount === proposal.amount.toString();
    } catch { return false; }
}

// ── Address alias (hex ↔ bech32) ──

function saveAddressAlias(hex: string, bech32: string) {
    try { localStorage.setItem(`addr_alias_${hex.toLowerCase()}`, bech32); } catch {}
}

function getAddressAlias(hex: string): string | null {
    try { return localStorage.getItem(`addr_alias_${hex.toLowerCase()}`) ?? null; } catch { return null; }
}

// ── Ownership pre-check ──

function checkOwnership(
    senderHex: string,
    vault: VaultInfo,
    tag: string,
): void {
    const lower = senderHex.toLowerCase();
    const match = vault.owners.some((o) => o.toLowerCase() === lower);
    if (!match) {
        console.error(
            `[${tag}] OWNERSHIP MISMATCH — your on-chain identity key is NOT in this vault's owner list.\n` +
            `  Your identity key: ${senderHex}\n` +
            `  Vault owners:     ${vault.owners.join(', ')}\n` +
            `  This vault was likely created before the identity-key fix. You need to create a new vault.`,
        );
        throw new Error(
            'Your wallet identity key does not match this vault\'s stored owners. ' +
            'This vault was created with old address format — please create a new vault.',
        );
    }
    console.log(`[${tag}] ownership check passed — sender ${truncAddr(senderHex)} is a vault owner`);
}

// ── Helpers ──

function truncAddr(hex: string): string {
    if (hex.length <= 16) return hex;
    return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
}

function formatBal(raw: bigint, decimals = 18): string {
    const d = BigInt(10) ** BigInt(decimals);
    const whole = raw / d;
    const frac = raw % d;
    const fs = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    return fs ? `${whole.toLocaleString()}.${fs}` : whole.toLocaleString();
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

// ── Component ──

export function MyVaultList() {
    const { wallet } = useWallet();
    const { toast } = useToast();
    const [state, setState] = useState<LoadState>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [allVaults, setAllVaults] = useState<VaultInfo[]>([]);
    const [walletHex, setWalletHex] = useState<string | null>(null);         // tweaked pubkey (for old vaults)
    const [walletIdentityHex, setWalletIdentityHex] = useState<string | null>(null); // identity key (for new vaults)
    const [expanded, setExpanded] = useState<number | null>(null);

    // Token metadata
    const [tokenMetas, setTokenMetas] = useState<Record<string, TokenMeta>>({});
    const fetchedTokens = useRef<Set<string>>(new Set());

    // Proposal modal
    const [proposalModal, setProposalModal] = useState<{ vaultId: number; threshold: number; hasProposal: boolean; token: string; balance: bigint } | null>(null);
    const [proposeTo, setProposeTo] = useState('');
    const [proposeAmount, setProposeAmount] = useState('');
    const [proposeStatus, setProposeStatus] = useState<'idle' | 'simulating' | 'sending'>('idle');

    // Deposit modal
    const [depositModal, setDepositModal] = useState<{ vaultId: number; token: string } | null>(null);
    const [depositAmount, setDepositAmount] = useState('');
    const [depositStatus, setDepositStatus] = useState<'idle' | 'simulating' | 'sending'>('idle');
    const [walletBalance, setWalletBalance] = useState<{ raw: bigint; decimals: number; formatted: number } | null>(null);
    const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
    const [walletBalanceError, setWalletBalanceError] = useState<string | null>(null);

    // Last submitted transaction (shown as prominent alert)
    const [lastTxId, setLastTxId] = useState<string | null>(null);

    // Loaded proposals keyed by vault id
    const [proposals, setProposals] = useState<Record<number, ProposalInfo>>({});

    useEffect(() => {
        if (!wallet.address) { setWalletHex(null); setWalletIdentityHex(null); return; }
        walletAddrToHex(wallet.address).then((hex) => {
            setWalletHex(hex);
            // Also resolve identity key for matching new vaults (owners stored as identity keys)
            if (hex) {
                (async () => {
                    try {
                        const { JSONRpcProvider } = await import('opnet');
                        const { networks } = await import('@btc-vision/bitcoin');
                        const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                        const pubKeyInfo = await provider.getPublicKeyInfo(hex, false).catch(() => null);
                        const identityHex = pubKeyInfo?.toString?.() ?? null;
                        if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                            setWalletIdentityHex(identityHex);
                        }
                    } catch { /* non-critical */ }
                })();
            }
        });
    }, [wallet.address]);

    const fetchAll = useCallback(async (): Promise<VaultInfo[]> => {
        const count = await fetchVaultCount();
        if (count === 0) return [];
        const results: VaultInfo[] = [];
        for (let i = 0; i < count; i++) {
            try { results.push(await fetchVaultInfo(i)); } catch (e) { console.error(`Vault ${i}:`, e); }
        }
        return results;
    }, []);

    const load = useCallback(async () => {
        const cached = loadVaultsCache();
        if (cached && cached.length > 0) {
            setAllVaults(cached);
            setState('done');
            fetchAll().then((fresh) => { setAllVaults(fresh); saveVaultsCache(fresh); }).catch(() => {});
            return;
        }
        setState('loading');
        setErrorMsg(null);
        try {
            const results = await fetchAll();
            setAllVaults(results);
            saveVaultsCache(results);
            setState('done');
        } catch (err: any) {
            setErrorMsg(err?.message ?? 'Failed to load vaults');
            setState('error');
        }
    }, [fetchAll]);

    useEffect(() => { load(); }, [load]);

    // Fetch wallet token balance when deposit modal opens — always fresh, no cache
    useEffect(() => {
        if (!depositModal || !wallet.address) {
            setWalletBalance(null);
            setWalletBalanceError(null);
            return;
        }
        let cancelled = false;
        setWalletBalanceLoading(true);
        setWalletBalance(null);
        setWalletBalanceError(null);
        (async () => {
            try {
                const { getContract, JSONRpcProvider, OP_20_ABI } = await import('opnet');
                const { networks, toOutputScript } = await import('@btc-vision/bitcoin');
                const { Address } = await import('@btc-vision/transaction');
                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const token = getContract(depositModal.token, OP_20_ABI as any, provider, networks.testnet);

                // Step 1: Convert wallet bech32 address → tweaked pubkey hex
                const addr = wallet.address!;
                let tweakedHex: string;
                if (addr.startsWith('0x') || addr.startsWith('0X')) {
                    tweakedHex = addr;
                } else {
                    const prefix = addr.split('1')[0];
                    let net: any;
                    if (prefix === 'opt' || prefix.startsWith('opt')) {
                        net = { ...networks.testnet, bech32: (networks.testnet as any).bech32Opnet ?? 'opt' };
                    } else if (prefix === networks.regtest.bech32) {
                        net = networks.regtest;
                    } else {
                        net = networks.testnet;
                    }
                    const script = toOutputScript(addr, net);
                    const program = script.subarray(2);
                    tweakedHex = '0x' + Array.from(program as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                }

                // Step 2: Resolve the on-chain identity key via getPublicKeyInfo
                // The OP-20 contract stores balances under this identity key, not the tweaked pubkey
                let balanceAddress: any;
                const pubKeyInfo = await provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
                const identityHex = pubKeyInfo?.toString?.() ?? null;
                if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                    const identityBytes = new Uint8Array(
                        (identityHex.slice(2).match(/.{2}/g) ?? []).map((b: string) => parseInt(b, 16)),
                    );
                    balanceAddress = Address.wrap(identityBytes);
                } else {
                    // Fallback: use the tweaked pubkey directly
                    balanceAddress = Address.wrap(
                        new Uint8Array((tweakedHex.slice(2).match(/.{2}/g) ?? []).map((b: string) => parseInt(b, 16))),
                    );
                }

                // Step 3: Fetch balance and decimals
                const [balRes, decRes] = await Promise.all([
                    (token as any).balanceOf(balanceAddress).catch((e: any) => {
                        console.error('[Deposit] balanceOf() threw:', e?.message ?? e);
                        return null;
                    }),
                    (token as any).decimals().catch((e: any) => {
                        console.error('[Deposit] decimals() threw:', e?.message ?? e);
                        return null;
                    }),
                ]);

                if (cancelled) return;

                // Parse decimals
                const dec = Number(
                    decRes?.properties?.decimals
                    ?? decRes?.result
                    ?? decRes?.decoded?.[0]
                    ?? 18,
                );

                // Parse balance — check multiple property paths
                const rawValue = balRes?.properties?.balance
                    ?? balRes?.result
                    ?? balRes?.decoded?.[0]
                    ?? null;
                const raw = rawValue !== null ? BigInt(rawValue.toString()) : BigInt(0);
                const divisor = BigInt(10) ** BigInt(dec);
                const formatted = Number(raw) / Number(divisor);
                setWalletBalance({ raw, decimals: dec, formatted });
            } catch (err: any) {
                console.error('[Deposit] balance fetch failed:', err);
                if (!cancelled) {
                    setWalletBalance(null);
                    setWalletBalanceError(err?.message ?? 'Failed to load balance');
                }
            } finally {
                if (!cancelled) setWalletBalanceLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [depositModal, wallet.address]);

    // Fetch token metadata for unique tokens across vaults
    useEffect(() => {
        const uniqueTokens = [...new Set(allVaults.map((v) => v.token))].filter(
            (t) => !fetchedTokens.current.has(t),
        );
        if (uniqueTokens.length === 0) return;
        uniqueTokens.forEach((t) => fetchedTokens.current.add(t));
        Promise.all(
            uniqueTokens.map(async (t) => {
                try {
                    const meta = await fetchTokenMeta(t);
                    setTokenMetas((prev) => ({ ...prev, [t]: meta }));
                } catch { /* non-critical */ }
            }),
        );
    }, [allVaults]);

    // Load proposal data when a vault with an active proposal is expanded
    const loadProposal = useCallback(async (vaultId: number) => {
        try {
            const info = await fetchProposal(vaultId);
            setProposals((prev) => ({ ...prev, [vaultId]: info }));
        } catch (err) {
            console.error(`Failed to load proposal for vault ${vaultId}:`, err);
        }
    }, []);

    useEffect(() => {
        if (expanded === null) return;
        const vault = allVaults.find((v) => v.id === expanded);
        if (vault?.hasProposal && !proposals[expanded]) {
            loadProposal(expanded);
        }
    }, [expanded, allVaults, proposals, loadProposal]);

    // Submit proposal
    const handlePropose = useCallback(async () => {
        if (!wallet.connected || !wallet.address || !proposalModal) return;

        const toStr = proposeTo.trim();
        const amtStr = proposeAmount.trim();
        if (!toStr) { toast.error('Enter a recipient address.'); return; }
        if (!amtStr || Number(amtStr) <= 0) { toast.error('Enter a valid amount.'); return; }

        setProposeStatus('simulating');
        try {
            console.log('[Propose] === Starting proposal flow ===');
            console.log('[Propose] wallet:', wallet.address);
            console.log('[Propose] vaultId:', proposalModal.vaultId);
            console.log('[Propose] recipient:', toStr);
            console.log('[Propose] amountInput:', amtStr);

            const sdk = await loadSdk();
            const { getContract, OP_20_ABI } = await import('opnet');
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript: toOut } = await import('@btc-vision/bitcoin');

            // ── Resolve sender identity key ──
            // On-chain, msg.sender is always the identity key. We use the same
            // for simulation so it accurately predicts on-chain behavior.
            console.log('[Propose] Resolving sender address (identity key)...');
            const walletAddr = wallet.address!;
            let senderAddress: any;
            if (walletAddr.startsWith('0x') || walletAddr.startsWith('0X')) {
                senderAddress = Address.fromString(walletAddr);
                console.log('[Propose] hex address, used Address.fromString directly');
            } else {
                const prefix = walletAddr.split('1')[0];
                let net: any;
                if (prefix === 'opt' || prefix.startsWith('opt')) {
                    net = { ...sdk.networks.testnet, bech32: (sdk.networks.testnet as any).bech32Opnet ?? 'opt' };
                } else if (prefix === sdk.networks.regtest.bech32) {
                    net = sdk.networks.regtest;
                } else {
                    net = sdk.networks.testnet;
                }
                const script = toOut(walletAddr, net);
                const tweakedHex = '0x' + Array.from(script.subarray(2) as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                const compressedTweaked = '0x02' + tweakedHex.slice(2);
                console.log('[Propose] tweakedHex:', tweakedHex);

                const pubKeyInfo = await sdk.provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
                const identityHex = pubKeyInfo?.toString?.() ?? null;
                console.log('[Propose] identityHex:', identityHex);

                if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                    senderAddress = Address.fromString(identityHex, compressedTweaked);
                    console.log('[Propose] sender created with identity key');
                } else {
                    senderAddress = Address.fromString(tweakedHex, compressedTweaked);
                    console.log('[Propose] fallback: sender from tweakedHex');
                }
            }
            console.log('[Propose] sender.toHex():', senderAddress.toHex());

            // Pre-flight ownership check — abort BEFORE spending BTC on a doomed tx
            const vault = allVaults.find((v) => v.id === proposalModal.vaultId);
            if (!vault) throw new Error('Vault not found');
            checkOwnership(senderAddress.toHex(), vault, 'Propose');

            // Get token decimals
            const tokenContract = getContract(vault.token, OP_20_ABI as any, sdk.provider, sdk.networks.testnet);
            const decimals = await (tokenContract as any).decimals().catch(() => null);
            const dec = Number(decimals?.properties?.decimals ?? 18);
            const amount = BigInt(Math.floor(Number(amtStr) * 10 ** dec));
            console.log('[Propose] decimals:', dec, '/ raw amount:', amount.toString());

            // Build calldata
            const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('propose', []);
            const params = new sdk.BinaryWriter();
            params.writeU256(BigInt(proposalModal.vaultId));
            const recipientAddr = await toAddr(toStr, Address, toOut, sdk.networks, sdk.provider);
            params.writeAddress(recipientAddr);
            params.writeU256(amount);

            // Save bech32 alias so we can display it alongside the hex
            if (!toStr.startsWith('0x') && !toStr.startsWith('0X')) {
                try { saveAddressAlias(recipientAddr.toHex(), toStr); } catch {}
            }
            const paramsBuf = params.getBuffer();
            const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
            calldata.set(selectorBuf, 0);
            calldata.set(paramsBuf, selectorBuf.length);
            const calldataHex = toHex(calldata);
            console.log('[Propose] calldata hex:', calldataHex.slice(0, 20) + '...');

            const sim = await sdk.provider.call(VAULT_ADDRESS, calldataHex as any, senderAddress);
            if (sim && 'error' in sim) {
                console.error('[Propose] simulation error:', (sim as any).error);
                throw new Error((sim as any).error);
            }
            // provider.call() leaves to/address/calldata/fromAddress undefined — set them
            (sim as any).to = VAULT_ADDRESS;
            (sim as any).address = Address.fromString(VAULT_ADDRESS);
            (sim as any).calldata = Buffer.from(calldata);
            (sim as any).fromAddress = senderAddress;
            console.log('[Propose] simulation OK, sending to wallet...');

            setProposeStatus('sending');
            toast.info('Confirm proposal in OPWallet...');
            const proposeTxId = await sendTx(sim, wallet.address!);

            toast.success('Proposal submitted!');
            if (proposeTxId) setLastTxId(proposeTxId);

            // Track that we voted on this proposal
            markVoted(proposalModal.vaultId, wallet.address!, toStr, amount.toString());

            setProposalModal(null);
            setProposeTo('');
            setProposeAmount('');
            setProposeStatus('idle');

            // Refresh vaults
            fetchAll().then((fresh) => { setAllVaults(fresh); saveVaultsCache(fresh); }).catch(() => {});
        } catch (err: any) {
            console.error('[Propose] FAILED:', err);
            const { message, isFunding } = friendlyError(err);
            toast.error(isFunding ? message : `Proposal failed: ${message}`);
            setProposeStatus('idle');
        }
    }, [wallet, proposalModal, proposeTo, proposeAmount, allVaults, toast, fetchAll]);

    // Approve (vote yes on active proposal)
    const [approvingVault, setApprovingVault] = useState<number | null>(null);
    const handleApprove = useCallback(async (vaultId: number) => {
        if (!wallet.connected || !wallet.address) return;

        setApprovingVault(vaultId);
        try {
            console.log('[Approve] === Starting approve flow ===');
            console.log('[Approve] vaultId:', vaultId);

            const sdk = await loadSdk();
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript: toOut } = await import('@btc-vision/bitcoin');

            // Resolve sender identity key
            const walletAddr = wallet.address!;
            let senderAddress: any;
            if (walletAddr.startsWith('0x') || walletAddr.startsWith('0X')) {
                senderAddress = Address.fromString(walletAddr);
            } else {
                const prefix = walletAddr.split('1')[0];
                let net: any;
                if (prefix === 'opt' || prefix.startsWith('opt')) {
                    net = { ...sdk.networks.testnet, bech32: (sdk.networks.testnet as any).bech32Opnet ?? 'opt' };
                } else if (prefix === sdk.networks.regtest.bech32) {
                    net = sdk.networks.regtest;
                } else {
                    net = sdk.networks.testnet;
                }
                const script = toOut(walletAddr, net);
                const tweakedHex = '0x' + Array.from(script.subarray(2) as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                const compressedTweaked = '0x02' + tweakedHex.slice(2);
                const pubKeyInfo = await sdk.provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
                const identityHex = pubKeyInfo?.toString?.() ?? null;
                if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                    senderAddress = Address.fromString(identityHex, compressedTweaked);
                } else {
                    senderAddress = Address.fromString(tweakedHex, compressedTweaked);
                }
            }

            // Pre-flight ownership check — abort BEFORE spending BTC on a doomed tx
            const vault = allVaults.find((v) => v.id === vaultId);
            if (!vault) throw new Error('Vault not found');
            checkOwnership(senderAddress.toHex(), vault, 'Approve');

            // Build calldata
            const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('approve', []);
            const params = new sdk.BinaryWriter();
            params.writeU256(BigInt(vaultId));
            const paramsBuf = params.getBuffer();
            const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
            calldata.set(selectorBuf, 0);
            calldata.set(paramsBuf, selectorBuf.length);
            const calldataHex = toHex(calldata);

            const sim = await sdk.provider.call(VAULT_ADDRESS, calldataHex as any, senderAddress);
            if (sim && 'error' in sim) throw new Error((sim as any).error);

            (sim as any).to = VAULT_ADDRESS;
            (sim as any).address = Address.fromString(VAULT_ADDRESS);
            (sim as any).calldata = Buffer.from(calldata);
            (sim as any).fromAddress = senderAddress;

            toast.info('Confirm approval in OPWallet...');
            const approveTxId = await sendTx(sim, wallet.address!, { maxSat: BigInt(50_000), minGas: BigInt(50_000) });

            // Track vote
            const proposal = proposals[vaultId];
            if (proposal) {
                markVoted(vaultId, wallet.address!, proposal.to, proposal.amount.toString());
            }

            toast.success('Vote submitted!');
            if (approveTxId) setLastTxId(approveTxId);
            setApprovingVault(null);

            // Refresh
            fetchAll().then((fresh) => { setAllVaults(fresh); saveVaultsCache(fresh); }).catch(() => {});
            loadProposal(vaultId);
        } catch (err: any) {
            console.error('[Approve] FAILED:', err);
            const errStr = String(err?.message ?? err ?? '');
            // If contract says "already approved", mark vote retroactively so button hides
            if (errStr.toLowerCase().includes('already approved')) {
                const proposal = proposals[vaultId];
                if (proposal) markVoted(vaultId, wallet.address!, proposal.to, proposal.amount.toString());
                toast.warning('You already approved this proposal.');
            } else {
                const { message, isFunding } = friendlyError(err);
                toast.error(isFunding ? message : `Approval failed: ${message}`);
            }
            setApprovingVault(null);
        }
    }, [wallet, allVaults, proposals, toast, fetchAll, loadProposal]);

    // Execute proposal (threshold met)
    const [executingVault, setExecutingVault] = useState<number | null>(null);
    const handleExecute = useCallback(async (vaultId: number) => {
        if (!wallet.connected || !wallet.address) return;

        setExecutingVault(vaultId);
        try {
            console.log('[Execute] === Starting execute flow ===');
            console.log('[Execute] vaultId:', vaultId);

            const sdk = await loadSdk();
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript: toOut } = await import('@btc-vision/bitcoin');

            // Resolve sender identity key
            const walletAddr = wallet.address!;
            let senderAddress: any;
            if (walletAddr.startsWith('0x') || walletAddr.startsWith('0X')) {
                senderAddress = Address.fromString(walletAddr);
            } else {
                const prefix = walletAddr.split('1')[0];
                let net: any;
                if (prefix === 'opt' || prefix.startsWith('opt')) {
                    net = { ...sdk.networks.testnet, bech32: (sdk.networks.testnet as any).bech32Opnet ?? 'opt' };
                } else if (prefix === sdk.networks.regtest.bech32) {
                    net = sdk.networks.regtest;
                } else {
                    net = sdk.networks.testnet;
                }
                const script = toOut(walletAddr, net);
                const tweakedHex = '0x' + Array.from(script.subarray(2) as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                const compressedTweaked = '0x02' + tweakedHex.slice(2);
                const pubKeyInfo = await sdk.provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
                const identityHex = pubKeyInfo?.toString?.() ?? null;
                if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                    senderAddress = Address.fromString(identityHex, compressedTweaked);
                } else {
                    senderAddress = Address.fromString(tweakedHex, compressedTweaked);
                }
            }

            // Build calldata
            const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('executeProposal', []);
            const params = new sdk.BinaryWriter();
            params.writeU256(BigInt(vaultId));
            const paramsBuf = params.getBuffer();
            const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
            calldata.set(selectorBuf, 0);
            calldata.set(paramsBuf, selectorBuf.length);
            const calldataHex = toHex(calldata);

            const sim = await sdk.provider.call(VAULT_ADDRESS, calldataHex as any, senderAddress);
            if (sim && 'error' in sim) throw new Error((sim as any).error);

            (sim as any).to = VAULT_ADDRESS;
            (sim as any).address = Address.fromString(VAULT_ADDRESS);
            (sim as any).calldata = Buffer.from(calldata);
            (sim as any).fromAddress = senderAddress;

            toast.info('Confirm execution in OPWallet...');
            const executeTxId = await sendTx(sim, wallet.address!);

            toast.success('Proposal executed! Tokens sent.');
            if (executeTxId) setLastTxId(executeTxId);
            setExecutingVault(null);

            // Refresh
            fetchAll().then((fresh) => { setAllVaults(fresh); saveVaultsCache(fresh); }).catch(() => {});
            loadProposal(vaultId);
        } catch (err: any) {
            console.error('[Execute] FAILED:', err);
            const { message, isFunding } = friendlyError(err);
            toast.error(isFunding ? message : `Execute failed: ${message}`);
            setExecutingVault(null);
        }
    }, [wallet, toast, fetchAll, loadProposal]);

    // Submit deposit
    const handleDeposit = useCallback(async () => {
        if (!wallet.connected || !wallet.address || !depositModal) return;

        const amtStr = depositAmount.trim();
        if (!amtStr || Number(amtStr) <= 0) { toast.error('Enter a valid amount.'); return; }

        setDepositStatus('simulating');
        try {
            console.log('[Deposit] === Starting deposit flow ===');
            console.log('[Deposit] wallet:', wallet.address);
            console.log('[Deposit] token:', depositModal.token);
            console.log('[Deposit] vaultId:', depositModal.vaultId);
            console.log('[Deposit] amountInput:', amtStr);

            const sdk = await loadSdk();
            const { getContract, OP_20_ABI } = await import('opnet');
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript } = await import('@btc-vision/bitcoin');

            // ── Resolve sender identity key ──
            // On-chain, msg.sender is always the identity key. We use the same
            // for simulation so it accurately predicts on-chain behavior.
            // New vaults store identity keys as owners, so this will match.
            console.log('[Deposit] Resolving sender address (identity key)...');
            const addr = wallet.address!;
            let senderAddress: any;
            if (addr.startsWith('0x') || addr.startsWith('0X')) {
                senderAddress = Address.fromString(addr);
                console.log('[Deposit] hex address, used Address.fromString directly');
            } else {
                const prefix = addr.split('1')[0];
                let net: any;
                if (prefix === 'opt' || prefix.startsWith('opt')) {
                    net = { ...sdk.networks.testnet, bech32: (sdk.networks.testnet as any).bech32Opnet ?? 'opt' };
                } else if (prefix === sdk.networks.regtest.bech32) {
                    net = sdk.networks.regtest;
                } else {
                    net = sdk.networks.testnet;
                }
                const script = toOutputScript(addr, net);
                const tweakedHex = '0x' + Array.from(script.subarray(2) as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join('');
                const compressedTweaked = '0x02' + tweakedHex.slice(2);
                console.log('[Deposit] tweakedHex:', tweakedHex);

                const pubKeyInfo = await sdk.provider.getPublicKeyInfo(tweakedHex, false).catch(() => null);
                const identityHex = pubKeyInfo?.toString?.() ?? null;
                console.log('[Deposit] identityHex:', identityHex);

                if (identityHex && identityHex.startsWith('0x') && identityHex.length === 66) {
                    senderAddress = Address.fromString(identityHex, compressedTweaked);
                    console.log('[Deposit] sender created with identity key');
                } else {
                    senderAddress = Address.fromString(tweakedHex, compressedTweaked);
                    console.log('[Deposit] fallback: sender from tweakedHex');
                }
            }
            console.log('[Deposit] sender.toHex():', senderAddress.toHex());

            // Pre-flight ownership check — abort BEFORE spending BTC on a doomed tx
            const vault = allVaults.find((v) => v.id === depositModal.vaultId);
            if (vault) checkOwnership(senderAddress.toHex(), vault, 'Deposit');

            // ── Get token decimals ──
            console.log('[Deposit] Fetching token decimals...');
            const tokenReadOnly = getContract(depositModal.token, OP_20_ABI as any, sdk.provider, sdk.networks.testnet);
            const decimals = await (tokenReadOnly as any).decimals().catch(() => null);
            const dec = Number(decimals?.properties?.decimals ?? 18);
            const amount = BigInt(Math.floor(Number(amtStr) * 10 ** dec));
            console.log('[Deposit] decimals:', dec, '/ raw amount:', amount.toString());

            // ── Step 1: increaseAllowance ──
            console.log('[Deposit] Step 1: Simulating increaseAllowance...');
            const tokenContract = getContract(depositModal.token, OP_20_ABI as any, sdk.provider, sdk.networks.testnet, senderAddress);
            const vaultAddr = Address.fromString(VAULT_ADDRESS);
            console.log('[Deposit] vaultAddr (spender):', vaultAddr.toHex());

            const allowanceSim = await (tokenContract as any).increaseAllowance(vaultAddr, amount);
            if (allowanceSim && 'error' in allowanceSim) {
                throw new Error(`Allowance simulation failed: ${(allowanceSim as any).error}`);
            }
            console.log('[Deposit] Step 1: Allowance simulation OK, sending to wallet...');

            setDepositStatus('sending');
            toast.info('Step 1/2 — Approve allowance in OPWallet...');
            const allowanceTxId = await sendTx(allowanceSim, wallet.address!);
            console.log('[Deposit] Step 1: Allowance tx sent, txId:', allowanceTxId);

            // ── Step 2: deposit on vault ──
            console.log('[Deposit] Step 2: Simulating vault deposit...');
            setDepositStatus('simulating');
            toast.info('Step 2/2 — Depositing...');

            const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata('deposit', []);
            const params = new sdk.BinaryWriter();
            params.writeU256(BigInt(depositModal.vaultId));
            params.writeU256(amount);
            const paramsBuf = params.getBuffer();
            const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
            calldata.set(selectorBuf, 0);
            calldata.set(paramsBuf, selectorBuf.length);
            const calldataHex = toHex(calldata);
            console.log('[Deposit] Step 2: calldata hex:', calldataHex.slice(0, 20) + '...');

            const sim = await sdk.provider.call(VAULT_ADDRESS, calldataHex as any, senderAddress);
            if (sim && 'error' in sim) {
                console.error('[Deposit] Step 2: vault deposit simulation error:', (sim as any).error);
                throw new Error(`Vault deposit simulation failed: ${(sim as any).error}`);
            }
            // provider.call() leaves to/address/calldata/fromAddress undefined — set them
            // so sendTransaction() can build the transaction properly
            (sim as any).to = VAULT_ADDRESS;
            (sim as any).address = Address.fromString(VAULT_ADDRESS);
            (sim as any).calldata = Buffer.from(calldata);
            (sim as any).fromAddress = senderAddress;
            console.log('[Deposit] Step 2: Vault deposit simulation OK, sending to wallet...');

            setDepositStatus('sending');
            toast.info('Confirm deposit in OPWallet...');
            const depositTxId = await sendTx(sim, wallet.address!);
            console.log('[Deposit] Step 2: Deposit tx sent, txId:', depositTxId);

            toast.success('Deposit submitted!');
            if (depositTxId) setLastTxId(depositTxId);
            setDepositModal(null);
            setDepositAmount('');
            setDepositStatus('idle');

            // Refresh vaults
            fetchAll().then((fresh) => { setAllVaults(fresh); saveVaultsCache(fresh); }).catch(() => {});
        } catch (err: any) {
            console.error('[Deposit] FAILED:', err);
            const { message, isFunding } = friendlyError(err);
            toast.error(isFunding ? message : `Deposit failed: ${message}`);
            setDepositStatus('idle');
        }
    }, [wallet, depositModal, depositAmount, toast, fetchAll]);

    // Match ownership against both tweaked pubkey (old vaults) and identity key (new vaults)
    const myVaults = (walletHex || walletIdentityHex)
        ? allVaults.filter((v) => v.owners.some((o) => {
            const lower = o.toLowerCase();
            return (walletHex && lower === walletHex.toLowerCase())
                || (walletIdentityHex && lower === walletIdentityHex.toLowerCase());
        }))
        : [];

    // ── Loading ──
    if (state === 'loading') {
        return (
            <div className="flex flex-col gap-0">
                <Header count={null} />
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className="flex items-center gap-4 px-5 py-4 animate-pulse"
                        style={{ borderBottom: '1px solid var(--border)' }}
                    >
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: '#E5E5E5' }} />
                        <div className="flex-1 flex flex-col gap-1.5">
                            <div className="h-3.5 w-28" style={{ backgroundColor: '#E5E5E5' }} />
                            <div className="h-3 w-48" style={{ backgroundColor: '#F0F0F0' }} />
                        </div>
                        <div className="h-3 w-20" style={{ backgroundColor: '#F0F0F0' }} />
                    </div>
                ))}
            </div>
        );
    }

    // ── Error ──
    if (state === 'error') {
        return (
            <div className="flex flex-col gap-0">
                <Header count={null} />
                <div className="p-6" style={{ backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
                    <p className="text-sm" style={{ color: 'var(--red)' }}>{errorMsg}</p>
                    <button
                        type="button"
                        onClick={load}
                        className="mt-2 px-3 py-1.5 text-xs font-medium"
                        style={{ backgroundColor: '#FFF', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // ── Not connected ──
    if (!wallet.connected) {
        return (
            <div className="flex flex-col gap-0">
                <Header count={null} />
                <div
                    className="px-5 py-10 text-center"
                    style={{ backgroundColor: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}
                >
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Connect your wallet to see your vaults.
                    </p>
                </div>
            </div>
        );
    }

    // ── Empty ──
    if (myVaults.length === 0) {
        return (
            <div className="flex flex-col gap-0">
                <Header count={0} />
                <div
                    className="px-5 py-10 text-center"
                    style={{ backgroundColor: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}
                >
                    <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                        You are not an owner in any vault.
                    </p>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                        Create a vault or ask to be added as an owner.
                    </p>
                    <Link
                        href="/vault/new"
                        className="inline-block px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: 'var(--accent)', color: '#FFF', cursor: 'pointer', transition: 'opacity 100ms ease' }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                        + New Vault
                    </Link>
                </div>
            </div>
        );
    }

    // ── List ──
    return (
        <div className="flex flex-col gap-0">
            <Header count={myVaults.length} />
            {lastTxId && (
                <TransactionAlert
                    txId={lastTxId}
                    onDismiss={() => setLastTxId(null)}
                />
            )}
            <div style={{ border: '1px solid var(--border)', backgroundColor: 'var(--card-bg)' }}>
                {myVaults.map((vault, idx) => {
                    const isOpen = expanded === vault.id;
                    const isLast = idx === myVaults.length - 1;
                    return (
                        <div key={vault.id}>
                            {/* Row */}
                            <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : vault.id)}
                                className="w-full flex items-center gap-4 px-5 py-4 text-left"
                                style={{
                                    backgroundColor: isOpen ? '#FAFAFA' : 'transparent',
                                    borderBottom: isLast && !isOpen ? 'none' : '1px solid var(--border)',
                                    cursor: 'pointer',
                                    transition: 'background-color 80ms ease',
                                }}
                                onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = '#FAFAFA'; }}
                                onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                {/* Icon */}
                                <div
                                    className="w-8 h-8 flex items-center justify-center shrink-0"
                                    style={{
                                        backgroundColor: vault.hasProposal ? '#F0FDF4' : '#F5F5F5',
                                        border: vault.hasProposal ? '1px solid #BBF7D0' : '1px solid var(--border)',
                                    }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={vault.hasProposal ? '#16A34A' : 'var(--text-tertiary)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                            Vault #{vault.id}
                                        </span>
                                        {vault.hasProposal && (
                                            <span
                                                className="px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                                                style={{ backgroundColor: '#F0FDF4', color: 'var(--green)', border: '1px solid #BBF7D0' }}
                                            >
                                                Active Proposal
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                                        {truncAddr(vault.owners[0] ?? '')}
                                        <span style={{ color: 'var(--text-tertiary)', margin: '0 4px' }}>&rarr;</span>
                                        {truncAddr(VAULT_ADDRESS)}
                                    </p>
                                </div>

                                {/* Threshold badge */}
                                <span
                                    className="px-2 py-1 text-[10px] font-mono font-medium shrink-0"
                                    style={{ backgroundColor: '#F5F5F5', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                                >
                                    {vault.threshold}/{vault.ownerCount}
                                </span>

                                {/* Token + Balance */}
                                <div className="text-right shrink-0" style={{ minWidth: '100px' }}>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                        {(() => {
                                            const m = tokenMetas[vault.token];
                                            return m
                                                ? `${formatBal(vault.balance, m.decimals)} ${m.symbol}`
                                                : formatBal(vault.balance);
                                        })()}
                                    </p>
                                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                        {tokenMetas[vault.token]?.name ?? 'loading...'}
                                    </p>
                                </div>

                                {/* Chevron */}
                                <svg
                                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    className="shrink-0"
                                    style={{ transition: 'transform 100ms ease', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </button>

                            {/* Expanded detail */}
                            {isOpen && (
                                <div
                                    className="px-5 py-5"
                                    style={{
                                        backgroundColor: '#FAFAFA',
                                        borderBottom: isLast ? 'none' : '1px solid var(--border)',
                                    }}
                                >
                                    <div
                                        className="flex items-center gap-2 px-3 py-2 mb-4 text-xs font-medium"
                                        style={{
                                            backgroundColor: '#FEF3C7',
                                            border: '1px solid var(--amber)',
                                            color: '#92400E',
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                            <line x1="12" y1="9" x2="12" y2="13" />
                                            <line x1="12" y1="17" x2="12.01" y2="17" />
                                        </svg>
                                        Only one proposal at a time per vault. Creating a new proposal will replace the current one. Multi-proposal support coming soon.
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                                        <DetailCell label="Threshold" value={`${vault.threshold} of ${vault.ownerCount}`} />
                                        <DetailCell
                                            label="Balance"
                                            value={(() => {
                                                const m = tokenMetas[vault.token];
                                                return m
                                                    ? `${formatBal(vault.balance, m.decimals)} ${m.symbol}`
                                                    : formatBal(vault.balance);
                                            })()}
                                        />
                                        <DetailCell label="Total Proposals" value={vault.totalProposals.toString()} />
                                        <DetailCell label="Status" value={vault.hasProposal ? 'Active Proposal' : 'Idle'} />
                                    </div>

                                    {/* Token */}
                                    <div className="mb-4">
                                        <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                            Token
                                        </p>
                                        {tokenMetas[vault.token] ? (
                                            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
                                                {tokenMetas[vault.token].name}
                                                <span className="text-xs font-normal ml-1.5" style={{ color: 'var(--text-tertiary)' }}>
                                                    {tokenMetas[vault.token].symbol}
                                                </span>
                                            </p>
                                        ) : null}
                                        <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                            {vault.token}
                                        </code>
                                    </div>

                                    {/* Owners */}
                                    <div className="mb-4">
                                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                            Owners
                                        </p>
                                        <div className="flex flex-col gap-1.5">
                                            {vault.owners.map((addr, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <span className="text-[10px] font-mono w-4 text-right" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
                                                    <code className="text-xs font-mono break-all" style={{ color: ((walletHex && addr.toLowerCase() === walletHex.toLowerCase()) || (walletIdentityHex && addr.toLowerCase() === walletIdentityHex.toLowerCase())) ? 'var(--accent)' : 'var(--text-secondary)' }}>
                                                        {addr}
                                                    </code>
                                                    {i === 0 && (
                                                        <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5" style={{ backgroundColor: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>
                                                            Creator
                                                        </span>
                                                    )}
                                                    {((walletHex && addr.toLowerCase() === walletHex.toLowerCase()) || (walletIdentityHex && addr.toLowerCase() === walletIdentityHex.toLowerCase())) && (
                                                        <span className="text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5" style={{ backgroundColor: '#F0FDF4', color: 'var(--green)', border: '1px solid #BBF7D0' }}>
                                                            You
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Active Proposal Display */}
                                    {vault.hasProposal && proposals[vault.id] && (
                                        <div
                                            className="mb-4 p-4"
                                            style={{ backgroundColor: '#FFFFFF', border: '1px solid var(--border)' }}
                                        >
                                            <div className="flex items-center gap-2 mb-3">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                    <polyline points="14 2 14 8 20 8" />
                                                    <line x1="16" y1="13" x2="8" y2="13" />
                                                    <line x1="16" y1="17" x2="8" y2="17" />
                                                </svg>
                                                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                                    Active Proposal
                                                </p>
                                                {hasVoted(vault.id, wallet.address, proposals[vault.id]) && (
                                                    <span
                                                        className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                                        style={{ backgroundColor: '#F0FDF4', color: 'var(--green)', border: '1px solid #BBF7D0' }}
                                                    >
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                        You voted
                                                    </span>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 mb-3">
                                                <DetailCell label="Amount" value={formatBal(proposals[vault.id].amount)} />
                                                <DetailCell label="Approvals" value={`${proposals[vault.id].approvals} / ${vault.threshold}`} />
                                            </div>

                                            {/* Progress bar */}
                                            <div className="mb-3">
                                                <div className="h-1.5 w-full" style={{ backgroundColor: '#E5E5E5', borderRadius: 3 }}>
                                                    <div
                                                        className="h-1.5"
                                                        style={{
                                                            width: `${Math.min(100, (proposals[vault.id].approvals / vault.threshold) * 100)}%`,
                                                            backgroundColor: proposals[vault.id].approvals >= vault.threshold ? 'var(--green)' : 'var(--accent)',
                                                            borderRadius: 3,
                                                            transition: 'width 0.3s ease',
                                                        }}
                                                    />
                                                </div>
                                                <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                                                    {proposals[vault.id].approvals >= vault.threshold
                                                        ? 'Threshold reached — ready to execute'
                                                        : `${vault.threshold - proposals[vault.id].approvals} more approval${vault.threshold - proposals[vault.id].approvals !== 1 ? 's' : ''} needed`}
                                                </p>
                                            </div>

                                            <div className="mb-3">
                                                <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                                    Recipient
                                                </p>
                                                <div style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', padding: '10px 12px' }}>
                                                    <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                                        {proposals[vault.id].to}
                                                    </code>
                                                    {getAddressAlias(proposals[vault.id].to) && (
                                                        <>
                                                            <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
                                                            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                                                Same address (bech32)
                                                            </p>
                                                            <code className="text-xs font-mono break-all" style={{ color: 'var(--text-tertiary)' }}>
                                                                {getAddressAlias(proposals[vault.id].to)}
                                                            </code>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Approve button */}
                                            {wallet.connected && !hasVoted(vault.id, wallet.address, proposals[vault.id]) && proposals[vault.id].approvals < vault.threshold && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleApprove(vault.id)}
                                                    disabled={approvingVault === vault.id}
                                                    className="w-full py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors"
                                                    style={{
                                                        backgroundColor: approvingVault === vault.id ? '#E5E5E5' : 'var(--green)',
                                                        color: approvingVault === vault.id ? 'var(--text-tertiary)' : '#FFFFFF',
                                                        border: 'none',
                                                        cursor: approvingVault === vault.id ? 'not-allowed' : 'pointer',
                                                    }}
                                                    onMouseEnter={(e) => { if (approvingVault !== vault.id) e.currentTarget.style.opacity = '0.85'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                                                >
                                                    {approvingVault === vault.id ? 'Approving...' : 'Approve Proposal'}
                                                </button>
                                            )}
                                            {wallet.connected && hasVoted(vault.id, wallet.address, proposals[vault.id]) && proposals[vault.id].approvals < vault.threshold && (
                                                <p className="text-[10px] text-center" style={{ color: 'var(--text-tertiary)' }}>
                                                    Waiting for other owners to approve
                                                </p>
                                            )}

                                            {/* Execute button — shown when threshold is met */}
                                            {wallet.connected && proposals[vault.id].approvals >= vault.threshold && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleExecute(vault.id)}
                                                    disabled={executingVault === vault.id}
                                                    className="w-full py-3 text-xs font-bold uppercase tracking-wider transition-colors"
                                                    style={{
                                                        backgroundColor: executingVault === vault.id ? '#E5E5E5' : '#16A34A',
                                                        color: executingVault === vault.id ? 'var(--text-tertiary)' : '#FFFFFF',
                                                        border: '2px solid #15803D',
                                                        borderRadius: '6px',
                                                        cursor: executingVault === vault.id ? 'not-allowed' : 'pointer',
                                                        boxShadow: executingVault === vault.id ? 'none' : '0 2px 8px rgba(22, 163, 74, 0.3)',
                                                    }}
                                                    onMouseEnter={(e) => { if (executingVault !== vault.id) { e.currentTarget.style.backgroundColor = '#15803D'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                                                    onMouseLeave={(e) => { if (executingVault !== vault.id) { e.currentTarget.style.backgroundColor = '#16A34A'; e.currentTarget.style.transform = 'translateY(0)'; } }}
                                                >
                                                    {executingVault === vault.id ? 'Executing...' : 'Execute Proposal — Send Tokens'}
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {vault.hasProposal && !proposals[vault.id] && (
                                        <div className="mb-4 p-4" style={{ backgroundColor: '#FFFFFF', border: '1px solid var(--border)' }}>
                                            <p className="text-xs animate-pulse" style={{ color: 'var(--text-tertiary)' }}>
                                                Loading proposal details...
                                            </p>
                                        </div>
                                    )}

                                    {/* Note + Actions */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Link
                                                href={`/vault/${vault.id}`}
                                                className="inline-block px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                                style={{
                                                    backgroundColor: 'transparent',
                                                    color: 'var(--text-secondary)',
                                                    border: '1px solid var(--border)',
                                                    cursor: 'pointer',
                                                    transition: 'border-color 100ms ease',
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-dark)'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                                            >
                                                View Vault
                                            </Link>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDepositAmount('');
                                                    setDepositStatus('idle');
                                                    setDepositModal({ vaultId: vault.id, token: vault.token });
                                                }}
                                                className="inline-block px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                                style={{
                                                    backgroundColor: 'transparent',
                                                    color: 'var(--green)',
                                                    border: '1px solid var(--green)',
                                                    cursor: 'pointer',
                                                    transition: 'opacity 100ms ease',
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                                            >
                                                Deposit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setProposeTo('');
                                                    setProposeAmount('');
                                                    setProposeStatus('idle');
                                                    setProposalModal({ vaultId: vault.id, threshold: vault.threshold, hasProposal: vault.hasProposal, token: vault.token, balance: vault.balance });
                                                }}
                                                className="inline-block px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                                style={{
                                                    backgroundColor: 'var(--accent)',
                                                    color: '#FFF',
                                                    border: '1px solid var(--accent)',
                                                    cursor: 'pointer',
                                                    transition: 'opacity 100ms ease',
                                                }}
                                                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                                            >
                                                + New Proposal
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="pb-20" />

            {/* ═══ Proposal Modal ═══ */}
            {proposalModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                    }}
                    onClick={() => { if (proposeStatus === 'idle') setProposalModal(null); }}
                >
                    <div
                        className="flex flex-col gap-4"
                        style={{
                            width: 440,
                            maxWidth: '90vw',
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border)',
                            padding: 24,
                            boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                New Proposal — Vault #{proposalModal.vaultId}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setProposalModal(null)}
                                disabled={proposeStatus !== 'idle'}
                                style={{ cursor: proposeStatus !== 'idle' ? 'not-allowed' : 'pointer', color: 'var(--text-tertiary)' }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        {/* Warning if replacing */}
                        {proposalModal.hasProposal && (
                            <div
                                className="px-3 py-2 text-xs"
                                style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: 'var(--amber)' }}
                            >
                                This vault already has an active proposal. Creating a new one will <strong>replace</strong> it.
                            </div>
                        )}

                        <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                            Propose a token withdrawal. You will automatically count as the first approval.
                            Only one proposal can be active at a time.
                        </p>

                        {/* Mining time notice */}
                        <div
                            className="flex items-start gap-2.5 px-3 py-2.5"
                            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            <p className="text-[11px]" style={{ color: '#3B82F6', lineHeight: 1.5 }}>
                                Proposals take a few minutes to confirm on the blockchain. It will appear in the vault once the transaction is mined.
                            </p>
                        </div>

                        {/* Recipient */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Recipient Address
                            </label>
                            <input
                                type="text"
                                value={proposeTo}
                                onChange={(e) => setProposeTo(e.target.value)}
                                placeholder="tb1p... or 0x..."
                                disabled={proposeStatus !== 'idle'}
                                className="w-full px-3 py-2 text-sm font-mono"
                                style={{
                                    backgroundColor: '#FAFAFA',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text)',
                                    outline: 'none',
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />
                        </div>

                        {/* Vault balance info */}
                        {(() => {
                            const meta = tokenMetas[proposalModal.token];
                            const dec = meta?.decimals ?? 18;
                            const vaultFormatted = Number(proposalModal.balance) / (10 ** dec);
                            const hasBalance = proposalModal.balance > BigInt(0);
                            return (
                                <>
                                    <div className="px-3 py-2.5" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                                        {meta && (
                                            <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                                                {meta.name}
                                                <span className="font-normal ml-1.5" style={{ color: 'var(--text-tertiary)' }}>{meta.symbol}</span>
                                            </p>
                                        )}
                                        <div className="flex items-center justify-between mt-1.5">
                                            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                                Vault balance
                                            </span>
                                            <span className="text-sm font-semibold font-mono" style={{ color: hasBalance ? 'var(--text)' : 'var(--red)' }}>
                                                {vaultFormatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                                {meta && (
                                                    <span className="font-normal text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>{meta.symbol}</span>
                                                )}
                                            </span>
                                        </div>
                                    </div>

                                    {!hasBalance && (
                                        <div className="px-3 py-2 text-xs" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: 'var(--red)' }}>
                                            This vault has no token balance. Deposit tokens first before creating a proposal.
                                        </div>
                                    )}

                                    {/* Amount */}
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                                Amount
                                            </label>
                                            {hasBalance && proposeAmount && (
                                                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                                    {((Number(proposeAmount) / vaultFormatted) * 100).toFixed(0)}% of vault
                                                </span>
                                            )}
                                        </div>
                                        <input
                                            type="text"
                                            value={proposeAmount}
                                            onChange={(e) => setProposeAmount(e.target.value)}
                                            placeholder="e.g. 50"
                                            disabled={proposeStatus !== 'idle' || !hasBalance}
                                            className="w-full px-3 py-2 text-sm font-mono"
                                            style={{
                                                backgroundColor: '#FAFAFA',
                                                border: '1px solid var(--border)',
                                                color: 'var(--text)',
                                                outline: 'none',
                                            }}
                                            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                                        />

                                        {/* Range slider + percentage buttons */}
                                        {hasBalance && (
                                            <>
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    value={
                                                        proposeAmount && vaultFormatted > 0
                                                            ? Math.min(Math.round((Number(proposeAmount) / vaultFormatted) * 100), 100)
                                                            : 0
                                                    }
                                                    onChange={(e) => {
                                                        const pct = Number(e.target.value);
                                                        if (pct === 100) {
                                                            setProposeAmount(vaultFormatted.toString());
                                                        } else {
                                                            const val = (vaultFormatted * pct) / 100;
                                                            setProposeAmount(val > 0 ? val.toFixed(dec > 4 ? 4 : dec) : '');
                                                        }
                                                    }}
                                                    disabled={proposeStatus !== 'idle'}
                                                    style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                                                />
                                                <div className="flex gap-2">
                                                    {[25, 50, 75, 100].map((pct) => (
                                                        <button
                                                            key={pct}
                                                            type="button"
                                                            onClick={() => {
                                                                if (pct === 100) {
                                                                    setProposeAmount(vaultFormatted.toString());
                                                                } else {
                                                                    const val = (vaultFormatted * pct) / 100;
                                                                    setProposeAmount(val.toFixed(dec > 4 ? 4 : dec));
                                                                }
                                                            }}
                                                            disabled={proposeStatus !== 'idle'}
                                                            className="flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                                                            style={{
                                                                backgroundColor:
                                                                    proposeAmount && Math.abs(Number(proposeAmount) - (vaultFormatted * pct) / 100) < 0.0001
                                                                        ? 'var(--cyan-light)'
                                                                        : 'transparent',
                                                                color:
                                                                    proposeAmount && Math.abs(Number(proposeAmount) - (vaultFormatted * pct) / 100) < 0.0001
                                                                        ? 'var(--cyan-mid)'
                                                                        : 'var(--text-secondary)',
                                                                border: '1px solid var(--border)',
                                                                cursor: proposeStatus !== 'idle' ? 'not-allowed' : 'pointer',
                                                            }}
                                                        >
                                                            {pct === 100 ? 'Max' : `${pct}%`}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </>
                            );
                        })()}

                        {/* Buttons */}
                        <div className="flex gap-3 mt-1">
                            <button
                                type="button"
                                onClick={() => setProposalModal(null)}
                                disabled={proposeStatus !== 'idle'}
                                className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider"
                                style={{
                                    backgroundColor: 'transparent',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border)',
                                    cursor: proposeStatus !== 'idle' ? 'not-allowed' : 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handlePropose}
                                disabled={proposeStatus !== 'idle'}
                                className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider"
                                style={{
                                    backgroundColor: proposeStatus !== 'idle' ? '#E5E5E5' : 'var(--accent)',
                                    color: proposeStatus !== 'idle' ? 'var(--text-tertiary)' : '#FFF',
                                    border: '1px solid transparent',
                                    cursor: proposeStatus !== 'idle' ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {proposeStatus === 'simulating' ? 'Simulating...'
                                    : proposeStatus === 'sending' ? 'Confirm in wallet...'
                                    : 'Create Proposal'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Deposit Modal ═══ */}
            {depositModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                    }}
                    onClick={() => { if (depositStatus === 'idle') setDepositModal(null); }}
                >
                    <div
                        className="flex flex-col gap-4"
                        style={{
                            width: 400,
                            maxWidth: '90vw',
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border)',
                            padding: 24,
                            boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                Deposit — Vault #{depositModal.vaultId}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setDepositModal(null)}
                                disabled={depositStatus !== 'idle'}
                                style={{ cursor: depositStatus !== 'idle' ? 'not-allowed' : 'pointer', color: 'var(--text-tertiary)' }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                            Send tokens into this vault. This is a two-step process: first you approve the token allowance, then the deposit is executed. You will confirm two transactions in OPWallet.
                        </p>

                        {/* Mining time notice */}
                        <div
                            className="flex items-start gap-2.5 px-3 py-2.5"
                            style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            <p className="text-[11px]" style={{ color: '#3B82F6', lineHeight: 1.5 }}>
                                Deposits take a few minutes to confirm on the blockchain. The vault balance will update once the transaction is mined.
                            </p>
                        </div>

                        {/* Token info + wallet balance */}
                        <div className="px-3 py-2.5" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                            {tokenMetas[depositModal.token] && (
                                <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                                    {tokenMetas[depositModal.token].name}
                                    <span className="font-normal ml-1.5" style={{ color: 'var(--text-tertiary)' }}>
                                        {tokenMetas[depositModal.token].symbol}
                                    </span>
                                </p>
                            )}
                            <div className="flex items-center justify-between mt-1.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                    Your balance
                                </span>
                                {walletBalanceLoading ? (
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading...</span>
                                ) : walletBalanceError ? (
                                    <span className="text-xs" style={{ color: 'var(--amber)' }}>Failed to load</span>
                                ) : walletBalance ? (
                                    <span className="text-sm font-semibold font-mono" style={{ color: walletBalance.raw === BigInt(0) ? 'var(--red)' : 'var(--text)' }}>
                                        {walletBalance.formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                        {tokenMetas[depositModal.token] && (
                                            <span className="font-normal text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>
                                                {tokenMetas[depositModal.token].symbol}
                                            </span>
                                        )}
                                    </span>
                                ) : (
                                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>—</span>
                                )}
                            </div>
                        </div>

                        {/* Balance fetch error */}
                        {walletBalanceError && (
                            <div
                                className="px-3 py-2 text-xs flex items-center justify-between"
                                style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: 'var(--amber)' }}
                            >
                                <span>Could not read wallet balance. Check console for details.</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Trigger re-fetch by toggling the modal state
                                        const m = depositModal;
                                        setDepositModal(null);
                                        setTimeout(() => setDepositModal(m), 50);
                                    }}
                                    className="text-[10px] font-semibold uppercase underline ml-2"
                                    style={{ color: 'var(--amber)' }}
                                >
                                    Retry
                                </button>
                            </div>
                        )}

                        {/* Zero balance warning */}
                        {!walletBalanceLoading && !walletBalanceError && walletBalance && walletBalance.raw === BigInt(0) && (
                            <div
                                className="px-3 py-2 text-xs"
                                style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: 'var(--red)' }}
                            >
                                You don&#39;t have any of this token in your wallet. Get some tokens first before depositing.
                            </div>
                        )}

                        {/* Amount */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                    Amount
                                </label>
                                {walletBalance && walletBalance.raw > BigInt(0) && depositAmount && (
                                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                        {((Number(depositAmount) / walletBalance.formatted) * 100).toFixed(0)}% of balance
                                    </span>
                                )}
                            </div>
                            <input
                                type="text"
                                value={depositAmount}
                                onChange={(e) => setDepositAmount(e.target.value)}
                                placeholder="e.g. 100"
                                disabled={depositStatus !== 'idle' || (!walletBalanceLoading && walletBalance?.raw === BigInt(0))}
                                className="w-full px-3 py-2 text-sm font-mono"
                                style={{
                                    backgroundColor: '#FAFAFA',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text)',
                                    outline: 'none',
                                }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />

                            {/* Range slider */}
                            {walletBalance && walletBalance.raw > BigInt(0) && (
                                <>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={
                                            depositAmount && walletBalance.formatted > 0
                                                ? Math.min(Math.round((Number(depositAmount) / walletBalance.formatted) * 100), 100)
                                                : 0
                                        }
                                        onChange={(e) => {
                                            const pct = Number(e.target.value);
                                            if (pct === 100) {
                                                setDepositAmount(walletBalance.formatted.toString());
                                            } else {
                                                const val = (walletBalance.formatted * pct) / 100;
                                                setDepositAmount(val > 0 ? val.toFixed(walletBalance.decimals > 4 ? 4 : walletBalance.decimals) : '');
                                            }
                                        }}
                                        disabled={depositStatus !== 'idle'}
                                        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                                    />

                                    {/* Percentage buttons */}
                                    <div className="flex gap-2">
                                        {[25, 50, 75, 100].map((pct) => (
                                            <button
                                                key={pct}
                                                type="button"
                                                onClick={() => {
                                                    if (pct === 100) {
                                                        setDepositAmount(walletBalance.formatted.toString());
                                                    } else {
                                                        const val = (walletBalance.formatted * pct) / 100;
                                                        setDepositAmount(val.toFixed(walletBalance.decimals > 4 ? 4 : walletBalance.decimals));
                                                    }
                                                }}
                                                disabled={depositStatus !== 'idle'}
                                                className="flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                                                style={{
                                                    backgroundColor:
                                                        depositAmount && Math.abs(Number(depositAmount) - (walletBalance.formatted * pct) / 100) < 0.0001
                                                            ? 'var(--cyan-light)'
                                                            : 'transparent',
                                                    color:
                                                        depositAmount && Math.abs(Number(depositAmount) - (walletBalance.formatted * pct) / 100) < 0.0001
                                                            ? 'var(--cyan-mid)'
                                                            : 'var(--text-secondary)',
                                                    border: '1px solid var(--border)',
                                                    cursor: depositStatus !== 'idle' ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {pct === 100 ? 'Max' : `${pct}%`}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-3 mt-1">
                            <button
                                type="button"
                                onClick={() => setDepositModal(null)}
                                disabled={depositStatus !== 'idle'}
                                className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider"
                                style={{
                                    backgroundColor: 'transparent',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border)',
                                    cursor: depositStatus !== 'idle' ? 'not-allowed' : 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeposit}
                                disabled={depositStatus !== 'idle' || !walletBalance || walletBalance.raw === BigInt(0)}
                                className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider"
                                style={{
                                    backgroundColor:
                                        depositStatus !== 'idle' || !walletBalance || walletBalance.raw === BigInt(0)
                                            ? '#E5E5E5'
                                            : 'var(--green)',
                                    color:
                                        depositStatus !== 'idle' || !walletBalance || walletBalance.raw === BigInt(0)
                                            ? 'var(--text-tertiary)'
                                            : '#FFF',
                                    border: '1px solid transparent',
                                    cursor:
                                        depositStatus !== 'idle' || !walletBalance || walletBalance.raw === BigInt(0)
                                            ? 'not-allowed'
                                            : 'pointer',
                                }}
                            >
                                {depositStatus === 'simulating' ? 'Simulating...'
                                    : depositStatus === 'sending' ? 'Confirm in wallet...'
                                    : !walletBalance || walletBalance.raw === BigInt(0) ? 'No balance'
                                    : 'Deposit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sub-components ──

function Header({ count }: { count: number | null }) {
    return (
        <section className="py-16">
            <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                My Vaults
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {count === null
                    ? 'Loading your vaults...'
                    : count === 0
                        ? 'Vaults where you are a participant.'
                        : `${count} vault${count !== 1 ? 's' : ''} where you are a participant.`}
            </p>
        </section>
    );
}

function DetailCell({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-3" style={{ backgroundColor: '#FFFFFF', border: '1px solid var(--border)' }}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                {label}
            </p>
            <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text)' }}>{value}</p>
        </div>
    );
}
