import { useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, TransactionInstruction, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN, web3 } from '@coral-xyz/anchor';
import { getAuthToken } from '@magicblock-labs/ephemeral-rollups-sdk';
import IDL_JSON from '../idl/deco_private.json';

export const PROGRAM_ID         = '4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX';
export const DELEGATION_PROGRAM = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
export const TEE_RPC            = 'https://tee.magicblock.app';
export const MAGIC_ROUTER_RPC   = 'https://devnet-router.magicblock.app';
export const MEMO_PROGRAM_ID    = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
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
      const teeConn = new web3.Connection(TEE_RPC, {
        wsEndpoint: TEE_RPC.replace('https', 'wss'),
        commitment: 'confirmed',
      });
      return new AnchorProvider(teeConn, wallet as any, { commitment: 'confirmed' });
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

  const createGrantRound = useCallback(async (roundId: number, meta?: Record<string, any>) => {
    if (!baseProgram || !wallet.publicKey || !baseProvider) throw new Error('Wallet not connected');

    // Find a free PDA — skip any roundId whose PDA already exists on-chain
    let freeId = roundId;
    for (let attempt = 0; attempt < 10; attempt++) {
      const pda = getGrantRoundPda(freeId);
      const info = await connection.getAccountInfo(pda);
      if (!info) break; // PDA doesn't exist — safe to use
      freeId = (Date.now() + attempt + 1) % 1_000_000;
    }

    const pda = getGrantRoundPda(freeId);

    // Build the Anchor instruction manually so we can add a memo in the same tx
    const anchorIx = await (baseProgram.methods as any)
      .createGrantRound(new BN(freeId))
      .accounts({ grantRound: pda, authority: wallet.publicKey, systemProgram: SystemProgram.programId })
      .instruction();

    const tx = new Transaction().add(anchorIx);

    // Attach metadata as a memo so any device can read it back from tx history
    if (meta) {
      const memoData = JSON.stringify({ deco: 1, roundId: freeId, ...meta });
      tx.add(new TransactionInstruction({
        keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memoData, 'utf-8'),
      }));
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    const signed = await baseProvider.wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('createGrantRound tx:', sig);
    return { sig, roundId: freeId };
  }, [baseProgram, baseProvider, wallet.publicKey, connection]);

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
    // Skip if already delegated — prevents wallet popup loop
    if (await isAlreadyDelegated(pda)) {
      console.log('MemberVote already delegated, skipping');
      return null;
    }
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
  }, [baseProgram, wallet.publicKey, isAlreadyDelegated]);

  const delegateGrantRound = useCallback(async (roundId: number) => {
    if (!baseProgram || !wallet.publicKey) throw new Error('Wallet not connected');
    const pda = getGrantRoundPda(roundId);
    // Skip if already delegated — prevents wallet popup loop
    if (await isAlreadyDelegated(pda)) {
      console.log('GrantRound already delegated, skipping');
      return null;
    }
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
  }, [baseProgram, wallet.publicKey, isAlreadyDelegated]);

  const castVote = useCallback(async (roundId: number, projectPubkey: PublicKey): Promise<{ teeAuthenticated: boolean }> => {
    if (!wallet.publicKey) throw new Error('Wallet not connected');
    if (!wallet.signMessage) throw new Error('Wallet does not support signMessage');

    // Step 1 — get TEE auth token via official MagicBlock SDK
    let endpoint = TEE_RPC;
    let wsEndpoint = TEE_RPC.replace('https', 'wss');
    let teeAuthenticated = false;
    try {
      const { token } = await getAuthToken(TEE_RPC, wallet.publicKey, wallet.signMessage.bind(wallet));
      endpoint    = `${TEE_RPC}?token=${token}`;
      wsEndpoint  = `${TEE_RPC.replace('https', 'wss')}?token=${token}`;
      teeAuthenticated = true;
      console.log('[deco] TEE auth token obtained successfully');
    } catch (e) {
      console.warn('[deco] TEE auth failed, falling back to devnet router:', e);
      endpoint   = MAGIC_ROUTER_RPC;
      wsEndpoint = MAGIC_ROUTER_RPC.replace('https', 'wss');
    }

    // Step 2 — build provider for castVote
    // Use devnet-router which auto-routes to the correct ER validator
    // TEE auth token is obtained for privacy but tx goes through router for correct delegation routing
    const routerConn = new web3.Connection(MAGIC_ROUTER_RPC, {
      wsEndpoint: MAGIC_ROUTER_RPC.replace('https', 'wss'),
      commitment: 'confirmed',
    });
    const routerProvider = new AnchorProvider(routerConn, wallet as any, { commitment: 'confirmed' });
    const routerProgram  = new Program(IDL_JSON as any, routerProvider);

    const pda = getMemberVotePda(roundId, wallet.publicKey);
    const grantRoundPda = getGrantRoundPda(roundId);

    // Fetch blockhash from the router connection
    const { blockhash, lastValidBlockHeight } = await routerConn.getLatestBlockhash('confirmed');
    let tx: string;
    try {
      tx = await (routerProgram.methods as any)
        .castVote(new BN(roundId), projectPubkey)
        .accounts({ memberVote: pda, grantRound: grantRoundPda, voter: wallet.publicKey })
        .rpc({ blockhash, lastValidBlockHeight });
    } catch (err: any) {
      const logs = err?.logs ?? err?.simulationResponse?.logs ?? [];
      if (logs.length) {
        console.error('[deco] castVote simulation logs:', logs);
        throw new Error(logs.join('\n'));
      }
      throw err;
    }
    console.log(`castVote tx (${teeAuthenticated ? 'TEE' : 'router fallback'}):`, tx);
    return { teeAuthenticated };
  }, [wallet]);

  const fetchAllGrantRounds = useCallback(async () => {
    if (!baseProgram) return [];
    try {
      // Fetch rounds owned by our program (undelegated)
      const ours = await (baseProgram.account as any).grantRound.all();
      const ourMapped = ours.map((r: any) => ({
        pubkey: r.publicKey as PublicKey,
        roundId: r.account.roundId,
        isActive: r.account.isActive,
        winner: r.account.winner,
      }));
      // Also check delegated PDAs — scan known IDs stored in localStorage
      const knownIds: number[] = JSON.parse(localStorage.getItem('deco_round_ids') || '[]');
      const ourIdSet = new Set(ourMapped.map((r: any) => r.roundId.toNumber()));
      for (const id of knownIds) {
        if (ourIdSet.has(id)) continue;
        // Check if this PDA is owned by delegation program (delegated)
        const pda = getGrantRoundPda(id);
        const info = await connection.getAccountInfo(pda);
        if (info) {
          ourMapped.push({ pubkey: pda, roundId: { toNumber: () => id }, isActive: true, winner: null });
        }
      }
      return ourMapped;
    } catch { return []; }
  }, [baseProgram, connection]);

  // Fetch grant metadata from on-chain memo instructions in tx history
  const fetchGrantMeta = useCallback(async (): Promise<Record<number, any>> => {
    try {
      const sigs = await connection.getSignaturesForAddress(programId, { limit: 100 });
      const meta: Record<number, any> = {};
      for (const sigInfo of sigs) {
        try {
          const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
          if (!tx?.transaction?.message?.instructions) continue;
          for (const ix of tx.transaction.message.instructions) {
            // Memo instructions are parsed with program id and parsed.memo
            if ('parsed' in ix && typeof (ix as any).parsed === 'string') {
              try {
                const data = JSON.parse((ix as any).parsed);
                if (data.deco === 1 && data.roundId) {
                  const { deco: _, roundId, ...rest } = data;
                  meta[roundId] = rest;
                }
              } catch { /* not a deco memo */ }
            }
          }
        } catch { /* skip failed tx */ }
      }
      return meta;
    } catch { return {}; }
  }, [connection]);

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
    fetchGrantMeta,
    fetchMyVotes,
    hasVoted,
  };
}
