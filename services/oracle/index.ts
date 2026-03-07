/**
 * SSS Oracle Service
 *
 * Provides price oracle integration for stablecoin operations.
 * Supports multiple price sources with fallback:
 *   1. Pyth Network (primary — on-chain, low-latency)
 *   2. Switchboard V2 (secondary — permissionless feeds)
 *   3. CoinGecko REST API (fallback — off-chain, for testing)
 *
 * Use cases:
 *   - computeMintAmount: given N USD, how many tokens to mint?
 *   - computeRedeemAmount: given N tokens, how much USD to return?
 *   - getPriceWithConfidence: get current price + confidence interval
 *
 * Design:
 *   The oracle service does NOT make on-chain CPI calls. It fetches the
 *   current price off-chain and the client uses the result to build
 *   the correct mint/burn instruction amounts. The on-chain program
 *   validates mint_authority — the oracle is purely client-side.
 */

import { Connection, PublicKey } from '@solana/web3.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceResult {
  price: number;           // USD price per 1 unit of collateral
  confidence: number;      // ±confidence interval
  exponent: number;        // Pyth price exponent (price = price_raw * 10^exponent)
  source: PriceSource;
  timestamp: number;       // Unix timestamp
  slot: number;            // Solana slot (0 for off-chain sources)
}

export type PriceSource = 'pyth' | 'switchboard' | 'coingecko' | 'mock';

export interface OracleConfig {
  rpcUrl: string;
  pythProgramId?: string;
  switchboardProgramId?: string;
  // Mapping: token symbol → price feed IDs
  feeds: Record<string, FeedConfig>;
}

export interface FeedConfig {
  pythFeedId?: string;     // Pyth price feed account (base58)
  switchboardFeedId?: string;
  coingeckoId?: string;    // e.g. "usd-coin", "euro-coin"
}

export interface MintCalculation {
  tokensToMint: bigint;    // in token base units
  collateralRequired: bigint; // in collateral base units
  price: PriceResult;
  slippageBps: number;     // applied slippage (basis points)
}

export interface RedeemCalculation {
  collateralToReturn: bigint;
  tokensToburn: bigint;
  price: PriceResult;
  feeBps: number;
}

// ─── Oracle Client ────────────────────────────────────────────────────────────

export class SSSOracle {
  private connection: Connection;
  private config: OracleConfig;
  private priceCache: Map<string, { result: PriceResult; fetchedAt: number }>;
  private cacheTtlMs: number;

  constructor(config: OracleConfig, cacheTtlMs = 5_000) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.config = config;
    this.priceCache = new Map();
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get the current price for a symbol (USD per collateral unit).
   * Tries sources in order: Pyth → Switchboard → CoinGecko → cached value.
   */
  async getPrice(symbol: string): Promise<PriceResult> {
    // Check cache
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.result;
    }

    const feed = this.config.feeds[symbol];
    if (!feed) {
      throw new Error(`No price feed configured for symbol: ${symbol}`);
    }

    let result: PriceResult | null = null;

    // Try Pyth first
    if (feed.pythFeedId) {
      result = await this.fetchPyth(feed.pythFeedId).catch(() => null);
    }

    // Try Switchboard
    if (!result && feed.switchboardFeedId) {
      result = await this.fetchSwitchboard(feed.switchboardFeedId).catch(() => null);
    }

    // Fallback to CoinGecko
    if (!result && feed.coingeckoId) {
      result = await this.fetchCoinGecko(feed.coingeckoId).catch(() => null);
    }

    if (!result) {
      // Return stale cache if available
      if (cached) {
        console.warn(`[Oracle] Using stale price for ${symbol} (all feeds failed)`);
        return cached.result;
      }
      throw new Error(`[Oracle] All price sources failed for ${symbol}`);
    }

