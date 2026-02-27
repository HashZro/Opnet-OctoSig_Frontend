'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useToast } from '@/contexts/ToastContext';
import { VAULT_ADDRESS, VAULT_ABI, OCT_ADDRESS_HEX, RPC_URL } from '@/lib/contracts';

const MIN_OWNERS = 2;
const MAX_OWNERS = 10;
const MIN_THRESHOLD = 2;

export function NewVaultClient() {
    const { wallet } = useWallet();
    const { toast } = useToast();

    const [tokenAddress, setTokenAddress] = useState('opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle');
    const [owners, setOwners] = useState<string[]>(['', 'opt1pzmkt4gh5x6tjtt0shregpyedl70z05a7s3hmsrru7qn5dnwhr8us2u9vvq']);
    const [threshold, setThreshold] = useState(2);
    const [status, setStatus] = useState<'idle' | 'simulating' | 'sending' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Contract public info
    const [vaultCount, setVaultCount] = useState<string | null>(null);
    const [deployTx, setDeployTx] = useState<string | null>(null);
    const [deployerAddr, setDeployerAddr] = useState<string | null>(null);
    const [deployBlock, setDeployBlock] = useState<string | null>(null);
    const [bytecodeSize, setBytecodeSize] = useState<string | null>(null);
    const [contractInfoError, setContractInfoError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { getContract, JSONRpcProvider } = await import('opnet');
                const { networks } = await import('@btc-vision/bitcoin');

                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);

                // Fetch vault count via contract method call
                const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
                const countResult = await (contract as any).getVaultCount();
                if (!cancelled) {
                    const raw = countResult?.properties?.count ?? countResult?.decoded?.[0] ?? null;
                    setVaultCount(raw !== null ? raw.toString() : '0');
                }

                // Fetch contract metadata from chain
                const code: any = await provider.getCode(VAULT_ADDRESS);
                if (!cancelled && code) {
                    setDeployTx(code.deployedTransactionId ?? null);
                    setBytecodeSize(code.bytecode?.length ? `${(code.bytecode.length / 1024).toFixed(1)} KB` : null);

                    if (code.deployerAddress) {
                        const hex = Buffer.from(code.deployerAddress).toString('hex');
                        setDeployerAddr(`0x${hex}`);
                    }

                    // Get deploy block from transaction
                    if (code.deployedTransactionId) {
                        try {
                            const tx = await provider.getTransaction(code.deployedTransactionId);
                            if (!cancelled && tx?.blockNumber) {
                                setDeployBlock(tx.blockNumber.toString());
                            }
                        } catch { /* non-critical */ }
                    }
                }
            } catch (err: any) {
                console.error('Failed to fetch contract info:', err);
                if (!cancelled) setContractInfoError(err?.message ?? 'Failed to load');
            }
        })();
        return () => { cancelled = true; };
    }, []);
    const [txId, setTxId] = useState<string | null>(null);

    // Auto-populate first owner with connected wallet address
    const didAutoPopulate = useRef(false);
    useEffect(() => {
        if (wallet.address && !didAutoPopulate.current) {
            didAutoPopulate.current = true;
            setOwners((prev) => {
                if (!prev[0]) return [wallet.address!, ...prev.slice(1)];
                return prev;
            });
        }
    }, [wallet.address]);

    const addOwner = useCallback(() => {
        if (owners.length < MAX_OWNERS) setOwners((prev) => [...prev, '']);
    }, [owners.length]);

    const removeOwner = useCallback(
        (index: number) => {
            if (owners.length <= MIN_OWNERS) return;
            setOwners((prev) => prev.filter((_, i) => i !== index));
            setThreshold((prev) => Math.min(prev, owners.length - 1));
        },
        [owners.length],
    );

    const updateOwner = useCallback((index: number, value: string) => {
        setOwners((prev) => prev.map((o, i) => (i === index ? value : o)));
    }, []);

    const filledOwners = owners.map((o) => o.trim()).filter(Boolean);
    const maxThreshold = filledOwners.length || MIN_OWNERS;
    const busy = status === 'simulating' || status === 'sending';

    const handleCreate = useCallback(async () => {
        console.log('=== CREATE VAULT START ===');
        console.log('Wallet:', { connected: wallet.connected, address: wallet.address });
        console.log('Token address:', tokenAddress);
        console.log('Owners:', owners);
        console.log('Threshold:', threshold);

        if (!wallet.connected || !wallet.address) {
            toast.warning('Connect your wallet first.');
            return;
        }

        // --- Validate ---
        if (!tokenAddress.trim()) {
            toast.error('Token address is required.');
            return;
        }

        const trimmed = owners.map((o) => o.trim()).filter(Boolean);
        console.log('Trimmed owners:', trimmed);
        if (trimmed.length < MIN_OWNERS) {
            toast.error(`At least ${MIN_OWNERS} owner addresses required.`);
            return;
        }
        const seen = new Set<string>();
        for (const addr of trimmed) {
            if (seen.has(addr)) {
                toast.error('Duplicate owner address detected.');
                return;
            }
            seen.add(addr);
        }
        if (threshold < MIN_THRESHOLD || threshold > trimmed.length) {
            toast.error(`Threshold must be between ${MIN_THRESHOLD} and ${trimmed.length}.`);
            return;
        }

        // --- Build calldata & simulate ---
        setStatus('simulating');
        setErrorMsg(null);
        setTxId(null);

        try {
            console.log('[1] Importing SDK modules...');
            const { getContract, JSONRpcProvider } = await import('opnet');
            const { networks, toOutputScript } = await import('@btc-vision/bitcoin');
            const { BinaryWriter, Address } = await import('@btc-vision/transaction');
            console.log('[1] SDK modules imported OK');

            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            console.log('[2] Provider created');

            // ── Address conversion helper ──
            // Supports all formats:
            //   0x... hex (32-byte internal address) → Address.fromString()
            //   opt1p... (OPNet taproot wallet, 32 bytes) → bech32 decode
            //   opt1s.../opt1q... (OPNet contract, 20-21 bytes) → resolve via getCode()
            //   tb1.../bcrt1... (Bitcoin bech32) → toOutputScript + Address.wrap()
            const toAddr = async (addrStr: string, label: string) => {
                console.log(`[toAddr] ${label}: input="${addrStr}" (length=${addrStr.length})`);

                // Hex format: 0x + 64 hex chars = 32 bytes
                if (addrStr.startsWith('0x') || addrStr.startsWith('0X')) {
                    const addr = Address.fromString(addrStr);
                    console.log(`[toAddr] ${label}: hex → OK`);
                    return addr;
                }

                const prefix = addrStr.split('1')[0];
                console.log(`[toAddr] ${label}: bech32 prefix="${prefix}"`);

                // OPNet bech32 addresses (opt1p..., opt1s..., opt1q...)
                if (prefix === 'opt') {
                    // Try bech32 decode first using OPNet network config
                    const opnetNet = { ...networks.testnet, bech32: networks.testnet.bech32Opnet! };
                    try {
                        const script = toOutputScript(addrStr, opnetNet);
                        const programBytes = script.subarray(2);
                        console.log(`[toAddr] ${label}: opt bech32 decoded, witness program=${programBytes.length} bytes`);

                        if (programBytes.length === 32) {
                            // 32-byte witness program (taproot / opt1p...) — use directly
                            const addr = Address.wrap(programBytes);
                            console.log(`[toAddr] ${label}: 32-byte Address.wrap OK`);
                            return addr;
                        }
                    } catch (e) {
                        console.log(`[toAddr] ${label}: bech32 decode failed, trying getCode...`);
                    }

                    // Non-32-byte (contract address) — resolve via getCode()
                    console.log(`[toAddr] ${label}: resolving contract via getCode()...`);
                    const code: any = await provider.getCode(addrStr);
                    if (!code || !code.contractPublicKey) {
                        throw new Error(
                            `"${label}": Could not resolve opt address. ` +
                            `Contract may not exist on chain. Try using the 0x hex format from OPScan.`,
                        );
                    }
                    const hexKey = `0x${Buffer.from(code.contractPublicKey).toString('hex')}`;
                    console.log(`[toAddr] ${label}: resolved contract to ${hexKey}`);
                    const addr = Address.fromString(hexKey);
                    return addr;
                }

                // Bitcoin bech32 (tb1.../bcrt1...)
                const net =
                    prefix === networks.regtest.bech32 ? networks.regtest : networks.testnet;
                const script = toOutputScript(addrStr, net);
                const programBytes = script.subarray(2);
                console.log(`[toAddr] ${label}: witness program=${programBytes.length} bytes`);

                if (programBytes.length !== 32 && programBytes.length !== 20) {
                    throw new Error(
                        `"${label}" decoded to ${programBytes.length} bytes. ` +
                        `Try using a tb1p... or 0x hex address instead.`,
                    );
                }

                const addr = Address.wrap(programBytes);
                console.log(`[toAddr] ${label}: Address.wrap OK`);
                return addr;
            };

            // ── Get selector from ABI ──
            console.log('[3] Getting contract instance for selector...');
            const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
            console.log('[3] Contract address (raw):', (contract as any).address);

            console.log('[4] Encoding selector for createVault...');
            const selectorBuf: Uint8Array = (contract as any).encodeCalldata('createVault', []);
            console.log(
                `[4] Selector: length=${selectorBuf.length}, ` +
                `hex=${Array.from(selectorBuf).map((b: number) => b.toString(16).padStart(2, '0')).join('')}`,
            );

            // ── Encode params manually ──
            console.log('[5] Converting token address...');
            const tokenAddr = await toAddr(tokenAddress.trim(), 'token');

            console.log('[6] Converting owner addresses...');
            const ownerAddrs = [];
            for (let i = 0; i < trimmed.length; i++) {
                const addr = await toAddr(trimmed[i], `owner[${i}]`);
                ownerAddrs.push(addr);
            }

            console.log('[7] Building calldata params...');
            const params = new BinaryWriter();
            params.writeAddress(tokenAddr);
            console.log('[7a] Wrote token address');

            params.writeU8(trimmed.length);
            console.log(`[7b] Wrote ownerCount=${trimmed.length}`);

            for (let i = 0; i < ownerAddrs.length; i++) {
                params.writeAddress(ownerAddrs[i]);
                console.log(`[7c] Wrote owner[${i}]`);
            }

            params.writeU8(threshold);
            console.log(`[7d] Wrote threshold=${threshold}`);

            const paramsBuf = params.getBuffer();
            console.log(`[7] Params buffer: length=${paramsBuf.length}`);

            // ── Concatenate selector + params ──
            const calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
            calldata.set(selectorBuf, 0);
            calldata.set(paramsBuf, selectorBuf.length);
            const calldataHex = '0x' + Array.from(calldata).map((b: number) => b.toString(16).padStart(2, '0')).join('');
            console.log(`[8] Full calldata: length=${calldata.length}, hex=${calldataHex.slice(0, 20)}...`);

            // ── Simulate ──
            console.log('[9] Calling provider.call() to simulate...');
            const sim = await provider.call(VAULT_ADDRESS, calldataHex as any);
            console.log('[9] Simulation result:', sim);
            console.log('[9] Result type:', typeof sim);
            console.log('[9] Has error?', sim && 'error' in sim);

            if (sim && 'error' in sim) {
                const errMsg = (sim as any).error || 'Simulation failed';
                console.error('[9] Simulation error:', errMsg);
                throw new Error(errMsg);
            }

            // Bind contract address, calldata, and sender on CallResult
            // (provider.call() doesn't set these — the Contract class normally does)
            const vaultAddr = Address.fromString(VAULT_ADDRESS);
            const senderAddr = await toAddr(wallet.address!, 'sender');
            (sim as any).setTo(VAULT_ADDRESS, vaultAddr);
            (sim as any).setCalldata(Buffer.from(calldata));
            (sim as any).setFromAddress(senderAddr);
            console.log('[9b] CallResult fields bound (to, calldata, fromAddress)');

            // ── Send transaction ──
            setStatus('sending');
            console.log('[10] Sending transaction (OPWallet will prompt)...');

            const receipt = await (sim as any).sendTransaction({
                signer: null,
                mldsaSigner: null,
                refundTo: wallet.address,
                maximumAllowedSatToSpend: BigInt(500_000),
                feeRate: 10,
                network: networks.testnet,
                minGas: BigInt(500_000),
            });
            console.log('[10] Transaction receipt:', receipt);

            let id: string | null = null;
            if (receipt && typeof receipt === 'object') {
                if ('transactionId' in receipt) {
                    id = (receipt as any).transactionId;
                } else if (Array.isArray(receipt) && receipt.length > 0) {
                    id = receipt[0];
                }
            }

            setStatus('success');
            setTxId(id);
            console.log('=== CREATE VAULT SUCCESS ===', { txId: id });
            toast.success('Vault created successfully!');
        } catch (err: any) {
            console.error('=== CREATE VAULT FAILED ===', err);
            console.error('Error name:', err?.name);
            console.error('Error message:', err?.message);
            console.error('Error stack:', err?.stack);
            setStatus('error');
            setErrorMsg(err?.message ?? 'Unknown error');
            toast.error(`Failed: ${err?.message ?? 'Unknown error'}`);
        }
    }, [wallet, tokenAddress, owners, threshold, toast]);

    return (
        <>
            {/* Hero */}
            <section className="py-16">
                <h2
                    className="text-3xl font-semibold tracking-tight"
                    style={{ color: 'var(--text)' }}
                >
                    New Vault
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Create a multisig vault for an OP-20 token. Requires{' '}
                    <strong>2 – 10 owners</strong> and a <strong>threshold of 2+</strong>{' '}
                    approvals.
                </p>
            </section>

            {/* Connect prompt */}
            {!wallet.connected && (
                <div
                    className="mb-8 px-4 py-3 text-sm"
                    style={{
                        backgroundColor: '#FFFBEB',
                        border: '1px solid #FDE68A',
                        color: 'var(--amber)',
                    }}
                >
                    Connect your OPWallet to create a vault.
                </div>
            )}

            {/* Contract Info */}
            <div
                className="mb-8 p-6"
                style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
            >
                <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-4"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    Contract Info
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Total Vaults
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                            {contractInfoError
                                ? <span style={{ color: 'var(--red)' }}>Error</span>
                                : vaultCount ?? '...'}
                        </p>
                    </div>
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Min Owners
                        </p>
                        <p className="mt-1 text-sm font-semibold">2</p>
                    </div>
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Max Owners
                        </p>
                        <p className="mt-1 text-sm font-semibold">10</p>
                    </div>
                    <div className="p-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)' }}>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Deploy Block
                        </p>
                        <p className="mt-1 text-sm font-semibold">{deployBlock ?? '...'}</p>
                    </div>
                </div>

                <div className="grid gap-3 mb-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                            Contract Address
                        </p>
                        <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                            {VAULT_ADDRESS}
                        </code>
                    </div>
                    {deployerAddr && (
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Deployed By
                            </p>
                            <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                {deployerAddr}
                            </code>
                        </div>
                    )}
                    {deployTx && (
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Deploy Transaction
                            </p>
                            <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                {deployTx}
                            </code>
                        </div>
                    )}
                    {bytecodeSize && (
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Bytecode Size
                            </p>
                            <code className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                                {bytecodeSize}
                            </code>
                        </div>
                    )}
                </div>

                {contractInfoError && (
                    <p className="text-xs" style={{ color: 'var(--red)' }}>
                        {contractInfoError}
                    </p>
                )}
            </div>

            {/* Form */}
            <div
                className="mb-16 p-6 flex flex-col gap-6"
                style={{
                    backgroundColor: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                }}
            >
                {/* Token address */}
                <div className="flex flex-col gap-2">
                    <label
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        Token Address
                    </label>
                    <input
                        type="text"
                        value={tokenAddress}
                        onChange={(e) => setTokenAddress(e.target.value)}
                        placeholder="0x... (32-byte hex from OPScan)"
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
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        The OP-20 token this vault will hold. Accepts{' '}
                        <strong>0x hex</strong>, <strong>opt1...</strong>, or{' '}
                        <strong>tb1...</strong> addresses. Defaults to OCT.
                    </p>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* Owners */}
                <div className="flex flex-col gap-3">
                    <label
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        Vault Owners ({filledOwners.length} of {owners.length})
                    </label>

                    {owners.map((owner, i) => (
                        <div key={i} className="flex gap-2 items-center">
                            <span
                                className="text-[11px] font-mono w-5 text-right shrink-0"
                                style={{ color: 'var(--text-tertiary)' }}
                            >
                                {i + 1}
                            </span>
                            <input
                                type="text"
                                value={owner}
                                onChange={(e) => updateOwner(i, e.target.value)}
                                placeholder="tb1p... or 0x... (wallet address)"
                                className="flex-1 px-3 py-2 text-sm font-mono"
                                style={{
                                    backgroundColor: '#FAFAFA',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text)',
                                    outline: 'none',
                                }}
                                onFocus={(e) =>
                                    (e.currentTarget.style.borderColor = 'var(--accent)')
                                }
                                onBlur={(e) =>
                                    (e.currentTarget.style.borderColor = 'var(--border)')
                                }
                            />
                            {owners.length > MIN_OWNERS && (
                                <button
                                    type="button"
                                    onClick={() => removeOwner(i)}
                                    className="flex items-center justify-center shrink-0 transition-colors"
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        backgroundColor: '#FEF2F2',
                                        border: '1px solid #FECACA',
                                        color: 'var(--red)',
                                        cursor: 'pointer',
                                    }}
                                    title="Remove owner"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    ))}

                    {owners.length < MAX_OWNERS && (
                        <button
                            type="button"
                            onClick={addOwner}
                            className="self-start px-3 py-1.5 text-xs font-medium transition-colors"
                            style={{
                                backgroundColor: '#F5F5F5',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                            }}
                        >
                            + Add Owner
                        </button>
                    )}

                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        Min {MIN_OWNERS}, max {MAX_OWNERS} owners. Accepts{' '}
                        <strong>opt1p...</strong> wallet addresses, <strong>tb1p...</strong>,{' '}
                        or <strong>0x hex</strong> format.
                    </p>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* Threshold */}
                <div className="flex flex-col gap-2">
                    <label
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        Approval Threshold
                    </label>
                    <div className="flex items-center gap-3">
                        <select
                            value={threshold}
                            onChange={(e) => setThreshold(Number(e.target.value))}
                            className="px-3 py-2 text-sm font-mono"
                            style={{
                                backgroundColor: '#FAFAFA',
                                border: '1px solid var(--border)',
                                color: 'var(--text)',
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            {Array.from(
                                { length: Math.max(0, maxThreshold - MIN_THRESHOLD + 1) },
                                (_, i) => MIN_THRESHOLD + i,
                            ).map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            of {filledOwners.length || '—'} owners must approve each proposal
                        </span>
                    </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* Submit */}
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!wallet.connected || busy}
                    className="w-full py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                    style={{
                        backgroundColor:
                            !wallet.connected || busy ? '#E5E5E5' : 'var(--accent)',
                        color: !wallet.connected || busy ? 'var(--text-tertiary)' : '#FFFFFF',
                        border: '1px solid transparent',
                        cursor: !wallet.connected || busy ? 'not-allowed' : 'pointer',
                    }}
                >
                    {status === 'simulating'
                        ? 'Simulating...'
                        : status === 'sending'
                          ? 'Confirm in OPWallet...'
                          : 'Create Vault'}
                </button>
            </div>

            {/* Success card */}
            {status === 'success' && (
                <div
                    className="mb-16 p-6"
                    style={{
                        backgroundColor: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                    }}
                >
                    <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-2"
                        style={{ color: 'var(--green)' }}
                    >
                        Vault Created
                    </h3>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Your multisig vault has been submitted to the network.
                    </p>
                    {txId && (
                        <p className="mt-2 text-sm font-mono break-all" style={{ color: 'var(--text)' }}>
                            TX: {txId}
                        </p>
                    )}
                </div>
            )}

            {/* Error card */}
            {status === 'error' && errorMsg && (
                <div
                    className="mb-16 p-6"
                    style={{
                        backgroundColor: '#FEF2F2',
                        border: '1px solid #FECACA',
                    }}
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
                        onClick={() => {
                            setStatus('idle');
                            setErrorMsg(null);
                        }}
                        className="mt-3 px-3 py-1.5 text-xs font-medium"
                        style={{
                            backgroundColor: '#FFFFFF',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        Dismiss
                    </button>
                </div>
            )}
        </>
    );
}
