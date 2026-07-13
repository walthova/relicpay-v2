#!/bin/zsh
# RelicPay swarm — evening digest to Walter's Telegram (launchd, weekdays 6:07pm).
#
# Token setup (one-time, by Walter): create ~/relicpay/.telegram.env containing
#   TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# (same token the Telegram bridge bot uses, from @BotFather). File is gitignored.
# Until the token exists, the digest falls back to a macOS notification and the
# report file below, so nothing is silently lost.

export PATH="$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/w.m/relicpay || exit 1
mkdir -p docs/reports .runtime

TODAY=$(date +%Y-%m-%d)
REPORT="docs/reports/$TODAY.md"
CHAT_ID="1427434233"
[ -f .telegram.env ] && source .telegram.env

# Assemble the digest with a short headless claude run.
claude -p "Write Walter's RelicPay evening digest for $TODAY as plain text (no markdown headers), max 400 words. Read docs/progress/$TODAY.md if it exists (say 'No swarm activity today' if not), plus 'git log --oneline --since=yesterday'. Structure: 1) SHIPPED — concrete results with test counts. 2) RESULTS DELTA — what moved toward money/users/deploys. 3) DECISIONS NEEDED — every open NEEDS-WALTER item across the three most recent progress notes, numbered, one line each, so Walter can reply 'do 2' in Telegram. Write ONLY the digest text to stdout, nothing else." \
  --allowedTools "Read" "Bash(git log*)" "Bash(ls*)" \
  --permission-mode acceptEdits \
  > "$REPORT" 2>> .runtime/swarm-report.log

if [ ! -s "$REPORT" ]; then
  echo "digest generation produced no output for $TODAY" >> .runtime/swarm-report.log
  exit 1
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  # Direct Bot API sendMessage — does not conflict with the bridge's polling.
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$(cat "$REPORT")" \
    >> .runtime/swarm-report.log 2>&1
  echo "sent to telegram: $TODAY" >> .runtime/swarm-report.log
else
  osascript -e "display notification \"Digest ready: $REPORT (add .telegram.env for Telegram delivery)\" with title \"RelicPay Report\"" 2>/dev/null
  echo "no TELEGRAM_BOT_TOKEN — notification fallback used for $TODAY" >> .runtime/swarm-report.log
fi
