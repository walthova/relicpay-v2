use anchor_lang::prelude::*;

#[error_code]
pub enum RelicPayError {
    #[msg("Invalid payment amount — must be greater than zero")]
    InvalidAmount,
    #[msg("Installment count must be between 2 and 12")]
    InvalidInstallments,
    #[msg("Payment interval must be greater than zero")]
    InvalidInterval,
    #[msg("Product ID must be 64 characters or fewer")]
    InvalidProductId,
    #[msg("Merchant name must be 64 characters or fewer")]
    InvalidMerchantName,
    #[msg("Agreement is not active")]
    AgreementNotActive,
    #[msg("Agreement is not yet complete")]
    AgreementNotComplete,
    #[msg("All installments already paid")]
    AlreadyCompleted,
    #[msg("Next payment is not due yet — check your schedule")]
    PaymentNotDue,
    #[msg("Grace period has not expired — wait 7 days past the missed due date")]
    GracePeriodNotExpired,
    #[msg("Unauthorized — only the authorized wallet can call this")]
    Unauthorized,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    // ── v2 additions (appended so v1 error codes keep their numbers) ──
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Merchant has already withdrawn payment for this agreement")]
    AlreadyWithdrawn,
    #[msg("Agreement is still active or has unsettled funds — cannot close")]
    AgreementNotSettled,
    #[msg("Yield rate exceeds the protocol maximum")]
    RateTooHigh,
}
