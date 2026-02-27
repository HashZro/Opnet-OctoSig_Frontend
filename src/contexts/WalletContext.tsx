'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type WalletState = {
    connected: boolean;
    address: string | null;
    network: string | null;
};

type WalletContextType = {
    wallet: WalletState;
    opnetAvailable: boolean;
    connectWallet: () => Promise<void>;
};

const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet(): WalletContextType {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within WalletProvider');
    return ctx;
}

const WALLET_STORAGE_KEY = 'octosig_wallet';

function saveWallet(state: WalletState) {
    try { localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadWallet(): WalletState | null {
    try {
        const raw = localStorage.getItem(WALLET_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.connected && parsed?.address) return parsed;
    } catch {}
    return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
    const [wallet, setWallet] = useState<WalletState>({
        connected: false,
        address: null,
        network: null,
    });
    const [opnetAvailable, setOpnetAvailable] = useState(false);

    // Detect OPWallet extension
    useEffect(() => {
        const check = () => {
            if (typeof window !== 'undefined' && 'opnet' in window) {
                setOpnetAvailable(true);
            }
        };
        check();
        window.addEventListener('opnet#initialized', check);
        const t = setTimeout(check, 500);
        return () => {
            window.removeEventListener('opnet#initialized', check);
            clearTimeout(t);
        };
    }, []);

    // Auto-reconnect from localStorage
    useEffect(() => {
        const saved = loadWallet();
        if (!saved) return;

        const tryReconnect = async () => {
            const opnet = (window as any).opnet;
            if (!opnet) return;
            try {
                const accounts: string[] = await opnet.requestAccounts();
                const network: string = await opnet.getNetwork();
                const state: WalletState = { connected: true, address: accounts[0] ?? null, network };
                setWallet(state);
                saveWallet(state);
            } catch {
                localStorage.removeItem(WALLET_STORAGE_KEY);
            }
        };

        if ((window as any).opnet) {
            tryReconnect();
        } else {
            const onInit = () => {
                tryReconnect();
                window.removeEventListener('opnet#initialized', onInit);
            };
            window.addEventListener('opnet#initialized', onInit);
            const t = setTimeout(tryReconnect, 600);
            return () => {
                window.removeEventListener('opnet#initialized', onInit);
                clearTimeout(t);
            };
        }
    }, []);

    // Listen for account / network changes (like MetaMask's accountsChanged / chainChanged)
    useEffect(() => {
        const opnet = (window as any).opnet;
        if (!opnet || typeof opnet.on !== 'function') return;

        const onAccountsChanged = (accounts: string[]) => {
            if (!accounts || accounts.length === 0) {
                const disconnected: WalletState = { connected: false, address: null, network: null };
                setWallet(disconnected);
                localStorage.removeItem(WALLET_STORAGE_KEY);
            } else {
                setWallet((prev) => {
                    const next: WalletState = { connected: true, address: accounts[0], network: prev.network };
                    saveWallet(next);
                    return next;
                });
            }
        };

        const onChainChanged = (chainInfo: any) => {
            const net = typeof chainInfo === 'string' ? chainInfo : chainInfo?.network ?? chainInfo?.chain ?? null;
            setWallet((prev) => {
                const next: WalletState = { ...prev, network: net };
                if (prev.connected) saveWallet(next);
                return next;
            });
        };

        opnet.on('accountsChanged', onAccountsChanged);
        opnet.on('chainChanged', onChainChanged);

        return () => {
            if (typeof opnet.removeListener === 'function') {
                opnet.removeListener('accountsChanged', onAccountsChanged);
                opnet.removeListener('chainChanged', onChainChanged);
            }
        };
    }, [opnetAvailable]);

    const connectWallet = useCallback(async () => {
        const opnet = (window as any).opnet;
        if (!opnet) return;
        const accounts: string[] = await opnet.requestAccounts();
        const network: string = await opnet.getNetwork();
        const state: WalletState = { connected: true, address: accounts[0] ?? null, network };
        setWallet(state);
        saveWallet(state);
    }, []);

    return (
        <WalletContext.Provider value={{ wallet, opnetAvailable, connectWallet }}>
            {children}
        </WalletContext.Provider>
    );
}
