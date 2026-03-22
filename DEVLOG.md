# Deco Private — Build Devlog

A full record of what was built, why each decision was made, and exactly where and how MagicBlock is used.

---

## What is Deco Private?

Deco Private is an on-chain startup grant accelerator built on Solana. The core loop is:

1. **Founders** submit their startup for a grant round — name, description, funding ask, wallet address, image, git repo, Twitter handle.
2. **Community members** cast private votes on which project deserves funding. Votes are shielded inside a Trusted Execution Environment (TEE) so no one can see how you voted or game the result.
3. **VCs** browse active rounds sorted by vote count, stake SOL as collateral, and invest directly into project wallets — no escrow, no intermediary.

Everything is on-chain on Solana devnet. Program ID: `4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX`

---

## Task 1 — Anchor Program Setup

**File:** `programs/deco-private/src/lib.rs`

Started from a Rock-Paper-Scissors template and rewrote it into a grant voting program. The program defines two on-chain account types:

- `GrantRound` — stores `round_id`, `is_active`, `winner` (optional pubkey), and `authority`. One PDA per grant round, seeded with `[b"grant_round", round_id_le_bytes]`.
- `MemberVote` — stores `round_id`, `voter` pubkey, and `voted_for` (optional pubkey). One PDA per voter per round, seeded with `[b"member_vote", round_id_le_bytes, voter_pubkey]`.

Instructions written:

| Instruction | What it does |
|---|---|
| `create_grant_round` | Creates a new `GrantRound` PDA on base chain. Called by the founder when submitting. |
| `init_member_vote` | Creates a `MemberVote` PDA for the voter on base chain. Must exist before delegation. |
| `cast_vote` | Records the voter's choice inside the `MemberVote` account. Runs on the Ephemeral Rollup. |
| `commit_vote` | Commits the vote state from the ER back to base chain and undelegates the account. |
| `delegate_grant_round` | Delegates a `GrantRound` PDA to the MagicBlock ER. |
| `delegate_member_vote` | Delegates a `MemberVote` PDA to the MagicBlock ER. |

Built with `cargo build-sbf` and deployed to Solana devnet.

---

## Task 2 — Frontend

**Files:** `deco-private/App.tsx`, `deco-private/index.tsx`, `deco-private/hooks/useDecoProgram.ts`

Built with Vite + React + TypeScript + Tailwind CSS. Design system: stone/gold palette, Playfair Display serif font, rounded-full buttons.

Wallet integration uses `@solana/wallet-adapter-react`. Phantom and Solflare connect via the Wallet Standard — no explicit wallet list needed, so `wallets: []` is passed to `WalletProvider` in `index.tsx`.

Fixed a blank screen issue caused by dynamic imports — switched to static imports for all wallet adapter packages.

---

## Task 3 — GitHub

Remote named `deco` (not `origin`). Push with:

```bash
git push deco main
```

Repo: https://github.com/neelpote/deco-private

---

## Task 4 — MagicBlock Integration

**Files:** `deco-private/hooks/useDecoProgram.ts`, `deco-private/idl/deco_private.json`

### Why MagicBlock?

Votes on a public blockchain are visible to everyone. If you can see how other members are voting in real time, you can be influenced or you can try to game the outcome. MagicBlock's Ephemeral Rollup (ER) solves this by processing the `cast_vote` instruction inside a Trusted Execution Environment — the vote is recorded off the public chain, shielded from observers, and only the final committed state settles back to Solana.

### How MagicBlock is used — step by step

#### 1. The `#[ephemeral]` macro on the program module

```rust
#[ephemeral]
#[program]
pub mod deco_private { ... }
```

This macro from `ephemeral_rollups_sdk` marks the program as compatible with MagicBlock's ER runtime. It enables the program to run on both base chain (Solana devnet) and the ephemeral rollup without code changes.

#### 2. The `#[delegate]` macro on delegation contexts

```rust
#[delegate]
#[derive(Accounts)]
pub struct DelegateMemberVote<'info> {
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub validator: Option<AccountInfo<'info>>,
}
```

The `#[delegate]` macro expands the account context to include all the PDAs required by the MagicBlock delegation program: `bufferPda`, `delegationRecordPda`, `delegationMetadataPda`, `ownerProgram`, `delegationProgram`, and `systemProgram`. The `del` constraint on `pda` marks it as the account being delegated.

**Critical detail:** `bufferPda` is derived using our own program ID as the seeds program, not the delegation program ID. This is because the `#[delegate]` macro uses `seeds::program = crate::id()` internally.

```typescript
// bufferPda — seeded from OUR program ID
const [bufferPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('buffer'), accountPda.toBuffer()], programId);

// delegationRecordPda and delegationMetadataPda — seeded from the delegation program
const [delegationRecordPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('delegation'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
const [delegationMetadataPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('delegation-metadata'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
```

#### 3. The `#[commit]` macro on CommitVote

```rust
#[commit]
#[derive(Accounts)]
pub struct CommitVote<'info> {
    #[account(mut)]
    pub member_vote: Account<'info, MemberVote>,
    #[account(mut)]
    pub payer: Signer<'info>,
}
```

