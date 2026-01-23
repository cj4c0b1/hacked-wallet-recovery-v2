import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createPublicClient, decodeErrorResult, http, parseAbi } from "viem";
import type { Address, Authorization, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";
import { type RecoveryAsset, buildAssetCalls, encodeExecuteBatch, getDelegateForChain } from "~~/utils/recovery/calls";
import { getMaxTxGas, padGasLimit } from "~~/utils/recovery/gasLimit";
import { hashCalls, readIntentNonce, typedDataForRecoveryIntent } from "~~/utils/recovery/intent";
import { jsonSafe } from "~~/utils/recovery/jsonSafe";
import {
  canonicalAssetsHash,
  getErc20UsdMicrosPerToken,
  getNativeUsdMicrosPerToken,
  usdMicrosToWeiCeil,
  weiToUsdMicros,
} from "~~/utils/recovery/quotePricing";
import { rateLimit } from "~~/utils/recovery/rateLimit";
import { decodeRevertData } from "~~/utils/recovery/revert";
import { getServiceFeeUsdMicros } from "~~/utils/recovery/serviceFee";
import { requireAddress, requireHex, requireNumber, requireObject } from "~~/utils/recovery/validation";
import { getChain, getRpcUrl } from "~~/utils/recovery/viemServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mkLogPrefix(reqId: string) {
  return `[hwr.quote ${reqId}]`;
}

function safeErr(e: any) {
  return {
    name: typeof e?.name === "string" ? e.name : null,
    code: e?.code ?? e?.cause?.code ?? null,
    shortMessage: typeof e?.shortMessage === "string" ? e.shortMessage : null,
    message: typeof e?.message === "string" ? e.message : String(e),
  };
}

function decodeOptionalBoolReturn(
  data: Hex | null,
): { kind: "none" } | { kind: "bool"; value: boolean } | { kind: "unknown"; size: number } {
  if (!data || data === "0x") return { kind: "none" };
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const bytes = Math.floor(hex.length / 2);
  if (bytes >= 32) {
    const lastWord = hex.slice(hex.length - 64);
    const v = BigInt("0x" + lastWord);
    return { kind: "bool", value: v !== 0n };
  }
  return { kind: "unknown", size: bytes };
}

