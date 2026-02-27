'use client';

type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type Props = {
    wallet: WalletState;
    opnetAvailable: boolean;
    onConnect: () => void;
};

function truncateAddress(addr: string): string {
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

export function WalletBar({ wallet, opnetAvailable, onConnect }: Props) {
    if (wallet.connected && wallet.address) {
        return (
            <div className="flex items-center gap-2">
                <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: 'var(--green)' }}
                />
                <code
                    className="px-3 py-1.5 text-xs font-mono font-medium"
                    style={{
                        backgroundColor: '#F5F5F5',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                    }}
                    title={wallet.address}
                >
                    {truncateAddress(wallet.address)}
                </code>
            </div>
        );
    }

    return (
        <button
            onClick={onConnect}
            disabled={!opnetAvailable}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            style={{
                backgroundColor: opnetAvailable ? 'var(--accent)' : '#E5E5E5',
                color: opnetAvailable ? '#FFFFFF' : 'var(--text-tertiary)',
                border: '1px solid transparent',
                cursor: opnetAvailable ? 'pointer' : 'not-allowed',
            }}
            title={!opnetAvailable ? 'OPWallet extension not detected' : undefined}
        >
            {opnetAvailable ? 'Connect Wallet' : 'Wallet Not Found'}
        </button>
    );
}
