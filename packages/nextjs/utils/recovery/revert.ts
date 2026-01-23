import type { Abi, Hex } from "viem";
import { decodeAbiParameters, decodeErrorResult, parseAbiParameters } from "viem";

const ERROR_STRING_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_SELECTOR = "0x4e487b71"; // Panic(uint256)

export type DecodedRevert =
  | { kind: "none"; summary: null; data: null; decoded: null }
  | { kind: "error_string"; summary: string; data: Hex; decoded: { message: string } }
  | { kind: "panic"; summary: string; data: Hex; decoded: { code: bigint } }
  | { kind: "custom_error"; summary: string; data: Hex; decoded: any }
  | { kind: "unknown"; summary: string; data: Hex; decoded: null };

export function decodeRevertData(params: { data?: Hex | null; abi?: Abi }): DecodedRevert {
  const data = params.data;
  if (!data || data === "0x") return { kind: "none", summary: null, data: null, decoded: null };

  const selector = (data.length >= 10 ? (data.slice(0, 10) as Hex) : "0x") as Hex;
  const body = ("0x" + data.slice(10)) as Hex;

  if (selector === ERROR_STRING_SELECTOR) {
    try {
      const [message] = decodeAbiParameters(parseAbiParameters("string"), body);
      return {
        kind: "error_string",
        summary: `Error(${String(message)})`,
        data,
        decoded: { message: String(message) },
      };
    } catch {
      return { kind: "unknown", summary: "Error(string) (failed to decode)", data, decoded: null };
    }
  }

  if (selector === PANIC_SELECTOR) {
    try {
      const [code] = decodeAbiParameters(parseAbiParameters("uint256"), body);
      return { kind: "panic", summary: `Panic(${String(code)})`, data, decoded: { code: code as bigint } };
    } catch {
      return { kind: "unknown", summary: "Panic(uint256) (failed to decode)", data, decoded: null };
    }
  }

  if (params.abi) {
    try {
      const decoded = decodeErrorResult({ abi: params.abi, data });
      const summary =
        typeof decoded?.errorName === "string"
          ? decoded.errorName +
            (Array.isArray(decoded?.args) || decoded?.args ? `(${JSON.stringify(decoded.args)})` : "")
          : "CustomError";
      return { kind: "custom_error", summary, data, decoded };
    } catch {
      // fallthrough
    }
  }

  return { kind: "unknown", summary: "Unknown revert data", data, decoded: null };
}
