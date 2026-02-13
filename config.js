// config.js
window.APP_CONFIG = {
  CHAIN_ID_DEC: 56,
  CHAIN_ID_HEX: "0x38",
  CHAIN_NAME: "BSC Mainnet",
  RPC_URL: "https://bsc-dataseed.binance.org/",
  BLOCK_EXPLORER: "https://bscscan.com",

  // ===== Addresses =====
  CORE:       "0xe6E204B20Be44f984773d4F02DBe73e5E018f0fF",
  VAULT:      "0x2bc3dB5AdB26ef1F192f7Bd6b0B3359d0E796D9a",
  BINARY:     "0xD78043E993D0F6cC95F5f81eE927883BbFc41Ac6",
  STAKING_V4: "0x4Dfa9EFEAc6069D139CF7ffEe406FAB78d7410A7",
  STAKING_V5: "0xa960B32A137EfDE9c35f34C169EefeE6F4D5DD2d",

  USDT: "0x55d398326f99059fF775485246999027B3197955",
  DF:   "0x36579d7eC4b29e875E3eC21A55F71C822E03A992",

  CORE_BUY_METHOD: "buyOrUpgrade",

  ERC20_ABI: [
    "function name() view returns(string)",
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
  ],

  // ===== CoreV6 (REAL) ✅ =====
  CORE_ABI: [
    "function USDT() view returns(address)",
    "function DF() view returns(address)",
    "function VAULT() view returns(address)",
    "function BINARY() view returns(address)",
    "function STAKING() view returns(address)",
    "function treasury() view returns(address)",
    "function COMPANY_WALLET() view returns(address)",

    "function registered(address) view returns(bool)",
    "function users(address) view returns(address sponsor, address parent, bool sideRight, uint8 pkg, uint8 rank, uint32 directSmallOrMore)",

    "function buyOrUpgrade(uint8 newPkg, address sponsor, address placementParent, bool sideRight)",
  ],

  // ===== BinaryV4 (REAL) ✅ =====
  BINARY_ABI: [
    "function volumesOf(address u) view returns (uint256 l, uint256 r, uint256 p)",
  ],

  // ===== VaultV6 (REAL) ✅ =====
  VAULT_ABI: [
    "function earns(address) view returns (uint256 unlockedUSDT,uint256 claimedUSDT,uint256 lockedUSDT,uint64 lockStartUSDT,uint64 lockEndUSDT,uint256 expiredUSDT,uint256 unlockedDF,uint256 claimedDF,uint256 lockedDF,uint64 lockStartDF,uint64 lockEndDF,uint256 expiredDF)",
    "function claimableUSDT(address u) view returns(uint256)",
    "function claimableDF(address u) view returns(uint256)",
    "function refresh(address u)",
    "function claim()",
  ],

  // ===== StakingV4 (keep minimal; adjust if needed) =====
  STAKING_V4_ABI: [
    "function pendingReward(address) view returns(uint256)",
    "function stakes(address) view returns(uint256 principal, uint64 start, uint64 end, bool claimed)",
    "function claimStake()",
  ],

  // ===== StakingV5 (REAL) ✅ =====
  STAKING_V5_ABI: [
    "function mlm() view returns(address)",
    "function stakeCount(address user) view returns(uint256)",
    "function pendingRewardTotal(address user) view returns(uint256 total)",
    "function pendingReward(address user, uint256 stakeId) view returns(uint256)",
    "function stakeAt(address user, uint256 i) view returns(uint8 pkg, uint256 principal, uint64 start, uint64 end, bool claimed)",
    "function claimStake(uint256 stakeId)",
    "function claimAllMatured(uint256 maxClaims)",
  ],
};