    this.priceCache.set(symbol, { result, fetchedAt: Date.now() });
    return result;
  }

  /**
   * Compute how many tokens to mint given a USD collateral amount.
   *
   * Formula: tokens = (collateralUsd / price) * (1 - slippage)
   *
   * @param symbol  Token symbol (must be in config.feeds)
   * @param collateralUsd  Amount of USD collateral being deposited
   * @param tokenDecimals  Token decimal places (usually 6)
   * @param slippageBps    Max acceptable slippage in basis points (default 50 = 0.5%)
   */
  async computeMintAmount(
    symbol: string,
    collateralUsd: number,
    tokenDecimals: number,
    slippageBps = 50,
  ): Promise<MintCalculation> {
    const price = await this.getPrice(symbol);
    const slippageFactor = 1 - slippageBps / 10_000;
    const tokenAmount = (collateralUsd / price.price) * slippageFactor;
    const tokenBaseUnits = BigInt(Math.floor(tokenAmount * 10 ** tokenDecimals));
    const collateralBaseUnits = BigInt(Math.floor(collateralUsd * 10 ** 6));

    return {
      tokensToMint: tokenBaseUnits,
      collateralRequired: collateralBaseUnits,
      price,
      slippageBps,
    };
  }

  /**
   * Compute how much USD collateral to return given a token redemption.
   *
   * Formula: collateral = tokens * price * (1 - fee)
   */
  async computeRedeemAmount(
    symbol: string,
    tokenAmount: bigint,
    tokenDecimals: number,
    feeBps = 10, // 0.1% redemption fee
  ): Promise<RedeemCalculation> {
    const price = await this.getPrice(symbol);
    const tokenAmountNormalized = Number(tokenAmount) / 10 ** tokenDecimals;
    const feeFactor = 1 - feeBps / 10_000;
    const collateralUsd = tokenAmountNormalized * price.price * feeFactor;
    const collateralBaseUnits = BigInt(Math.floor(collateralUsd * 10 ** 6));

    return {
      collateralToReturn: collateralBaseUnits,
      tokensToburn: tokenAmount,
      price,
      feeBps,
    };
  }

  /**
   * Get price with confidence for display / slippage estimation.
   */
  async getPriceWithConfidence(symbol: string): Promise<{
    price: number;
    low: number;
    high: number;
    source: PriceSource;
    ageMs: number;
  }> {
    const result = await this.getPrice(symbol);
    return {
      price: result.price,
      low: result.price - result.confidence,
      high: result.price + result.confidence,
      source: result.source,
      ageMs: Date.now() - result.timestamp * 1000,
    };
  }

  // ─── Source implementations ──────────────────────────────────────────────

  private async fetchPyth(feedId: string): Promise<PriceResult> {
    const feedPubkey = new PublicKey(feedId);
    const accountInfo = await this.connection.getAccountInfo(feedPubkey);
    if (!accountInfo) throw new Error(`Pyth feed account not found: ${feedId}`);

    // Parse Pyth price account (simplified — real impl uses @pythnetwork/client)
    // Pyth price account layout: https://docs.pyth.network/documentation/pythnet-price-feeds/account-structure
    const data = accountInfo.data;

    // Magic: bytes 0-3 = 0xa1b2c3e4 (little-endian)
    const magic = data.readUInt32LE(0);
    if (magic !== 0xa1b2c3e4) {
      throw new Error(`Not a valid Pyth price account: ${feedId}`);
    }

    // Price info at offset 208 (agg price)
    const priceRaw = Number(data.readBigInt64LE(208));
    const confRaw = Number(data.readBigUInt64LE(216));
    const exponent = data.readInt32LE(20);
    const publishTime = Number(data.readBigInt64LE(240));
    const slot = Number(data.readBigUInt64LE(248));

    const scale = Math.pow(10, exponent);
    const price = priceRaw * scale;
    const confidence = confRaw * scale;

    return {
      price,
      confidence,
      exponent,
      source: 'pyth',
      timestamp: publishTime,
      slot,
    };
  }

  private async fetchSwitchboard(feedId: string): Promise<PriceResult> {
    // Switchboard V2 aggregator account
    const feedPubkey = new PublicKey(feedId);
    const accountInfo = await this.connection.getAccountInfo(feedPubkey);
    if (!accountInfo) throw new Error(`Switchboard feed not found: ${feedId}`);

    // Switchboard AggregatorAccountData layout
    // Latest result at offset ~3468 (mantissa + scale)
    const data = accountInfo.data;
    const mantissaBytes = data.slice(3468, 3484); // 128-bit int
    const scale = data.readUInt32LE(3484);

    // Convert 128-bit little-endian to BigInt
    let mantissa = BigInt(0);
    for (let i = 0; i < 16; i++) {
      mantissa += BigInt(mantissaBytes[i]!) << BigInt(i * 8);
    }
    const price = Number(mantissa) / Math.pow(10, scale);

    const currentSlot = await this.connection.getSlot();
    return {
      price,
      confidence: price * 0.001, // Switchboard doesn't expose confidence directly
      exponent: -scale,
      source: 'switchboard',
      timestamp: Math.floor(Date.now() / 1000),
      slot: currentSlot,
    };
  }

  private async fetchCoinGecko(coingeckoId: string): Promise<PriceResult> {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd&include_last_updated_at=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const json = (await res.json()) as Record<string, { usd: number; last_updated_at: number }>;
    const data = json[coingeckoId];
    if (!data) throw new Error(`No CoinGecko data for ${coingeckoId}`);

    return {
      price: data.usd,
      confidence: data.usd * 0.002, // 0.2% assumed spread
      exponent: -8,
      source: 'coingecko',
      timestamp: data.last_updated_at,
      slot: 0,
    };
  }
}

