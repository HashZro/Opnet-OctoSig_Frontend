'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useToast } from '@/contexts/ToastContext';
import { VAULT_ADDRESS, VAULT_ABI, RPC_URL } from '@/lib/contracts';
import { friendlyError } from '@/lib/errorMessages';
import { TransactionAlert } from './TransactionAlert';

type VaultInfo = {
    threshold: bigint;
    ownerCount: bigint;
    token: string;
    balance: bigint;
    totalProposals: bigint;
    hasProposal: boolean;
    owners: string[];
};

type ProposalInfo = {
    to: string;
    amount: bigint;
    approvals: bigint;
};

type TxStatus = 'idle' | 'simulating' | 'sending' | 'success' | 'error';

// ── Shared helpers ──

async function loadSdk() {
    const { getContract, JSONRpcProvider } = await import('opnet');
    const { networks, toOutputScript } = await import('@btc-vision/bitcoin');
    const { BinaryWriter, BinaryReader, Address } = await import('@btc-vision/transaction');
    const provider = new JSONRpcProvider(RPC_URL, networks.testnet);
    const contract = getContract(VAULT_ADDRESS, VAULT_ABI as any, provider, networks.testnet);
    return { provider, contract, networks, toOutputScript, BinaryWriter, BinaryReader, Address };
}

async function toAddr(
    addrStr: string,
    label: string,
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
            console.log(`[toAddr] "${label}": resolved identity key ${identityHex}`);
            return Address.fromString(identityHex);
        }
        console.warn(`[toAddr] "${label}": could not resolve identity key — recipient must have transacted on OPNet at least once.`);
    }

    return Address.wrap(programBytes);
}

async function callContract(
    methodName: string,
    paramsBuilder: ((w: any, Address: any, toOutputScript: any, networks: any, provider: any) => void | Promise<void>) | null,
) {
    const sdk = await loadSdk();
    const selectorBuf: Uint8Array = (sdk.contract as any).encodeCalldata(methodName, []);

    let calldata: Uint8Array;
    if (paramsBuilder) {
        const params = new sdk.BinaryWriter();
        await paramsBuilder(params, sdk.Address, sdk.toOutputScript, sdk.networks, sdk.provider);
        const paramsBuf = params.getBuffer();
        calldata = new Uint8Array(selectorBuf.length + paramsBuf.length);
        calldata.set(selectorBuf, 0);
        calldata.set(paramsBuf, selectorBuf.length);
    } else {
        calldata = selectorBuf;
    }

    const sim = await sdk.provider.call(VAULT_ADDRESS, calldata as any);
    return { sim, sdk };
}

async function sendTx(sim: any, walletAddress: string, networks: any, opts?: { maxSat?: bigint; minGas?: bigint }) {
    const receipt = await sim.sendTransaction({
        signer: null,
        mldsaSigner: null,
        refundTo: walletAddress,
        maximumAllowedSatToSpend: opts?.maxSat ?? BigInt(500_000),
        feeRate: 10,
        network: networks.testnet,
        minGas: opts?.minGas ?? BigInt(200_000),
    });

    let txId: string | null = null;
    if (receipt && typeof receipt === 'object') {
        if ('transactionId' in receipt) txId = (receipt as any).transactionId;
        else if (Array.isArray(receipt) && receipt.length > 0) txId = receipt[0];
    }
    return txId;
}

// ── Component ──