function normalizeYParity(input: unknown, chainId: number): number {
  // Prefer yParity (0/1). Fall back to v (27/28) if provided.
  const raw =
    (input as any)?.yParity ??
    (input as any)?.y_parity ??
    (input as any)?.v ??
    (input as any)?.V ??
    (input as any)?.y_parity;
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

export async function POST(req: Request) {
  const reqId = (() => {
    try {
      return randomUUID();
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
    }
  })();
  const logp = mkLogPrefix(reqId);
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = rateLimit({ key: `quote:${ip}`, limit: 20, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const body = requireObject(await req.json().catch(() => ({})));
    const safeAddress = requireAddress(body.safeAddress, "safeAddress");
    const assets = Array.isArray(body.assets) ? (body.assets as RecoveryAsset[]) : [];
    const authorizationsByChainIdObj = requireObject(body.authorizationsByChainId);
    const paymentChainId =
      typeof (body as any).paymentChainId === "number"
        ? (body as any).paymentChainId
        : Number((body as any).paymentChainId);
    if (!Number.isFinite(paymentChainId)) {
      return NextResponse.json({ error: "Missing paymentChainId (connect a wallet to pay fees)." }, { status: 400 });
    }
    const paymentAsset = (body as any).paymentAsset as any;
    const paymentKind =
      paymentAsset && typeof paymentAsset === "object" && typeof paymentAsset.kind === "string"
        ? paymentAsset.kind
        : "native";
    const paymentTokenAddress =
      paymentKind === "erc20" ? requireAddress(paymentAsset?.address, "paymentAsset.address") : null;

    console.info(logp, "request", {
      ip,
      safeAddress,
      paymentChainId,
      paymentKind,
      paymentTokenAddress,
      assetCount: assets.length,
      chainIds: Array.from(new Set(assets.map(a => a.chainId))).sort((a, b) => a - b),
    });

    // Payment is made to the paymaster EOA (same key used to sponsor txs on each chain).
    const pk = process.env.PAYMASTER_PRIVATE_KEY;
    if (!pk) return NextResponse.json({ error: "Missing PAYMASTER_PRIVATE_KEY on server." }, { status: 500 });
    const paymasterAccount = privateKeyToAccount(requireHex(pk, "PAYMASTER_PRIVATE_KEY"));
    const paymaster = paymasterAccount.address;
    console.info(logp, "paymaster", { paymaster });

    const serviceFeeUsdMicros = getServiceFeeUsdMicros();

    const requestedAssetsWithIndex = assets.map((asset, index) => ({ index, asset }));
    const requestedAssetsHash = canonicalAssetsHash(assets);

    // Best-effort per-chain gas estimates (informational only).
    const chainIds = Array.from(new Set(assets.map(a => a.chainId))).sort((a, b) => a - b);
    const perChain = await Promise.all(
      chainIds.map(async chainId => {
        const chainLogp = `${logp}[chainId=${chainId}]`;
        const chainAssetsWithIndexForErrors = requestedAssetsWithIndex.filter(a => a.asset.chainId === chainId);
        const failAllAssets = (error: string) => ({
          chainId,
          assetCount: chainAssetsWithIndexForErrors.length,
          assetStatuses: chainAssetsWithIndexForErrors.map(({ index }) => ({ index, ok: false, error, revert: null })),
          executableAssetCount: 0,
        });

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
          console.warn(chainLogp, "missing delegate authorization");
          return { ...failAllAssets("Missing delegate authorization for this chain."), quote: null };
        }

        const yParity = normalizeYParity(delegateAuthObj, chainId);

        const authorization = {
          address: requireAddress(delegateAuthObj.address, `authorizationsByChainId.${chainId}.address`),
          chainId: requireNumber(delegateAuthObj.chainId, `authorizationsByChainId.${chainId}.chainId`),
          nonce: requireNumber(delegateAuthObj.nonce, `authorizationsByChainId.${chainId}.nonce`),
          r: requireHex(delegateAuthObj.r, `authorizationsByChainId.${chainId}.r`),
          s: requireHex(delegateAuthObj.s, `authorizationsByChainId.${chainId}.s`),
          yParity,
        } satisfies Authorization;
        const viemAuthorization: any = {
          ...(authorization as any),
          // Provide viem's alternate naming to avoid runtime serialization issues.
          contractAddress: (authorization as any).contractAddress ?? authorization.address,
        };

        const chainAssets = assets.filter(a => a.chainId === chainId);
        const rpcUrl = getRpcUrl(chainId);
        const chain = getChain(chainId, rpcUrl);
        const delegate = getDelegateForChain(chainId);
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        console.info(chainLogp, "config", { rpcUrl, delegate: delegate.address });

        // Collect minimal info needed for the UI.
        const paymasterBalanceWei = await publicClient.getBalance({ address: paymaster }).catch(() => null);
        console.info(chainLogp, "paymasterBalanceWei", {
          paymasterBalanceWei: paymasterBalanceWei?.toString?.() ?? null,
        });

        if (paymasterBalanceWei === 0n) {
          console.warn(chainLogp, "paymaster has zero balance");
          return {
            ...failAllAssets("Paymaster has 0 balance on this chain (cannot sponsor transactions)."),
            paymasterBalanceWei,
            quote: null,
            rpcUrl,
          };
        }

        // Ensure the signature delegates to the expected contract.
        if (authorization.address.toLowerCase() !== delegate.address.toLowerCase()) {
          console.warn(chainLogp, "authorization delegate mismatch", {
            authDelegate: authorization.address,
            expectedDelegate: delegate.address,
          });
          return {
            ...failAllAssets("Authorization does not delegate to the expected contract."),
            paymasterBalanceWei,
            quote: null,
            rpcUrl,
          };
        }

        const compromisedAddress = (await recoverAuthorizationAddress({
          authorization: authorization as any,
        })) as Address;
        console.info(chainLogp, "recovered compromised", { compromisedAddress, authNonce: authorization.nonce });

        // If the compromised account nonce changed since signing (e.g. attacker txs), the authorization can become invalid.
        const compromisedNonceNow = await publicClient
          .getTransactionCount({ address: compromisedAddress, blockTag: "pending" })
          .catch(() => null);
        console.info(chainLogp, "compromisedNonceNow", { compromisedNonceNow });
        if (
          typeof compromisedNonceNow === "number" &&
          Number.isFinite(compromisedNonceNow) &&
          authorization.nonce !== compromisedNonceNow
        ) {
          console.warn(chainLogp, "stale authorization nonce", {
            signed: authorization.nonce,
            current: compromisedNonceNow,
          });
          return {
            ...failAllAssets(
              `Authorization nonce is stale. Signed nonce=${authorization.nonce} current nonce=${compromisedNonceNow}. Re-sign authorizations.`,
            ),
            paymasterBalanceWei,
            quote: null,
            rpcUrl,
          };
        }

        const chainAssetsWithIndex = requestedAssetsWithIndex.filter(a => a.asset.chainId === chainId);
        const statusByIndex = new Map<number, { ok: boolean; error: string | null; revert: any | null }>();

        // 1) Simulate non-custom assets individually (legacy behavior).
        const nonCustom = chainAssetsWithIndex.filter(x => x.asset.standard !== "customcall");
        const nonCustomStatuses = await Promise.all(
          nonCustom.map(async ({ index, asset }) => {
            if (asset.standard === "native") {
              return { index, ok: true, error: null, revert: null };
            }
            try {
              const [call] = buildAssetCalls({ compromisedAddress, safeAddress, assets: [asset] });
              if (!call)
                return { index, ok: false, error: "Missing call for asset (unsupported/malformed).", revert: null };
              const res = (await publicClient.call({
                to: call.to,
                data: call.data,
                value: call.value,
                account: compromisedAddress,
              })) as any;
              if (asset.standard === "erc20") {
                const callResultHex =
                  typeof res === "string" ? (res as Hex) : (((res as any)?.data as Hex | undefined) ?? null);
                const decoded = decodeOptionalBoolReturn(callResultHex);
                const ok = decoded.kind === "bool" ? decoded.value : true;
                if (!ok) return { index, ok: false, error: "ERC20 transfer returned false", revert: null };
              }
              return { index, ok: true, error: null, revert: null };
            } catch (e: any) {
              const msg =
                (typeof e?.shortMessage === "string" && e.shortMessage) ||
                (typeof e?.message === "string" && e.message) ||
                "Asset call simulation failed";
              const revertData = (e?.data ?? e?.cause?.data) as Hex | null | undefined;
              const decoded = decodeRevertData({ data: revertData ?? null });
              const revertSummary = decoded?.summary ?? null;
              return { index, ok: false, error: msg, revert: revertSummary ? { summary: revertSummary } : null };
            }
          }),
        );
        for (const s of nonCustomStatuses) statusByIndex.set(s.index, { ok: s.ok, error: s.error, revert: s.revert });

        // 2) Simulate custom calls as an ordered bundle (to avoid false negatives from call dependencies).
        const custom = chainAssetsWithIndex.filter(x => x.asset.standard === "customcall");
        const simulateCustomBundle = async (assetsSubset: RecoveryAsset[]) => {
          try {
            const calls = buildAssetCalls({ compromisedAddress, safeAddress, assets: assetsSubset });
            const authorizer = paymasterAccount.address;
            const intentNonce = await readIntentNonce({
              publicClient,
              chainId,
              compromisedAddress,
              authorization,
              authorizer,
              caller: paymaster,
            });
            const deadline = 0n;
            const callsHash = hashCalls(calls);
            console.info(chainLogp, "intent", {
              authorizer,
              intentNonce: intentNonce.toString(),
              deadline: deadline.toString(),
              calls: calls.length,
              callsHash,
            });
            const td = typedDataForRecoveryIntent({
              chainId,
              verifyingContract: compromisedAddress,
              recoveryAddress: safeAddress,
              callsHash,
              nonce: intentNonce,
              deadline,
            });
            const signature = (await paymasterAccount.signTypedData(td as any)) as Hex;
            const data = encodeExecuteBatch({
              chainId,
              recoveryAddress: safeAddress,
              calls,
              authorizer,
              nonce: intentNonce,
              deadline,
              signature,
            });
            const callParams = {
              to: compromisedAddress,
              data,
              account: paymaster,
              type: "eip7702",
              authorizationList: [viemAuthorization],
              chainId,
              // Some RPCs under-estimate/limit eth_call gas for EIP-7702. Provide a high ceiling to avoid false negatives.
              gas: 3_000_000n,
            } as any;
            await publicClient.call(callParams);
            return { ok: true as const };
          } catch (e: any) {
            console.warn(chainLogp, "simulate batch failed", safeErr(e));
            const msg =
              (typeof e?.shortMessage === "string" && e.shortMessage) ||
              (typeof e?.message === "string" && e.message) ||
              "Batch simulation failed";
            const revertData = (e?.data ?? e?.cause?.data) as Hex | null | undefined;
            let callFailedIndex: number | null = null;
            let callFailedReason: Hex | null = null;
            let decoded: any = null;
            if (revertData) {
              try {
                decoded = decodeErrorResult({ abi: delegate.abi, data: revertData });
                if (decoded?.errorName === "CallFailed") {
                  const idx = decoded?.args?.index;
                  callFailedIndex = typeof idx === "bigint" ? Number(idx) : typeof idx === "number" ? idx : Number(idx);
                  callFailedReason = (decoded?.args?.reason ?? null) as Hex | null;
                }
              } catch {
                decoded = null;
              }
            }
            const revertSummary = callFailedReason
              ? decodeRevertData({ data: callFailedReason }).summary
              : decodeRevertData({ data: revertData ?? null }).summary;
            const rpcUnsupported =
              typeof msg === "string" && /Invalid parameters were provided/i.test(msg)
                ? "RPC does not support EIP-7702 call simulation."
                : null;
            if (rpcUnsupported) {
              // Avoid marking custom calls as "failed" when the RPC simply can't simulate EIP-7702.
              // The actual broadcast on /api/execute may still succeed.
              return { ok: true as const };
            }
            return {
              ok: false as const,
              error: rpcUnsupported ?? msg,
              revertSummary: revertSummary ?? null,
              callFailedIndex,
            };
          }
        };

        if (custom.length) {
          const customAssets = custom.map(x => x.asset);
          const full = await simulateCustomBundle(customAssets as any);
          if (full.ok) {
            for (const { index } of custom) statusByIndex.set(index, { ok: true, error: null, revert: null });
          } else {
            // Prefix-based checks: simulate each call in the context of previous successful custom calls.
            const good: RecoveryAsset[] = [];
            for (const { index, asset } of custom) {
              const res = await simulateCustomBundle([...good, asset] as any);
              if (res.ok) {
                statusByIndex.set(index, { ok: true, error: null, revert: null });
                good.push(asset);
              } else {
                const summary = (res as any).revertSummary;
                const idx = (res as any).callFailedIndex;
                const extra = typeof idx === "number" && Number.isFinite(idx) ? ` (failed at batch index=${idx})` : "";
                statusByIndex.set(index, {
                  ok: false,
                  error: (res as any).error ?? "Custom call failed",
                  revert: summary ? { summary: `${summary}${extra}` } : extra ? { summary: extra } : null,
                });
              }
            }
          }
        }

        const assetStatuses = chainAssetsWithIndex.map(({ index }) => ({
          index,
          ...(statusByIndex.get(index) ?? { ok: true, error: null, revert: null }),
        }));

        const failingAssetIndexes = new Set(assetStatuses.filter(s => !s.ok).map(s => s.index));
        const executableChainAssets = chainAssetsWithIndex
          .filter(x => !failingAssetIndexes.has(x.index))
          .map(x => x.asset);

        // If all assets for this chain are excluded, we will skip execution on this chain entirely
        // (no authorization needed; chain cost should be 0).
        if (executableChainAssets.length === 0) {
          return {
            chainId,
            assetCount: chainAssets.length,
            assetStatuses,
            executableAssetCount: 0,
            paymasterBalanceWei,
            quote: { gas: 0n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, gasCostWei: 0n },
            rpcUrl,
          };
        }

        const calls = buildAssetCalls({ compromisedAddress, safeAddress, assets: executableChainAssets });
        const authorizer = paymasterAccount.address;
        const intentNonce = await readIntentNonce({
          publicClient,
          chainId,
          compromisedAddress,
          authorization,
          authorizer,
          caller: paymaster,
        });
        const deadline = 0n;
        const callsHash = hashCalls(calls);
        console.info(chainLogp, "intent(for-estimate)", {
          authorizer,
          intentNonce: intentNonce.toString(),
          deadline: deadline.toString(),
          calls: calls.length,
          callsHash,
        });
        const td = typedDataForRecoveryIntent({
          chainId,
          verifyingContract: compromisedAddress,
          recoveryAddress: safeAddress,
          callsHash,
          nonce: intentNonce,
          deadline,
        });
        const signature = (await paymasterAccount.signTypedData(td as any)) as Hex;
        const data = encodeExecuteBatch({
          chainId,
          recoveryAddress: safeAddress,
          calls,
          authorizer,
          nonce: intentNonce,
          deadline,
          signature,
        });

        try {
          const estimateParams = {
            to: compromisedAddress,
            data,
            account: paymaster,
            type: "eip7702",
            authorizationList: [viemAuthorization],
            chainId,
          } as any;
          const { maxGas } = await getMaxTxGas(publicClient);
          const estGas = await publicClient.estimateGas(estimateParams);
          const gas = padGasLimit({ estimatedGas: estGas, callsCount: calls.length, maxGas, minGas: 200_000n });
          const fees = await publicClient.estimateFeesPerGas().catch(() => null);
          const maxFeePerGas = fees?.maxFeePerGas ?? (await publicClient.getGasPrice());
          const maxPriorityFeePerGas = fees?.maxPriorityFeePerGas ?? 0n;
          const gasCostWei = gas * maxFeePerGas;

          console.info(chainLogp, "estimate ok", {
            estGas: estGas.toString(),
            gas: gas.toString(),
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            gasCostWei: gasCostWei.toString(),
          });
          return {
            chainId,
            assetCount: chainAssets.length,
            assetStatuses,
            executableAssetCount: executableChainAssets.length,
            paymasterBalanceWei,
            quote: { gas, maxFeePerGas, maxPriorityFeePerGas, gasCostWei },
            rpcUrl,
          };
        } catch (e: any) {
          // Best-effort: try to get revert data (helps distinguish "RPC doesn't support EIP-7702" vs "a call failed").
          console.warn(chainLogp, "estimate failed", safeErr(e));
          let revertData: Hex | null = null;
          let decoded: any = null;
          let decodedSummary: string | null = null;
          try {
            const callParams = {
              to: compromisedAddress,
              data,
              account: paymaster,
              type: "eip7702",
              authorizationList: [viemAuthorization],
              chainId,
            } as any;
            await publicClient.call(callParams);
          } catch (callErr: any) {
            revertData = (callErr?.data ?? callErr?.cause?.data) as Hex | null;
            if (revertData) {
              try {
                decoded = decodeErrorResult({ abi: delegate.abi, data: revertData });
                if (decoded?.errorName === "CallFailed") {
                  const idx = decoded?.args?.index;
                  const to = decoded?.args?.to;
                  decodedSummary = `CallFailed(index=${String(idx)}, to=${String(to)})`;
                } else if (typeof decoded?.errorName === "string") {
                  decodedSummary = decoded.errorName;
                }
              } catch {
                decoded = null;
              }
              if (!decodedSummary) {
                const decodedStd = decodeRevertData({ data: revertData, abi: delegate.abi });
                decodedSummary = decodedStd.summary;
              }
            }
          }

          const msg =
            (typeof e?.shortMessage === "string" && e.shortMessage) ||
            (typeof e?.message === "string" && e.message) ||
            "Unknown error";
          const category =
            typeof msg === "string" && /Invalid parameters were provided/i.test(msg)
              ? "RPC_UNSUPPORTED_EIP7702"
              : typeof msg === "string" && /Execution reverted/i.test(msg)
                ? "REVERTED"
                : "UNKNOWN";

          return {
            chainId,
            assetCount: chainAssets.length,
            assetStatuses,
            executableAssetCount: executableChainAssets.length,
            paymasterBalanceWei,
            quote: null,
            error:
              category === "RPC_UNSUPPORTED_EIP7702" ? "RPC does not support EIP-7702 estimation/broadcasting." : msg,
            revert: decodedSummary
              ? { summary: decodedSummary, decoded: decoded?.errorName ? { errorName: decoded.errorName } : null }
              : null,
            rpcUrl,
          };
        }
      }),
    );

    // Flatten per-asset statuses (aligned to the request `assets` array index).
    const assetStatusesFlat: Array<{ index: number; ok: boolean; error: string | null; revert: any | null }> = [];
    for (const c of perChain as any[]) {
      if (Array.isArray(c?.assetStatuses)) {
        for (const s of c.assetStatuses) assetStatusesFlat.push(s);
      }
    }
    const statusByIndex = new Map<number, { ok: boolean; error: string | null; revert: any | null }>();
    for (const s of assetStatusesFlat) {
      const idx = typeof s?.index === "number" ? s.index : Number(s?.index);
      if (!Number.isFinite(idx)) continue;
      statusByIndex.set(idx, {
        ok: Boolean(s?.ok),
        error: typeof s?.error === "string" ? s.error : null,
        revert: s?.revert ?? null,
      });
    }
    const assetStatuses = assets.map((_, i) => ({
      index: i,
      ...(statusByIndex.get(i) ?? { ok: true, error: null, revert: null }),
    }));

    const executableAssets = assets.filter((_, i) => assetStatuses[i]?.ok !== false);
    const executableAssetsHash = canonicalAssetsHash(executableAssets);
    const failedAssetCount = assetStatuses.filter(s => !s.ok).length;
    const executableAssetCount = executableAssets.length;

    // Pricing: estimate sponsor gas across chains in USD, then convert to selected payment asset amount.
    const paymentNativeDecimals = 18;
    let paymentTokenDecimals = 18;

    const MIN_CHAIN_USD_MICROS = 10_000n; // $0.01
    let sponsorGasUsdMicros = 0n;
    let pricingComplete = true;
    const nativeUsdMicrosByChainId: Record<number, string> = {};
    const gasCostUsdMicrosByChainId: Record<number, string> = {};

    for (const c of perChain as any[]) {
      const cid = typeof c?.chainId === "number" ? c.chainId : Number(c?.chainId);
      if (!Number.isFinite(cid)) continue;
      const gasCostWei =
        typeof c?.quote?.gasCostWei === "string" || typeof c?.quote?.gasCostWei === "bigint"
          ? BigInt(c.quote.gasCostWei)
          : null;

      const nativeUsdMicros = await getNativeUsdMicrosPerToken(cid);
      if (nativeUsdMicros) nativeUsdMicrosByChainId[cid] = nativeUsdMicros.toString();

      if (gasCostWei == null || !nativeUsdMicros) {
        pricingComplete = false;
        continue;
      }

      const chainUsdMicros = weiToUsdMicros({
        wei: gasCostWei,
        nativeDecimals: 18,
        nativeUsdMicrosPerToken: nativeUsdMicros,
      });
      // Floor to $0.01 per chain whenever gasCostWei > 0, even if integer micros rounding yields 0.
      const chainUsdMicrosFloored =
        gasCostWei > 0n && chainUsdMicros < MIN_CHAIN_USD_MICROS ? MIN_CHAIN_USD_MICROS : chainUsdMicros;
      gasCostUsdMicrosByChainId[cid] = chainUsdMicrosFloored.toString();
      sponsorGasUsdMicros += chainUsdMicrosFloored;
    }

    const markupBpsRaw = process.env.RECOVERY_MARKUP_BPS ? Number(process.env.RECOVERY_MARKUP_BPS) : 1000; // 10%
    const markupBps = Number.isFinite(markupBpsRaw) && markupBpsRaw >= 0 ? Math.floor(markupBpsRaw) : 1000;
    const sponsorGasUsdMicrosWithMarkup = (sponsorGasUsdMicros * BigInt(10_000 + markupBps) + 9_999n) / 10_000n;

    // Always round up to at least $0.01 so we never quote $0.00.
    const MIN_TOTAL_USD_MICROS = 10_000n; // $0.01
    const totalUsdMicrosRaw = serviceFeeUsdMicros + sponsorGasUsdMicrosWithMarkup;
    const totalUsdMicros = totalUsdMicrosRaw < MIN_TOTAL_USD_MICROS ? MIN_TOTAL_USD_MICROS : totalUsdMicrosRaw;

    const paymentNativeUsdMicros = await getNativeUsdMicrosPerToken(paymentChainId);
    const paymentErc20UsdMicros =
      paymentKind === "erc20" && paymentTokenAddress
        ? await getErc20UsdMicrosPerToken({ chainId: paymentChainId, tokenAddress: paymentTokenAddress })
        : null;

    const paymentUsdMicrosPerUnit = paymentKind === "erc20" ? paymentErc20UsdMicros : paymentNativeUsdMicros;
    if (!paymentUsdMicrosPerUnit) pricingComplete = false;

    const totalDueWei =
      paymentKind === "native" && paymentUsdMicrosPerUnit
        ? usdMicrosToWeiCeil({
            usdMicros: totalUsdMicros,
            nativeDecimals: paymentNativeDecimals,
            nativeUsdMicrosPerToken: paymentUsdMicrosPerUnit,
          })
        : 0n;

    // For ERC-20 payments, we'll return totalDueTokenUnits and keep totalDueWei=0.
    if (paymentKind === "erc20" && paymentTokenAddress) {
      try {
        const paymentRpcUrl = getRpcUrl(paymentChainId);
        const paymentChain = getChain(paymentChainId, paymentRpcUrl);
        const paymentClient = createPublicClient({ chain: paymentChain, transport: http(paymentRpcUrl) });
        const erc20MetaAbi = parseAbi(["function decimals() view returns (uint8)"]);
        const d = (await paymentClient
          .readContract({ address: paymentTokenAddress, abi: erc20MetaAbi, functionName: "decimals" })
          .catch(() => null)) as unknown;
        const dn =
          typeof d === "number" && Number.isFinite(d) ? Math.floor(d) : typeof d === "bigint" ? Number(d) : null;
        if (typeof dn === "number" && Number.isFinite(dn) && dn >= 0 && dn <= 255) paymentTokenDecimals = dn;
      } catch {
        // default 18
      }
    }
    const totalDueTokenUnits =
      paymentKind === "erc20" && paymentUsdMicrosPerUnit
        ? usdMicrosToWeiCeil({
            usdMicros: totalUsdMicros,
            nativeDecimals: paymentTokenDecimals,
            nativeUsdMicrosPerToken: paymentUsdMicrosPerUnit,
          })
        : 0n;

    // Signed payload so /api/execute can require the exact quoted amount (and asset set) without recomputing estimates.
    const assetsHash = executableAssetsHash;
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + 10 * 60_000;
    const totalDueAmount = paymentKind === "erc20" ? totalDueTokenUnits : totalDueWei;
    const quoteMessage =
      `hwr.quote.v1\n` +
      `safe=${safeAddress}\n` +
      `paymentChainId=${String(paymentChainId)}\n` +
      `paymentKind=${paymentKind}\n` +
      `paymentToken=${paymentTokenAddress ?? "0x0000000000000000000000000000000000000000"}\n` +
      `assetsHash=${assetsHash}\n` +
      `totalDue=${totalDueAmount.toString()}\n` +
      `expiresAtMs=${String(expiresAtMs)}`;
    const quoteSig = await paymasterAccount.signMessage({ message: quoteMessage });

    return NextResponse.json(
      jsonSafe({
        paymaster,
        safeAddress,
        chains: perChain,
        quote: {
          paymentChainId,
          paymentAsset: paymentKind === "erc20" ? { kind: "erc20", address: paymentTokenAddress } : { kind: "native" },
          paymentTokenDecimals,
          requestedAssetsHash,
          executableAssets,
          executableAssetsHash,
          assetStatuses,
          executableAssetCount,
          failedAssetCount,
          serviceFeeUsdMicros,
          sponsorGasUsdMicros,
          sponsorGasUsdMicrosWithMarkup,
          markupBps,
          totalUsdMicros,
          totalDueWei,
          totalDueTokenUnits,
          pricingComplete,
          paymentNativeUsdMicros,
          paymentErc20UsdMicros,
          nativeUsdMicrosByChainId,
          gasCostUsdMicrosByChainId,
          quotePayload: {
            safeAddress,
            paymentChainId,
            paymentKind,
            paymentTokenAddress: paymentTokenAddress ?? "0x0000000000000000000000000000000000000000",
            assetsHash,
            totalDue: totalDueAmount,
            issuedAtMs,
            expiresAtMs,
          },
          quoteSig,
        },
      }),
    );
  } catch (e) {
    console.error(logp, "fatal", safeErr(e));
    const message = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