// ─── Factory / default configs ────────────────────────────────────────────────

export const MAINNET_ORACLE_CONFIG: OracleConfig = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  pythProgramId: 'FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH',
  feeds: {
    USDC: {
      pythFeedId: 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD',
      coingeckoId: 'usd-coin',
    },
    EURC: {
      pythFeedId: 'CPjXDqb3G8An5SzEqJHFGXqoaB3Kb2UkJXFKChnbRkZc',
      coingeckoId: 'euro-coin',
    },
    USDT: {
      pythFeedId: '3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL',
      coingeckoId: 'tether',
    },
  },
};

export const DEVNET_ORACLE_CONFIG: OracleConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  feeds: {
    USDC: {
      coingeckoId: 'usd-coin',
    },
    EURC: {
      coingeckoId: 'euro-coin',
    },
  },
};

/**
 * Create a mock oracle for testing — returns configurable prices.
 */
export function createMockOracle(prices: Record<string, number>): SSSOracle {
  const config: OracleConfig = {
    rpcUrl: 'https://api.devnet.solana.com',
    feeds: Object.fromEntries(
      Object.keys(prices).map((sym) => [sym, { coingeckoId: sym.toLowerCase() }])
    ),
  };

  const oracle = new SSSOracle(config);

  // Monkey-patch getPrice to return mock values
  const mockGetPrice = async (symbol: string): Promise<PriceResult> => {
    const price = prices[symbol];
    if (price === undefined) throw new Error(`No mock price for ${symbol}`);
    return {
      price,
      confidence: price * 0.001,
      exponent: -6,
      source: 'mock',
      timestamp: Math.floor(Date.now() / 1000),
      slot: 0,
    };
  };

  (oracle as any).getPrice = mockGetPrice;
  return oracle;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const oracle = new SSSOracle(DEVNET_ORACLE_CONFIG);

    console.log('SSS Oracle Service — Price Check');
    console.log('=================================');

    for (const symbol of ['USDC', 'EURC']) {
      try {
        const result = await oracle.getPriceWithConfidence(symbol);
        console.log(`\n${symbol}:`);
        console.log(`  Price:  $${result.price.toFixed(6)}`);
        console.log(`  Range:  $${result.low.toFixed(6)} – $${result.high.toFixed(6)}`);
        console.log(`  Source: ${result.source}`);
        console.log(`  Age:    ${result.ageMs}ms`);

        const mint = await oracle.computeMintAmount(symbol, 1000, 6);
        console.log(`  Mint:   $1,000 → ${mint.tokensToMint.toString()} base units`);

        const redeem = await oracle.computeRedeemAmount(symbol, mint.tokensToMint, 6);
        console.log(`  Redeem: ${mint.tokensToMint.toString()} tokens → ${redeem.collateralToReturn.toString()} USD base units`);
      } catch (err) {
        console.error(`  Error: ${err}`);
      }
    }
  })();
}
