'use client';

import { useState, useEffect, useCallback } from 'react';
import { MINE_COST_SATS, MINE_REWARD_TOKENS, MINE_ABI, RPC_URL } from '@/lib/contracts';
import { useToast } from '@/contexts/ToastContext';

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

/**
 * Pick the right network object for decoding a wallet address.
 * OPWallet returns bcrt1... (regtest HRP) on OPNet testnet,
 * so we must match the bech32 prefix to avoid "invalid prefix" errors.
 */
async function getNetworkForAddress(address: string) {
    const { networks } = await import('@btc-vision/bitcoin');
    const prefix = address.split('1')[0]; // e.g. "bcrt", "tb", "bc"

    console.log(`[getNetworkForAddress] address prefix: "${prefix}"`);
    console.log(`[getNetworkForAddress] networks.testnet.bech32 = "${networks.testnet.bech32}"`);
    console.log(`[getNetworkForAddress] networks.regtest.bech32 = "${networks.regtest.bech32}"`);

    if (prefix === networks.regtest.bech32) {
        console.log(`[getNetworkForAddress] -> using networks.regtest`);
        return networks.regtest;
    }
    if (prefix === networks.testnet.bech32) {
        console.log(`[getNetworkForAddress] -> using networks.testnet`);
        return networks.testnet;
    }
    // Fallback: try testnet (the deploy script used it)
    console.warn(`[getNetworkForAddress] unknown prefix "${prefix}", falling back to networks.testnet`);
    return networks.testnet;
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
            console.log(`[${symbol}] restored pending tx from localStorage: ${stored}`);
            setTxId(stored);
            setStatus('success');
        }
    }, [contractAddress, wallet.address]);

    // ── fetchBalance ────────────────────────────────────────────────────
    const fetchBalance = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            console.log(`[${symbol}] fetchBalance: skipped — wallet not connected`);
            setBalance(null);
            return;
        }

        console.log(`[${symbol}] fetchBalance: starting for wallet ${wallet.address}`);
        console.log(`[${symbol}] fetchBalance: contract address = ${contractAddress}`);
        setBalanceLoading(true);

        try {
            // Step 1: import modules
            console.log(`[${symbol}] fetchBalance: importing opnet + bitcoin modules...`);
            const { JSONRpcProvider, getContract, OP_20_ABI } = await import('opnet');
            const { Address } = await import('@btc-vision/transaction');
            const { toOutputScript, networks } = await import('@btc-vision/bitcoin');
            console.log(`[${symbol}] fetchBalance: modules imported OK`);

            // Step 2: create provider
            console.log(`[${symbol}] fetchBalance: creating JSONRpcProvider("${RPC_URL}", networks.testnet)...`);
            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            console.log(`[${symbol}] fetchBalance: provider created OK`);

            // Step 3: get contract instance
            console.log(`[${symbol}] fetchBalance: calling getContract("${contractAddress}", OP_20_ABI, provider, networks.testnet)...`);
            const contract = getContract(
                contractAddress,
                OP_20_ABI as any,
                provider,
                networks.testnet,
            );
            console.log(`[${symbol}] fetchBalance: contract instance created OK`);

            // Step 4: parse wallet address to output script
            const addrNetwork = await getNetworkForAddress(wallet.address!);
            console.log(`[${symbol}] fetchBalance: parsing wallet address with bech32="${addrNetwork.bech32}"...`);

            let script: Uint8Array;
            try {
                script = toOutputScript(wallet.address!, addrNetwork);
            } catch (addrErr: any) {
                console.error(`[${symbol}] fetchBalance: toOutputScript FAILED for "${wallet.address}" with bech32="${addrNetwork.bech32}":`, addrErr);
                throw new Error(`Address decode failed (prefix="${wallet.address!.split('1')[0]}", network bech32="${addrNetwork.bech32}"): ${addrErr.message}`);
            }
            console.log(`[${symbol}] fetchBalance: output script (${script.length} bytes): ${Array.from(script).map(b => b.toString(16).padStart(2, '0')).join('')}`);

            // Step 5: extract witness program (skip version byte + push length)
            const ownerAddress = Address.wrap(script.subarray(2));
            console.log(`[${symbol}] fetchBalance: Address.wrap OK (${script.length - 2} byte witness program)`);

            // Step 6: call balanceOf + decimals in parallel
            console.log(`[${symbol}] fetchBalance: calling balanceOf + decimals...`);
            const [balResult, decResult] = await Promise.all([
                (contract as any).balanceOf(ownerAddress).catch((e: any) => {
                    console.error(`[${symbol}] fetchBalance: balanceOf() RPC error:`, e);
                    throw new Error(`balanceOf RPC failed: ${e?.message ?? e}`);
                }),
                (contract as any).decimals().catch((e: any) => {
                    console.warn(`[${symbol}] fetchBalance: decimals() failed (will default to 18):`, e?.message);
                    return null;
                }),
            ]);
            console.log(`[${symbol}] fetchBalance: balResult =`, JSON.stringify(balResult, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
            console.log(`[${symbol}] fetchBalance: decResult =`, JSON.stringify(decResult, (_k, v) => typeof v === 'bigint' ? v.toString() : v));

            // Step 7: extract raw balance
            const raw = balResult?.properties?.balance
                ?? balResult?.result
                ?? balResult?.decoded?.[0]
                ?? null;

            if (raw !== null) {
                const decimals = Number(
                    decResult?.properties?.decimals
                    ?? decResult?.result
                    ?? decResult?.decoded?.[0]
                    ?? 18
                );
                const formatted = formatBalance(BigInt(raw.toString()), decimals);
                console.log(`[${symbol}] fetchBalance: balance = ${formatted} (raw=${raw}, decimals=${decimals})`);
                setBalance(formatted);
            } else {
                console.warn(`[${symbol}] fetchBalance: could not extract balance from result. balResult keys:`, balResult ? Object.keys(balResult) : 'null');
                setBalance('0');
            }
        } catch (err: any) {
            console.error(`[${symbol}] fetchBalance FAILED:`, err);
            console.error(`[${symbol}] fetchBalance error details — message: "${err?.message}", code: "${err?.code}"`);
        } finally {
            setBalanceLoading(false);
        }
    }, [wallet.connected, wallet.address, contractAddress, symbol]);

    useEffect(() => {
        fetchBalance();
    }, [fetchBalance]);

    // ── handleMine ──────────────────────────────────────────────────────
    async function handleMine() {
        if (!wallet.connected || !wallet.address) {
            console.warn(`[${symbol}] handleMine: aborted — wallet not connected`);
            return;
        }

        console.log(`[${symbol}] handleMine: ===== STARTING MINE =====`);
        console.log(`[${symbol}] handleMine: wallet = ${wallet.address}`);
        console.log(`[${symbol}] handleMine: contract = ${contractAddress}`);
        console.log(`[${symbol}] handleMine: cost = ${MINE_COST_SATS} sats`);

        const opnet = (window as any).opnet;
        if (!opnet) {
            const msg = 'OPWallet extension not found on window.opnet';
            console.error(`[${symbol}] handleMine: ${msg}`);
            setErrorMsg(msg);
            setStatus('error');
            toast.error(msg);
            return;
        }
        console.log(`[${symbol}] handleMine: OPWallet detected`);

        // Check for already-pending tx
        const storedTxId = localStorage.getItem(pendingTxKey(contractAddress, wallet.address));
        if (storedTxId) {
            console.log(`[${symbol}] handleMine: found stored pending tx ${storedTxId}, checking...`);
            try {
                const { JSONRpcProvider } = await import('opnet');
                const { networks } = await import('@btc-vision/bitcoin');
                const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
                const receipt = await provider.getTransactionReceipt(storedTxId);
                if (!receipt) {
                    console.log(`[${symbol}] handleMine: tx ${storedTxId} still unconfirmed — blocking double-submit`);
                    toast.warning(`${symbol} mine already pending. Tx: ${storedTxId.slice(0, 16)}...`);
                    return;
                }
                console.log(`[${symbol}] handleMine: tx ${storedTxId} confirmed — clearing pending state`);
                localStorage.removeItem(pendingTxKey(contractAddress, wallet.address));
            } catch (e: any) {
                console.warn(`[${symbol}] handleMine: receipt lookup error (treating as still pending):`, e?.message);
                toast.warning(`${symbol} mine already pending. Tx: ${storedTxId.slice(0, 16)}...`);
                return;
            }
        }

        setStatus('pending');
        setTxId(null);
        setErrorMsg(null);

        try {
            // Step 1: import modules
            console.log(`[${symbol}] handleMine: importing opnet modules...`);
            const { JSONRpcProvider, getContract } = await import('opnet');
            const { networks } = await import('@btc-vision/bitcoin');
            console.log(`[${symbol}] handleMine: modules imported OK`);

            // Step 2: create provider
            console.log(`[${symbol}] handleMine: creating JSONRpcProvider("${RPC_URL}", networks.testnet)...`);
            const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
            console.log(`[${symbol}] handleMine: provider created OK`);

            // Step 3: build contract instance with MINE_ABI
            console.log(`[${symbol}] handleMine: calling getContract("${contractAddress}", MINE_ABI, provider, networks.testnet)...`);
            console.log(`[${symbol}] handleMine: MINE_ABI =`, JSON.stringify(MINE_ABI));
            const contract = getContract(
                contractAddress,
                MINE_ABI as any,
                provider,
                networks.testnet,
            );
            console.log(`[${symbol}] handleMine: contract instance created OK`);

            // Step 4: simulate mine() call
            console.log(`[${symbol}] handleMine: simulating mine()...`);
            const simulation = await (contract as any).mine();
            console.log(`[${symbol}] handleMine: simulation result =`, simulation);

            if (simulation.revert) {
                const revertMsg = `Simulation reverted: ${simulation.revert}`;
                console.error(`[${symbol}] handleMine: ${revertMsg}`);
                throw new Error(revertMsg);
            }
            console.log(`[${symbol}] handleMine: simulation passed — sending transaction...`);

            // Step 5: send transaction via OPWallet
            console.log(`[${symbol}] handleMine: calling sendTransaction with signer=null, mldsaSigner=null, cost=${MINE_COST_SATS} sats...`);
            const receipt = await simulation.sendTransaction({
                signer: null,
                mldsaSigner: null,
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
            console.log(`[${symbol}] handleMine: sendTransaction receipt =`, receipt);

            const submittedTxId = receipt?.transactionId ?? receipt?.[1] ?? 'submitted';
            console.log(`[${symbol}] handleMine: txId = ${submittedTxId}`);

            // Persist pending tx
            if (submittedTxId !== 'submitted') {
                localStorage.setItem(pendingTxKey(contractAddress, wallet.address), submittedTxId);
                console.log(`[${symbol}] handleMine: saved pending tx to localStorage`);
            }

            setTxId(submittedTxId);
            setStatus('success');
            toast.success(`Mined ${MINE_REWARD_TOKENS} ${symbol}!`);

            // Refresh balance after a short delay
            console.log(`[${symbol}] handleMine: scheduling balance refresh in 2s...`);
            setTimeout(() => fetchBalance(), 2000);
        } catch (err: any) {
            console.error(`[${symbol}] handleMine FAILED:`, err);
            console.error(`[${symbol}] handleMine error details — message: "${err?.message}", stack:`, err?.stack);
            const msg = err?.message ?? 'Transaction failed';
            setErrorMsg(msg);
            setStatus('error');
            toast.error(`${symbol} mine failed: ${msg}`);
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
