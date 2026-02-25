import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ToastProvider } from '@/contexts/ToastContext';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
    title: 'MultSig Vault — Faucet',
    description: 'OPNet testnet faucet. Mine ALPHA and BETA tokens for testing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={spaceGrotesk.variable}>
            <body className="font-[family-name:var(--font-space-grotesk)] antialiased">
                <ToastProvider>{children}</ToastProvider>
            </body>
        </html>
    );
}
