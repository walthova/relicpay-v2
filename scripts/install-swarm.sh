#!/bin/zsh
# Activate the RelicPay daily-progress swarm (two launchd jobs).
# Run this yourself: ./scripts/install-swarm.sh
# Deactivate any time with: ./scripts/uninstall-swarm.sh

set -e
cd "$(dirname "$0")/.."

chmod +x scripts/swarm-build.sh scripts/swarm-growth.sh
mkdir -p ~/Library/LaunchAgents .runtime

for job in relicpay-build relicpay-growth; do
  cp "swarm/com.walthova.$job.plist" ~/Library/LaunchAgents/
  launchctl unload ~/Library/LaunchAgents/com.walthova.$job.plist 2>/dev/null || true
  launchctl load ~/Library/LaunchAgents/com.walthova.$job.plist
  echo "loaded: com.walthova.$job"
done

echo ""
echo "Swarm active. relicpay-build: weekdays 9:12am · relicpay-growth: Mon/Wed/Fri 12:37pm"
echo "Progress notes land in docs/progress/ · logs in .runtime/"
