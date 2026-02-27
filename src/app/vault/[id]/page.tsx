type Props = {
    params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    return { title: `Vault #${id} — OctoSig` };
}

export default async function VaultDetailPage({ params }: Props) {
    const { id } = await params;

    return (
        <>
            <section className="py-16">
                <h2
                    className="text-3xl font-semibold tracking-tight"
                    style={{ color: 'var(--text)' }}
                >
                    Vault #{id}
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Vault detail page — coming soon.
                </p>
            </section>

            <div
                className="mb-16 p-6 text-center"
                style={{
                    backgroundColor: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                }}
            >
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Detailed vault management for Vault #{id} will be available here.
                </p>
            </div>
        </>
    );
}
