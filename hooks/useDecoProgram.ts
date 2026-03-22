import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN, web3 } from '@coral-xyz/anchor';
import IDL_JSON from '../idl/deco_private.json';

export const PROGRAM_ID         = '4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX';
export const DELEGATION_PROGRAM = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
export const TEE_RPC            = 'https://tee.magicblock.app';
export const ROUTER_RPC         = 'https://devnet-router.magicblock.app';
export const ROUTER_WS          = 'wss://devnet-router.magicblock.app';

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
  const [bufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('buffer'), accountPda.toBuffer()], programId);
  const [delegationRecordPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
  const [delegationMetadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation-metadata'), accountPda.toBuffer()], DELEGATION_PROGRAM_ID);
  return { bufferPda, delegationRecordPda, delegationMetadataPda };
}

// Try TEE auth — returns token string or null if unavailable
async function tryGetTeeToken(
  pubkey: PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<string | null> {
  try {
    const res = await fetch(`${TEE_RPC}/auth/challenge?pubkey=${pubkey.toBase58()}`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const { challenge } = await res.json() as { challenge: string };
    if (!challenge) return null;

    const sig = await signMessage(new TextEncoder().encode(challenge));

    // bs58 encode the signature
    const bs58chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const encodeBase58 = (buf: Uint8Array): string => {
      let n = BigInt('0x' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(''));
      let result = '';
      while (n > 0n) { result = bs58chars[Number(n % 58n)] + result; n /= 58n; }
      for (const byte of buf) { if (byte !== 0) break; result = '1' + result; }
      return result;
    };
    const sigStr = encodeBase58(sig);

    const loginRes = await fetch(`${TEE_RPC}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: pubkey.toBase58(), challenge, signature: sigStr }),
      signal: AbortSignal.timeout(6000),
    });
    if (!loginRes.ok) return null;
    const { token } = await loginRes.json() as { token: string };
    return token || null;
  } catch {
    return null;
  }
}

export function useDecoProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const baseProvider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    return new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
  }, [connection, wallet.publicKey, wallet.signTransaction]);

  const baseProgram = useMemo(() => {
    if (!baseProvider) return null;
    try { return new Program(IDL_JSON as any, baseProvider); }
    catch (e) { console.error('baseProgram init failed:', e); return null; }
  }, [baseProvider]);

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

  const isAlreadyDelegated = useCallback(async (accountPda: PublicKey): Promise<boolean> => {
    try {
      const { delegationRecordPda } = getDelegationPdas(accountPda);
      const info = await connection.getAccountInfo(delegationRecordPda);
      return info !== null;
    } catch { return false; }
  }, [connection]);

  const delegateMemberVote = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getMemberVotePda(roundId, wallet.publicKey);
    if (await isAlreadyDelegated(pda)) {
      console.log('MemberVote already delegated, skipping');
      return null;
    }
    const { bufferPda, delegationRecordPda, delegationMetadataPda } = getDelegationPdas(pda);
    const tx = await (baseProgram.methods as any)
      .delegateMemberVote(new BN(roundId))
      .accounts({
        pda, payer: wallet.publicKey, validator: null,
        ownerProgram: programId, bufferPda, delegationRecordPda,
        delegationMetadataPda, delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('delegateMemberVote tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey, isAlreadyDelegated]);

  const delegateGrantRound = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getGrantRoundPda(roundId);
    if (await isAlreadyDelegated(pda)) {
      console.log('GrantRound already delegated, skipping');
      return null;
    }
    const { bufferPda, delegationRecordPda, delegationMetadataPda } = getDelegationPdas(pda);
    const tx = await (baseProgram.methods as any)
      .delegateGrantRound(new BN(roundId))
      .accounts({
        pda, payer: wallet.publicKey, validator: null,
        ownerProgram: programId, bufferPda, delegationRecordPda,
        delegationMetadataPda, delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('delegateGrantRound tx:', tx);
    return tx;
  }, [baseProgram, wallet.publicKey, isAlreadyDelegated]);

  const castVote = useCallback(async (
    roundId: number,
    projectPubkey: PublicKey,
  ): Promise<{ teeAuthenticated: boolean }> => {
    if (!wallet.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected');

    const memberVotePda  = getMemberVotePda(roundId, wallet.publicKey);
    const grantRoundPda  = getGrantRoundPda(roundId);

    // Try TEE auth — fall back to devnet-router if it fails
    let rpcEndpoint  = ROUTER_RPC;
    let wsEndpoint   = ROUTER_WS;
    let teeAuthenticated = false;

    if (wallet.signMessage) {
      const token = await tryGetTeeToken(wallet.publicKey, wallet.signMessage.bind(wallet));
      if (token) {
        rpcEndpoint      = `${TEE_RPC}?token=${token}`;
        wsEndpoint       = `${TEE_RPC.replace('https', 'wss')}?token=${token}`;
        teeAuthenticated = true;
        console.log('[deco] TEE authenticated, routing castVote through TEE');
      } else {
        console.warn('[deco] TEE auth failed, falling back to devnet-router');
      }
    }

    const erConn     = new web3.Connection(rpcEndpoint, { wsEndpoint, commitment: 'confirmed' });
    const erProvider = new AnchorProvider(erConn, wallet as any, { commitment: 'confirmed' });
    const erProgram  = new Program(IDL_JSON as any, erProvider);

    // Build the transaction manually so we can use the ER connection's blockhash
    const ix = await (erProgram.methods as any)
      .castVote(new BN(roundId), projectPubkey)
      .accounts({ memberVote: memberVotePda, grantRound: grantRoundPda, voter: wallet.publicKey })
      .instruction();

    const { blockhash, lastValidBlockHeight } = await erConn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: wallet.publicKey });
    tx.add(ix);

    const signed = await wallet.signTransaction(tx);
    const sig = await erConn.sendRawTransaction(signed.serialize(), { skipPreflight: true });

    try {
      await erConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    } catch {
      // Timeout is a client-side limit — tx likely landed
      console.warn('[deco] confirmTransaction timed out, tx likely landed:', sig);
    }

    console.log(`castVote tx (${teeAuthenticated ? 'TEE' : 'devnet-router'}):`, sig);
    return { teeAuthenticated };
  }, [wallet]);

  const fetchAllGrantRounds = useCallback(async () => {
    if (!baseProgram) return [];
    try {
      const ours = await (baseProgram.account as any).grantRound.all();
      const ourMapped = ours.map((r: any) => ({
        pubkey: r.publicKey as PublicKey,
        roundId: r.account.roundId,
        isActive: r.account.isActive,
        winner: r.account.winner,
      }));
      // Also surface delegated rounds tracked in localStorage
      const knownIds: number[] = JSON.parse(localStorage.getItem('deco_round_ids') || '[]');
      const ourIdSet = new Set(ourMapped.map((r: any) => r.roundId.toNumber()));
      for (const id of knownIds) {
        if (ourIdSet.has(id)) continue;
        const pda  = getGrantRoundPda(id);
        const info = await connection.getAccountInfo(pda);
        if (info) {
          ourMapped.push({ pubkey: pda, roundId: { toNumber: () => id }, isActive: true, winner: null });
        }
      }
      return ourMapped;
    } catch { return []; }
  }, [baseProgram, connection]);

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
      const pda  = getMemberVotePda(roundId, wallet.publicKey);
      const vote = await (baseProgram.account as any).memberVote.fetch(pda);
      return vote.votedFor !== null;
    } catch { return false; }
  }, [baseProgram, wallet.publicKey]);

  const commitVote = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getMemberVotePda(roundId, wallet.publicKey);
    const tx  = await (baseProgram.methods as any)
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
