/**
 * OPNet contract addresses and ABI definitions for the faucet.
 *
 * NOTE: ALPHA and BETA were deployed on the old testnet chain (pre v1.0.0-testnet).
 * That chain was reset — those contracts no longer exist.
 * OctToken (OCT) is deployed on the current testnet chain.
 */

export const NETWORK_NAME = 'OPNet Testnet';
export const RPC_URL = 'https://testnet.opnet.org';

/** AlphaToken — INVALIDATED by testnet chain reset (v1.0.0-testnet) */
export const ALPHA_ADDRESS = 'opt1sqrfpr855j4ngqsyyejc00fvheult7s3mjug2pz9n';
/** BetaToken — INVALIDATED by testnet chain reset (v1.0.0-testnet) */
export const BETA_ADDRESS = 'opt1sqpjcuujxqtgawt6ck8qxdw6pue728rkcnghpp084';

/** Token contract — name/symbol read from chain at runtime */
export const OCT_ADDRESS = '0xbf564b41d0a1439386da00a28e20025fc78c994018d92ca67bf7591aa8805c82';

/**
 * Internal 32-byte hex addresses for calldata encoding.
 */
export const OCT_ADDRESS_HEX = '0xbf564b41d0a1439386da00a28e20025fc78c994018d92ca67bf7591aa8805c82';

/** Tokens received per mine call */
export const MINE_REWARD_TOKENS = 100;

/**
 * OPNet ABI for mine() — free claim, no BTC payment required.
 */
export const MINE_ABI = [
    {
        name: 'mine',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'amount', type: 'UINT256' }],
    },
];

// ══════════════════════════════════════════════════════════════════════
//  MultSigVault — Factory-pattern multisig vault contract
// ══════════════════════════════════════════════════════════════════════

/** MultSigVault contract — v3 gas-optimized (no SHA256 keys), deployed on current testnet chain */
// Bech32: opt1sqz2mywkf7vp38jyjxf4r9q9l3eqaa2sdg5fcnnwz
// Hex (contract pubkey — used for RPC calls):
export const VAULT_ADDRESS = '0x3e91ca44a8a6bf585644485ffab376bc1a292d84ce4cbf357a4cf95e0717f586';

/**
 * MultSigVault ABI — single-proposal-per-vault model
 *
 * Methods:
 *   createVault(token, ownerCount, owners[], threshold) → vaultId
 *   deposit(vaultId, amount) → success
 *   propose(vaultId, to, amount) → success  (auto-votes yes, replaces existing)
 *   approve(vaultId) → success              (vote yes on active proposal)
 *   executeProposal(vaultId) → success      (transfer if threshold met, deletes proposal)
 *   getVaultCount() → count
 *   getVaultInfo(vaultId) → threshold, ownerCount, token, balance, totalProposals, hasProposal, owners[]
 *   getProposal(vaultId) → to, amount, approvals
 *   checkOwner(vaultId, address) → result
 */
export const VAULT_ABI = [
    {
        name: 'createVault',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'vaultId', type: 'UINT256' }],
    },
    {
        name: 'deposit',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'success', type: 'BOOL' }],
    },
    {
        name: 'propose',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'success', type: 'BOOL' }],
    },
    {
        name: 'approve',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'success', type: 'BOOL' }],
    },
    {
        name: 'executeProposal',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'success', type: 'BOOL' }],
    },
    {
        name: 'getVaultCount',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'count', type: 'UINT256' }],
    },
    {
        name: 'getVaultInfo',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [],
    },
    {
        name: 'getProposal',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [],
    },
    {
        name: 'checkOwner',
        type: 'function',
        payable: false,
        inputs: [],
        outputs: [{ name: 'result', type: 'BOOL' }],
    },
];
