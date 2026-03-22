/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import App from './App';

const endpoint = clusterApiUrl('devnet');
// Pass empty array — Phantom/Solflare register themselves via Wallet Standard.
// Manually adding their adapters causes a double-registration crash.
const wallets: any[] = [];

// Catch any render crash so we never get a blank screen
class RootErrorBoundary extends Component<{ children: React.ReactNode }, { err: string | null }> {
  state = { err: null };
  static getDerivedStateFromError(e: any) { return { err: String(e) }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', background: '#F9F8F4', minHeight: '100vh' }}>
          <h2 style={{ color: '#C5A059' }}>Something went wrong</h2>
          <pre style={{ color: '#555', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{this.state.err}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '8px 16px', cursor: 'pointer' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);
