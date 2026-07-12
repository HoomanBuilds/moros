export const NETWORK = {
  name: "Stellar testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  marketId: "CBKR2OYQHNBYUSHQEFEHB4GI6BMZYXP35GPYYCBKFRTZBTR6NV3P3MXS",
  poolId: "CDUYUZEZBIWRPXM3ITDQZBANHN3Q6B6KUKCBV7MP6BGLYRQCT6QSV23E",
  xlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorer: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
};