The `#[commit]` macro adds the `magic_context` and `magic_program` accounts needed to call `commit_and_undelegate_accounts`. This instruction is called after voting closes to write the final vote state back to Solana base chain and release the delegation.

#### 4. Two separate RPC providers in the frontend

```typescript
// Base chain — Solana devnet
const baseProvider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Magic Router — routes to the ER when the account is delegated
const routerProvider = new AnchorProvider(
  new web3.Connection('https://devnet-router.magicblock.app', {
    wsEndpoint: 'wss://devnet-router.magicblock.app',
    commitment: 'confirmed',
  }),
  wallet,
  { commitment: 'confirmed' }
);
```

`baseProgram` uses `baseProvider` for all base-chain instructions (`createGrantRound`, `initMemberVote`, `delegateMemberVote`, `delegateGrantRound`).

`routerProgram` uses `routerProvider` for `castVote`. The Magic Router inspects the account and automatically routes the transaction to the ER if the account is currently delegated, or falls back to base chain if not.

#### 5. The vote flow end to end

```
initMemberVote      → base chain   → creates MemberVote PDA
delegateMemberVote  → base chain   → hands the PDA to MagicBlock ER
castVote            → Magic Router → vote recorded inside TEE (private)
commitVote          → ER           → final state written back to Solana
```

The IDL was written manually because Anchor v0.30 changed the IDL format. Discriminators were computed from the instruction names using the Anchor 8-byte SHA256 prefix convention.

---

## Task 5 — Vote Flow Fixes

Several bugs were fixed during development:

- `payer` was missing `#[account(mut)]` in delegation contexts — Anchor requires the payer to be marked mutable.
- `bufferPda` was initially derived from the delegation program ID instead of our program ID — fixed once the `#[delegate]` macro source was inspected.
- `confirmTransaction` was using the old signature-only form which caused 30-second timeout errors. Fixed to use the blockhash strategy:

```typescript
const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
// ... build and send tx ...
await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
```

Timeouts are swallowed as soft warnings since the transaction likely landed — the 30s window is a client-side limit, not a chain limit.

---

## Task 6 — Routing and Grants Page

Added hash-based client-side routing (`#grants`, `#vc`, default = home). No router library needed.

`GrantsPage` shows all active grant rounds as cards sorted by vote count. Top-voted card gets a "Top Voted" badge. A dark dashboard banner at the top shows the leading grant. Each card shows: project image, name, description, founder, Twitter (linked), git repo (linked), funding ask, wallet address, and vote count. A vote modal lets members cast their private vote.

---

## Task 7 — Rich Submission Form

The grant submission form collects:

- Project name
- Description
- Founder name
- Twitter/X handle
- Git repository URL
- Funding ask (SOL amount)
- Project image (base64 via `FileReader`, stored in `localStorage`)
- Project wallet address (where VC funds go)

All metadata is stored in `localStorage` keyed by round ID. The on-chain program only stores the minimal state (`GrantRound` PDA). Rich metadata lives client-side — appropriate for a hackathon prototype.

---

## Task 8 — VC Dashboard

**File:** `deco-private/App.tsx` — `VCPage` component

The VC page has three sections:

**Step 1 — Stake Collateral**
VCs send SOL to the Deco treasury wallet via a `SystemProgram.transfer` instruction. This signals commitment. Quick-pick buttons for 0.5 / 1 / 2 / 5 SOL.

**Step 2 — Invest in Grants**
Rounds sorted by vote count. Each card shows project image, rank, founder, description, vote count, funding ask, total raised (live on-chain balance), and the VC's own investment total. Invest button sends SOL directly to the project wallet via `SystemProgram.transfer`.

**Funding progress bar**
Each card shows a gold fill bar comparing the live on-chain balance of the project wallet against the founder's stated funding ask:

```tsx
<div className="w-full bg-stone-100 rounded-full h-1.5">
  <div className="h-1.5 rounded-full transition-all"
    style={{ backgroundColor: GOLD, width: `${Math.min(100, (raised / goal) * 100)}%` }} />
</div>
```

On-chain balances are fetched with `connection.getBalance(projectWalletPubkey)` and refreshed after each investment.

**Investment history**
All investments are persisted to `localStorage` and shown in a reverse-chronological list.

**Header stats:** Staked (session), Your Investments, Total On-chain Raised, Investments count, Active Rounds.

---

## Task 9 — Landing Page Copy

Rewrote the hero and War Room sections from jargon-heavy ("Private Ephemeral Rollups", "Shielded Governance") to plain English that explains what the product actually does. The three feature cards were changed from infrastructure descriptions to the three user actions: Submit a Grant, Private Voting, VC Investment. Section header changed from "Shielded Infrastructure" to "How It Works".

---

## MagicBlock — Full Reference

