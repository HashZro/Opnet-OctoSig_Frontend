import { FaucetClient } from '@/components/FaucetClient';

export const metadata = {
    title: 'Faucet — MultSig Vault',
    description: 'Mine ALPHA and BETA test tokens on OPNet testnet. Costs 0.00001 BTC per mine.',
};

export default function FaucetPage() {
    return <FaucetClient />;
}
