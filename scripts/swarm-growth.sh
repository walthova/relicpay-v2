#!/bin/zsh
# RelicPay swarm — growth pass (invoked by launchd Mon/Wed/Fri).
# Drafts only: the agent never posts, emails, or submits anything externally.

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/w.m/relicpay || exit 1

mkdir -p docs/progress marketing/drafts .runtime
exec claude -p "Invoke the relicpay-growth agent for one growth pass. Follow its instructions exactly — drafts only, flag everything external as NEEDS-WALTER in the progress note." \
  --permission-mode acceptEdits \
  >> .runtime/swarm-growth.log 2>&1
