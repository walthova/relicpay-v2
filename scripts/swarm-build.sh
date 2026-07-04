#!/bin/zsh
# RelicPay swarm — daily build increment (invoked by launchd on weekdays).
# Runs headless Claude with the relicpay-build agent definition.
# Permissions are scoped by /Users/w.m/relicpay/.claude/settings.json:
# build/test/commit allowed; push/deploy/transfer denied.

export PATH="$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/w.m/relicpay || exit 1

mkdir -p docs/progress .runtime
exec claude -p "Invoke the relicpay-build agent for one daily build increment. Follow its instructions exactly, including the frozen characterization suite rule and the dated progress note." \
  --permission-mode acceptEdits \
  >> .runtime/swarm-build.log 2>&1
