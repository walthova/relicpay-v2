#!/bin/zsh
# Solana DEVNET ONLY: build, upgrade the relicpay program, and initialize the parity singletons.
# Walter runs this; no agent has run it. It refuses any cluster but devnet.
#
#   ./scripts/deploy-solana-devnet.sh
#
# Needs: anchor 0.32.1 and a devnet-funded wallet in your Solana CLI config that is the program
# upgrade authority. That wallet becomes the authority of any singleton this script creates
# (there is no authority-transfer instruction yet: open question Q1).
# Mainnet rule (not this script): governance must be a Squads v4 multisig with a time lock of at
# least 2 days, matching the Base TimelockController.

set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER_URL=$(solana config get json_rpc_url | awk '{print $NF}')
case "$CLUSTER_URL" in
  *devnet*) ;;
  *) echo "Refusing: Solana CLI is pointed at $CLUSTER_URL, not devnet." >&2; exit 1 ;;
esac

echo "Building..."
anchor build

echo "Upgrading relicpay on devnet (program id from Anchor.toml)..."
anchor upgrade target/deploy/relicpay.so \
  --program-id "$(grep -A2 '\[programs.devnet\]' Anchor.toml | awk -F'"' '/relicpay/{print $2}')" \
  --provider.cluster devnet

echo "Initializing parity singletons (skips any that already exist)..."
ANCHOR_PROVIDER_URL="$CLUSTER_URL" ANCHOR_WALLET="$(solana config get keypair | awk '{print $NF}')" \
  node scripts/init-devnet-parity.js

echo "Done. Next: fund the yield reserve and (only if you want credit on devnet) set_credit_params."
