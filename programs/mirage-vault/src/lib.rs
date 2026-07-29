use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

declare_id!("D6au34Ft153B5ghrujVzTg4nGJFiitpePnoQ666JPzB7");

#[program]
pub mod mirage_vault {
    use super::*;

    pub fn settle(ctx: Context<Settle>, amount: u64) -> Result<()> {
        require!(amount > 0, MirageError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.facade_ata.to_account_info(),
                    to: ctx.accounts.merchant_ata.to_account_info(),
                    authority: ctx.accounts.facade.to_account_info(),
                },
            ),
            amount,
        )?;
        token::close_account(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.facade_ata.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.facade.to_account_info(),
            },
        ))?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub facade: Signer<'info>,
    #[account(mut, constraint = facade_ata.owner == facade.key() @ MirageError::WrongOwner)]
    pub facade_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub merchant_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum MirageError {
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("facade_ata not owned by facade")]
    WrongOwner,
}
