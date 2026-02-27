import { VaultDashboard } from '@/components/VaultDashboard';

export const metadata = {
    title: 'Manage Vault — OctoSig',
    description: 'Manage your multisig vault on OPNet testnet.',
};

export default function ManageVaultPage() {
    return <VaultDashboard />;
}
