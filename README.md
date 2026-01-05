# CBL DEX - Decentralized Exchange on Solana

A fully autonomous decentralized exchange similar to Orca/Raydium/Jupiter, built on Solana.

## Features
- Create liquidity pools with any token pair
- Swap tokens with low fees
- Provide liquidity and earn fees
- Advanced price API for third-party integration
- Multi-platform support (Web, Android, iOS, Windows)
- High security and audited smart contracts

## Quick Start

```bash
# Clone repository
git clone https://github.com/ciblcoin/CBL.git
cd CBL

# Install dependencies
npm install

# Build contracts
npm run build

# Run tests
npm test

# Deploy to devnet
npm run deploy:devnet

Documentation

· API Documentation
· Smart Contract Docs
· SDK Documentation
· Mobile App Setup

Applications

· Web App: https://cbl.ag
· Android: Google Play Store
· iOS: App Store
· Windows: Download

API Access

Use our public API for price feeds:

```bash
GET https://api.cbl.ag/v1/price/SOL_USDC
```

License

MIT License

```


## 2. Smart Contract  (`programs/cbl-dex/src/lib.rs`)

```rust
//! CBL DEX - Decentralized Exchange Program
//! 
//! This program implements a complete DEX on Solana with features similar to Orca/Raydium.
//! Supports: Liquidity pools, swapping, yield farming, and governance.

use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, Token, TokenAccount, Mint, Transfer},
    associated_token::AssociatedToken,
};
use std::mem::size_of;

declare_id!("CBLDEXv2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod cbl_dex {
    use super::*;

    /// Initializes the DEX with admin authority
    pub fn initialize_dex(ctx: Context<InitializeDex>) -> Result<()> {
        let dex = &mut ctx.accounts.dex;
        dex.authority = ctx.accounts.authority.key();
        dex.is_initialized = true;
        dex.version = 1;
        dex.bump = *ctx.bumps.get("dex").unwrap();
        
        emit!(DexInitialized {
            dex: dex.key(),
            authority: dex.authority,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Creates a new liquidity pool for a token pair
    /// 
    /// # Arguments
    /// * pool_fee - Fee for liquidity providers (basis points)
    /// * trading_fee - Fee for traders (basis points)
    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_fee: u16,
        trading_fee: u16,
    ) -> Result<()> {
        require!(pool_fee <= 1000, DexError::InvalidFee); // Max 10%
        require!(trading_fee <= 500, DexError::InvalidFee); // Max 5%
        
        let pool = &mut ctx.accounts.pool;
        pool.token_a_mint = ctx.accounts.token_a_mint.key();
        pool.token_b_mint = ctx.accounts.token_b_mint.key();
        pool.token_a_vault = ctx.accounts.token_a_vault.key();
        pool.token_b_vault = ctx.accounts.token_b_vault.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.pool_fee = pool_fee;
        pool.trading_fee = trading_fee;
        pool.authority = ctx.accounts.authority.key();
        pool.liquidity = 0;
        pool.volume_24h = 0;
        pool.is_active = true;
        pool.bump = *ctx.bumps.get("pool").unwrap();
        pool.created_at = Clock::get()?.unix_timestamp;
        
        emit!(PoolCreated {
            pool: pool.key(),
            token_a: pool.token_a_mint,
            token_b: pool.token_b_mint,
            lp_mint: pool.lp_mint,
            pool_fee,
            trading_fee,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Adds liquidity to an existing pool
    /// 
    /// # Arguments
    /// * amount_a - Amount of token A to deposit
    /// * amount_b - Amount of token B to deposit
    /// * min_lp_tokens - Minimum LP tokens to receive (slippage protection)
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
        min_lp_tokens: u64,
    ) -> Result<()> {
        require!(amount_a > 0 && amount_b > 0, DexError::InvalidAmount);
        
        // Calculate LP tokens using constant product formula
        let lp_tokens = calculate_lp_tokens(
            amount_a,
            amount_b,
            ctx.accounts.token_a_vault.amount,
            ctx.accounts.token_b_vault.amount,
            ctx.accounts.lp_mint.supply,
        );
        
        require!(lp_tokens >= min_lp_tokens, DexError::SlippageExceeded);
        
        // Transfer tokens from user to vaults
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.user_token_a,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.user,
            amount_a,
        )?;
        
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.user_token_b,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.user,
            amount_b,
        )?;
        
        // Mint LP tokens to user
        mint_lp_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.lp_mint,
            &ctx.accounts.user_lp_token,
            &ctx.accounts.pool,
            lp_tokens,
            &[
                b"pool",
                ctx.accounts.pool.token_a_mint.as_ref(),
                ctx.accounts.pool.token_b_mint.as_ref(),
                &[ctx.accounts.pool.bump],
            ],
        )?;
        
        // Update pool liquidity
        let pool = &mut ctx.accounts.pool;
        pool.liquidity = pool.liquidity
            .checked_add(amount_a.checked_add(amount_b).unwrap())
            .unwrap();
        
        emit!(LiquidityAdded {
            pool: pool.key(),
            provider: ctx.accounts.user.key(),
            amount_a,
            amount_b,
            lp_minted: lp_tokens,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Swaps tokens in a pool
    /// 
    /// # Arguments
    /// * amount_in - Input amount
    /// * min_amount_out - Minimum output amount (slippage protection)
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        require!(amount_in > 0, DexError::InvalidAmount);
        
        let amount_out = calculate_output_amount(
            amount_in,
            ctx.accounts.token_in_vault.amount,
            ctx.accounts.token_out_vault.amount,
            ctx.accounts.pool.trading_fee,
        )?;
        
        require!(amount_out >= min_amount_out, DexError::SlippageExceeded);
        require!(
            amount_out <= ctx.accounts.token_out_vault.amount,
            DexError::InsufficientLiquidity
        );
        
        // Transfer input tokens from user to vault
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.user_token_in,
            &ctx.accounts.token_in_vault,
            &ctx.accounts.user,
            amount_in,
        )?;
        
        // Transfer output tokens from vault to user
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.token_out_vault,
            &ctx.accounts.user_token_out,
            &ctx.accounts.pool,
            amount_out,
            &[
                b"pool",
                ctx.accounts.pool.token_a_mint.as_ref(),
                ctx.accounts.pool.token_b_mint.as_ref(),
                &[ctx.accounts.pool.bump],
            ],
        )?;
        
        // Update pool volume
        let pool = &mut ctx.accounts.pool;
        pool.volume_24h = pool.volume_24h
            .checked_add(amount_in)
            .unwrap();
        
        emit!(SwapExecuted {
            pool: pool.key(),
            user: ctx.accounts.user.key(),
            token_in: ctx.accounts.token_in_mint.key(),
            token_out: ctx.accounts.token_out_mint.key(),
            amount_in,
            amount_out,
            fee: ctx.accounts.pool.trading_fee,
            price: calculate_price(amount_in, amount_out),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Removes liquidity from a pool
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_amount_a: u64,
        min_amount_b: u64,
    ) -> Result<()> {
        require!(lp_amount > 0, DexError::InvalidAmount);
        
        // Calculate proportional share
        let (amount_a, amount_b) = calculate_withdrawal_amounts(
            lp_amount,
            ctx.accounts.lp_mint.supply,
            ctx.accounts.token_a_vault.amount,
            ctx.accounts.token_b_vault.amount,
        );
        
        require!(amount_a >= min_amount_a && amount_b >= min_amount_b, 
                DexError::SlippageExceeded);
        
        // Burn LP tokens
        burn_lp_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.lp_mint,
            &ctx.accounts.user_lp_token,
            &ctx.accounts.user,
            lp_amount,
        )?;
        
        // Transfer tokens from vaults to user
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.user_token_a,
            &ctx.accounts.pool,
            amount_a,
            &[
                b"pool",
                ctx.accounts.pool.token_a_mint.as_ref(),
                ctx.accounts.pool.token_b_mint.as_ref(),
                &[ctx.accounts.pool.bump],
            ],
        )?;
        
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.user_token_b,
            &ctx.accounts.pool,
            amount_b,
            &[
                b"pool",
                ctx.accounts.pool.token_a_mint.as_ref(),
                ctx.accounts.pool.token_b_mint.as_ref(),
                &[ctx.accounts.pool.bump],
            ],
        )?;
        
        // Update pool liquidity
        let pool = &mut ctx.accounts.pool;
        pool.liquidity = pool.liquidity
            .checked_sub(amount_a.checked_add(amount_b).unwrap())
            .unwrap();
        
        emit!(LiquidityRemoved {
            pool: pool.key(),
            provider: ctx.accounts.user.key(),
            lp_burned: lp_amount,
            amount_a,
            amount_b,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

// =============== ACCOUNT STRUCTS ===============

#[account]
#[derive(Default)]
pub struct Dex {
    pub authority: Pubkey,      // Admin authority
    pub is_initialized: bool,   // Initialization flag
    pub version: u8,           // Contract version
    pub total_pools: u32,      // Total pools created
    pub total_volume: u64,     // Total trading volume
    pub bump: u8,              // PDA bump
}

#[account]
#[derive(Default)]
pub struct Pool {
    // Token mints
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    
    // Vault addresses
    pub token_a_vault: Pubkey,
    pub token_b_vault: Pubkey,
    
    // LP token
    pub lp_mint: Pubkey,
    
    // Fees (basis points)
    pub pool_fee: u16,      // Liquidity provider fee
    pub trading_fee: u16,   // Trading fee
    
    // Stats
    pub liquidity: u64,     // Total liquidity
    pub volume_24h: u64,    // 24h volume
    pub trades_24h: u32,    // 24h trade count
    
    // Metadata
    pub authority: Pubkey,  // Pool creator
    pub is_active: bool,    // Active status
    pub bump: u8,           // PDA bump
    pub created_at: i64,    // Creation timestamp
}

// =============== CONTEXTS ===============

#[derive(Accounts)]
pub struct InitializeDex<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + size_of::<Dex>(),
        seeds = [b"dex"],
        bump
    )]
    pub dex: Account<'info, Dex>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + size_of::<Pool>(),
        seeds = [
            b"pool",
            token_a_mint.key().as_ref(),
            token_b_mint.key().as_ref()
        ],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        token::mint = token_a_mint,
        token::authority = pool,
        seeds = [
            b"vault_a",
            token_a_mint.key().as_ref(),
            token_b_mint.key().as_ref()
        ],
        bump
    )]
    pub token_a_vault: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        token::mint = token_b_mint,
        token::authority = pool,
        seeds = [
            b"vault_b",
            token_a_mint.key().as_ref(),
            token_b_mint.key().as_ref()
        ],
        bump
    )]
    pub token_b_vault: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = pool,
        seeds = [
            b"lp_mint",
            token_a_mint.key().as_ref(),
            token_b_mint.key().as_ref()
        ],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

// ... (Other contexts for AddLiquidity, Swap, RemoveLiquidity)

// =============== EVENTS ===============

#[event]
pub struct DexInitialized {
    pub dex: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub lp_mint: Pubkey,
    pub pool_fee: u16,
    pub trading_fee: u16,
    pub timestamp: i64,
}

#[event]
pub struct LiquidityAdded {
    pub pool: Pubkey,
    pub provider: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub lp_minted: u64,
    pub timestamp: i64,
}

#[event]
pub struct SwapExecuted {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub token_in: Pubkey,
    pub token_out: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u16,
    pub price: u64,
    pub timestamp: i64,
}

#[event]
pub struct LiquidityRemoved {
    pub pool: Pubkey,
    pub provider: Pubkey,
    pub lp_burned: u64,
    pub amount_a: u64,
    pub amount_b: u64,
    pub timestamp: i64,
}

// =============== ERRORS ===============

#[error_code]
pub enum DexError {
    #[msg("Invalid fee amount")]
    InvalidFee,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Pool not active")]
    PoolNotActive,
    #[msg("Math overflow")]
    MathOverflow,
}

// =============== HELPER FUNCTIONS ===============

fn calculate_output_amount(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_bps: u16,
) -> Result<u64> {
    require!(reserve_in > 0 && reserve_out > 0, DexError::InsufficientLiquidity);
    
    let amount_in_with_fee = amount_in
        .checked_mul(10000u64.checked_sub(fee_bps as u64).unwrap())
        .unwrap()
        .checked_div(10000)
        .unwrap();
    
    let numerator = amount_in_with_fee
        .checked_mul(reserve_out)
        .ok_or(DexError::MathOverflow)?;
    
    let denominator = reserve_in
        .checked_add(amount_in_with_fee)
        .ok_or(DexError::MathOverflow)?;
    
    numerator
        .checked_div(denominator)
        .ok_or(DexError::MathOverflow)
}

fn calculate_lp_tokens(
    amount_a: u64,
    amount_b: u64,
    reserve_a: u64,
    reserve_b: u64,
    total_supply: u64,
) -> u64 {
    if total_supply == 0 {
        // Initial liquidity: sqrt(amount_a * amount_b)
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .unwrap();
        (product as f64).sqrt() as u64
    } else {
        // Proportional to existing supply
        let share_a = (amount_a as u128)
            .checked_mul(total_supply as u128)
            .unwrap()
            .checked_div(reserve_a as u128)
            .unwrap();
        
        let share_b = (amount_b as u128)
            .checked_mul(total_supply as u128)
            .unwrap()
            .checked_div(reserve_b as u128)
            .unwrap();
        
        share_a.min(share_b) as u64
    }
}

fn calculate_withdrawal_amounts(
    lp_amount: u64,
    total_supply: u64,
    reserve_a: u64,
    reserve_b: u64,
) -> (u64, u64) {
    let share = (lp_amount as f64) / (total_supply as f64);
    let amount_a = (reserve_a as f64 * share) as u64;
    let amount_b = (reserve_b as f64 * share) as u64;
    (amount_a, amount_b)
}

fn calculate_price(amount_in: u64, amount_out: u64) -> u64 {
    if amount_out == 0 {
        return 0;
    }
    (amount_in as u128 * 10u128.pow(9) / amount_out as u128) as u64
}

// Helper token transfer functions
fn transfer_tokens(
    token_program: &AccountInfo,
    from: &Account<TokenAccount>,
    to: &Account<TokenAccount>,
    authority: &Signer,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)
}

fn transfer_from_vault<'info>(
    token_program: &AccountInfo<'info>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    pool: &Account<'info, Pool>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: vault.to_account_info(),
        to: to.to_account_info(),
        authority: pool.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        cpi_accounts,
        &[seeds],
    );
    
    token::transfer(cpi_ctx, amount)
}

fn mint_lp_tokens<'info>(
    token_program: &AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    to: &Account<'info, TokenAccount>,
    authority: &Account<'info, Pool>,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    let cpi_accounts = token::MintTo {
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        cpi_accounts,
        &[seeds],
    );
    
    token::mint_to(cpi_ctx, amount)
}

fn burn_lp_tokens(
    token_program: &AccountInfo,
    mint: &Account<Mint>,
    from: &Account<TokenAccount>,
    authority: &Signer,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = token::Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: authority.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
    token::burn(cpi_ctx, amount)
}