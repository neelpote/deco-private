import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN, web3 } from '@coral-xyz/anchor';
import IDL_JSON from '../idl/deco_private.json';

export const PROGRAM_ID         = '4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX';
export const DELEGATION_PROGRAM = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
export const MAGIC_ROUTER_RPC   = 'https://devnet-router.magicblock.app';
export const TEE_RPC            = 'https://tee.magicblock.app';

const MAGIC_ROUTER_WS       = 'wss://devnet-router.magicblock.app';

// ── TEE AuthToken flow ────────────────────────────────────────────────────────
// Implements the MagicBlock challenge/sign/token handshake.
// Falls back to the devnet router if the TEE endpoint is unreachable.
export async function getTeeAuthToken(
  pubkey: PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<{ token: string; endpoint: string; wsEndpoint: string }> {
  try {
    // 1. Request a challenge nonce from the TEE
    const challengeRes = await fetch(
      `${TEE_RPC}/auth/challenge?pubkey=${pubkey.toBase58()}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!challengeRes.ok) throw new Error('TEE challenge failed');
    const { challenge } = await challengeRes.json() as { challenge: string };

    // 2. Sign the challenge bytes with the user's wallet
    const msgBytes = new TextEncoder().encode(challenge);
    const signature = await signMessage(msgBytes);
    const sigBase64 = btoa(String.fromCharCode(...signature));

    // 3. Exchange pubkey + signature for an auth token
    const tokenRes = await fetch(`${TEE_RPC}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: pubkey.toBase58(), signature: sigBase64 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!tokenRes.ok) throw new Error('TEE token exchange failed');
    const { token } = await tokenRes.json() as { token: string };

    return {
      token,
      endpoint:   `${TEE_RPC}?token=${token}`,
      wsEndpoint: `${TEE_RPC.replace('https', 'wss')}?token=${token}`,
    };
  } catch {
    // TEE unreachable — fall back to the public devnet router
    console.warn('[deco] TEE endpoint unreachable, falling back to devnet router');
    return {
      token:      'devnet-fallback',
      endpoint:   MAGIC_ROUTER_RPC,
      wsEndpoint: MAGIC_ROUTER_WS,
    };
  }
}
const DELEGATION_PROGRAM_ID = new PublicKey(DELEGATION_PROGRAM);
const GRANT_ROUND_SEED      = Buffer.from('grant_round');
const MEMBER_VOTE_SEED      = Buffer.from('member_vote');
const programId             = new PublicKey(PROGRAM_ID);

export function getGrantRoundPda(roundId: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(roundId));
  return PublicKey.findProgramAddressSync([GRANT_ROUND_SEED, buf], programId)[0];
}

export function getMemberVotePda(roundId: number, voter: PublicKey): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(roundId));
  return PublicKey.findProgramAddressSync([MEMBER_VOTE_SEED, buf, voter.toBuffer()], programId)[0];
}

