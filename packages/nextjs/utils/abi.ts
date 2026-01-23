import { isZeroAddress } from "./scaffold-eth/common";
import { Address, Chain } from "viem";

function parseEtherscanAbiField(raw: unknown): { abi: any[] | null; message?: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { abi: null, message: "Empty ABI" };

  // Etherscan uses a non-JSON string for unverified contracts.
  if (/contract source code not verified/i.test(s)) return { abi: null, message: "Contract source code not verified" };

  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return { abi: null, message: "ABI was not an array" };
    return { abi: parsed };
  } catch (e) {
    // Preserve the server-provided string if it isn't JSON (often useful, e.g. rate limits / API key issues).
    if (!s.startsWith("[") && !s.startsWith("{")) throw new Error(s);
    throw new Error(e instanceof Error ? e.message : "Failed to parse ABI JSON");
  }
}

export const fetchContractABIFromEtherscan = async (verifiedContractAddress: Address, chainId: number) => {
  const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_V2_API_KEY;

  const withApiKey = (url: string) => (apiKey ? `${url}&apikey=${encodeURIComponent(apiKey)}` : url);

  // First call to get source code and check for implementation
  const sourceCodeUrl = withApiKey(
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${verifiedContractAddress}`,
  );

  const sourceCodeResponse = await fetch(sourceCodeUrl);
  const sourceCodeData = await sourceCodeResponse.json();

  if (sourceCodeData.status !== "1" || !sourceCodeData.result || sourceCodeData.result.length === 0) {
    console.error("Error fetching source code from Etherscan:", sourceCodeData);
    throw new Error("Failed to fetch source code from Etherscan");
  }

  const contractData = sourceCodeData.result[0];
  const implementation = contractData.Implementation || null;

  // If there's an implementation address, make a second call to get its ABI
  if (implementation && !isZeroAddress(implementation)) {
    const abiUrl = withApiKey(
      `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getabi&address=${implementation}`,
    );
    const abiResponse = await fetch(abiUrl);
    const abiData = await abiResponse.json();

    if (abiData.status === "1" && abiData.result) {
      const parsed = parseEtherscanAbiField(abiData.result);
      return {
        abi: parsed.abi,
        implementation,
        message: parsed.message,
      };
    } else {
      console.error("Error fetching ABI for implementation from Etherscan:", abiData);
      throw new Error("Failed to fetch ABI for implementation from Etherscan");
    }
  }

  // If no implementation or failed to get implementation ABI, return original contract ABI
  const parsed = parseEtherscanAbiField(contractData.ABI);
  return {
    abi: parsed.abi,
    implementation,
    message: parsed.message,
  };
};

export function parseAndCorrectJSON(input: string): any {
  // Add double quotes around keys
  let correctedJSON = input.replace(/(\w+)(?=\s*:)/g, '"$1"');

  // Remove trailing commas
  correctedJSON = correctedJSON.replace(/,(?=\s*[}\]])/g, "");

  try {
    return JSON.parse(correctedJSON);
  } catch (error) {
    console.error("Failed to parse JSON", error);
    throw new Error("Failed to parse JSON");
  }
}

export const getNetworkName = (chains: Chain[], chainId: number) => {
  const chain = chains.find(chain => chain.id === chainId);
  return chain ? chain.name : "Unknown Network";
};