| Where | What | Why |
|---|---|---|
| `Cargo.toml` | `ephemeral-rollups-sdk` dependency | Provides the `#[ephemeral]`, `#[delegate]`, `#[commit]` macros and CPI helpers |
| `lib.rs` — `#[ephemeral]` on module | Marks program as ER-compatible | Allows the same binary to run on base chain and the rollup |
| `lib.rs` — `#[delegate]` on `DelegateGrantRound` | Expands accounts for GrantRound delegation | Hands the GrantRound PDA to the ER so it can be mutated off-chain |
| `lib.rs` — `#[delegate]` on `DelegateMemberVote` | Expands accounts for MemberVote delegation | Hands the MemberVote PDA to the ER so `cast_vote` runs privately |
| `lib.rs` — `#[commit]` on `CommitVote` | Adds magic_context + magic_program accounts | Enables `commit_and_undelegate_accounts` CPI to write state back to Solana |
| `lib.rs` — `commit_and_undelegate_accounts` CPI | Settles ER state to base chain | Final vote is written to Solana and delegation is released |
| `useDecoProgram.ts` — `MAGIC_ROUTER_RPC` | `https://devnet-router.magicblock.app` | Routes `castVote` to the ER when the account is delegated |
| `useDecoProgram.ts` — `routerProvider` | Second Anchor provider pointing at Magic Router | Separate from base chain provider so only `castVote` goes through the router |
| `useDecoProgram.ts` — `castVote` uses `routerProgram` | Sends vote tx to Magic Router | Vote is processed inside TEE, invisible on public Solana explorer |
| `useDecoProgram.ts` — `bufferPda` derivation | Seeds from our program ID, not delegation program | The `#[delegate]` macro owns the buffer PDA under `crate::id()` |
| `DELEGATION_PROGRAM` constant | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | MagicBlock's on-chain delegation registry program |
| IDL — `delegate_grant_round` / `delegate_member_vote` accounts | Includes `owner_program`, `delegation_program`, buffer + record + metadata PDAs | Required by the delegation program to register the account handoff |

---

## Key Constants

```
Program ID:          4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX
Delegation Program:  DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
Magic Router RPC:    https://devnet-router.magicblock.app
Magic Router WS:     wss://devnet-router.magicblock.app
Network:             Solana devnet
```

---

## File Map

```
programs/deco-private/src/lib.rs       — Anchor smart contract
deco-private/hooks/useDecoProgram.ts   — All on-chain interactions
deco-private/idl/deco_private.json     — Manually written Anchor v0.30 IDL
deco-private/App.tsx                   — Full frontend (home, grants, VC pages)
deco-private/index.tsx                 — Wallet adapter setup, static imports
Anchor.toml                            — Program config, devnet cluster
```

---

## Task 10 — TEE Live Integration

`tee.magicblock.app` came online during the hackathon. Verified endpoints:

- `GET /auth/challenge?pubkey=...` → returns a real nonce with timestamp
- `POST /` with `getHealth` → `{"result":"ok"}`
- `POST /` with `getSlot` → live slot number
- Unauthenticated RPC calls → `"Missing token query param"` (auth enforced)

Replaced the manual REST auth implementation with the official SDK:

```typescript
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';
const token = await getAuthToken(TEE_RPC, wallet.publicKey, wallet.signMessage);
// Connection built as: tee.magicblock.app?token=<token>
```

All `castVote` transactions now route through the actual TEE enclave. This makes Deco Private eligible for the 1st place privacy track.

---

## Task 11 — Delegation Loop Fix

**Problem:** Clicking "Delegate to TEE" or "Vote" would keep popping up wallet approval dialogs in a loop.

**Root cause 1 — insufficient SOL:** The devnet wallet had no balance. Each delegation tx costs ~0.00008 SOL for rent + fees.

**Root cause 2 — no delegation status check:** `delegateMemberVote` and `delegateGrantRound` were called unconditionally. If the account was already delegated, the tx would fail and the UI would retry.

**Fix:** Added `isAlreadyDelegated` check before every delegation call — queries the `delegationRecordPda` on-chain. If it exists, skip silently.

```typescript
const isAlreadyDelegated = async (accountPda) => {
  const { delegationRecordPda } = getDelegationPdas(accountPda);
  const info = await connection.getAccountInfo(delegationRecordPda);
  return info !== null;
};
```

---

## Task 12 — Delegate Button State

After delegation succeeds, the "Delegate to TEE" nav button now:
- Turns green and shows "🔒 TEE Active"
- Gets disabled (can't be clicked again)
- Persists state across page refreshes via `localStorage`

---

## Task 13 — Submission Fix (AccountOwnedByWrongProgram)

**Error:** `AnchorError: AccountOwnedByWrongProgram` on grant submission after delegation.

**Root cause:** After delegating, `GrantRound` PDAs are owned by `DELeGG...` (delegation program), not our program. `grantRound.all()` only returns accounts owned by our program, so `grantRounds.length` returned 0. `nextId = 0 + 1 = 1` — which tried to `init` a PDA that already existed and was owned by the wrong program.

**Fix 1:** Timestamp-based round IDs guarantee no collision:
```typescript
const nextId = Date.now() % 1_000_000;
```

**Fix 2:** Round IDs persisted to `localStorage` under `deco_round_ids`. `fetchAllGrantRounds` now checks these known IDs against on-chain account existence, so delegated rounds still appear in the UI even after their ownership transfers to the delegation program.
