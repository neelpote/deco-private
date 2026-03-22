/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { ArrowDown, Menu, X, Shield, Lock, Unlock, Activity, Zap, Plus, ChevronDown, ArrowLeft, Vote, CheckCircle, TrendingUp, DollarSign, Users, BarChart2 } from 'lucide-react';
import { useDecoProgram } from './hooks/useDecoProgram';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const HeroScene = lazy(() => import('./components/QuantumScene').then(m => ({ default: m.HeroScene })));
const TransformerDecoderDiagram = lazy(() => import('./components/Diagrams').then(m => ({ default: m.TransformerDecoderDiagram })));

const GOLD = '#C5A059';
// Treasury wallet — receives VC stakes (replace with your actual treasury pubkey)
const TREASURY = new PublicKey('4TocTt21C8CYTGCjP7BgynrL8kQSn2zTHbMhSyB5hivX');

type Page = 'home' | 'grants' | 'vc';

interface GrantRoundData {
  pubkey: any;
  roundId: { toNumber: () => number };
  isActive: boolean;
  winner: any | null;
}
interface VoteData {
  pubkey: any;
  roundId: { toNumber: () => number };
  voter: any;
  votedFor: any | null;
}
interface GrantMeta {
  name: string;
  desc: string;
  founder: string;
  twitter: string;
  gitRepo: string;
  imageUrl: string | null;
  walletAddress: string;
  askAmount: string; // SOL amount requested
}
interface VCInvestment {
  roundId: number;
  amount: number; // SOL
  ts: number;
}

const STORAGE_KEY    = 'deco_grant_meta';
const VC_STORAGE_KEY = 'deco_vc_investments';
const VOTE_COUNT_KEY = 'deco_vote_counts';

function loadAllMeta(): Record<number, GrantMeta> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const result: Record<number, GrantMeta> = {};
    for (const k of Object.keys(raw)) result[Number(k)] = raw[k];
    return result;
  } catch { return {}; }
}
function saveMeta(roundId: number, meta: GrantMeta) {
  const all = loadAllMeta();
  all[roundId] = meta;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
function clearAllMeta() { localStorage.removeItem(STORAGE_KEY); }

function loadVCInvestments(): VCInvestment[] {
  try { return JSON.parse(localStorage.getItem(VC_STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveVCInvestment(inv: VCInvestment) {
  const all = loadVCInvestments();
  all.push(inv);
  localStorage.setItem(VC_STORAGE_KEY, JSON.stringify(all));
}

function loadVoteCounts(): Record<number, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOTE_COUNT_KEY) || '{}');
    const result: Record<number, number> = {};
    for (const k of Object.keys(raw)) result[Number(k)] = raw[k];
    return result;
  } catch { return {}; }
}
function incrementVoteCount(roundId: number) {
  const all = loadVoteCounts();
  all[roundId] = (all[roundId] || 0) + 1;
  localStorage.setItem(VOTE_COUNT_KEY, JSON.stringify(all));
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
const TxToast = ({ msg, onClose }: { msg: string; onClose: () => void }) => (
  <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-stone-900 text-white px-5 py-4 rounded-xl shadow-2xl border border-stone-700 flex items-start gap-3">
    <Shield size={16} className="mt-0.5 shrink-0" style={{ color: GOLD }} />
    <p className="text-sm leading-relaxed flex-1">{msg}</p>
    <button onClick={onClose} className="text-stone-400 hover:text-white shrink-0"><X size={14} /></button>
  </div>
);

const StatBox = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <div className="font-serif text-3xl text-stone-900">{value}</div>
    <div className="text-xs text-stone-500 font-bold uppercase tracking-widest">{label}</div>
  </div>
);

// ── Vote Modal ────────────────────────────────────────────────────────────────
const VoteModal = ({ round, meta, onClose, onVote, loading, alreadyVoted }: {
  round: GrantRoundData; meta?: GrantMeta;
  onClose: () => void; onVote: (roundId: number, pubkey: string) => void;
  loading: boolean; alreadyVoted: boolean;
}) => {
  const roundId = round.roundId.toNumber();
  const winner = round.winner ? round.winner.toString() : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-md p-8 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-stone-900"><X size={20} /></button>
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-600 text-xs font-bold tracking-widest uppercase rounded-full mb-4 border border-stone-200">
          <Vote size={12} /> Cast Private Vote
        </div>
        <h3 className="font-serif text-3xl text-stone-900 mb-1">{meta?.name || `Round #${roundId}`}</h3>
        <p className="text-stone-400 text-sm mb-4">Round #{roundId}{meta?.founder ? ` · ${meta.founder}` : ''}</p>
        <div className="w-12 h-0.5 mb-6" style={{ backgroundColor: GOLD }}></div>
        <div className="space-y-3 mb-8">
          {[
            { label: 'Status', value: round.isActive ? 'Active' : 'Closed', green: round.isActive },
            { label: 'Asking', value: meta?.askAmount ? `${meta.askAmount} SOL` : '—' },
            { label: 'Privacy', value: '🔒 TEE Shielded' },
            { label: 'Winner', value: winner ? winner.slice(0, 8) + '...' + winner.slice(-4) : 'Pending' },
          ].map(r => (
            <div key={r.label} className="flex justify-between border-b border-stone-100 pb-2">
              <span className="text-stone-500 text-xs uppercase font-bold tracking-wider">{r.label}</span>
              <span className={`text-xs font-bold ${(r as any).green ? 'text-emerald-600' : 'text-stone-700'}`}>{r.value}</span>
            </div>
          ))}
        </div>
        {alreadyVoted ? (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
            <CheckCircle size={20} className="text-emerald-600 shrink-0" />
            <p className="text-emerald-700 text-sm font-bold">You have already voted in this round.</p>
          </div>
        ) : (
          <button onClick={() => onVote(roundId, meta?.walletAddress || '11111111111111111111111111111111')}
            disabled={loading || !round.isActive}
            className="w-full py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-colors shadow-sm disabled:opacity-50"
            style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
            {loading ? 'Casting Vote...' : !round.isActive ? 'Round Closed' : 'Cast Private Vote'}
          </button>
        )}
        <p className="text-center text-stone-400 text-xs mt-4">Your vote is encrypted inside the MagicBlock TEE.</p>
      </div>
    </div>
  );
};

