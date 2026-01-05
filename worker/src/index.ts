/**
 * CBL DEX API Worker
 * Provides price feeds and trading data for third-party integration
 * Deployed on Cloudflare Workers
 */

import { Router } from 'itty-router';
import { CORS_HEADERS, RATE_LIMIT, API_VERSION } from './constants';
import { PriceCache } from './cache';
import { SolanaRPC } from './solana';
import { validateRequest, rateLimit } from './middleware';

// Initialize router
const router = Router();
const priceCache = new PriceCache();
const solanaRPC = new SolanaRPC(process.env.SOLANA_RPC_URL);

// Health check endpoint
router.get('/health', () => {
  return new Response(JSON.stringify({
    status: 'ok',
    version: API_VERSION,
    timestamp: Date.now(),
  }), {
    headers: CORS_HEADERS,
  });
});

// Get price for a token pair
router.get('/v1/price/:pair', async (request: Request) => {
  const { pair } = request.params;
  const cacheKey = `price:${pair.toUpperCase()}`;
  
  try {
    // Try cache first
    let price = await priceCache.get(cacheKey);
    
    if (!price) {
      // Fetch from Solana on-chain data
      price = await fetchPriceFromChain(pair);
      
      // Cache for 5 seconds
      await priceCache.set(cacheKey, price, 5);
    }
    
    return new Response(JSON.stringify({
      success: true,
      pair: pair.toUpperCase(),
      price: price.current,
      change_24h: price.change24h,
      volume_24h: price.volume24h,
      liquidity: price.liquidity,
      timestamp: Date.now(),
      source: 'CBL DEX',
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch price',
      details: error.message,
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// Get all available pools
router.get('/v1/pools', async (request: Request) => {
  const { page = 1, limit = 50 } = request.query;
  
  try {
    const pools = await solanaRPC.getPools({
      page: Number(page),
      limit: Number(limit),
    });
    
    return new Response(JSON.stringify({
      success: true,
      pools,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: pools.length,
      },
      timestamp: Date.now(),
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch pools',
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// Get recent trades
router.get('/v1/trades/:pool?', async (request: Request) => {
  const { pool } = request.params;
  const { limit = 100 } = request.query;
  
  try {
    const trades = await solanaRPC.getRecentTrades({
      poolAddress: pool,
      limit: Number(limit),
    });
    
    return new Response(JSON.stringify({
      success: true,
      trades,
      count: trades.length,
      timestamp: Date.now(),
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch trades',
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// Get order book for a pair
router.get('/v1/orderbook/:pair', async (request: Request) => {
  const { pair } = request.params;
  const { depth = 20 } = request.query;
  
  try {
    const orderbook = await fetchOrderBook(pair, Number(depth));
    
    return new Response(JSON.stringify({
      success: true,
      pair: pair.toUpperCase(),
      bids: orderbook.bids,
      asks: orderbook.asks,
      mid_price: orderbook.midPrice,
      timestamp: Date.now(),
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch order book',
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// Get DEX statistics
router.get('/v1/stats', async () => {
  try {
    const stats = await getDexStatistics();
    
    return new Response(JSON.stringify({
      success: true,
      ...stats,
      timestamp: Date.now(),
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to fetch statistics',
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// WebSocket for real-time prices
router.get('/v1/ws', async (request: Request, env: any) => {
  const upgradeHeader = request.headers.get('Upgrade');
  
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }
  
  const [client, server] = Object.values(new WebSocketPair());
  
  server.accept();
  
  // Handle WebSocket messages
  server.addEventListener('message', async (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'subscribe':
          const prices = await subscribeToPrices(server, data.pairs);
          server.send(JSON.stringify({
            type: 'price_update',
            prices,
            timestamp: Date.now(),
          }));
          break;
          
        case 'unsubscribe':
          unsubscribeFromPrices(server, data.pairs);
          break;
          
        case 'ping':
          server.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
          }));
          break;
      }
    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        message: error.message,
      }));
    }
  });
  
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
});

// Batch price request
router.post('/v1/batch/prices', async (request: Request) => {
  try {
    const { pairs } = await request.json();
    
    if (!Array.isArray(pairs) || pairs.length > 100) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid request. Maximum 100 pairs allowed.',
      }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    
    const prices = await Promise.all(
      pairs.map(async (pair: string) => {
        const price = await priceCache.get(`price:${pair.toUpperCase()}`) ||
                     await fetchPriceFromChain(pair);
        return {
          pair: pair.toUpperCase(),
          ...price,
        };
      })
    );
    
    return new Response(JSON.stringify({
      success: true,
      prices,
      timestamp: Date.now(),
    }), {
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Batch request failed',
    }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});

// CORS preflight
router.options('*', () => {
  return new Response(null, {
    headers: CORS_HEADERS,
  });
});

// 404 handler
router.all('*', () => {
  return new Response(JSON.stringify({
    success: false,
    error: 'Endpoint not found',
  }), {
    status: 404,
    headers: CORS_HEADERS,
  });
});

// Helper functions
async function fetchPriceFromChain(pair: string): Promise<any> {
  // Implementation for fetching price from Solana chain
  const [tokenA, tokenB] = pair.split('_');
  
  // Fetch pool data from Solana
  const poolData = await solanaRPC.getPoolData(tokenA, tokenB);
  
  if (!poolData) {
    throw new Error(`No pool found for pair ${pair}`);
  }
  
  return {
    current: poolData.price,
    change24h: poolData.change24h,
    volume24h: poolData.volume24h,
    liquidity: poolData.liquidity,
    high24h: poolData.high24h,
    low24h: poolData.low24h,
  };
}

async function fetchOrderBook(pair: string, depth: number): Promise<any> {
  // Implementation for fetching order book
  const [tokenA, tokenB] = pair.split('_');
  
  // This would fetch actual order book data from the DEX
  return {
    bids: [],
    asks: [],
    midPrice: 0,
  };
}

async function getDexStatistics(): Promise<any> {
  const stats = await solanaRPC.getDexStats();
  
  return {
    total_volume: stats.totalVolume,
    total_liquidity: stats.totalLiquidity,
    total_trades: stats.totalTrades,
    total_pools: stats.totalPools,
    total_users: stats.totalUsers,
    daily_volume: stats.dailyVolume,
    daily_trades: stats.dailyTrades,
    top_pairs: stats.topPairs,
  };
}

async function subscribeToPrices(ws: WebSocket, pairs: string[]): Promise<any[]> {
  // Subscribe to price updates
  return Promise.all(pairs.map(pair => fetchPriceFromChain(pair)));
}

function unsubscribeFromPrices(ws: WebSocket, pairs: string[]): void {
  // Unsubscribe logic
}

// Apply middleware
router.all('*', validateRequest);
router.all('*', rateLimit(RATE_LIMIT));

export default {
  fetch: router.handle,
};