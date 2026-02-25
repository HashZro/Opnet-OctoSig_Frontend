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
    onDisconnect: () => void;
};

function truncateAddress(addr: string): string {
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

export function WalletBar({ wallet, opnetAvailable, onConnect, onDisconnect }: Props) {
    if (wallet.connected && wallet.address) {
        return (
            <div className="flex items-center gap-3">
                <span
                    className="rounded-lg border-2 border-black px-3 py-1 text-xs font-bold"
                    style={{ backgroundColor: 'var(--green)', color: '#000' }}
                >
                    CONNECTED
                </span>
                <code
                    className="hidden rounded-lg border-2 border-black px-3 py-1 text-xs font-bold sm:block"
                    style={{ backgroundColor: '#222', color: 'var(--yellow)' }}
                >
                    {truncateAddress(wallet.address)}
                </code>
                <button
                    onClick={onDisconnect}
                    className="nb-press nb-shadow-sm rounded-lg border-2 border-black px-3 py-1 text-xs font-bold uppercase"
                    style={{ backgroundColor: 'var(--red)', color: '#fff' }}
                >
                    Disconnect
                </button>
            </div>
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
