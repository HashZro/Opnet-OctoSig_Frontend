import { FaucetClient } from '@/components/FaucetClient';

export const metadata = {
    title: 'Faucet — OctoSig',
    description: 'Claim free OCT test tokens on the OPNet testnet.',
};

export default function FaucetPage() {
    return <FaucetClient />;
}