function getDelegationPdas(accountPda: PublicKey) {
  // buffer is owned by OUR program (seeds::program = crate::id() in the #[delegate] macro)
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('buffer'), accountPda.toBuffer()], programId);
  // delegation_record and delegation_metadata are owned by the delegation program
  const [delegationRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
  const [delegationMetadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation-metadata'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
  return { bufferPda, delegationRecordPda, delegationMetadataPda };
}

export function useDecoProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const baseProvider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
  }, [connection, wallet.publicKey, wallet.signTransaction]);

  const routerProvider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    try {
      const routerConn = new web3.Connection(MAGIC_ROUTER_RPC, {
        wsEndpoint: MAGIC_ROUTER_WS,
        commitment: 'confirmed',
      });
      return new AnchorProvider(routerConn, wallet as any, { commitment: 'confirmed' });
    } catch {
      return new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
    }
  }, [connection, wallet.publicKey, wallet.signTransaction]);

  const baseProgram = useMemo(() => {
    if (!baseProvider) return null;
    try { return new Program(IDL_JSON as any, baseProvider); }
    catch (e) { console.error('baseProgram init failed:', e); return null; }
  }, [baseProvider]);

  const routerProgram = useMemo(() => {
    if (!routerProvider) return null;
    try { return new Program(IDL_JSON as any, routerProvider); }
    catch (e) { console.error('routerProgram init failed:', e); return null; }
  }, [routerProvider]);

  const createGrantRound = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getGrantRoundPda(roundId);
    const tx = await (baseProgram.methods as any)
      .createGrantRound(new BN(roundId))
      .accounts({ grantRound: pda, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log('createGrantRound tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey]);

  const initMemberVote = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getMemberVotePda(roundId, wallet.publicKey);
    try {
      await (baseProgram.account as any).memberVote.fetch(pda);
      console.log('MemberVote already exists, skipping init');
      return null;
    } catch { /* not found, proceed */ }
    const tx = await (baseProgram.methods as any)
      .initMemberVote(new BN(roundId))
      .accounts({ memberVote: pda, voter: wallet.publicKey, systemProgram: SystemProgram.programId })
      .rpc();
    console.log('initMemberVote tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey]);

  const delegateMemberVote = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getMemberVotePda(roundId, wallet.publicKey);
    const { bufferPda, delegationRecordPda, delegationMetadataPda } = getDelegationPdas(pda);
    const tx = await (baseProgram.methods as any)
      .delegateMemberVote(new BN(roundId))
      .accounts({
        pda,
        payer: wallet.publicKey,
        validator: null,
        ownerProgram: programId,
        bufferPda,
        delegationRecordPda,
        delegationMetadataPda,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('delegateMemberVote tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey]);

  const delegateGrantRound = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getGrantRoundPda(roundId);
    const { bufferPda, delegationRecordPda, delegationMetadataPda } = getDelegationPdas(pda);
    const tx = await (baseProgram.methods as any)
      .delegateGrantRound(new BN(roundId))
      .accounts({
        pda,
        payer: wallet.publicKey,
        validator: null,
        ownerProgram: programId,
        bufferPda,
        delegationRecordPda,
        delegationMetadataPda,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('delegateGrantRound tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey]);

  const castVote = useCallback(async (roundId: number, projectPubkey: PublicKey): Promise<{ teeAuthenticated: boolean }> => {
    if (!wallet.publicKey) throw new Error('Wallet not connected');
    if (!wallet.signMessage) throw new Error('Wallet does not support signMessage');

    // Step 1 — get TEE auth token (prompts wallet for message signature)
    const { token, endpoint, wsEndpoint } = await getTeeAuthToken(
      wallet.publicKey,
      wallet.signMessage.bind(wallet),
    );
    const teeAuthenticated = token !== 'devnet-fallback';

    // Step 2 — build a provider pointing at the authenticated endpoint
    const teeConn = new web3.Connection(endpoint, {
      wsEndpoint,
      commitment: 'confirmed',
    });
    const teeProvider = new AnchorProvider(teeConn, wallet as any, { commitment: 'confirmed' });
    const teeProgram  = new Program(IDL_JSON as any, teeProvider);

    const pda = getMemberVotePda(roundId, wallet.publicKey);

    // Fetch blockhash from the same connection the transaction will be sent through.
    const { blockhash, lastValidBlockHeight } = await teeConn.getLatestBlockhash('confirmed');
    const tx = await (teeProgram.methods as any)
      .castVote(new BN(roundId), projectPubkey)
      .accounts({ memberVote: pda, grantRound: getGrantRoundPda(roundId), voter: wallet.publicKey })
      .rpc({ blockhash, lastValidBlockHeight });
    console.log(`castVote tx (${teeAuthenticated ? 'TEE' : 'router fallback'}):`, tx);
    return { teeAuthenticated };
  }, [wallet]);

  const fetchAllGrantRounds = useCallback(async () => {
    if (!baseProgram) return [];
    try {
      const all = await (baseProgram.account as any).grantRound.all();
      return all.map((r: any) => ({
        pubkey: r.publicKey as PublicKey,
        roundId: r.account.roundId,
        isActive: r.account.isActive,
        winner: r.account.winner,
      }));
    } catch { return []; }
  }, [baseProgram]);

  const fetchMyVotes = useCallback(async () => {
    if (!baseProgram || !wallet.publicKey) return [];
    try {
      const all = await (baseProgram.account as any).memberVote.all();
      return all
        .filter((v: any) => v.account.voter.equals(wallet.publicKey!))
        .map((v: any) => ({
          pubkey: v.publicKey as PublicKey,
          roundId: v.account.roundId,
          voter: v.account.voter,
          votedFor: v.account.votedFor,
        }));
    } catch { return []; }
  }, [baseProgram, wallet.publicKey]);

  const hasVoted = useCallback(async (roundId: number): Promise<boolean> => {
    if (!baseProgram || !wallet.publicKey) return false;
    try {
      const pda = getMemberVotePda(roundId, wallet.publicKey);
      const vote = await (baseProgram.account as any).memberVote.fetch(pda);
      return vote.votedFor !== null;
    } catch { return false; }
  }, [baseProgram, wallet.publicKey]);

  // Commit vote from ER back to base chain and undelegate
  const commitVote = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getMemberVotePda(roundId, wallet.publicKey);
    const tx = await (baseProgram.methods as any)
      .commitVote()
      .accounts({ memberVote: pda, payer: wallet.publicKey })
      .rpc();
    console.log('commitVote tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey]);

  return {
    connected: !!wallet.publicKey,
    publicKey: wallet.publicKey,
    createGrantRound,
    initMemberVote,
    delegateGrantRound,
    delegateMemberVote,
    castVote,
    commitVote,
    fetchAllGrantRounds,
    fetchMyVotes,
    hasVoted,
  };
}
