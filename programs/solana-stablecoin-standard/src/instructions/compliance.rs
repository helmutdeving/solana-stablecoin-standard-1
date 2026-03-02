use anchor_lang::prelude::*;

use crate::errors::SssError;
use crate::state::*;

#[derive(Accounts)]
pub struct RecordComplianceEvent<'info> {
    pub compliance_officer: Signer<'info>,

    #[account(
        seeds = [b"sss-config", config.mint.as_ref()],
        bump = config.bump,
        constraint = config.is_sss2() @ SssError::NotSss2,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [b"sss-compliance", config.mint.as_ref()],
        bump = compliance.bump,
        constraint = compliance.compliance_officer == compliance_officer.key() @ SssError::Unauthorized,
    )]
    pub compliance: Account<'info, ComplianceConfig>,

    #[account(
        init,
        payer = compliance_officer,
        space = ComplianceEventRecord::LEN,
        seeds = [
            b"sss-event",
            config.mint.as_ref(),
            compliance.event_count.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub event_record: Account<'info, ComplianceEventRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RecordComplianceEvent>, event: ComplianceEventData) -> Result<()> {
    let compliance = &mut ctx.accounts.compliance;
    let event_record = &mut ctx.accounts.event_record;
    let clock = Clock::get()?;

    event_record.mint = ctx.accounts.config.mint;
    event_record.event_id = compliance.event_count;
    event_record.event_type = event.event_type;
    event_record.subject = event.subject;
    event_record.actor = ctx.accounts.compliance_officer.key();
    event_record.amount = event.amount;
    event_record.note = event.note;
    event_record.timestamp = clock.unix_timestamp;
    event_record.bump = ctx.bumps.event_record;

    compliance.event_count = compliance.event_count.checked_add(1).ok_or(SssError::Overflow)?;

    Ok(())
}
