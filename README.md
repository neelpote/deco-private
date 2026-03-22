<div align="center">

# 🛡️ Deco Private

**The first shielded decentralized startup accelerator on Solana.**

[![Solana Blitz V2](https://img.shields.io/badge/Hackathon-Solana_Blitz_V2-purple?style=for-the-badge)](https://hackathon.magicblock.app/)
[![Built with MagicBlock](https://img.shields.io/badge/Powered_by-MagicBlock_PERs-black?style=for-the-badge&logo=solana)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

*Cast private votes, shield your cap table, and scale in the shadows.*

---

*(Replace this line with your Hero/Dashboard Screenshot: e.g., `<img src="./public/hero.png" width="800">`)*

</div>

Live Link--   https://deco-private.vercel.app/

## 💡 The Problem: "The Cap Table Panopticon"

In standard Web3 accelerators and DAOs, every vote, investment, and cap table update is broadcast to the public mainnet in real-time. This complete transparency creates massive inefficiencies:

1. **Predatory Signaling:** VCs and whales watch public votes and front-run investments.
2. **Herd Mentality:** DAO members are heavily influenced by live vote counts, crushing independent, objective thought.
3. **Founder Vulnerability:** Startups are forced to expose their runway and early cap tables to the public before they are ready.

## ✨ The Solution: Deco Private

Deco leverages **MagicBlock's Private Ephemeral Rollups (PERs)** and Intel SGX Trusted Execution Environments (TEEs) to create a shielded "War Room" for startup acceleration.

We allow DAO members to cast encrypted, off-chain votes that are mathematically verified but completely invisible to the public Solana explorer. Only when the round officially concludes is the final state decrypted and settled back to the base chain.

---

## 🎯 Target Hackathon Tracks

Deco Private was built specifically for the **Solana Blitz V2 Hackathon**, targeting the following tracks:

* **🏆 MagicBlock Privacy Track:** Utilizing Ephemeral Rollups to shield on-chain voting and state transitions from public block explorers.
* **🏆 Consumer / DAO Track:** Creating a seamless, Web2-quality, institutional UX for decentralized governance and accelerator funding.

---

## 🚀 Platform Features (By Persona)

### For Founders (The Applicants)
* **Shielded Pitching:** Submit startup details (Ask, Repo, Socials) without exposing your live cap table or funding momentum to competitors.
* **Direct Treasury Access:** If your grant wins, VC and DAO funds are routed directly to your project wallet—no escrow delays.

### For DAO Members (The Voters)
* **Zero-Fee Voting:** Because votes happen inside the Ephemeral Rollup, users don't pay Solana base-fee gas costs for every action.
* **Encrypted Ballots:** Votes are cast privately. The UI features a "Fog of War" toggle, visually proving the data is hidden from standard mainnet block explorers.

### For VCs & Angels (The Investors)
* **Real-time Settlement:** Once a round is decrypted and the winner is publicly revealed on the L1, VCs can stake SOL collateral and invest immediately.

---

## 🔮 Deep Dive: MagicBlock Architecture

Deco uses MagicBlock to temporarily move state accounts off the slow, public mainnet and into a high-speed, private enclave. Here is the exact lifecycle of a Deco Grant Round:

```text
1️⃣ INIT (Solana Devnet)
─────────────────────────
The founder calls `create_grant_round`. A PDA is initialized on the
public Solana devnet.
            ⬇

2️⃣ DELEGATE (The Handoff)
─────────────────────────
Admin calls `delegate_grant_round`. The PDA is transferred to the
MagicBlock ER Validator using the `#[delegate]` macro.
            ⬇

3️⃣ SHIELDED VOTING (MagicBlock TEE) 🔒
─────────────────────────
DAO members sign a wallet message to retrieve an AuthToken.
The `cast_vote` instruction executes inside the Intel SGX TEE.

❌ Standard Explorers see: [ ENCRYPTED HASH ]
✅ Authenticated Users see: Real-time UI
            ⬇

4️⃣ DECRYPT & SETTLE (Solana Devnet)
─────────────────────────
Admin calls `commit_vote`. The TEE state is compressed,
settled back to the L1 via CPI, and the winner is publicly revealed.
```

---

## 🛠️ Comprehensive Tech Stack

### Smart Contracts (Backend)

| Technology | Description |
|---|---|
| Rust & Anchor (v0.32.1) | The core framework for our Solana smart contracts. |
| MagicBlock SDK | Utilized `ephemeral-rollups-sdk` for `#[ephemeral]`, `#[delegate]`, and `#[commit]` macros. |
| Custom IDL | Manually structured Anchor v0.30 IDL with 8-byte SHA256 instruction discriminators. |

### Frontend (Client)

| Technology | Description |
|---|---|
| Next.js & React | App router, strict TypeScript, and server/client state management. |
| Tailwind CSS & Lucide | Custom "Dark Institutional" design system with glassmorphism UI. |
| Solana Wallet Adapter | Standard wallet connection supporting Phantom, Solflare, etc. |
| Web3.js (@solana/web3.js) | RPC connection and blockhash polling for transaction confirmation. |

---

## 💻 Local Development Quickstart

```bash
# Clone the repository
git clone <your-repo-url>
cd deco-private

# Install dependencies
npm install

# Start the development server
npm run dev
```

---

## 📝 Important Note for Judges (Privacy Track)

The MagicBlock TEE endpoint (`tee.magicblock.app`) is **fully live and integrated**. Deco Private uses the official `getAuthToken` function from `@magicblock-labs/ephemeral-rollups-sdk` to perform the full Intel TDX challenge/sign/token handshake before every vote.

The exact flow:
1. User clicks "Vote" — wallet is prompted to sign a TEE challenge nonce
2. The signed challenge is exchanged for an auth token via the SDK
3. `castVote` is sent to `tee.magicblock.app?token=<authToken>` — routed inside the TEE enclave
4. Vote state is shielded from the public Solana explorer until `commitVote` settles it back to L1

Grant round PDAs are delegated to the MagicBlock ER via the "Delegate to TEE" button in the nav. Once delegated, the button turns green ("🔒 TEE Active") and new submissions use timestamp-based round IDs to avoid PDA collisions with delegated accounts.

We have included a highly detailed `Devlog.md` in this repository that breaks down exactly how we built our Anchor program architecture and CPI routing. We highly recommend reviewing it!

---

## 📜 Deployed Contracts

**Network:** Solana Devnet

| Contract | Address |
|---|---|
| Deco Program ID | `4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX` |
| MagicBlock Delegation Program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |

---

<div align="center">
<i>Built with ☕ and 🦀 by Neel Pote for the Solana Blitz V2</i>
</div>