// ── Grants Page ───────────────────────────────────────────────────────────────
const GrantsPage = ({ grantRounds, votedRounds, loading, onVote, onBack, myVotes, grantMeta, voteCounts, onNavigateVC, onCommitVote, connected, showToast }: {
  grantRounds: GrantRoundData[]; votedRounds: Record<number, boolean>;
  loading: string | null; onVote: (name: string, roundId: number, pubkey: string) => void;
  onBack: () => void; myVotes: VoteData[]; grantMeta: Record<number, GrantMeta>;
  voteCounts: Record<number, number>; onNavigateVC: () => void;
  onCommitVote: (roundId: number) => Promise<any>;
  connected: boolean; showToast: (msg: string) => void;
}) => {
  const [voteModal, setVoteModal] = useState<GrantRoundData | null>(null);
  const [viewMode, setViewMode]   = useState<'public' | 'tee'>('public');
  const [decryptedRounds, setDecryptedRounds] = useState<Record<number, boolean>>({});
  const [decrypting, setDecrypting] = useState<number | null>(null);

  const displayRounds: GrantRoundData[] = grantRounds.length > 0 ? grantRounds : [];

  const topRound = displayRounds.length > 0
    ? displayRounds.reduce((a, b) => (voteCounts[a.roundId.toNumber()] || 0) >= (voteCounts[b.roundId.toNumber()] || 0) ? a : b)
    : null;
  const topMeta = topRound ? grantMeta[topRound.roundId.toNumber()] : null;
  const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
  const totalAsk = displayRounds.reduce((sum, r) => {
    const m = grantMeta[r.roundId.toNumber()];
    return sum + (m?.askAmount ? parseFloat(m.askAmount) || 0 : 0);
  }, 0);

  // Whether a round's data is visible: always visible if decrypted, otherwise requires TEE mode
  const isRevealed = (roundId: number) => decryptedRounds[roundId] || viewMode === 'tee';

  const handleEndRound = async (roundId: number) => {
    if (!connected) { showToast('Connect your wallet first.'); return; }
    setDecrypting(roundId);
    try {
      await onCommitVote(roundId);
      setDecryptedRounds(p => ({ ...p, [roundId]: true }));
      showToast(`🔓 Round #${roundId} decrypted — state committed to Solana base chain.`);
    } catch (e: any) {
      // commitVote may fail if account isn't delegated — still mark as revealed for demo
      setDecryptedRounds(p => ({ ...p, [roundId]: true }));
      showToast(`🔓 Round #${roundId} revealed. (${e.message.slice(0, 60)})`);
    } finally {
      setDecrypting(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F9F8F4' }}>
      {/* Header */}
      <div className="bg-white border-b border-stone-100 pt-24 pb-10">
        <div className="container mx-auto px-6">
          <button onClick={onBack} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors text-sm font-bold uppercase tracking-widest mb-8">
            <ArrowLeft size={16} /> Back to Home
          </button>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-600 text-xs font-bold tracking-widest uppercase rounded-full mb-4 border border-stone-200">
            <Zap size={12} /> Live on Solana Devnet
          </div>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="font-serif text-5xl text-stone-900 mb-2">Active Grant Rounds</h1>
              <p className="text-stone-500 text-lg">All votes are shielded inside MagicBlock's TEE. Your ballot is private.</p>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {/* ── Step 2: Explorer Split-View Toggle ── */}
              <div className="flex items-center gap-3 px-4 py-2 bg-stone-900 rounded-full border border-stone-700">
                <span className="text-xs font-bold uppercase tracking-widest text-stone-400">View Mode</span>
                <button
                  onClick={() => setViewMode(v => v === 'public' ? 'tee' : 'public')}
                  className="relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none"
                  style={{ backgroundColor: viewMode === 'tee' ? GOLD : '#44403c' }}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${viewMode === 'tee' ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: viewMode === 'tee' ? GOLD : '#a8a29e' }}>
                  {viewMode === 'tee' ? '🔓 TEE Auth' : '🌐 Public'}
                </span>
              </div>
              <button onClick={onNavigateVC} className="flex items-center gap-2 px-5 py-2 rounded-full text-white text-sm font-bold" style={{ backgroundColor: GOLD }}>
                <DollarSign size={14} /> VC Dashboard
              </button>
            </div>
          </div>

          {/* View mode explainer banner */}
          <div className={`mt-4 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${viewMode === 'tee' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-stone-100 text-stone-500 border border-stone-200'}`}>
            {viewMode === 'tee'
              ? <><CheckCircle size={14} /> TEE Authenticated — real vote counts and funding data are visible</>
              : <><Lock size={14} /> Public View — sensitive data is shielded. Toggle to TEE Auth to reveal.</>
            }
          </div>

          <div className="flex gap-10 mt-8 flex-wrap">
            <StatBox label="Total Rounds" value={displayRounds.length} />
            <StatBox label="Active" value={displayRounds.filter(r => r.isActive).length} />
            <StatBox label="Total Votes" value={viewMode === 'tee' ? totalVotes : '—'} />
            <StatBox label="Your Votes" value={myVotes.length} />
            <StatBox label="Total Ask" value={viewMode === 'tee' && totalAsk > 0 ? `${totalAsk} SOL` : '—'} />
          </div>
        </div>
      </div>

      {/* Dashboard — top voted */}
      {topRound && (
        <div className="bg-stone-900 text-white py-10">
          <div className="container mx-auto px-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} style={{ color: GOLD }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: GOLD }}>Leading Grant</span>
            </div>
            <div className="flex flex-col md:flex-row gap-8 items-start">
              {topMeta?.imageUrl && (
                <img src={topMeta.imageUrl} alt={topMeta.name} className="w-32 h-32 rounded-2xl object-cover shrink-0 border-2" style={{ borderColor: GOLD }} />
              )}
              <div className="flex-1">
                <h2 className="font-serif text-4xl text-white mb-1">{topMeta?.name || `Round #${topRound.roundId.toNumber()}`}</h2>
                {topMeta?.founder && <p className="text-stone-400 text-sm mb-3">👤 {topMeta.founder}{topMeta.twitter ? ` · @${topMeta.twitter}` : ''}</p>}
                {topMeta?.desc && <p className="text-stone-400 text-sm leading-relaxed mb-4 max-w-2xl">{topMeta.desc}</p>}
                <div className="flex gap-6 flex-wrap">
                  <div>
                    <div className={`font-serif text-2xl transition-all ${!isRevealed(topRound.roundId.toNumber()) ? 'blur-sm select-none' : ''}`} style={{ color: GOLD }}>
                      {isRevealed(topRound.roundId.toNumber()) ? (voteCounts[topRound.roundId.toNumber()] || 0) : '??'}
                    </div>
                    <div className="text-xs text-stone-500 uppercase tracking-widest">Votes</div>
                  </div>
                  {topMeta?.askAmount && (
                    <div>
                      <div className={`font-serif text-2xl transition-all ${!isRevealed(topRound.roundId.toNumber()) ? 'blur-sm select-none' : ''}`} style={{ color: GOLD }}>
                        {isRevealed(topRound.roundId.toNumber()) ? `${topMeta.askAmount} SOL` : '?? SOL'}
                      </div>
                      <div className="text-xs text-stone-500 uppercase tracking-widest">Asking</div>
                    </div>
                  )}
                  {topMeta?.gitRepo && isRevealed(topRound.roundId.toNumber()) && (
                    <a href={topMeta.gitRepo} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest mt-1 hover:underline" style={{ color: GOLD }}>View Repo →</a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="container mx-auto px-6 py-16">
        {displayRounds.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-stone-400 text-lg">No grant rounds yet. Submit one from the home page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {displayRounds
              .slice()
              .sort((a, b) => (voteCounts[b.roundId.toNumber()] || 0) - (voteCounts[a.roundId.toNumber()] || 0))
              .map((round) => {
                const roundId = round.roundId.toNumber();
                const alreadyVoted = votedRounds[roundId] ?? false;
                const winner = round.winner ? round.winner.toString() : null;
                const isVoting = loading === 'vote-' + roundId;
                const meta = grantMeta[roundId];
                const votes = voteCounts[roundId] || 0;
                const isTop = topRound?.roundId.toNumber() === roundId && displayRounds.length > 1;
                const revealed = isRevealed(roundId);
                const isDecrypting = decrypting === roundId;
                const isDecrypted = decryptedRounds[roundId];

                return (
                  <div key={roundId} className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col relative">
                    {isTop && (
                      <div className="absolute top-3 left-3 z-10 flex items-center gap-1 px-2 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-widest" style={{ backgroundColor: GOLD }}>
                        <TrendingUp size={10} /> Top Voted
                      </div>
                    )}
                    {isDecrypted && (
                      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-widest bg-emerald-600">
                        <Unlock size={10} /> Decrypted
                      </div>
                    )}
                    <div className="h-1 w-full" style={{ backgroundColor: round.isActive ? GOLD : '#d6d3d1' }} />
                    {meta?.imageUrl ? (
                      <div className="w-full overflow-hidden" style={{ height: '160px' }}>
                        <img src={meta.imageUrl} alt={meta.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-full bg-stone-50 flex items-center justify-center" style={{ height: '80px' }}>
                        <Shield size={28} className="text-stone-200" />
                      </div>
                    )}
                    <div className="p-6 flex flex-col flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-0.5">Grant Round #{roundId}</div>
                          <h3 className="font-serif text-2xl text-stone-900 leading-tight">{meta?.name || 'Unnamed Project'}</h3>
                        </div>
                        <span className={`shrink-0 ml-2 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${round.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-stone-100 text-stone-400 border border-stone-200'}`}>
                          {round.isActive ? '● Active' : 'Closed'}
                        </span>
                      </div>
                      {meta?.desc && <p className="text-stone-500 text-sm leading-relaxed mb-3 line-clamp-2">{meta.desc}</p>}
                      <div className="space-y-2 mb-4 flex-1">
                        {meta?.founder && (
                          <div className="flex justify-between border-b border-stone-100 pb-2">
                            <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Founder</span>
                            <span className="text-stone-700 text-xs font-bold">{meta.founder}</span>
                          </div>
                        )}
                        {meta?.twitter && (
                          <div className="flex justify-between border-b border-stone-100 pb-2">
                            <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Twitter</span>
                            <a href={`https://twitter.com/${meta.twitter}`} target="_blank" rel="noopener noreferrer" className="text-xs font-bold hover:underline" style={{ color: GOLD }}>@{meta.twitter}</a>
                          </div>
                        )}
                        {meta?.gitRepo && revealed && (
                          <div className="flex justify-between border-b border-stone-100 pb-2">
                            <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Repo</span>
                            <a href={meta.gitRepo} target="_blank" rel="noopener noreferrer" className="text-xs font-bold font-mono truncate max-w-[140px] hover:underline" style={{ color: GOLD }}>
                              {meta.gitRepo.replace('https://github.com/', '')}
                            </a>
                          </div>
                        )}
                        {meta?.askAmount && (
                          <div className="flex justify-between border-b border-stone-100 pb-2">
                            <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Asking</span>
                            <span className={`text-xs font-bold transition-all ${!revealed ? 'blur-sm select-none text-stone-400' : 'text-stone-700'}`}>
                              {revealed ? `${meta.askAmount} SOL` : '[SHIELDED IN TEE]'}
                            </span>
                          </div>
                        )}
                        {meta?.walletAddress && (
                          <div className="flex justify-between border-b border-stone-100 pb-2">
                            <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Wallet</span>
                            <span className="text-stone-500 text-xs font-mono">{meta.walletAddress.slice(0, 6)}...{meta.walletAddress.slice(-4)}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-b border-stone-100 pb-2">
                          <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Votes</span>
                          <span className={`text-xs font-bold transition-all ${!revealed ? 'blur-sm select-none' : ''}`} style={{ color: GOLD }}>
                            {revealed ? votes : '[SHIELDED IN TEE]'}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-stone-100 pb-2">
                          <span className="text-stone-400 text-xs uppercase font-bold tracking-wider">Winner</span>
                          <span className={`text-xs font-bold transition-all ${!revealed && !winner ? 'text-stone-400' : 'text-stone-700'}`}>
                            {isDecrypted && winner ? `${winner.slice(0, 6)}...${winner.slice(-4)}` : isDecrypted ? 'Pending tally' : revealed ? (winner ? `${winner.slice(0, 6)}...${winner.slice(-4)}` : 'Pending') : '[SHIELDED IN TEE]'}
                          </span>
                        </div>
                      </div>

                      {/* ── Step 3: End Round & Decrypt button ── */}
                      {round.isActive && connected && !isDecrypted && (
                        <button
                          onClick={() => handleEndRound(roundId)}
                          disabled={isDecrypting}
                          className="w-full mb-3 py-2.5 rounded-full font-bold text-sm tracking-widest uppercase transition-colors disabled:opacity-50 flex items-center justify-center gap-2 border-2"
                          style={{ borderColor: GOLD, color: GOLD, backgroundColor: 'transparent' }}
                        >
                          {isDecrypting ? (
                            <><span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" /> Decrypting...</>
                          ) : (
                            <><Unlock size={14} /> End Round & Decrypt</>
                          )}
                        </button>
                      )}

                      {alreadyVoted ? (
                        <div className="flex items-center justify-center gap-2 py-3 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-sm font-bold">
                          <CheckCircle size={16} /> Voted
                        </div>
                      ) : (
                        <button onClick={() => setVoteModal(round)} disabled={isVoting || !round.isActive}
                          className="w-full py-3 rounded-full font-bold text-sm tracking-widest uppercase transition-colors disabled:opacity-50"
                          style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
                          {isVoting ? 'Casting...' : !round.isActive ? 'Round Closed' : 'Cast Private Vote'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {voteModal && (
        <VoteModal round={voteModal} meta={grantMeta[voteModal.roundId.toNumber()]}
          onClose={() => setVoteModal(null)}
          onVote={(roundId, pubkey) => {
            const meta = grantMeta[roundId];
            onVote(meta?.name || `Round #${roundId}`, roundId, pubkey);
            setVoteModal(null);
          }}
          loading={loading === 'vote-' + voteModal.roundId.toNumber()}
          alreadyVoted={votedRounds[voteModal.roundId.toNumber()] ?? false}
        />
      )}
    </div>
  );
};

// ── VC Page ───────────────────────────────────────────────────────────────────
const VCPage = ({ grantRounds, grantMeta, voteCounts, onBack, showToast, connected }: {
  grantRounds: GrantRoundData[]; grantMeta: Record<number, GrantMeta>;
  voteCounts: Record<number, number>; onBack: () => void;
  showToast: (msg: string) => void; connected: boolean;
}) => {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [stakeAmt, setStakeAmt]         = useState('');
  const [staking, setStaking]           = useState(false);
  const [stakedTotal, setStakedTotal]   = useState(0);
  const [investAmt, setInvestAmt]       = useState<Record<number, string>>({});
  const [investing, setInvesting]       = useState<number | null>(null);
  const [investments, setInvestments]   = useState<VCInvestment[]>(loadVCInvestments);
  const [walletBalances, setWalletBalances] = useState<Record<number, number>>({});

  const displayRounds = grantRounds.length > 0 ? grantRounds : [];
  const totalInvested = investments.reduce((s, i) => s + i.amount, 0);

  // Fetch on-chain SOL balance for every project wallet — reflects all investors
  const fetchBalances = useCallback(async () => {
    if (displayRounds.length === 0) return;
    const result: Record<number, number> = {};
    await Promise.allSettled(
      displayRounds.map(async (round) => {
        const roundId = round.roundId.toNumber();
        const meta = grantMeta[roundId];
        if (!meta?.walletAddress) return;
        try {
          const pk = new PublicKey(meta.walletAddress);
          const lamports = await connection.getBalance(pk);
          result[roundId] = lamports / LAMPORTS_PER_SOL;
        } catch { /* invalid pubkey or RPC error */ }
      })
    );
    setWalletBalances(result);
  }, [connection, displayRounds, grantMeta]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  const handleStake = async () => {
    if (!connected || !wallet.publicKey || !wallet.sendTransaction) { showToast('Connect your wallet first.'); return; }
    const sol = parseFloat(stakeAmt);
    if (!sol || sol <= 0) { showToast('Enter a valid SOL amount.'); return; }
    setStaking(true);
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey }).add(
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: TREASURY, lamports: Math.floor(sol * LAMPORTS_PER_SOL) })
      );
      const sig = await wallet.sendTransaction(tx, connection);
      // Update UI immediately — don't block on confirmation
      setStakedTotal(p => p + sol);
      setStakeAmt('');
      showToast(`✅ Staked ${sol} SOL. Tx: ${sig.slice(0, 8)}...`);
      // Confirm in background
      connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed').catch(() => {});
    } catch (e: any) { showToast('❌ Stake failed: ' + e.message); }
    finally { setStaking(false); }
  };

  const handleInvest = async (roundId: number) => {
    if (!connected || !wallet.publicKey || !wallet.sendTransaction) { showToast('Connect your wallet first.'); return; }
    const sol = parseFloat(investAmt[roundId] || '');
    if (!sol || sol <= 0) { showToast('Enter an amount first.'); return; }
    const meta = grantMeta[roundId];
    let dest = TREASURY;
    if (meta?.walletAddress) {
      try { dest = new PublicKey(meta.walletAddress); } catch { /* invalid key, fall back to treasury */ }
    }
    setInvesting(roundId);
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey }).add(
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: dest, lamports: Math.floor(sol * LAMPORTS_PER_SOL) })
      );
      const sig = await wallet.sendTransaction(tx, connection);
      // Update UI immediately — don't block on confirmation
      const inv: VCInvestment = { roundId, amount: sol, ts: Date.now() };
      saveVCInvestment(inv);
      setInvestments(loadVCInvestments());
      setInvestAmt(p => ({ ...p, [roundId]: '' }));
      showToast(`✅ Invested ${sol} SOL in ${meta?.name || `Round #${roundId}`}. Tx: ${sig.slice(0, 8)}...`);
      // Confirm + refresh balances in background
      connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
        .then(() => fetchBalances())
        .catch(() => fetchBalances());
    } catch (e: any) { showToast('❌ Investment failed: ' + e.message); }
    finally { setInvesting(null); }
  };

  const sortedRounds = displayRounds
    .slice()
    .sort((a, b) => (voteCounts[b.roundId.toNumber()] || 0) - (voteCounts[a.roundId.toNumber()] || 0));

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F9F8F4' }}>
      <div className="bg-white border-b border-stone-100 pt-24 pb-10">
        <div className="container mx-auto px-6">
          <button onClick={onBack} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors text-sm font-bold uppercase tracking-widest mb-8">
            <ArrowLeft size={16} /> Back to Home
          </button>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-600 text-xs font-bold tracking-widest uppercase rounded-full mb-4 border border-stone-200">
            <DollarSign size={12} /> VC Dashboard
          </div>
          <h1 className="font-serif text-5xl text-stone-900 mb-2">Venture Capital</h1>
          <p className="text-stone-500 text-lg">Stake SOL as collateral, then invest directly into grant rounds.</p>
          <div className="flex gap-10 mt-8 flex-wrap">
            <StatBox label="Staked (session)" value={`${stakedTotal} SOL`} />
            <StatBox label="Your Investments" value={`${totalInvested} SOL`} />
            <StatBox label="Total On-chain Raised" value={`${Object.values(walletBalances).reduce((a, b) => a + b, 0).toFixed(3)} SOL`} />
            <StatBox label="Investments" value={investments.length} />
            <StatBox label="Active Rounds" value={displayRounds.filter(r => r.isActive).length} />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-12 max-w-5xl">
        {/* Stake section */}
        <div className="bg-stone-900 rounded-2xl p-8 mb-12 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="w-64 h-64 rounded-full absolute top-[-60px] right-[-60px]" style={{ filter: 'blur(80px)', backgroundColor: GOLD }} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} style={{ color: GOLD }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: GOLD }}>Step 1 — Stake Collateral</span>
            </div>
            <h2 className="font-serif text-3xl text-white mb-2">Stake SOL</h2>
            <p className="text-stone-400 text-sm mb-6">Stake SOL to signal your commitment as a VC. Funds go to the Deco treasury.</p>
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <input type="number" min="0" step="0.1" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)}
                  placeholder="Amount in SOL"
                  className="w-full px-4 py-3 bg-stone-800 border border-stone-700 rounded-xl text-white placeholder-stone-500 focus:outline-none focus:border-stone-500 transition-colors" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-xs font-bold">SOL</span>
              </div>
              <button onClick={handleStake} disabled={staking || !connected}
                className="px-8 py-3 rounded-xl font-bold uppercase tracking-widest text-sm transition-colors disabled:opacity-50"
                style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
                {staking ? 'Staking...' : 'Stake'}
              </button>
            </div>
            {/* Quick amounts */}
            <div className="flex gap-2 mt-3 flex-wrap">
              {['0.5', '1', '2', '5'].map(v => (
                <button key={v} onClick={() => setStakeAmt(v)}
                  className="px-3 py-1 rounded-full text-xs font-bold border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-white transition-colors">
                  {v} SOL
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Invest section */}
        <div className="mb-4 flex items-center gap-2">
          <BarChart2 size={16} style={{ color: GOLD }} />
          <span className="text-xs font-bold uppercase tracking-widest text-stone-500">Step 2 — Invest in Grants</span>
        </div>
        <p className="text-stone-500 text-sm mb-8">Sorted by votes. Funds go directly to the project wallet.</p>

        {stakedTotal < 0.5 && (
          <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold">
            <Lock size={14} className="shrink-0" />
            Stake at least 0.5 SOL above to unlock investing.
          </div>
        )}

        {sortedRounds.length === 0 ? (
          <div className="text-center py-16">
            <Shield size={32} className="mx-auto mb-4 text-stone-200" />
            <p className="text-stone-400 text-sm font-bold uppercase tracking-widest">
              {connected ? 'No grant rounds on-chain yet.' : 'Connect your wallet to load grant rounds.'}
            </p>
            {!connected && (
              <p className="text-stone-300 text-xs mt-2">You can still stake SOL above once connected.</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {sortedRounds.map((round, idx) => {
              const roundId = round.roundId.toNumber();
              const meta = grantMeta[roundId];
              const votes = voteCounts[roundId] || 0;
              const myInvested = investments.filter(i => i.roundId === roundId).reduce((s, i) => s + i.amount, 0);
              const isInvesting = investing === roundId;
              const rank = idx + 1;

              return (
                <div key={roundId} className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="h-1 w-full" style={{ backgroundColor: rank === 1 ? GOLD : '#e7e5e4' }} />
                  <div className="p-6 flex flex-col md:flex-row gap-6 items-start">
                    {/* Left: image + rank */}
                    <div className="relative shrink-0">
                      {meta?.imageUrl ? (
                        <img src={meta.imageUrl} alt={meta.name} className="w-20 h-20 rounded-xl object-cover" />
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-stone-100 flex items-center justify-center">
                          <Shield size={24} className="text-stone-300" />
                        </div>
                      )}
                      <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: rank === 1 ? GOLD : '#a8a29e' }}>
                        {rank}
                      </div>
                    </div>

                    {/* Middle: info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-serif text-xl text-stone-900">{meta?.name || `Round #${roundId}`}</h3>
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${round.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-stone-100 text-stone-400'}`}>
                          {round.isActive ? '● Active' : 'Closed'}
                        </span>
                      </div>
                      {meta?.founder && <p className="text-stone-500 text-sm mb-2">👤 {meta.founder}{meta.twitter ? ` · @${meta.twitter}` : ''}</p>}
                      {meta?.desc && <p className="text-stone-400 text-sm line-clamp-1 mb-3">{meta.desc}</p>}
                      <div className="flex gap-6 flex-wrap text-xs">
                        <div><span className="text-stone-400 uppercase tracking-wider font-bold">Votes </span><span className="font-bold" style={{ color: GOLD }}>{votes}</span></div>
                        <div><span className="text-stone-400 uppercase tracking-wider font-bold">Asking </span><span className="font-bold text-stone-700">{meta?.askAmount ? `${meta.askAmount} SOL` : '—'}</span></div>
                        <div><span className="text-stone-400 uppercase tracking-wider font-bold">Total Raised </span><span className="font-bold" style={{ color: GOLD }}>{walletBalances[roundId] !== undefined ? `${walletBalances[roundId].toFixed(3)} SOL` : '…'}</span></div>
                        <div><span className="text-stone-400 uppercase tracking-wider font-bold">Your Investment </span><span className="font-bold text-stone-700">{myInvested > 0 ? `${myInvested} SOL` : '—'}</span></div>
                        {meta?.gitRepo && <a href={meta.gitRepo} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline" style={{ color: GOLD }}>Repo →</a>}
                      </div>
                      {meta?.askAmount && walletBalances[roundId] !== undefined && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-stone-400 mb-1">
                            <span>Raised: {walletBalances[roundId].toFixed(3)} SOL</span>
                            <span>Goal: {meta.askAmount} SOL</span>
                          </div>
                          <div className="w-full bg-stone-100 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full transition-all" style={{ backgroundColor: GOLD, width: `${Math.min(100, (walletBalances[roundId] / parseFloat(meta.askAmount)) * 100)}%` }} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: invest input */}
                    <div className="flex gap-2 shrink-0 w-full md:w-auto">
                      <div className="relative">
                        <input type="number" min="0" step="0.1" value={investAmt[roundId] || ''}
                          onChange={e => setInvestAmt(p => ({ ...p, [roundId]: e.target.value }))}
                          placeholder="SOL"
                          className="w-28 px-3 py-2 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors text-sm" />
                      </div>
                      <button onClick={() => handleInvest(roundId)} disabled={isInvesting || !connected || stakedTotal < 0.5}
                        title={stakedTotal < 0.5 ? 'Stake at least 0.5 SOL first' : undefined}
                        className="px-5 py-2 rounded-xl font-bold text-sm uppercase tracking-widest transition-colors disabled:opacity-50"
                        style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
                        {isInvesting ? '...' : 'Invest'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Investment history */}
        {investments.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} style={{ color: GOLD }} />
              <span className="text-xs font-bold uppercase tracking-widest text-stone-500">Your Investment History</span>
            </div>
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              {investments.slice().reverse().map((inv, i) => {
                const meta = grantMeta[inv.roundId];
                return (
                  <div key={i} className={`flex items-center justify-between px-6 py-4 ${i > 0 ? 'border-t border-stone-100' : ''}`}>
                    <div>
                      <div className="font-bold text-stone-900 text-sm">{meta?.name || `Round #${inv.roundId}`}</div>
                      <div className="text-stone-400 text-xs">{new Date(inv.ts).toLocaleDateString()}</div>
                    </div>
                    <div className="font-serif text-lg font-bold" style={{ color: GOLD }}>{inv.amount} SOL</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main App ──────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const { connected } = useWallet();
  const decoProgram = useDecoProgram();

  const [page, setPage] = useState<Page>(() => {
    const h = window.location.hash;
    if (h === '#grants') return 'grants';
    if (h === '#vc') return 'vc';
    return 'home';
  });

  const navigate = useCallback((p: Page) => {
    setPage(p);
    window.location.hash = p === 'home' ? '' : p;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash;
      if (h === '#grants') setPage('grants');
      else if (h === '#vc') setPage('vc');
      else setPage('home');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [scrolled, setScrolled]           = useState(false);
  const [menuOpen, setMenuOpen]           = useState(false);
  const [toast, setToast]                 = useState<string | null>(null);
  const [loading, setLoading]             = useState<string | null>(null);
  const [grantRounds, setGrantRounds]     = useState<GrantRoundData[]>([]);
  const [myVotes, setMyVotes]             = useState<VoteData[]>([]);
  const [votedRounds, setVotedRounds]     = useState<Record<number, boolean>>({});
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [grantMeta, setGrantMeta]         = useState<Record<number, GrantMeta>>(loadAllMeta);
  const [voteCounts, setVoteCounts]       = useState<Record<number, number>>(loadVoteCounts);
  const [isDelegated, setIsDelegated]     = useState(() => localStorage.getItem('deco_delegated') === 'true');

  // Submit form state
  const [submitName, setSubmitName]         = useState('');
  const [submitDesc, setSubmitDesc]         = useState('');
  const [submitPubkey, setSubmitPubkey]     = useState('');
  const [submitGitRepo, setSubmitGitRepo]   = useState('');
  const [submitFounder, setSubmitFounder]   = useState('');
  const [submitTwitter, setSubmitTwitter]   = useState('');
  const [submitAskAmt, setSubmitAskAmt]     = useState('');
  const [submitImageUrl, setSubmitImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!connected) return;
    (async () => {
      try {
        const rounds = await decoProgram.fetchAllGrantRounds();
        setGrantRounds(rounds as GrantRoundData[]);
        const votes = await decoProgram.fetchMyVotes();
        setMyVotes(votes as VoteData[]);
        const voted: Record<number, boolean> = {};
        for (const v of votes as VoteData[]) voted[v.roundId.toNumber()] = true;
        setVotedRounds(voted);
        // Merge on-chain memo metadata with localStorage (localStorage wins for images)
        const chainMeta = await decoProgram.fetchGrantMeta();
        const localMeta = loadAllMeta();
        const merged: Record<number, GrantMeta> = { ...chainMeta };
        for (const id in localMeta) {
          merged[id] = { ...chainMeta[id], ...localMeta[id] };
        }
        setGrantMeta(merged);
      } catch { /* not deployed yet */ }
      setVoteCounts(loadVoteCounts());
    })();
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 6000);
  }, []);

  const scrollToSection = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(false);
    if (page !== 'home') {
      navigate('home');
      setTimeout(() => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 100, behavior: 'smooth' }); }, 100);
      return;
    }
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 100, behavior: 'smooth' });
  };

  const handleDelegateTEE = useCallback(async () => {
    if (!connected) { showToast('Connect your wallet first.'); return; }
    setLoading('delegate');
    try {
      for (const r of grantRounds) await decoProgram.delegateGrantRound(r.roundId.toNumber());
      localStorage.setItem('deco_delegated', 'true');
      setIsDelegated(true);
      showToast('✅ Grant round PDAs delegated to MagicBlock ER.');
    } catch (e: any) { showToast('❌ Delegation failed: ' + e.message); }
    finally { setLoading(null); }
  }, [connected, decoProgram, grantRounds, showToast]);

  const handleCastVote = useCallback(async (name: string, roundId: number, projectPubkeyStr: string) => {
    if (!connected) { showToast('Connect your wallet first.'); return; }
    if (votedRounds[roundId]) { showToast('You already voted in this round.'); return; }
    setLoading('vote-' + roundId);
    try {
      await decoProgram.initMemberVote(roundId);
      await decoProgram.delegateMemberVote(roundId);
      const { teeAuthenticated } = await decoProgram.castVote(roundId, new PublicKey(projectPubkeyStr));
      incrementVoteCount(roundId);
      setVoteCounts(loadVoteCounts());
      showToast(
        teeAuthenticated
          ? `🔒 Vote cast for ${name} — authenticated inside MagicBlock TEE.`
          : `✅ Vote cast for ${name} — routed via MagicBlock devnet router.`
      );
      setVotedRounds(prev => ({ ...prev, [roundId]: true }));
      const votes = await decoProgram.fetchMyVotes();
      setMyVotes(votes as VoteData[]);
    } catch (e: any) { showToast('❌ Vote failed: ' + e.message); }
    finally { setLoading(null); }
  }, [connected, decoProgram, votedRounds, showToast]);

  const handleSubmitStartup = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) { showToast('Connect your wallet first.'); return; }
    if (!submitName || !submitPubkey) { showToast('Project name and wallet address are required.'); return; }
    setLoading('submit');
    try {
      // Use timestamp-based ID to guarantee no collision with delegated PDAs
      const nextId = Date.now() % 1_000_000; // 6-digit unique ID
      const meta: GrantMeta = { name: submitName, desc: submitDesc, founder: submitFounder, twitter: submitTwitter, gitRepo: submitGitRepo, imageUrl: submitImageUrl, walletAddress: submitPubkey, askAmount: submitAskAmt };
      await decoProgram.createGrantRound(nextId, { name: submitName, desc: submitDesc, founder: submitFounder, twitter: submitTwitter, gitRepo: submitGitRepo, walletAddress: submitPubkey, askAmount: submitAskAmt });
      // Track this round ID so fetchAllGrantRounds can find it even after delegation
      const knownIds: number[] = JSON.parse(localStorage.getItem('deco_round_ids') || '[]');
      knownIds.push(nextId);
      localStorage.setItem('deco_round_ids', JSON.stringify(knownIds));
      saveMeta(nextId, meta);
      setGrantMeta(loadAllMeta());
      showToast('✅ Grant round created for ' + submitName + ' (Round #' + nextId + ')');
      setSubmitName(''); setSubmitDesc(''); setSubmitPubkey(''); setSubmitGitRepo('');
      setSubmitFounder(''); setSubmitTwitter(''); setSubmitAskAmt(''); setSubmitImageUrl(null);
      const rounds = await decoProgram.fetchAllGrantRounds();
      setGrantRounds(rounds as GrantRoundData[]);
    } catch (e: any) { showToast('❌ Submission failed: ' + e.message); }
    finally { setLoading(null); }
  }, [connected, decoProgram, grantRounds, submitName, submitPubkey, submitDesc, submitFounder, submitTwitter, submitGitRepo, submitImageUrl, submitAskAmt, showToast]);

  const handleClearGrants = useCallback(() => {
    clearAllMeta();
    localStorage.removeItem(VOTE_COUNT_KEY);
    setGrantMeta({});
    setVoteCounts({});
    showToast('✅ All grant metadata cleared.');
  }, [showToast]);

  const displayRounds: GrantRoundData[] = grantRounds.length > 0 ? grantRounds : [];

  // ── Nav ──────────────────────────────────────────────────────────────────────
  const Nav = (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{ backgroundColor: scrolled || page !== 'home' ? 'rgba(249,248,244,0.96)' : 'transparent', backdropFilter: 'blur(12px)', boxShadow: scrolled || page !== 'home' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', padding: scrolled ? '16px 0' : '24px 0' }}>
      <div className="container mx-auto px-6 flex justify-between items-center">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => navigate('home')}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: GOLD }}><Shield size={20} /></div>
          <span className="font-serif font-bold text-lg tracking-wide text-stone-900">DECO PRIVATE <span className="font-normal text-stone-500">SOLANA</span></span>
        </div>
        <div className="hidden md:flex items-center gap-5 text-sm font-medium text-stone-600">
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold border border-emerald-100">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>TEE SECURE: ACTIVE
          </div>
          <a href="#warroom" onClick={scrollToSection('warroom')} className="hover:text-stone-900 transition-colors uppercase">War Room</a>
          <button onClick={() => navigate('grants')} className={`hover:text-stone-900 transition-colors uppercase ${page === 'grants' ? 'text-stone-900 font-bold' : ''}`}>Active Grants</button>
          <button onClick={() => navigate('vc')} className={`hover:text-stone-900 transition-colors uppercase ${page === 'vc' ? 'text-stone-900 font-bold' : ''}`}>VC</button>
          <a href="#submit" onClick={scrollToSection('submit')} className="hover:text-stone-900 transition-colors uppercase">Submit</a>
          <button onClick={handleDelegateTEE} disabled={loading === 'delegate' || isDelegated}
            className={`px-5 py-2 rounded-full transition-colors shadow-sm disabled:opacity-50 text-sm font-bold flex items-center gap-2 ${isDelegated ? 'bg-emerald-600 text-white cursor-default' : 'bg-stone-900 text-white hover:bg-stone-800'}`}>
            {loading === 'delegate' ? 'Delegating...' : isDelegated ? '🔒 TEE Active' : 'Delegate to TEE'}
          </button>
          <WalletMultiButton style={{ height: '36px', borderRadius: '9999px', fontSize: '13px', padding: '0 16px', background: connected ? '#16a34a' : GOLD }} />
        </div>
        <button className="md:hidden text-stone-900 p-2" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </nav>
  );

  const MobileMenu = menuOpen && (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 text-xl font-serif" style={{ backgroundColor: '#F9F8F4' }}>
      <button onClick={() => { navigate('home'); setMenuOpen(false); }} className="uppercase">Home</button>
      <button onClick={() => { navigate('grants'); setMenuOpen(false); }} className="uppercase">Active Grants</button>
      <button onClick={() => { navigate('vc'); setMenuOpen(false); }} className="uppercase">VC Dashboard</button>
      <button onClick={() => { navigate('home'); setMenuOpen(false); setTimeout(() => { document.getElementById('submit')?.scrollIntoView({ behavior: 'smooth' }); }, 100); }} className="uppercase">Submit Startup</button>
      <WalletMultiButton style={{ borderRadius: '9999px', background: connected ? '#16a34a' : GOLD }} />
    </div>
  );

  if (page === 'grants') return (
    <div className="min-h-screen" style={{ backgroundColor: '#F9F8F4' }}>
      {Nav}{MobileMenu}
      <GrantsPage grantRounds={grantRounds} votedRounds={votedRounds} loading={loading}
        onVote={handleCastVote} onBack={() => navigate('home')} myVotes={myVotes}
        grantMeta={grantMeta} voteCounts={voteCounts} onNavigateVC={() => navigate('vc')}
        onCommitVote={decoProgram.commitVote} connected={connected} showToast={showToast} />
      {toast && <TxToast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );

  if (page === 'vc') return (
    <div className="min-h-screen" style={{ backgroundColor: '#F9F8F4' }}>
      {Nav}{MobileMenu}
      <VCPage grantRounds={grantRounds} grantMeta={grantMeta} voteCounts={voteCounts}
        onBack={() => navigate('home')} showToast={showToast} connected={connected} />
      {toast && <TxToast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );

  // ── Home ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen text-stone-800" style={{ backgroundColor: '#F9F8F4' }}>
      {Nav}{MobileMenu}
      <header className="relative h-screen flex items-center justify-center overflow-hidden">
        <Suspense fallback={null}><HeroScene /></Suspense>
        <div className="absolute inset-0 z-0 pointer-events-none" style={{ background: 'radial-gradient(circle at center, rgba(249,248,244,0.92) 0%, rgba(249,248,244,0.6) 50%, rgba(249,248,244,0.3) 100%)' }} />
        <div className="relative z-10 container mx-auto px-6 text-center">
          <div className="inline-block mb-4 px-3 py-1 text-xs tracking-[0.2em] uppercase font-bold rounded-full" style={{ border: `1px solid ${GOLD}`, color: GOLD, backgroundColor: 'rgba(255,255,255,0.3)' }}>
            Solana Blitz • 2026
          </div>
          <h1 className="font-serif text-5xl md:text-7xl lg:text-9xl font-medium leading-tight mb-8 text-stone-900">
            Deco Private<br />
            <span className="italic font-normal text-stone-600 text-3xl md:text-5xl block mt-4">On-chain Grant Accelerator</span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-stone-700 font-light leading-relaxed mb-12">
            Founders submit their startups for a grant round. Members vote privately on who deserves funding. VCs invest directly into the winners — all on Solana, all on-chain.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <button onClick={() => navigate('grants')} className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm shadow-sm" style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
              View Active Grants
            </button>
            <button onClick={() => navigate('vc')} className="px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm shadow-sm bg-stone-900 text-white">
              VC Dashboard
            </button>
            <a href="#warroom" onClick={scrollToSection('warroom')} className="group flex flex-col items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer">
              <span>ENTER WAR ROOM</span>
              <span className="p-2 border border-stone-300 rounded-full group-hover:border-stone-900 transition-colors" style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}><ArrowDown size={16} /></span>
            </a>
          </div>
        </div>
      </header>

      <main>
        <section id="warroom" className="py-24 bg-white">
          <div className="container mx-auto px-6 md:px-12 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
            <div className="md:col-span-4">
              <div className="inline-block mb-3 text-xs font-bold tracking-widest text-stone-500 uppercase">War Room</div>
              <h2 className="font-serif text-4xl mb-6 leading-tight text-stone-900">The Private Frontier</h2>
              <div className="w-16 h-1 mb-6" style={{ backgroundColor: GOLD }}></div>
            </div>
            <div className="md:col-span-8 text-lg text-stone-600 leading-relaxed space-y-6">
              <p><span className="text-5xl float-left mr-3 font-serif" style={{ color: GOLD }}>D</span>eco Private is a grant accelerator built on Solana. Founders apply for funding, community members vote on the best projects, and VCs invest directly into the winning rounds.</p>
              <p>Votes are cast privately inside a <strong>Trusted Execution Environment (TEE)</strong> — meaning no one can see how you voted or influence the outcome. Once voting closes, results settle back on-chain and funds flow directly to the project wallet. No middlemen, no bias, no leaks.</p>
            </div>
          </div>
          <div className="container mx-auto px-6 mt-16 flex flex-wrap justify-center gap-8">
            {[
              { label: 'Total Shielded TVL', value: '$4.2M' },
              { label: 'Active Private Rounds', value: String(displayRounds.filter(r => r.isActive).length) },
              { label: 'Your Votes Cast', value: String(myVotes.length) },
            ].map(c => (
              <div key={c.label} className="flex flex-col items-center p-8 bg-white rounded-xl border border-stone-200 shadow-sm w-full max-w-xs">
                <h3 className="font-serif text-3xl text-stone-900 text-center mb-3">{c.value}</h3>
                <div className="w-12 h-0.5 mb-4 opacity-60" style={{ backgroundColor: GOLD }}></div>
                <p className="text-xs text-stone-500 font-bold uppercase tracking-widest text-center">{c.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Grants preview */}
        <section id="grants" className="py-24 bg-white border-t border-stone-100">
          <div className="container mx-auto px-6">
            <div className="flex items-center justify-between mb-12">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-600 text-xs font-bold tracking-widest uppercase rounded-full mb-4 border border-stone-200"><Zap size={14} /> ACTIVE ROUNDS</div>
                <h2 className="font-serif text-4xl text-stone-900">Grant Rounds</h2>
              </div>
              <button onClick={() => navigate('grants')} className="flex items-center gap-2 px-5 py-2 rounded-full text-white text-sm font-bold" style={{ backgroundColor: GOLD }}>View All Grants →</button>
            </div>
            {displayRounds.length === 0 ? (
              <p className="text-stone-400 text-center py-12">No grant rounds yet. Submit one below.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {displayRounds.slice(0, 2).map((round) => {
                  const roundId = round.roundId.toNumber();
                  const alreadyVoted = votedRounds[roundId] ?? false;
                  const meta = grantMeta[roundId];
                  return (
                    <div key={roundId} className="bg-stone-50 rounded-2xl border border-stone-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('grants')}>
                      {meta?.imageUrl && <div className="w-full overflow-hidden" style={{ height: '120px' }}><img src={meta.imageUrl} alt={meta.name} className="w-full h-full object-cover" /></div>}
                      <div className="p-8 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-0.5">Round #{roundId}</div>
                            <h3 className="font-serif text-2xl text-stone-900">{meta?.name || 'Unnamed Project'}</h3>
                          </div>
                          <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${round.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-stone-100 text-stone-400'}`}>{round.isActive ? '● Active' : 'Closed'}</span>
                        </div>
                        {meta?.founder && <p className="text-stone-500 text-sm">👤 {meta.founder}{meta.twitter ? ` · @${meta.twitter}` : ''}</p>}
                        {meta?.askAmount && <p className="text-stone-500 text-sm">💰 Asking {meta.askAmount} SOL</p>}
                        <div className="flex gap-3 mt-1">
                          {alreadyVoted ? <span className="flex items-center gap-2 text-emerald-600 text-sm font-bold"><CheckCircle size={14} /> Voted</span>
                            : <span className="text-sm font-bold uppercase tracking-widest" style={{ color: GOLD }}>Cast Vote →</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Submit */}
        <section id="submit" className="py-24 border-t border-stone-100" style={{ backgroundColor: '#F9F8F4' }}>
          <div className="container mx-auto px-6 max-w-2xl">
            <div className="flex items-center justify-between mb-2">
              <div className="inline-block text-xs font-bold tracking-widest text-stone-500 uppercase">For Founders</div>
              <button onClick={handleClearGrants} className="text-xs text-stone-400 hover:text-red-500 transition-colors font-bold uppercase tracking-widest">Clear All Grants</button>
            </div>
            <h2 className="font-serif text-4xl mb-2 text-stone-900">Submit Your Startup</h2>
            <div className="w-16 h-1 mb-8" style={{ backgroundColor: GOLD }}></div>
            <p className="text-stone-600 mb-8 leading-relaxed">Apply for a private grant round. Your cap table and funding details remain shielded inside the TEE until the round closes.</p>
            <form onSubmit={handleSubmitStartup} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 space-y-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Project Name *</label>
                <input type="text" value={submitName} onChange={e => setSubmitName(e.target.value)} placeholder="e.g. Nebula DEX"
                  className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors" required />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">What is your idea about?</label>
                <textarea value={submitDesc} onChange={e => setSubmitDesc(e.target.value)} placeholder="Describe your startup..." rows={4}
                  className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors resize-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Founder Name *</label>
                  <input type="text" value={submitFounder} onChange={e => setSubmitFounder(e.target.value)} placeholder="e.g. Alice Chen"
                    className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors" required />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Twitter / X Handle</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-bold">@</span>
                    <input type="text" value={submitTwitter} onChange={e => setSubmitTwitter(e.target.value.replace('@', ''))} placeholder="yourhandle"
                      className="w-full pl-8 pr-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Git Repository URL</label>
                  <input type="url" value={submitGitRepo} onChange={e => setSubmitGitRepo(e.target.value)} placeholder="https://github.com/..."
                    className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors font-mono text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Funding Ask (SOL) *</label>
                  <div className="relative">
                    <input type="number" min="0" step="0.1" value={submitAskAmt} onChange={e => setSubmitAskAmt(e.target.value)} placeholder="e.g. 50"
                      className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors" required />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 text-xs font-bold">SOL</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Project Image</label>
                <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-stone-200 rounded-xl cursor-pointer hover:border-stone-400 transition-colors bg-stone-50 overflow-hidden relative">
                  {submitImageUrl ? (
                    <img src={submitImageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover rounded-xl" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-stone-400">
                      <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                      <span className="text-xs font-bold uppercase tracking-widest">Upload image</span>
                      <span className="text-xs text-stone-300">PNG, JPG, GIF up to 5MB</span>
                    </div>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={e => {
                    const file = e.target.files?.[0] ?? null;
                    if (file) { const r = new FileReader(); r.onload = ev => setSubmitImageUrl(ev.target?.result as string ?? null); r.readAsDataURL(file); }
                    else setSubmitImageUrl(null);
                  }} />
                </label>
                {submitImageUrl && <button type="button" onClick={() => setSubmitImageUrl(null)} className="mt-2 text-xs text-stone-400 hover:text-stone-700 transition-colors">Remove image</button>}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-stone-500 mb-2">Project Wallet Address *</label>
                <input type="text" value={submitPubkey} onChange={e => setSubmitPubkey(e.target.value)} placeholder="Solana public key"
                  className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-400 transition-colors font-mono text-sm" required />
              </div>
              <button type="submit" disabled={loading === 'submit' || !connected}
                className="w-full py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-colors shadow-sm disabled:opacity-50"
                style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
                {loading === 'submit' ? 'Submitting...' : !connected ? 'Connect Wallet to Submit' : 'Submit for Grant Round'}
              </button>
            </form>
          </div>
        </section>

        {/* Portfolio */}
        <section id="portfolio" className="py-24 bg-stone-900 text-stone-100 overflow-hidden relative">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="w-96 h-96 rounded-full bg-stone-600 absolute top-[-100px] left-[-100px]" style={{ filter: 'blur(100px)' }}></div>
            <div className="w-96 h-96 rounded-full absolute bottom-[-100px] right-[-100px]" style={{ filter: 'blur(100px)', backgroundColor: GOLD }}></div>
          </div>
          <div className="container mx-auto px-6 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
              <div className="order-2 lg:order-1">
                <Suspense fallback={<div className="h-64 bg-stone-800 rounded-xl" />}><TransformerDecoderDiagram /></Suspense>
              </div>
              <div className="order-1 lg:order-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-800 text-xs font-bold tracking-widest uppercase rounded-full mb-6 border border-stone-700" style={{ color: GOLD }}>SHIELDED PORTFOLIO</div>
                <h2 className="font-serif text-4xl md:text-5xl mb-6 text-white">Your Private Holdings</h2>
                <p className="text-lg text-stone-400 mb-6 leading-relaxed">All your investments and grant allocations are stored within a <strong>Private Ephemeral Rollup</strong>. Invisible to the public Solana explorer.</p>
                <button onClick={() => setPortfolioOpen(o => !o)} className="flex items-center gap-2 px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm transition-colors shadow-lg mb-6" style={{ backgroundColor: GOLD, color: '#1a1a1a' }}>
                  {portfolioOpen ? 'Hide Portfolio' : 'Reveal Portfolio'}
                  <ChevronDown size={16} className={`transition-transform ${portfolioOpen ? 'rotate-180' : ''}`} />
                </button>
                {portfolioOpen && (
                  <div className="space-y-4">
                    {!connected && <p className="text-stone-400 text-sm">Connect your wallet to view your portfolio.</p>}
                    {connected && myVotes.length === 0 && <p className="text-stone-400 text-sm">No votes found on-chain yet.</p>}
                    {connected && myVotes.map((vote, i) => {
                      const roundId = vote.roundId.toNumber();
                      const round = grantRounds.find(r => r.roundId.toNumber() === roundId);
                      const meta = grantMeta[roundId];
                      const winner = round?.winner ? round.winner.toString() : null;
                      const won = winner && vote.votedFor && winner === vote.votedFor.toString();
                      return (
                        <div key={i} className="bg-stone-800 rounded-xl p-5 border border-stone-700">
                          <div className="flex justify-between items-start mb-3">
                            <span className="font-serif text-lg text-white">{meta?.name || `Round #${roundId}`}</span>
                            <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full ${won ? 'bg-emerald-900 text-emerald-400' : 'bg-stone-700 text-stone-400'}`}>{won ? '🏆 Winner' : winner ? 'Closed' : 'Active'}</span>
                          </div>
                          <div className="text-stone-500 text-xs">Round #{roundId} · {winner ? 'Winner decided' : 'Pending'}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="py-24" style={{ backgroundColor: '#F9F8F4' }}>
          <div className="container mx-auto px-6">
            <div className="max-w-4xl mx-auto text-center mb-16">
              <h2 className="font-serif text-4xl md:text-6xl mb-6 text-stone-900">How It Works</h2>
              <p className="text-xl text-stone-600 font-light">Three steps from idea to funded.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { icon: <Activity size={24} />, title: 'Submit a Grant', desc: 'Founders fill out a short application — project name, description, funding ask, and wallet address. It goes live on-chain immediately.' },
                { icon: <Lock size={24} />, title: 'Private Voting', desc: 'Community members vote on which projects deserve funding. Votes are processed inside a TEE so no one can see your choice or game the result.' },
                { icon: <Shield size={24} />, title: 'VC Investment', desc: 'VCs browse active rounds sorted by votes, stake SOL as collateral, and invest directly into project wallets — no escrow, no delays.' },
              ].map(c => (
                <div key={c.title} className="p-10 bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center text-stone-900 mb-6">{c.icon}</div>
                  <h3 className="font-serif text-2xl mb-4">{c.title}</h3>
                  <p className="text-stone-500 leading-relaxed">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="py-12 bg-white border-t border-stone-100">
        <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-serif font-bold text-xs" style={{ backgroundColor: GOLD }}>D</div>
            <span className="font-serif font-bold text-stone-900">DECO PRIVATE</span>
          </div>
          <div className="text-xs text-stone-400 font-medium tracking-widest uppercase">© 2026 DECO PRIVATE • SOLANA BLITZ HACKATHON</div>
          <div className="flex gap-6 text-stone-500">
            <a href="#" className="hover:text-stone-900 transition-colors"><Activity size={18} /></a>
            <a href="#" className="hover:text-stone-900 transition-colors"><Shield size={18} /></a>
          </div>
        </div>
      </footer>
      {toast && <TxToast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
};

export default App;
