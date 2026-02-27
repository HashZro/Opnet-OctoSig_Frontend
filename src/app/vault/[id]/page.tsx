import { VaultDetail } from '@/components/VaultDetail';

type Props = {
    params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    return { title: `Vault #${id} — OctoSig` };
}

export default async function VaultDetailPage({ params }: Props) {
    const { id } = await params;
    const vaultId = parseInt(id, 10);

    if (isNaN(vaultId) || vaultId < 0) {
        return (
            <section className="py-16">
                <h2
                    className="text-3xl font-semibold tracking-tight"
                    style={{ color: 'var(--text)' }}
                >
                    Invalid Vault ID
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    &quot;{id}&quot; is not a valid vault ID.
                </p>
            </section>
        );
    }

    return <VaultDetail vaultId={vaultId} />;
}
