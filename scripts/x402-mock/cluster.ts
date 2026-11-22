export const GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
};

export function assertCluster(cluster: "localnet" | "devnet", genesis: string): void {
  if (genesis === GENESIS.mainnet || genesis === GENESIS.testnet) throw new Error("Mainnet/testnet RPCs are not supported by this mock");
  if ((cluster === "devnet") !== (genesis === GENESIS.devnet)) throw new Error("RPC genesis does not match --cluster");
}
