import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ToastProvider } from '@/contexts/ToastContext';
import { WalletProvider } from '@/contexts/WalletContext';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-inter',
});

export const metadata: Metadata = {
    title: 'OctoSig',
    description: 'OctoSig — Multisig vaults on Bitcoin, powered by OPNet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={inter.variable}>
            <body className="font-[family-name:var(--font-inter)] antialiased">
                <ToastProvider>
                    <WalletProvider>
                        <AppShell>{children}</AppShell>
                    </WalletProvider>
                </ToastProvider>
            </body>
        </html>
    );
}
