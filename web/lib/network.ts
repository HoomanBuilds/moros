export const NETWORK = {
  name: "Stellar testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  marketId: "CBCFLHWJY37QIFFLGA5KQVTPXZQW5MD32EKHL5A6A5HSYFHOKJHRGG4N",
  poolId: "CAJFPQUSDRICY627OZU2FVNQVAIL653CAAWVEE4VBDWLZIUMO5H33UAZ",
  xlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorer: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
};
