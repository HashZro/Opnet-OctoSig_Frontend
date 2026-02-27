import { NewVaultClient } from '@/components/NewVaultClient';

export const metadata = {
    title: 'New Vault — OctoSig',
    description: 'Create a multisig vault on OPNet testnet.',
};

export default function NewVaultPage() {
    return <NewVaultClient />;
}
