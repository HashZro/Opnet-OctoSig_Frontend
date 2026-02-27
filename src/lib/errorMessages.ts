const FUND_PATTERNS = [
    /insufficient\s+utxo/i,
    /not\s+enough.*utxo/i,
    /available:.*needed:/i,
    /insufficient.*fund/i,
    /insufficient.*balance/i,
    /not\s+enough.*satoshi/i,
    /not\s+enough.*btc/i,
];

/**
 * Checks if an error message is related to insufficient BTC funds
 * and returns a user-friendly message if so.
 * Otherwise returns the original error message.
 */
export function friendlyError(err: any): { message: string; isFunding: boolean } {
    const raw = err?.message ?? err?.toString?.() ?? 'Unknown error';
    for (const pattern of FUND_PATTERNS) {
        if (pattern.test(raw)) {
            return {
                message: 'Not enough BTC in your wallet to cover this transaction. Please fund your wallet with more BTC and try again.',
                isFunding: true,
            };
        }
    }
    return { message: raw, isFunding: false };
}