export function VaultDashboard() {
    const { wallet } = useWallet();
    const { toast } = useToast();

    // Vault selection
    const [vaultIdInput, setVaultIdInput] = useState('0');
    const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
    const [proposal, setProposal] = useState<ProposalInfo | null>(null);
    const [loadingVault, setLoadingVault] = useState(false);

    // Deposit
    const [depositAmount, setDepositAmount] = useState('');
    const [depositStatus, setDepositStatus] = useState<TxStatus>('idle');

    // Propose
    const [proposeTo, setProposeTo] = useState('');
    const [proposeAmount, setProposeAmount] = useState('');
    const [proposeStatus, setProposeStatus] = useState<TxStatus>('idle');

    // Approve
    const [approveStatus, setApproveStatus] = useState<TxStatus>('idle');

    // Execute
    const [executeStatus, setExecuteStatus] = useState<TxStatus>('idle');

    // Last tx
    const [lastTxId, setLastTxId] = useState<string | null>(null);

    // ── Load vault info ──

    const loadVault = useCallback(async () => {
        setLoadingVault(true);
        setVaultInfo(null);
        setProposal(null);
        setLastTxId(null);

        try {
            const { sim, sdk } = await callContract('getVaultInfo', (w) => {
                w.writeU256(BigInt(vaultIdInput));
            });

            if (sim && 'error' in sim) throw new Error((sim as any).error);

            const rawResult = (sim as any).result || (sim as any).calldata;
            if (!rawResult) throw new Error('No data returned from getVaultInfo');

            const reader = new sdk.BinaryReader(rawResult);
            const threshold = reader.readU256();
            const ownerCount = reader.readU256();
            const token = reader.readAddress();
            const balance = reader.readU256();
            const totalProposals = reader.readU256();
            const hasProposalVal = reader.readU256();
            const hasProposal = hasProposalVal !== BigInt(0);

            const count = Number(ownerCount);
            const owners: string[] = [];
            for (let i = 0; i < count; i++) {
                const addr = reader.readAddress();
                owners.push(addr.toHex ? addr.toHex() : `0x${Buffer.from(addr).toString('hex')}`);
            }

            const info: VaultInfo = {
                threshold: BigInt(threshold.toString()),
                ownerCount: BigInt(ownerCount.toString()),
                token: token.toHex ? token.toHex() : `0x${Buffer.from(token).toString('hex')}`,
                balance: BigInt(balance.toString()),
                totalProposals: BigInt(totalProposals.toString()),
                hasProposal,
                owners,
            };
            setVaultInfo(info);

            // Load proposal if active
            if (hasProposal) {
                try {
                    const { sim: pSim, sdk: pSdk } = await callContract('getProposal', (w) => {
                        w.writeU256(BigInt(vaultIdInput));
                    });
                    if (pSim && !('error' in pSim)) {
                        const pRaw = (pSim as any).result || (pSim as any).calldata;
                        if (pRaw) {
                            const pr = new pSdk.BinaryReader(pRaw);
                            const pTo = pr.readAddress();
                            const pAmount = pr.readU256();
                            const pApprovals = pr.readU256();
                            setProposal({
                                to: pTo.toHex ? pTo.toHex() : `0x${Buffer.from(pTo).toString('hex')}`,
                                amount: BigInt(pAmount.toString()),
                                approvals: BigInt(pApprovals.toString()),
                            });
                        }
                    }
                } catch {
                    // Proposal fetch failed — not critical
                }
            }

            toast.success('Vault loaded');
        } catch (err: any) {
            console.error('Load vault failed:', err);
            toast.error(`Failed: ${err?.message ?? 'Unknown error'}`);
        } finally {
            setLoadingVault(false);
        }
    }, [vaultIdInput, toast]);

    // ── Deposit ──

    const handleDeposit = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            toast.warning('Connect your wallet first.');
            return;
        }
        if (!vaultInfo) return;

        const amountRaw = depositAmount.trim();
        if (!amountRaw || Number(amountRaw) <= 0) {
            toast.error('Enter a valid amount.');
            return;
        }

        setDepositStatus('simulating');
        setLastTxId(null);

        try {
            const sdk = await loadSdk();

            // Step 1: increaseAllowance on the token contract
            const { getContract, OP_20_ABI } = await import('opnet');
            const tokenContract = getContract(
                vaultInfo.token,
                OP_20_ABI as any,
                sdk.provider,
                sdk.networks.testnet,
            );

            const decimals = await (tokenContract as any).decimals().catch(() => null);
            const dec = Number(decimals?.properties?.decimals ?? 18);
            const amount = BigInt(Math.floor(Number(amountRaw) * 10 ** dec));

            // Simulate increaseAllowance
            const vaultAddr = toAddr(
                VAULT_ADDRESS,
                'vault',
                sdk.Address,
                sdk.toOutputScript,
                sdk.networks,
            );
            const allowanceSim = await (tokenContract as any).increaseAllowance(vaultAddr, amount);
            if (allowanceSim && 'error' in allowanceSim) {
                throw new Error(`Allowance failed: ${(allowanceSim as any).error}`);
            }

            setDepositStatus('sending');
            toast.info('Approve allowance in OPWallet...');
            await sendTx(allowanceSim, wallet.address!, sdk.networks);

            // Step 2: deposit on vault
            setDepositStatus('simulating');
            toast.info('Now deposit — simulating...');

            const { sim } = await callContract('deposit', (w) => {
                w.writeU256(BigInt(vaultIdInput));
                w.writeU256(amount);
            });

            if (sim && 'error' in sim) throw new Error((sim as any).error);

            setDepositStatus('sending');
            toast.info('Confirm deposit in OPWallet...');
            const txId = await sendTx(sim, wallet.address!, sdk.networks);

            setDepositStatus('success');
            setLastTxId(txId);
            toast.success('Deposit submitted!');
        } catch (err: any) {
            console.error('Deposit failed:', err);
            setDepositStatus('error');
            const { message, isFunding } = friendlyError(err);
            toast.error(isFunding ? message : `Deposit failed: ${message}`);
        }
    }, [wallet, vaultInfo, depositAmount, vaultIdInput, toast]);

    // ── Propose ──

    const handlePropose = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            toast.warning('Connect your wallet first.');
            return;
        }
        if (!vaultInfo) return;

        const toStr = proposeTo.trim();
        const amtStr = proposeAmount.trim();
        if (!toStr) { toast.error('Enter a recipient address.'); return; }
        if (!amtStr || Number(amtStr) <= 0) { toast.error('Enter a valid amount.'); return; }

        setProposeStatus('simulating');
        setLastTxId(null);

        try {
            const sdk = await loadSdk();

            // Get token decimals for amount conversion
            const { getContract, OP_20_ABI } = await import('opnet');
            const tokenContract = getContract(
                vaultInfo.token,
                OP_20_ABI as any,
                sdk.provider,
                sdk.networks.testnet,
            );
            const decimals = await (tokenContract as any).decimals().catch(() => null);
            const dec = Number(decimals?.properties?.decimals ?? 18);
            const amount = BigInt(Math.floor(Number(amtStr) * 10 ** dec));

            const { sim } = await callContract('propose', async (w, Address, toOutputScript, networks, provider) => {
                w.writeU256(BigInt(vaultIdInput));
                w.writeAddress(await toAddr(toStr, 'recipient', Address, toOutputScript, networks, provider));
                w.writeU256(amount);
            });

            if (sim && 'error' in sim) throw new Error((sim as any).error);

            setProposeStatus('sending');
            toast.info('Confirm proposal in OPWallet...');
            const txId = await sendTx(sim, wallet.address!, sdk.networks);

            setProposeStatus('success');
            setLastTxId(txId);
            toast.success('Proposal submitted!');
        } catch (err: any) {
            console.error('Propose failed:', err);
            setProposeStatus('error');
            const fe = friendlyError(err);
            toast.error(fe.isFunding ? fe.message : `Propose failed: ${fe.message}`);
        }
    }, [wallet, vaultInfo, proposeTo, proposeAmount, vaultIdInput, toast]);

    // ── Approve ──

    const handleApprove = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            toast.warning('Connect your wallet first.');
            return;
        }

        setApproveStatus('simulating');
        setLastTxId(null);

        try {
            const { sim, sdk } = await callContract('approve', (w) => {
                w.writeU256(BigInt(vaultIdInput));
            });

            if (sim && 'error' in sim) throw new Error((sim as any).error);

            setApproveStatus('sending');
            toast.info('Confirm approval in OPWallet...');
            const txId = await sendTx(sim, wallet.address!, sdk.networks, { maxSat: BigInt(250_000), minGas: BigInt(100_000) });

            setApproveStatus('success');
            setLastTxId(txId);
            toast.success('Approval submitted!');
        } catch (err: any) {
            console.error('Approve failed:', err);
            setApproveStatus('error');
            const fe2 = friendlyError(err);
            toast.error(fe2.isFunding ? fe2.message : `Approve failed: ${fe2.message}`);
        }
    }, [wallet, vaultIdInput, toast]);

    // ── Execute ──

    const handleExecute = useCallback(async () => {
        if (!wallet.connected || !wallet.address) {
            toast.warning('Connect your wallet first.');
            return;
        }

        setExecuteStatus('simulating');
        setLastTxId(null);

        try {
            const { sim, sdk } = await callContract('executeProposal', (w) => {
                w.writeU256(BigInt(vaultIdInput));
            });

            if (sim && 'error' in sim) throw new Error((sim as any).error);

            setExecuteStatus('sending');
            toast.info('Confirm execution in OPWallet...');
            const txId = await sendTx(sim, wallet.address!, sdk.networks);

            setExecuteStatus('success');
            setLastTxId(txId);
            toast.success('Proposal executed!');
        } catch (err: any) {
            console.error('Execute failed:', err);
            setExecuteStatus('error');
            const fe3 = friendlyError(err);
            toast.error(fe3.isFunding ? fe3.message : `Execute failed: ${fe3.message}`);
        }
    }, [wallet, vaultIdInput, toast]);

    // ── Busy flags ──
    const depositBusy = depositStatus === 'simulating' || depositStatus === 'sending';
    const proposeBusy = proposeStatus === 'simulating' || proposeStatus === 'sending';
    const approveBusy = approveStatus === 'simulating' || approveStatus === 'sending';
    const executeBusy = executeStatus === 'simulating' || executeStatus === 'sending';

    return (
        <>
            {/* Hero */}
            <section className="py-16">
                <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                    Manage Vault
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Load a vault by ID to deposit, propose withdrawals, approve, and execute.
                </p>
            </section>

            {/* Connect prompt */}
            {!wallet.connected && (
                <div
                    className="mb-8 px-4 py-3 text-sm"
                    style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: 'var(--amber)' }}
                >
                    Connect your OPWallet to manage vaults.
                </div>
            )}

            {/* ═══ Vault Selector ═══ */}
            <div
                className="mb-6 p-4 sm:p-6 flex flex-col gap-4"
                style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
            >
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Vault ID
                </label>
                <div className="flex gap-2 sm:gap-3">
                    <input
                        type="number"
                        min="0"
                        value={vaultIdInput}
                        onChange={(e) => setVaultIdInput(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm font-mono"
                        style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    />
                    <button
                        type="button"
                        onClick={loadVault}
                        disabled={loadingVault}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                        style={{
                            backgroundColor: loadingVault ? '#E5E5E5' : 'var(--accent)',
                            color: loadingVault ? 'var(--text-tertiary)' : '#FFFFFF',
                            border: '1px solid transparent',
                            cursor: loadingVault ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {loadingVault ? 'Loading...' : 'Load Vault'}
                    </button>
                </div>
            </div>

            {/* ═══ Vault Info ═══ */}
            {vaultInfo && (
                <div
                    className="mb-6 p-4 sm:p-6 flex flex-col gap-4"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        Vault #{vaultIdInput} Info
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                        <InfoCell label="Threshold" value={`${vaultInfo.threshold} of ${vaultInfo.ownerCount}`} />
                        <InfoCell label="Balance" value={formatTokenAmount(vaultInfo.balance)} />
                        <InfoCell label="Total Proposals" value={vaultInfo.totalProposals.toString()} />
                        <InfoCell label="Active Proposal" value={vaultInfo.hasProposal ? 'Yes' : 'No'} />
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)' }} />

                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                            Token
                        </p>
                        <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                            {vaultInfo.token}
                        </code>
                    </div>

                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                            Owners
                        </p>
                        <div className="flex flex-col gap-1">
                            {vaultInfo.owners.map((o, i) => (
                                <code key={i} className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                    {i + 1}. {o}
                                </code>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Active Proposal ═══ */}
            {vaultInfo?.hasProposal && proposal && (
                <div
                    className="mb-6 p-4 sm:p-6 flex flex-col gap-4"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        Active Proposal
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                        <InfoCell label="Amount" value={formatTokenAmount(proposal.amount)} />
                        <InfoCell label="Approvals" value={`${proposal.approvals} / ${vaultInfo.threshold}`} />
                    </div>

                    <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                            Recipient
                        </p>
                        <div style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', padding: '10px 12px' }}>
                            <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
                                {proposal.to}
                            </code>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handleApprove}
                            disabled={!wallet.connected || approveBusy}
                            className="flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                            style={{
                                backgroundColor: !wallet.connected || approveBusy ? '#E5E5E5' : '#16A34A',
                                color: !wallet.connected || approveBusy ? 'var(--text-tertiary)' : '#FFFFFF',
                                border: '1px solid transparent',
                                cursor: !wallet.connected || approveBusy ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {approveBusy ? 'Processing...' : 'Approve'}
                        </button>

                        <button
                            type="button"
                            onClick={handleExecute}
                            disabled={!wallet.connected || executeBusy || proposal.approvals < vaultInfo.threshold}
                            className="flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                            style={{
                                backgroundColor: !wallet.connected || executeBusy || proposal.approvals < vaultInfo.threshold
                                    ? '#E5E5E5' : 'var(--accent)',
                                color: !wallet.connected || executeBusy || proposal.approvals < vaultInfo.threshold
                                    ? 'var(--text-tertiary)' : '#FFFFFF',
                                border: '1px solid transparent',
                                cursor: !wallet.connected || executeBusy || proposal.approvals < vaultInfo.threshold
                                    ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {executeBusy ? 'Processing...' : 'Execute'}
                        </button>
                    </div>

                    {proposal.approvals < vaultInfo.threshold && (
                        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            Execute is disabled until {vaultInfo.threshold.toString()} approvals are reached.
                        </p>
                    )}
                </div>
            )}

            {/* ═══ Deposit ═══ */}
            {vaultInfo && (
                <div
                    className="mb-6 p-4 sm:p-6 flex flex-col gap-4"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        Deposit Tokens
                    </h3>

                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            placeholder="Amount (e.g. 100)"
                            className="flex-1 px-3 py-2 text-sm font-mono"
                            style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                        />
                        <button
                            type="button"
                            onClick={handleDeposit}
                            disabled={!wallet.connected || depositBusy}
                            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                            style={{
                                backgroundColor: !wallet.connected || depositBusy ? '#E5E5E5' : 'var(--accent)',
                                color: !wallet.connected || depositBusy ? 'var(--text-tertiary)' : '#FFFFFF',
                                border: '1px solid transparent',
                                cursor: !wallet.connected || depositBusy ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {depositBusy ? 'Processing...' : 'Deposit'}
                        </button>
                    </div>

                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        This will first request token allowance, then deposit. You will confirm two transactions in OPWallet.
                    </p>
                </div>
            )}

            {/* ═══ Create Proposal ═══ */}
            {vaultInfo && (
                <div
                    className="mb-6 p-4 sm:p-6 flex flex-col gap-4"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)' }}
                >
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        Create Withdrawal Proposal
                    </h3>

                    {vaultInfo.hasProposal && (
                        <div
                            className="px-3 py-2 text-xs"
                            style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', color: 'var(--amber)' }}
                        >
                            Warning: Creating a new proposal will replace the existing one.
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Recipient Address
                            </label>
                            <input
                                type="text"
                                value={proposeTo}
                                onChange={(e) => setProposeTo(e.target.value)}
                                placeholder="tb1p... or 0x..."
                                className="w-full px-3 py-2 text-sm font-mono"
                                style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                Amount
                            </label>
                            <input
                                type="text"
                                value={proposeAmount}
                                onChange={(e) => setProposeAmount(e.target.value)}
                                placeholder="Amount (e.g. 50)"
                                className="w-full px-3 py-2 text-sm font-mono"
                                style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
                                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                            />
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handlePropose}
                        disabled={!wallet.connected || proposeBusy}
                        className="w-full py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                        style={{
                            backgroundColor: !wallet.connected || proposeBusy ? '#E5E5E5' : 'var(--accent)',
                            color: !wallet.connected || proposeBusy ? 'var(--text-tertiary)' : '#FFFFFF',
                            border: '1px solid transparent',
                            cursor: !wallet.connected || proposeBusy ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {proposeBusy ? 'Processing...' : 'Create Proposal'}
                    </button>

                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        Creating a proposal automatically votes yes. Only vault owners can propose.
                    </p>
                </div>
            )}

            {/* ═══ Last TX ═══ */}
            {lastTxId && (
                <TransactionAlert
                    txId={lastTxId}
                    onDismiss={() => setLastTxId(null)}
                />
            )}

            {/* Spacer */}
            <div className="pb-20" />
        </>
    );
}

// ── Sub-components ──

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

function formatTokenAmount(raw: bigint): string {
    // Assume 18 decimals — will be overridden when we know the actual decimals
    const decimals = 18;
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}
