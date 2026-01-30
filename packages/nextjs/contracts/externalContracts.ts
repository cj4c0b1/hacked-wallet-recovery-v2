import type { Abi } from "abitype";
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

/**
 * @example
 * const externalContracts = {
 *   1: {
 *     DAI: {
 *       address: "0x...",
 *       abi: [...],
 *     },
 *   },
 * } as const;
 */
/**
 * UniversalRecoveryDelegate deployments across supported networks.
 */
const UNIVERSAL_RECOVERY_DELEGATE_ABI = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_paymaster",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "PAYMASTER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "executeBatchRecovery",
    inputs: [
      {
        name: "_recoveryAddress",
        type: "address",
        internalType: "address",
      },
      {
        name: "calls",
        type: "tuple[]",
        internalType: "struct UniversalRecoveryDelegate.Call[]",
        components: [
          {
            name: "to",
            type: "address",
            internalType: "address",
          },
          {
            name: "value",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "data",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "authorizer",
        type: "address",
        internalType: "address",
      },
      {
        name: "nonce",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recoveryIntentDigest",
    inputs: [
      { name: "recoveryAddress", type: "address", internalType: "address" },
      {
        name: "calls",
        type: "tuple[]",
        internalType: "struct UniversalRecoveryDelegate.Call[]",
        components: [
          { name: "to", type: "address", internalType: "address" },
          { name: "value", type: "uint256", internalType: "uint256" },
          { name: "data", type: "bytes", internalType: "bytes" },
        ],
      },
      { name: "nonce", type: "uint256", internalType: "uint256" },
      { name: "deadline", type: "uint256", internalType: "uint256" },
    ],
    outputs: [
      { name: "digest", type: "bytes32", internalType: "bytes32" },
      { name: "callsHash", type: "bytes32", internalType: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "CallFailed",
    inputs: [
      {
        name: "index",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "value",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
  {
    type: "error",
    name: "IntentExpired",
    inputs: [
      { name: "deadline", type: "uint256", internalType: "uint256" },
      { name: "nowTs", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InvalidNonce",
    inputs: [
      { name: "signer", type: "address", internalType: "address" },
      { name: "expected", type: "uint256", internalType: "uint256" },
      { name: "provided", type: "uint256", internalType: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InvalidSignature",
    inputs: [],
  },
] as const satisfies Abi;

export const CREATE2_FACTORY_ABI = [
  {
    type: "function",
    name: "deploy",
    inputs: [
      {
        name: "initCode",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "addr",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "Deployed",
    inputs: [
      {
        name: "addr",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

const externalContracts = {
  // 31337: {
  //   UniversalRecoveryDelegate: {
  //     address: "0x700b6A60ce7EaaEA56F065753d8dcB9653dbAD35",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  // },
  // Ethereum: Public mempool, we use the flashbots RPC
  1: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Optimism: No public mempool
  10: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // BSC: Public mempool, we use the blinklabs RPC
  56: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Gnosis: Public mempool, we use Shutterized RPC
  100: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Unichain: no public mempool
  130: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Polygon: Public mempool, no encrypted mempool solution
  // 137: {
  //   UniversalRecoveryDelegate: {
  //     address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  // },

  // Monad: no public mempool
  143: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // // Sonic: Public mempool, no encrypted mempool solution
  // 146: {
  //   UniversalRecoveryDelegate: {
  //     address: "0x90b0f446179b4c61566FB41f50e45E75fDa92861",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  // },

  // World: no public mempool
  480: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Stable: Can subscribe to transactions
  // 988: {
  //   UniversalRecoveryDelegate: {
  //     address: "0xD81891650795D8BA695aDF2Fd8018A3DB5d8D52b",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  //   Create2Factory: {
  //     address: "0x4E32B2200B4C2cA464e05e87501271cEf739c2E8",
  //     abi: CREATE2_FACTORY_ABI,
  //   },
  // },

  // HyperEVM: Public mempool, no encrypted mempool solution
  // 999: {
  //   UniversalRecoveryDelegate: {
  //     address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  // },

  // Soneium: no public mempool
  1868: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Ronin: no public mempool
  2020: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Mantle: no public mempool
  5000: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Base: no public mempool
  8453: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Arbitrum: no public mempool
  42161: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Celo: Unknown
  42220: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Avalanche: no public mempool
  43114: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Zircuit: Public mempool, no encrypted mempool solution
  // 48900: {
  //   UniversalRecoveryDelegate: {
  //     address: "0xD81891650795D8BA695aDF2Fd8018A3DB5d8D52b",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  //   Create2Factory: {
  //     address: "0x4E32B2200B4C2cA464e05e87501271cEf739c2E8",
  //     abi: CREATE2_FACTORY_ABI,
  //   },
  // },

  // Ink: no public mempool
  57073: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // // Blast: no public mempool
  81457: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Katana: no public mempool
  747474: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Zora: no public mempool
  7777777: {
    UniversalRecoveryDelegate: {
      address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
      abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
    },
  },

  // Sepolia
  // 11155111: {
  //   UniversalRecoveryDelegate: {
  //     address: "0x681BcBC1fBc1c8A2f1F5b4A43e6D38c5CA220892",
  //     abi: UNIVERSAL_RECOVERY_DELEGATE_ABI,
  //   },
  // },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
