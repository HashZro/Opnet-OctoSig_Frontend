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
            <code
                className="rounded-lg border-2 border-black px-3 py-1 text-xs font-bold"
                style={{ backgroundColor: '#222', color: 'var(--yellow)' }}
                title={wallet.address}
            >
                {truncateAddress(wallet.address)}
            </code>
        );
    }

    return (
        <button
            onClick={onConnect}
            disabled={!opnetAvailable}
            className="nb-press nb-shadow rounded-lg border-2 border-black px-4 py-2 text-sm font-black uppercase tracking-wide"
            style={{
                backgroundColor: opnetAvailable ? 'var(--yellow)' : '#ccc',
                color: '#000',
            }}
            title={!opnetAvailable ? 'OPWallet extension not detected' : undefined}
        >
            {opnetAvailable ? 'Connect OPWallet' : 'OPWallet Not Found'}
        </button>
    );
}
