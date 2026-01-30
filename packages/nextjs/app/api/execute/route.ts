import { NextResponse } from "next/server";
import type { Address, Hex } from "viem";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  http,
  parseAbi,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";
import { type RecoveryAsset, buildAssetCalls, encodeExecuteBatch, getDelegateForChain } from "~~/utils/recovery/calls";
import { fallbackGasLimit, getMaxTxGas, padGasLimit } from "~~/utils/recovery/gasLimit";
import { hashCalls, readIntentNonce, typedDataForRecoveryIntent } from "~~/utils/recovery/intent";
import { jsonSafe } from "~~/utils/recovery/jsonSafe";
import { rebalancePaymasterAcross } from "~~/utils/recovery/paymasterRebalance";
import { canonicalAssetsHash } from "~~/utils/recovery/quotePricing";
import { rateLimit } from "~~/utils/recovery/rateLimit";
import { decodeRevertData } from "~~/utils/recovery/revert";
import { requireAddress, requireHex, requireNumber, requireObject, requireString } from "~~/utils/recovery/validation";
import { getChain, getExecuteRpcUrls, getRpcUrls } from "~~/utils/recovery/viemServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Important: Node fetch has no default timeout; one bad/slow RPC can hang the whole endpoint.
const RPC_TIMEOUT_MS = 15_000;

type SignedAuthorization = {
  address: Address;
  chainId: number;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  // Prefer yParity (0/1). Backwards-compat supports v (27/28).
  yParity: number;
  v?: bigint | number;
};

function normalizeYParity(input: any, chainId: number): number {
  const raw = input?.yParity ?? input?.y_parity ?? input?.v;
  const b =
    typeof raw === "bigint"
      ? raw
      : typeof raw === "number" && Number.isFinite(raw)
        ? BigInt(raw)
        : typeof raw === "string" && raw.trim()
          ? BigInt(raw)
          : (() => {
              throw new Error(`Missing signature parity (yParity/v) for chainId=${chainId}`);
            })();
  const y = b === 27n || b === 28n ? b - 27n : b;
  if (y !== 0n && y !== 1n) throw new Error(`Invalid signature parity for chainId=${chainId}: ${y.toString()}`);
  return Number(y);
}

function rpcTransport(rpcUrl: string) {
  // viem http transport supports `timeout` but types can lag behind across versions.
  return http(rpcUrl, { timeout: RPC_TIMEOUT_MS } as any);
}

function safeErrMessage(e: any): string {
  return (
    (typeof e?.shortMessage === "string" && e.shortMessage) ||
    (typeof e?.message === "string" && e.message) ||
    (e instanceof Error ? e.message : String(e))
  );
}

function errCode(e: any) {
  return e?.code ?? e?.cause?.code ?? e?.errorCode ?? e?.cause?.errorCode ?? null;
}

function isRetryableRpcFailure(e: any): boolean {
  const code = errCode(e);
  if (code === -32090) return true;

  const name = typeof e?.name === "string" ? e.name : "";
  if (/HttpRequestError|RpcRequestError|TimeoutError/i.test(name)) return true;

  const msg = safeErrMessage(e).toLowerCase();
  if (msg.includes("rpc request failed")) return true;
  if (msg.includes("http request failed")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("network error")) return true;
  if (msg.includes("timeout") || msg.includes("timed out")) return true;
  if (msg.includes("socket hang up") || msg.includes("econnreset") || msg.includes("etimedout")) return true;

  // Avoid retrying real execution problems.
  if (msg.includes("execution reverted") || msg.includes("reverted")) return false;
  if (msg.includes("insufficient funds")) return false;
  if (msg.includes("nonce too low")) return false;
  if (msg.includes("replacement transaction underpriced")) return false;
  if (msg.includes("already known")) return false;

  return false;
}

