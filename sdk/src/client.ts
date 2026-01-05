/**
 * CBL DEX JavaScript/TypeScript SDK
 * For integration with web, mobile, and desktop applications
 */

import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import {
  CBL_DEX_PROGRAM_ID,
  NETWORK_CONFIG,
  API_ENDPOINTS,
} from './constants';
import {
  PoolInfo,
  TokenInfo,
  TradeParams,
  AddLiquidityParams,
  RemoveLiquidityParams,
  PriceData,
  DexStats,
} from './types';

export class CblDexClient {
  private connection: Connection;
  private wallet: WalletContextState | null;
  private apiBaseUrl: string;

  constructor(
    network: 'mainnet' | 'devnet' = 'mainnet',
    wallet?: WalletContextState
  ) {
    this.connection = new Connection(NETWORK_CONFIG[network].rpcUrl);
    this.wallet = wallet || null;
    this.apiBaseUrl = API_ENDPOINTS[network];
  }

  /**
   * Get price for a token pair
   */
  async getPrice(pair: string): Promise<PriceData> {
    const response = await fetch(`${this.apiBaseUrl}/v1/price/${pair}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch price: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    return data;
  }

  /**
   * Get all available pools
   */
  async getPools(options?: {
    page?: number;
    limit?: number;
    sortBy?: string;
  }): Promise<PoolInfo[]> {
    const params = new URLSearchParams();
    
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.sortBy) params.append('sortBy', options.sortBy);
    
    const response = await fetch(
      `${this.apiBaseUrl}/v1/pools?${params.toString()}`
    );
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    return data.pools;
  }

  /**
   * Execute a trade
   */
  async trade(params: TradeParams): Promise<string> {
    if (!this.wallet?.publicKey || !this.wallet.signTransaction) {
      throw new Error('Wallet not connected');
    }

    // Validate parameters
    this.validateTradeParams(params);

    // Create transaction
    const transaction = await this.createTradeTransaction(params);
    
    // Sign and send transaction
    const signature = await this.wallet.sendTransaction(
      transaction,
      this.connection
    );
    
    // Confirm transaction
    await this.connection.confirmTransaction(signature);
    
    return signature;
  }

  /**
   * Add liquidity to a pool
   */
  async addLiquidity(params: AddLiquidityParams): Promise<string> {
    if (!this.wallet?.publicKey) {
      throw new Error('Wallet not connected');
    }

    // Implementation for adding liquidity
    const transaction = await this.createAddLiquidityTransaction(params);
    
    const signature = await this.wallet.sendTransaction(
      transaction,
      this.connection
    );
    
    await this.connection.confirmTransaction(signature);
    
    return signature;
  }

  /**
   * Remove liquidity from a pool
   */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<string> {
    if (!this.wallet?.publicKey) {
      throw new Error('Wallet not connected');
    }

    // Implementation for removing liquidity
    const transaction = await this.createRemoveLiquidityTransaction(params);
    
    const signature = await this.wallet.sendTransaction(
      transaction,
      this.connection
    );
    
    await this.connection.confirmTransaction(signature);
    
    return signature;
  }

  /**
   * Create a new liquidity pool
   */
  async createPool(
    tokenA: PublicKey,
    tokenB: PublicKey,
    feeBps: number
  ): Promise<string> {
    if (!this.wallet?.publicKey) {
      throw new Error('Wallet not connected');
    }

    // Implementation for creating a new pool
    const transaction = await this.createPoolTransaction(
      tokenA,
      tokenB,
      feeBps
    );
    
    const signature = await this.wallet.sendTransaction(
      transaction,
      this.connection
    );
    
    await this.connection.confirmTransaction(signature);
    
    return signature;
  }

  /**
   * Get DEX statistics
   */
  async getStats(): Promise<DexStats> {
    const response = await fetch(`${this.apiBaseUrl}/v1/stats`);
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error);
    }
    
    return data;
  }

  /**
   * Subscribe to price updates via WebSocket
   */
  subscribeToPrices(
    pairs: string[],
    onUpdate: (prices: PriceData[]) => void
  ): WebSocket {
    const ws = new WebSocket(`${this.apiBaseUrl.replace('http', 'ws')}/v1/ws`);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        pairs,
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'price_update') {
        onUpdate(data.prices);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    return ws;
  }

  // Private helper methods
  private validateTradeParams(params: TradeParams): void {
    if (params.amountIn <= 0) {
      throw new Error('Invalid input amount');
    }
    
    if (params.minAmountOut <= 0) {
      throw new Error('Invalid minimum output amount');
    }
    
    if (params.slippageBps < 0 || params.slippageBps > 10000) {
      throw new Error('Invalid slippage tolerance');
    }
  }

  private async createTradeTransaction(
    params: TradeParams
  ): Promise<Transaction> {
    // Implementation for creating trade transaction
    const transaction = new Transaction();
    
    // Add swap instruction
    // This would call the smart contract swap function
    
    return transaction;
  }

  private async createAddLiquidityTransaction(
    params: AddLiquidityParams
  ): Promise<Transaction> {
    // Implementation for add liquidity transaction
    const transaction = new Transaction();
    
    // Add liquidity instruction
    
    return transaction;
  }

  private async createRemoveLiquidityTransaction(
    params: RemoveLiquidityParams
  ): Promise<Transaction> {
    // Implementation for remove liquidity transaction
    const transaction = new Transaction();
    
    // Add remove liquidity instruction
    
    return transaction;
  }

  private async createPoolTransaction(
    tokenA: PublicKey,
    tokenB: PublicKey,
    feeBps: number
  ): Promise<Transaction> {
    // Implementation for create pool transaction
    const transaction = new Transaction();
    
    // Add create pool instruction
    
    return transaction;
  }
}

// Utility functions
export function formatPrice(price: number, decimals: number = 6): string {
  return price.toFixed(decimals);
}

export function calculateSlippage(
  amount: number,
  slippageBps: number
): { min: number; max: number } {
  const slippage = amount * (slippageBps / 10000);
  return {
    min: amount - slippage,
    max: amount + slippage,
  };
}

export function estimateOutputAmount(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  feeBps: number = 30
): number {
  const amountInWithFee = amountIn * (10000 - feeBps) / 10000;
  return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
}