import { Fragment } from 'react';
import Link from 'next/link';

export const metadata = { title: 'OctoSig — Multisig Vaults on OPNet' };

export default function Home() {
    return (
        <div style={{ maxWidth: 1280, margin: '0 auto' }} className="px-6">
            {/* ── Hero ── */}
            <section className="pt-24 pb-20 flex items-center gap-16">
                <div style={{ flex: '1 1 0' }}>
                    <p
                        className="text-sm font-semibold uppercase tracking-widest mb-4"
                        style={{ color: 'var(--cyan)' }}
                    >
                        Powered by OPNet on Bitcoin
                    </p>
                    <h1
                        className="text-5xl font-bold tracking-tight mb-5"
                        style={{ color: 'var(--text)', lineHeight: 1.15 }}
                    >
                        A shared safe for
                        <br />
                        your <span style={{ color: 'var(--cyan)' }}>tokens</span>
                    </h1>
                    <p
                        className="text-lg mb-10"
                        style={{ color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 480 }}
                    >
                        OctoSig lets you and your friends hold tokens together in a{' '}
                        <strong style={{ color: 'var(--text)' }}>vault</strong>.
                        No one can spend alone — the group decides together.
                    </p>
                    <div className="flex gap-4">
                        <Link
                            href="/vault/new"
                            className="px-6 py-3 text-base font-semibold"
                            style={{
                                backgroundColor: 'var(--cyan)',
                                color: '#fff',
                                border: '1px solid var(--cyan)',
                            }}
                        >
                            Create a Vault
                        </Link>
                        <Link
                            href="/vaults"
                            className="px-6 py-3 text-base font-semibold"
                            style={{
                                backgroundColor: 'transparent',
                                color: 'var(--text)',
                                border: '1px solid var(--border-dark)',
                            }}
                        >
                            Browse Vaults
                        </Link>
                    </div>
                </div>

                {/* Hero visual — vault diagram */}
                <div
                    style={{
                        flex: '0 0 380px',
                        backgroundColor: 'var(--card-bg)',
                        border: '1px solid var(--border)',
                        padding: 40,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 20,
                    }}
                >
                    {/* Owners row */}
                    <div className="flex gap-4 justify-center">
                        {['A', 'B', 'C'].map((letter) => (
                            <div
                                key={letter}
                                className="flex items-center justify-center text-sm font-bold"
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--cyan-light)',
                                    border: '2px solid var(--cyan)',
                                    color: 'var(--cyan-mid)',
                                }}
                            >
                                {letter}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                        3 owners
                    </p>

                    {/* Arrows down */}
                    <svg width="100" height="28" viewBox="0 0 100 28" fill="none" style={{ color: 'var(--cyan)' }}>
                        <path d="M12 4 L12 20 L7 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M12 20 L17 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M50 4 L50 20 L45 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M50 20 L55 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M88 4 L88 20 L83 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M88 20 L93 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>

                    {/* Vault box */}
                    <div
                        className="w-full py-5 text-center"
                        style={{
                            backgroundColor: 'var(--cyan)',
                            color: '#fff',
                        }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <p className="text-sm font-bold uppercase tracking-wider">Vault</p>
                    </div>

                    <p className="text-xs font-semibold" style={{ color: 'var(--cyan-mid)' }}>
                        2 of 3 must approve
                    </p>
                </div>
            </section>

            {/* ── Divider ── */}
            <div style={{ height: 1, backgroundColor: 'var(--border)' }} />

            {/* ── What is a Vault? — side by side ── */}
            <section className="py-20 flex gap-16 items-start">
                <div style={{ flex: '1 1 0' }}>
                    <p
                        className="text-sm font-semibold uppercase tracking-widest mb-4"
                        style={{ color: 'var(--cyan)' }}
                    >
                        The idea
                    </p>
                    <h2
                        className="text-3xl font-bold mb-5"
                        style={{ color: 'var(--text)' }}
                    >
                        What is a vault?
                    </h2>
                    <p
                        className="text-base mb-5"
                        style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}
                    >
                        Think of it like a <strong style={{ color: 'var(--text)' }}>group wallet</strong>.
                        You pick who has access and how many people need to say
                        &quot;yes&quot; before any tokens leave.
                    </p>
                    <p
                        className="text-base"
                        style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}
                    >
                        If you set it to <strong style={{ color: 'var(--text)' }}>2 out of 3</strong>,
                        then at least two members must approve every withdrawal.
                        One person alone can never move funds.
                    </p>
                </div>

                {/* Feature cards — stacked on the right */}
                <div className="flex flex-col gap-4" style={{ flex: '0 0 440px' }}>
                    {[
                        {
                            icon: (
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                </svg>
                            ),
                            title: 'Shared ownership',
                            desc: 'Add friends or teammates as co-owners. Everyone can see the balance, but nobody acts alone.',
                        },
                        {
                            icon: (
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                            ),
                            title: 'Approval required',
                            desc: 'You choose how many approvals are needed. 2 of 3? 3 of 5? Your call.',
                        },
                        {
                            icon: (
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                            ),
                            title: 'Secured by Bitcoin',
                            desc: 'Everything runs on Bitcoin itself — not a copy or a separate network. Your tokens stay safe.',
                        },
                    ].map((card) => (
                        <div
                            key={card.title}
                            className="flex gap-5 items-start p-5 hover-lift"
                            style={{
                                backgroundColor: 'var(--card-bg)',
                                border: '1px solid var(--border)',
                                borderLeft: '3px solid var(--cyan)',
                            }}
                        >
                            <div
                                className="flex-shrink-0 flex items-center justify-center"
                                style={{
                                    width: 48,
                                    height: 48,
                                    backgroundColor: 'var(--cyan-light)',
                                    borderRadius: 8,
                                    color: 'var(--cyan)',
                                }}
                            >
                                {card.icon}
                            </div>
                            <div>
                                <h3
                                    className="text-base font-semibold mb-1"
                                    style={{ color: 'var(--text)' }}
                                >
                                    {card.title}
                                </h3>
                                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                    {card.desc}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Divider ── */}
            <div style={{ height: 1, backgroundColor: 'var(--border)' }} />

            {/* ── How it works — horizontal steps ── */}
            <section className="py-20">
                <p
                    className="text-sm font-semibold uppercase tracking-widest mb-4 text-center"
                    style={{ color: 'var(--cyan)' }}
                >
                    Step by step
                </p>
                <h2
                    className="text-3xl font-bold text-center mb-12"
                    style={{ color: 'var(--text)' }}
                >
                    How it works
                </h2>

                <div className="grid items-start" style={{ gridTemplateColumns: '1fr auto 1fr auto 1fr auto 1fr', gap: 0 }}>
                    {[
                        {
                            num: '1',
                            title: 'Create',
                            desc: 'Pick your co-owners and set how many approvals are needed.',
                        },
                        {
                            num: '2',
                            title: 'Deposit',
                            desc: 'Send tokens into the vault. Anyone can deposit at any time.',
                        },
                        {
                            num: '3',
                            title: 'Propose',
                            desc: 'An owner requests a withdrawal — choosing who gets what.',
                        },
                        {
                            num: '4',
                            title: 'Approve',
                            desc: 'Others say yes. Once enough approve, tokens are sent automatically.',
                        },
                    ].map((step, i) => (
                        <Fragment key={step.num}>
                            <div
                                className="flex flex-col items-center text-center p-5 hover-lift"
                                style={{
                                    backgroundColor: 'var(--card-bg)',
                                    border: '1px solid var(--border)',
                                    borderTop: '3px solid var(--cyan)',
                                }}
                            >
                                <span
                                    className="flex items-center justify-center text-base font-bold mb-4"
                                    style={{
                                        width: 44,
                                        height: 44,
                                        backgroundColor: 'var(--cyan)',
                                        color: '#fff',
                                        borderRadius: '50%',
                                    }}
                                >
                                    {step.num}
                                </span>
                                <h3
                                    className="text-base font-semibold mb-1.5"
                                    style={{ color: 'var(--text)' }}
                                >
                                    {step.title}
                                </h3>
                                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                    {step.desc}
                                </p>
                            </div>

                            {/* Horizontal arrow */}
                            {i < 3 && (
                                <div className="flex items-center justify-center" style={{ padding: '0 6px', alignSelf: 'center' }}>
                                    <svg width="24" height="14" viewBox="0 0 24 14" fill="none" style={{ color: 'var(--cyan)' }}>
                                        <path d="M2 7H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                        <path d="M15 2L20 7L15 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            )}
                        </Fragment>
                    ))}
                </div>
            </section>

            {/* ── Bottom CTA — full-width banner ── */}
            <section
                className="mb-20 flex items-center justify-between gap-10 px-12 py-12"
                style={{
                    backgroundColor: 'var(--cyan)',
                    color: '#fff',
                }}
            >
                <div>
                    <h2 className="text-2xl font-bold mb-2">Ready to try it?</h2>
                    <p className="text-base" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        Create your first vault in under a minute, or browse what others have built.
                    </p>
                </div>
                <div className="flex gap-4 flex-shrink-0">
                    <Link
                        href="/vault/new"
                        className="px-6 py-3 text-base font-semibold"
                        style={{
                            backgroundColor: '#fff',
                            color: 'var(--cyan-mid)',
                            border: '1px solid #fff',
                        }}
                    >
                        Create a Vault
                    </Link>
                    <Link
                        href="/vaults"
                        className="px-6 py-3 text-base font-semibold"
                        style={{
                            backgroundColor: 'transparent',
                            color: '#fff',
                            border: '1px solid rgba(255,255,255,0.4)',
                        }}
                    >
                        Browse Vaults
                    </Link>
                </div>
            </section>
        </div>
    );
}
