#!/bin/zsh
# Deactivate the RelicPay swarm.
for job in relicpay-build relicpay-growth; do
  launchctl unload ~/Library/LaunchAgents/com.walthova.$job.plist 2>/dev/null || true
  rm -f ~/Library/LaunchAgents/com.walthova.$job.plist
  echo "removed: com.walthova.$job"
done
