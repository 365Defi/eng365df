// config.js
window.APP_CONFIG = {
  // ===== Network =====
  CHAIN_ID_DEC: 56,
  CHAIN_ID_HEX: "0x38",
  CHAIN_NAME: "BSC Mainnet",
  RPC_URL: "https://bsc-dataseed.binance.org/",
  BLOCK_EXPLORER: "https://bscscan.com",

  // ===== Addresses =====
  USDT:   "0x55d398326f99059fF775485246999027B3197955",
  DF:     "0x36579d7eC4b29e875E3eC21A55F71C822E03A992",

  CORE:   "0xe6E204B20Be44f984773d4F02DBe73e5E018f0fF", // CoreV6 (your active)
  VAULT:  "0x2bc3dB5AdB26ef1F192f7Bd6b0B3359d0E796D9a", // VaultV6
  BINARY: "0xD78043E993D0F6cC95F5f81eE927883BbFc41Ac6", // BinaryV4

  STAKING_V4: "0x4Dfa9EFEAc6069D139CF7ffEe406FAB78d7410A7", // StakingV4 (legacy)
  STAKING_V5: "0xa960B32A137EfDE9c35f34C169EefeE6F4D5DD2d", // StakingV5 (new)

  DEFAULT_SPONSOR: "0x85EFe209769B183d41A332872Ac1cF57bd3d8300",

  // ===== Minimal ERC20 ABI =====
  ERC20_ABI: [
    { "inputs":[], "name":"decimals", "outputs":[{"type":"uint8"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"name":"owner","type":"address"}], "name":"balanceOf", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}], "name":"allowance", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}], "name":"approve", "outputs":[{"type":"bool"}], "stateMutability":"nonpayable", "type":"function" }
  ],

  // ===== CoreV6 ABI =====
  CORE_ABI: [
    {
      "inputs":[
        {"internalType":"uint8","name":"newPkg","type":"uint8"},
        {"internalType":"address","name":"sponsor","type":"address"},
        {"internalType":"address","name":"placementParent","type":"address"},
        {"internalType":"bool","name":"sideRight","type":"bool"}
      ],
      "name":"buyOrUpgrade",
      "outputs":[],
      "stateMutability":"nonpayable",
      "type":"function"
    },
    {
      "inputs":[{"internalType":"address","name":"","type":"address"}],
      "name":"users",
      "outputs":[
        {"internalType":"address","name":"sponsor","type":"address"},
        {"internalType":"address","name":"parent","type":"address"},
        {"internalType":"bool","name":"sideRight","type":"bool"},
        {"internalType":"uint8","name":"pkg","type":"uint8"},
        {"internalType":"uint8","name":"rank","type":"uint8"},
        {"internalType":"uint32","name":"directSmallOrMore","type":"uint32"}
      ],
      "stateMutability":"view",
      "type":"function"
    }
  ],

  // ===== VaultV6 ABI =====
  VAULT_ABI: [
    { "inputs":[{"internalType":"address","name":"u","type":"address"}], "name":"claimableUSDT", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"internalType":"address","name":"u","type":"address"}], "name":"claimableDF",   "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"internalType":"address","name":"","type":"address"}], "name":"earns",
      "outputs":[
        {"internalType":"uint256","name":"unlockedUSDT","type":"uint256"},
        {"internalType":"uint256","name":"claimedUSDT","type":"uint256"},
        {"internalType":"uint256","name":"lockedUSDT","type":"uint256"},
        {"internalType":"uint64","name":"lockStartUSDT","type":"uint64"},
        {"internalType":"uint64","name":"lockEndUSDT","type":"uint64"},
        {"internalType":"uint256","name":"expiredUSDT","type":"uint256"},
        {"internalType":"uint256","name":"unlockedDF","type":"uint256"},
        {"internalType":"uint256","name":"claimedDF","type":"uint256"},
        {"internalType":"uint256","name":"lockedDF","type":"uint256"},
        {"internalType":"uint64","name":"lockStartDF","type":"uint64"},
        {"internalType":"uint64","name":"lockEndDF","type":"uint64"},
        {"internalType":"uint256","name":"expiredDF","type":"uint256"}
      ],
      "stateMutability":"view",
      "type":"function"
    },
    { "inputs":[{"internalType":"address","name":"u","type":"address"}], "name":"refresh", "outputs":[], "stateMutability":"nonpayable", "type":"function" },
    { "inputs":[], "name":"claim", "outputs":[], "stateMutability":"nonpayable", "type":"function" }
  ],

  // ===== BinaryV4 ABI =====
  BINARY_ABI: [
    {
      "inputs":[
        {"internalType":"address","name":"upline","type":"address"},
        {"internalType":"bool","name":"sideRight","type":"bool"},
        {"internalType":"uint256","name":"volEq","type":"uint256"}
      ],
      "name":"addVolume",
      "outputs":[],
      "stateMutability":"nonpayable",
      "type":"function"
    },
    {
      "inputs":[{"internalType":"address","name":"u","type":"address"}],
      "name":"volumesOf",
      "outputs":[
        {"internalType":"uint256","name":"l","type":"uint256"},
        {"internalType":"uint256","name":"r","type":"uint256"},
        {"internalType":"uint256","name":"p","type":"uint256"}
      ],
      "stateMutability":"view",
      "type":"function"
    }
  ],

  // ===== StakingV4 ABI (legacy single-lot) =====
  STAKING_V4_ABI: [
    {
      "inputs":[{"internalType":"address","name":"user","type":"address"}],
      "name":"pendingReward",
      "outputs":[{"type":"uint256"}],
      "stateMutability":"view",
      "type":"function"
    },
    {
      "inputs":[{"internalType":"address","name":"","type":"address"}],
      "name":"stakes",
      "outputs":[
        {"internalType":"uint8","name":"pkg","type":"uint8"},
        {"internalType":"uint256","name":"principal","type":"uint256"},
        {"internalType":"uint64","name":"start","type":"uint64"},
        {"internalType":"uint64","name":"end","type":"uint64"},
        {"internalType":"bool","name":"claimed","type":"bool"}
      ],
      "stateMutability":"view",
      "type":"function"
    },
    { "inputs":[], "name":"claimStake", "outputs":[], "stateMutability":"nonpayable", "type":"function" }
  ],

  // ===== StakingV5 ABI (multi-lot) =====
  STAKING_V5_ABI: [
    { "inputs":[{"internalType":"address","name":"user","type":"address"}], "name":"stakeCount", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    {
      "inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"i","type":"uint256"}],
      "name":"stakeAt",
      "outputs":[{"components":[
        {"internalType":"uint8","name":"pkg","type":"uint8"},
        {"internalType":"uint256","name":"principal","type":"uint256"},
        {"internalType":"uint64","name":"start","type":"uint64"},
        {"internalType":"uint64","name":"end","type":"uint64"},
        {"internalType":"bool","name":"claimed","type":"bool"}
      ],"internalType":"struct Staking365V5.StakeLot","name":"","type":"tuple"}],
      "stateMutability":"view",
      "type":"function"
    },
    { "inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"stakeId","type":"uint256"}], "name":"pendingReward", "outputs":[{"type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"internalType":"address","name":"user","type":"address"}], "name":"pendingRewardTotal", "outputs":[{"internalType":"uint256","name":"total","type":"uint256"}], "stateMutability":"view", "type":"function" },
    { "inputs":[{"internalType":"uint256","name":"stakeId","type":"uint256"}], "name":"claimStake", "outputs":[], "stateMutability":"nonpayable", "type":"function" },
    { "inputs":[{"internalType":"uint256","name":"maxClaims","type":"uint256"}], "name":"claimAllMatured", "outputs":[], "stateMutability":"nonpayable", "type":"function" }
  ]
};
