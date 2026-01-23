import type { Address, Hex } from "viem";
import { isAddress, isHex } from "viem";

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Expected non-empty string: ${name}`);
  return value;
}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected number: ${name}`);
  return value;
}

export function requireAddress(value: unknown, name: string): Address {
  const s = requireString(value, name);
  if (!isAddress(s)) throw new Error(`Invalid address: ${name}`);
  return s as Address;
}

export function requireOptionalAddress(value: unknown, name: string): Address | undefined {
  if (typeof value === "undefined" || value === null || value === "") return undefined;
  return requireAddress(value, name);
}

export function requireHex(value: unknown, name: string): Hex {
  const s = requireString(value, name);
  if (!isHex(s)) throw new Error(`Invalid hex: ${name}`);
  return s as Hex;
}
