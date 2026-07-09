export const NETWORK = {
  name: "Stellar testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  marketId: "CAXHSRTJ27IDL52ORR7S6KITEA6WP7AHNGOLPY3N76DOLOY4FSMKVKLB",
  poolId: "CAPK7MR75OXODZ3PVRIZHFCSDWWUWBCV52VNDCXR6Q2LZLC7PLP26IIJ",
  xlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorer: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
};