export async function POST(req: Request) {
  try {
    // Note: debug logs are intentionally minimal here; the endpoint handles private key operations.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = rateLimit({ key: `execute:${ip}`, limit: 5, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const body = requireObject(await req.json().catch(() => ({})));
    const safeAddress = requireAddress(body.safeAddress, "safeAddress");
    const paymentTxHash = requireString(body.paymentTxHash, "paymentTxHash") as Hex;
    const paymentChainId = requireNumber(body.paymentChainId, "paymentChainId");
    const authorizationsByChainIdObj = requireObject(body.authorizationsByChainId);

    const assets = Array.isArray(body.assets) ? (body.assets as RecoveryAsset[]) : [];

    // Load paymaster hot wallet key.
    const pk = process.env.PAYMASTER_PRIVATE_KEY;
    if (!pk) return NextResponse.json({ error: "Missing PAYMASTER_PRIVATE_KEY on server." }, { status: 500 });
    const paymasterAccount = privateKeyToAccount(requireHex(pk, "PAYMASTER_PRIVATE_KEY"));
    // Verify payment on the chain the user paid on (independent of execution chains).
    const paymentRpcUrls = getRpcUrls(paymentChainId);
    let paymentTx: any = null;
    let paymentReceipt: any = null;
    let paymentRpcUsed: string | null = null;
    let lastPaymentErr: any = null;
    for (const rpcUrl of paymentRpcUrls) {
      try {
        const paymentChain = getChain(paymentChainId, rpcUrl);
        const paymentClient = createPublicClient({ chain: paymentChain, transport: rpcTransport(rpcUrl) });
        paymentTx = await paymentClient.getTransaction({ hash: paymentTxHash });
        paymentReceipt = await paymentClient.waitForTransactionReceipt({ hash: paymentTxHash });
        paymentRpcUsed = rpcUrl;
        lastPaymentErr = null;
        break;
      } catch (e: any) {
        lastPaymentErr = e;
        if (!isRetryableRpcFailure(e)) break;
      }
    }
    if (!paymentTx || !paymentReceipt) {
      const msg = safeErrMessage(lastPaymentErr);
      const code = errCode(lastPaymentErr);
      return NextResponse.json(
        { error: `Payment verification failed (RPC). ${msg}`, errorCode: code, chainId: paymentChainId },
        { status: 502 },
      );
    }
    if (paymentReceipt.status !== "success") {
      return NextResponse.json({ error: "Payment tx did not succeed." }, { status: 400 });
    }

    // Verify fee payment amount using the signed quote from /api/quote.
    const quotePayload = (body as any)?.quotePayload;
    const quoteSig = (body as any)?.quoteSig as Hex | undefined;
    if (!quotePayload || typeof quotePayload !== "object" || !quoteSig) {
      return NextResponse.json(
        { error: "Missing quotePayload/quoteSig. Refresh quote and try again." },
        { status: 400 },
      );
    }

    const expectedAssetsHash = canonicalAssetsHash(assets);
    const payloadSafe = requireAddress((quotePayload as any).safeAddress, "quotePayload.safeAddress");
    const payloadPaymentChainId = requireNumber((quotePayload as any).paymentChainId, "quotePayload.paymentChainId");
    const payloadPaymentKind = requireString((quotePayload as any).paymentKind, "quotePayload.paymentKind");
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
    const payloadPaymentTokenRaw = (quotePayload as any).paymentTokenAddress;
    const payloadPaymentToken =
      payloadPaymentKind === "erc20"
        ? requireAddress(payloadPaymentTokenRaw, "quotePayload.paymentTokenAddress")
        : typeof payloadPaymentTokenRaw === "string" && payloadPaymentTokenRaw.trim()
          ? requireAddress(payloadPaymentTokenRaw, "quotePayload.paymentTokenAddress")
          : ZERO_ADDR;
    const payloadAssetsHash = requireString((quotePayload as any).assetsHash, "quotePayload.assetsHash");
    const payloadTotalDue = BigInt(requireString((quotePayload as any).totalDue, "quotePayload.totalDue"));
    const expiresAtMs = requireNumber((quotePayload as any).expiresAtMs, "quotePayload.expiresAtMs");

    if (payloadSafe.toLowerCase() !== safeAddress.toLowerCase()) {
      return NextResponse.json({ error: "Quote safeAddress mismatch. Refresh quote and try again." }, { status: 400 });
    }
    if (payloadPaymentChainId !== paymentChainId) {
      return NextResponse.json(
        { error: "Quote paymentChainId mismatch. Refresh quote and try again." },
        { status: 400 },
      );
    }
    if (payloadAssetsHash.toLowerCase() !== expectedAssetsHash.toLowerCase()) {
      return NextResponse.json({ error: "Quote assets mismatch. Refresh quote and try again." }, { status: 400 });
    }
    if (Date.now() > expiresAtMs) {
      return NextResponse.json({ error: "Quote expired. Refresh quote and try again." }, { status: 400 });
    }

    const quoteMessage =
      `hwr.quote.v1\n` +
      `safe=${payloadSafe}\n` +
      `paymentChainId=${String(payloadPaymentChainId)}\n` +
      `paymentKind=${payloadPaymentKind}\n` +
      `paymentToken=${payloadPaymentToken}\n` +
      `assetsHash=${payloadAssetsHash}\n` +
      `totalDue=${payloadTotalDue.toString()}\n` +
      `expiresAtMs=${String(expiresAtMs)}`;

    const sigOk = await verifyMessage({
      address: paymasterAccount.address,
      message: quoteMessage,
      signature: quoteSig,
    });
    if (!sigOk) {
      return NextResponse.json({ error: "Invalid quote signature. Refresh quote and try again." }, { status: 400 });
    }

    // Validate payment according to the quote (native or ERC-20).
    if (payloadPaymentKind === "native") {
      if (!paymentTx.to || paymentTx.to.toLowerCase() !== paymasterAccount.address.toLowerCase()) {
        return NextResponse.json(
          { error: "Native payment tx must be sent to the paymaster address." },
          { status: 400 },
        );
      }
      if ((paymentTx.value ?? 0n) < payloadTotalDue) {
        return NextResponse.json({ error: "Payment tx value is below required fee." }, { status: 400 });
      }
    } else if (payloadPaymentKind === "erc20") {
      const tokenAddress = requireAddress(payloadPaymentToken, "quotePayload.paymentTokenAddress");
      if (!paymentTx.to || paymentTx.to.toLowerCase() !== tokenAddress.toLowerCase()) {
        return NextResponse.json({ error: "ERC20 payment tx must be sent to the token contract." }, { status: 400 });
      }
      const erc20TransferAbi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
      let paid = 0n;
      for (const log of paymentReceipt.logs as any[]) {
        if (!log?.address || String(log.address).toLowerCase() !== tokenAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: erc20TransferAbi, data: log.data, topics: log.topics });
          if (decoded.eventName !== "Transfer") continue;
          const to = (decoded.args as any)?.to as string | undefined;
          const value = (decoded.args as any)?.value as bigint | undefined;
          if (!to || typeof value !== "bigint") continue;
          if (to.toLowerCase() !== paymasterAccount.address.toLowerCase()) continue;
          paid += value;
        } catch {
          // ignore non-matching logs
        }
      }
      if (paid < payloadTotalDue) {
        return NextResponse.json({ error: "ERC20 transfer amount is below required fee." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Unsupported paymentKind in quote." }, { status: 400 });
    }

    const chainIds = Array.from(new Set(assets.map(a => a.chainId))).sort((a, b) => a - b);
    const results: Record<number, any> = {};
    let compromisedAddressGlobal: Address | null = null;

    for (const chainId of chainIds) {
      const entryObj =
        (authorizationsByChainIdObj as any)[String(chainId)] ?? (authorizationsByChainIdObj as any)[chainId];
      // Backwards-compatible:
      // - old format: { [chainId]: { delegate: {...}, undelegate: {...} } }
      // - new format: { [chainId]: { ...delegateAuthorization } }
      const delegateAuthObj = entryObj?.delegate
        ? requireObject(entryObj.delegate)
        : entryObj
          ? requireObject(entryObj)
          : null;
      if (!delegateAuthObj) {
        results[chainId] = { ok: false, error: `Missing authorizations for chainId=${chainId}` };
        continue;
      }

      const delegateAuthorization: SignedAuthorization = {
        address: requireAddress(delegateAuthObj.address, `authorizationsByChainId.${chainId}.address`),
        chainId: Number(delegateAuthObj.chainId),
        nonce: Number(delegateAuthObj.nonce),
        r: delegateAuthObj.r as any,
        s: delegateAuthObj.s as any,
        yParity: normalizeYParity(delegateAuthObj, chainId),
        v: typeof delegateAuthObj.v === "string" ? BigInt(delegateAuthObj.v) : (delegateAuthObj.v as any),
      };
      const viemAuthorization: any = {
        ...(delegateAuthorization as any),
        contractAddress: (delegateAuthorization as any).contractAddress ?? delegateAuthorization.address,
      };

      try {
        const delegate = getDelegateForChain(chainId);
        // Use private-mempool RPCs only during execution/broadcast to reduce nonce racing.
        const rpcUrls = getExecuteRpcUrls(chainId);

        // Stage 1: prepare + broadcast. If an RPC fails pre-broadcast, try the next one.
        let compromisedAddress: Address | null = null;
        let calls: any[] | null = null;
        let data: Hex | null = null;
        let gas: bigint | undefined = undefined;
        let txHash: Hex | null = null;
        let broadcastRpcUrl: string | null = null;

        let lastPrepareErr: any = null;
        for (const rpcUrl of rpcUrls) {
          try {
            const chain = getChain(chainId, rpcUrl);
            const publicClient = createPublicClient({ chain, transport: rpcTransport(rpcUrl) });

            const delegateBytecode = await publicClient.getBytecode({ address: delegate.address }).catch(() => null);
            const delegateHasCode = delegateBytecode ? delegateBytecode !== "0x" : null;
            if (delegateHasCode === false) {
              throw new Error(
                `UniversalRecoveryDelegate has no code at ${delegate.address} on chainId=${chainId} (wrong deployment for fork?).`,
              );
            }

            // Ensure the signature delegates to the expected contract.
            if (delegateAuthorization.address.toLowerCase() !== delegate.address.toLowerCase()) {
              throw new Error("Authorization does not delegate to the expected contract.");
            }

            compromisedAddress = (await recoverAuthorizationAddress({
              authorization: delegateAuthorization as any,
            })) as Address;
            if (
              compromisedAddressGlobal &&
              compromisedAddressGlobal.toLowerCase() !== compromisedAddress.toLowerCase()
            ) {
              throw new Error("Compromised address mismatch across chains.");
            }
            compromisedAddressGlobal = compromisedAddress;

            // Preflight: if the compromised account nonce changed since signing, the EIP-7702 authorization becomes invalid.
            // This commonly manifests as "invalid authorization" on some RPCs (Polygon can omit revert data).
            const compromisedNonceNow = await publicClient
              .getTransactionCount({ address: compromisedAddress, blockTag: "pending" })
              .catch(() => null);
            if (
              typeof compromisedNonceNow === "number" &&
              Number.isFinite(compromisedNonceNow) &&
              delegateAuthorization.nonce !== compromisedNonceNow
            ) {
              throw new Error(
                `Authorization nonce is stale. Signed nonce=${delegateAuthorization.nonce} current nonce=${compromisedNonceNow}. Re-sign authorizations.`,
              );
            }

            const chainAssets = assets.filter(a => a.chainId === chainId);
            calls = buildAssetCalls({ compromisedAddress, safeAddress, assets: chainAssets });

            // Bind the action to (chainId, verifyingContract=compromised EOA) and make it one-time via a per-authorizer nonce.
            const authorizer = paymasterAccount.address;
            const intentNonce = await readIntentNonce({
              publicClient,
              chainId,
              compromisedAddress,
              authorization: viemAuthorization as any,
              authorizer,
              caller: paymasterAccount.address,
            });
            const deadline = 0n;
            const callsHash = hashCalls(calls);
            const td = typedDataForRecoveryIntent({
              chainId,
              verifyingContract: compromisedAddress,
              recoveryAddress: safeAddress,
              callsHash,
              nonce: intentNonce,
              deadline,
            });
            const signature = (await paymasterAccount.signTypedData(td as any)) as Hex;

            data = encodeExecuteBatch({
              chainId,
              recoveryAddress: safeAddress,
              calls,
              authorizer,
              nonce: intentNonce,
              deadline,
              signature,
            });

            // Broadcast sponsored EIP-7702 transaction.
            // Some RPCs can under-estimate gas for EIP-7702. Add a modest safety buffer and clamp to block gas limit.
            gas = undefined;
            const { maxGas } = await getMaxTxGas(publicClient);
            try {
              const est = await publicClient.estimateGas({
                to: compromisedAddress,
                data,
                account: paymasterAccount.address,
                type: "eip7702",
                authorizationList: [viemAuthorization],
                chainId,
              } as any);
              gas = padGasLimit({ estimatedGas: est, callsCount: calls.length, maxGas, minGas: 200_000n });
            } catch {
              gas = fallbackGasLimit({ maxGas, minGas: 200_000n });
            }

            // Fees: let viem fill when possible, but if the RPC supports fee estimation,
            // setting them explicitly helps keep execution closer to the quoted cost.
            const fees = await publicClient.estimateFeesPerGas().catch(() => null);

            const walletClient = createWalletClient({
              chain,
              transport: rpcTransport(rpcUrl),
              account: paymasterAccount,
            });

            const txRequest = {
              to: compromisedAddress,
              data,
              type: "eip7702",
              authorizationList: [viemAuthorization],
              gas,
              maxFeePerGas: fees?.maxFeePerGas,
              maxPriorityFeePerGas: fees?.maxPriorityFeePerGas,
            } as any;

            txHash = await walletClient.sendTransaction(txRequest);
            broadcastRpcUrl = rpcUrl;
            lastPrepareErr = null;
            break;
          } catch (e: any) {
            lastPrepareErr = e;
            if (!isRetryableRpcFailure(e)) break;
          }
        }

        if (!txHash || !compromisedAddress || !data) {
          throw lastPrepareErr ?? new Error("Failed to broadcast transaction.");
        }

        // Stage 2: receipt wait + best-effort revert decode. If an RPC can't fetch it, try the next one.
        let receipt: any = null;
        let receiptRpcUrl: string | null = null;
        let lastReceiptErr: any = null;
        for (const rpcUrl of rpcUrls) {
          try {
            const chain = getChain(chainId, rpcUrl);
            const publicClient = createPublicClient({ chain, transport: rpcTransport(rpcUrl) });
            receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            receiptRpcUrl = rpcUrl;
            lastReceiptErr = null;
            break;
          } catch (e: any) {
            lastReceiptErr = e;
            if (!isRetryableRpcFailure(e)) break;
          }
        }
        if (!receipt) throw lastReceiptErr ?? new Error("Failed to fetch transaction receipt.");

        let revert: any = null;
        if (receipt.status === "reverted") {
          // Best-effort obtain revert data by re-simulating the call.
          try {
            const rpcUrl = receiptRpcUrl ?? broadcastRpcUrl ?? rpcUrls[0];
            const chain = getChain(chainId, rpcUrl);
            const publicClient = createPublicClient({ chain, transport: rpcTransport(rpcUrl) });
            await publicClient.call({
              to: compromisedAddress,
              data,
              account: paymasterAccount.address,
              chain,
              type: "eip7702",
              authorizationList: [viemAuthorization],
              gas,
              chainId,
            } as any);
          } catch (e: any) {
            const raw = (e?.data ?? e?.cause?.data) as Hex | undefined;
            let decoded: any = null;
            if (raw) {
              try {
                decoded = decodeErrorResult({ abi: delegate.abi, data: raw });
              } catch {
                decoded = null;
              }
            }
            const std = decodeRevertData({ data: raw ?? null, abi: delegate.abi });
            revert = { data: raw ?? null, decoded, summary: std.summary };
          }
        }

        results[chainId] = jsonSafe({
          ok: receipt.status === "success",
          chainId,
          compromisedAddress,
          safeAddress,
          txHash,
          rpcUrl: receiptRpcUrl ?? broadcastRpcUrl ?? null,
          receipt,
          revert,
        });
      } catch (e: any) {
        const msg = safeErrMessage(e);
        const code = errCode(e);
        results[chainId] = { ok: false, chainId, error: msg, errorCode: code };
      }
    }

    // Automatically rebalance paymaster across chains after execution.
    // This is best-effort and intentionally non-fatal: user recovery should not fail because rebalance failed.
    try {
      // Not awaiting since this doesn't need to complete to return the response to the user
      rebalancePaymasterAcross({ paymasterAccount, execute: true });
    } catch (e: any) {
      console.warn("[hwr.execute] paymaster rebalance failed", e?.message ?? e);
    }

    return NextResponse.json(
      jsonSafe({
        ok: Object.values(results).every((r: any) => r?.ok),
        compromisedAddress: compromisedAddressGlobal,
        safeAddress,
        payment: { chainId: paymentChainId, paymentTxHash, paymentReceipt, rpcUrl: paymentRpcUsed },
        results,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
