import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Address, Hex } from "viem";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import scaffoldConfig from "~~/scaffold.config";
import { jsonSafe } from "~~/utils/recovery/jsonSafe";
import { rateLimit } from "~~/utils/recovery/rateLimit";
import { requireAddress, requireHex, requireObject } from "~~/utils/recovery/validation";
import { getChain, getRpcUrl } from "~~/utils/recovery/viemServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACROSS_API_BASE = (process.env.ACROSS_API_BASE || "https://app.across.to/api").replace(/\/+$/, "");

const SPOKEPOOL_V3_ABI = parseAbi([
  "function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message) payable",
]);

function mkLogPrefix(reqId: string) {
  return `[hwr.paymaster.rebalance ${reqId}]`;
}

function safeErr(e: any) {
  return {
    name: typeof e?.name === "string" ? e.name : null,
    code: e?.code ?? e?.cause?.code ?? null,
    shortMessage: typeof e?.shortMessage === "string" ? e.shortMessage : null,
    message: typeof e?.message === "string" ? e.message : String(e),
  };
}

function requireAdmin(req: Request) {
  const expected = process.env.PAYMASTER_REBALANCE_AUTH_TOKEN;
  if (!expected || !expected.trim()) throw new Error("Missing PAYMASTER_REBALANCE_AUTH_TOKEN on server.");

  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const provided = (m?.[1] ?? "").trim();
  if (!provided || provided !== expected.trim()) {
    return { ok: false as const, error: "Unauthorized" };
  }
  return { ok: true as const };
}

function parseBigintFromUnknown(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.floor(v));
    if (typeof v === "string" && v.trim()) return BigInt(v.trim());
    return null;
  } catch {
    return null;
  }
}

async function acrossGet(path: string, params: Record<string, string>) {
  const url = new URL(`${ACROSS_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { method: "GET" });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = typeof json?.message === "string" ? json.message : text || `HTTP ${res.status}`;
    throw new Error(`Across GET ${path} failed: ${msg}`);
  }
  return json;
}

async function getAcrossNativeRoute(params: {
  originChainId: number;
  destinationChainId: number;
}): Promise<{ originToken: Address; destinationToken: Address }> {
  const routes = (await acrossGet("/available-routes", {
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
  })) as any[];
  const match = (Array.isArray(routes) ? routes : []).find(r => r && r.isNative === true);
  const originToken = requireAddress(match?.originToken, "across.available-routes.originToken");
  const destinationToken = requireAddress(match?.destinationToken, "across.available-routes.destinationToken");
  return { originToken, destinationToken };
}

async function getAcrossSuggestedFees(params: {
  originChainId: number;
  destinationChainId: number;
  inputToken: Address;
  outputToken: Address;
  amount: bigint;
  recipient: Address;
}) {
  return await acrossGet("/suggested-fees", {
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    originChainId: String(params.originChainId),
    destinationChainId: String(params.destinationChainId),
    amount: params.amount.toString(),
    recipient: params.recipient,
  });
}

function parseTargetsWei(): { defaultTargetWei: bigint; perChainTargetWei: Record<number, bigint> } {
  const perChainTargetWei: Record<number, bigint> = {};

  const defaultWeiRaw = process.env.PAYMASTER_TARGET_WEI;
  const defaultEthRaw = process.env.PAYMASTER_TARGET_ETH;
  const defaultTargetWei =
    (defaultWeiRaw && defaultWeiRaw.trim() ? parseBigintFromUnknown(defaultWeiRaw) : null) ??
    (defaultEthRaw && defaultEthRaw.trim() ? parseEther(defaultEthRaw.trim() as `${number}`) : null);

  if (typeof defaultTargetWei !== "bigint" || defaultTargetWei < 0n) {
    throw new Error("Missing/invalid PAYMASTER_TARGET_WEI or PAYMASTER_TARGET_ETH on server.");
  }

  // Optional per-chain overrides.
  // - PAYMASTER_TARGETS_WEI_JSON: {"1":"1000000000000000","10":"2000000000000000"}
  // - PAYMASTER_TARGETS_ETH_JSON: {"1":"0.001","10":"0.002"}
  const weiJsonRaw = process.env.PAYMASTER_TARGETS_WEI_JSON;
  const ethJsonRaw = process.env.PAYMASTER_TARGETS_ETH_JSON;

  const applyJson = (raw: string, kind: "wei" | "eth") => {
    let obj: any = null;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in PAYMASTER_TARGETS_${kind.toUpperCase()}_JSON`);
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new Error(`Expected JSON object in PAYMASTER_TARGETS_${kind.toUpperCase()}_JSON`);
    }
    for (const [k, v] of Object.entries(obj)) {
      const chainId = Number(k);
      if (!Number.isFinite(chainId)) continue;
      const target =
        kind === "wei"
          ? parseBigintFromUnknown(v)
          : typeof v === "string" && v.trim()
            ? parseEther(v.trim() as `${number}`)
            : null;
      if (typeof target === "bigint" && target >= 0n) perChainTargetWei[chainId] = target;
    }
  };

  if (typeof ethJsonRaw === "string" && ethJsonRaw.trim()) applyJson(ethJsonRaw, "eth");
  if (typeof weiJsonRaw === "string" && weiJsonRaw.trim()) applyJson(weiJsonRaw, "wei"); // wei overrides eth

  return { defaultTargetWei, perChainTargetWei };
}

function getSupportedChainIds(): number[] {
  return (scaffoldConfig.targetNetworks ?? [])
    .map(n => n.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    .sort((a, b) => a - b);
}

async function readNativeBalanceWei(chainId: number, address: Address): Promise<bigint> {
  const rpcUrl = getRpcUrl(chainId);
  const chain = getChain(chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  return await publicClient.getBalance({ address });
}

export async function GET(req: Request) {
  const reqId = (() => {
    try {
      return randomUUID();
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
    }
  })();
  const logp = mkLogPrefix(reqId);

  try {
    const auth = requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = rateLimit({ key: `paymaster.rebalance:get:${ip}`, limit: 30, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const pk = process.env.PAYMASTER_PRIVATE_KEY;
    if (!pk) return NextResponse.json({ error: "Missing PAYMASTER_PRIVATE_KEY on server." }, { status: 500 });
    const paymasterAccount = privateKeyToAccount(requireHex(pk, "PAYMASTER_PRIVATE_KEY"));

    const { defaultTargetWei, perChainTargetWei } = parseTargetsWei();
    const chainIds = getSupportedChainIds();

    const perChain = await Promise.all(
      chainIds.map(async chainId => {
        try {
          const balanceWei = await readNativeBalanceWei(chainId, paymasterAccount.address);
          const targetWei = perChainTargetWei[chainId] ?? defaultTargetWei;
          const deltaWei = balanceWei - targetWei;
          return {
            chainId,
            ok: true,
            paymaster: paymasterAccount.address,
            balanceWei,
            targetWei,
            deltaWei, // positive = surplus, negative = deficit
          };
        } catch (e: any) {
          return { chainId, ok: false, error: safeErr(e) };
        }
      }),
    );

    return NextResponse.json(
      jsonSafe({
        ok: perChain.every((c: any) => c?.ok),
        paymaster: paymasterAccount.address,
        chains: perChain,
      }),
    );
  } catch (e: any) {
    console.error(logp, "fatal", safeErr(e));
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad request" }, { status: 400 });
  }
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
    const auth = requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = rateLimit({ key: `paymaster.rebalance:post:${ip}`, limit: 10, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const body = requireObject(await req.json().catch(() => ({})));
    const execute = Boolean((body as any).execute);

    const sweepTo = process.env.PAYMASTER_SWEEP_ADDRESS;
    if (!sweepTo) return NextResponse.json({ error: "Missing PAYMASTER_SWEEP_ADDRESS on server." }, { status: 500 });
    const sweepAddress = requireAddress(sweepTo, "PAYMASTER_SWEEP_ADDRESS");

    const pk = process.env.PAYMASTER_PRIVATE_KEY;
    if (!pk) return NextResponse.json({ error: "Missing PAYMASTER_PRIVATE_KEY on server." }, { status: 500 });
    const paymasterAccount = privateKeyToAccount(requireHex(pk, "PAYMASTER_PRIVATE_KEY"));

    const { defaultTargetWei, perChainTargetWei } = parseTargetsWei();

    const chainIdsOverride = Array.isArray((body as any).chainIds)
      ? (body as any).chainIds.map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
      : null;
    const chainIds = (chainIdsOverride?.length ? chainIdsOverride : getSupportedChainIds()).sort(
      (a: number, b: number) => a - b,
    );

    const gasBufferBpsRaw = process.env.PAYMASTER_SWEEP_GAS_BUFFER_BPS;
    const gasBufferBps = (() => {
      const n = gasBufferBpsRaw && gasBufferBpsRaw.trim() ? Number(gasBufferBpsRaw) : 2000; // +20%
      if (!Number.isFinite(n) || n < 0) return 2000;
      return Math.floor(n);
    })();

    const results: Record<number, any> = {};

    // Pre-read balances/targets so we can choose source/destination chains for Across deposits.
    const state: Array<{
      chainId: number;
      rpcUrl: string;
      balanceWei: bigint;
      targetWei: bigint;
      deltaWei: bigint;
    }> = [];
    for (const chainId of chainIds) {
      const rpcUrl = getRpcUrl(chainId);
      const chain = getChain(chainId, rpcUrl);
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
      const balanceWei = await publicClient.getBalance({ address: paymasterAccount.address });
      const targetWei = perChainTargetWei[chainId] ?? defaultTargetWei;
      state.push({ chainId, rpcUrl, balanceWei, targetWei, deltaWei: balanceWei - targetWei });
    }

    // Reserve: keep some extra native on the source chain so the paymaster stays healthy there too.
    // We derive it from each chain's configured target to avoid introducing more env vars.
    // Rule: reserve = max(5% of target, 0.0002 ETH).
    const MIN_SOURCE_RESERVE_WEI = parseEther("0.0002");
    const sourceReserveWeiForTarget = (targetWei: bigint) => {
      const pct = targetWei / 20n; // 5%
      return pct > MIN_SOURCE_RESERVE_WEI ? pct : MIN_SOURCE_RESERVE_WEI;
    };

    const maxBridgeOpsRaw = process.env.PAYMASTER_REBALANCE_MAX_BRIDGES;
    const maxBridgeOps =
      maxBridgeOpsRaw && maxBridgeOpsRaw.trim() ? Math.max(0, Math.min(25, Number(maxBridgeOpsRaw))) : 10;

    const bridgeOps: any[] = [];

    // Rebalance deficits by bridging native ETH via Across depositV3 from surplus chains.
    // We only ever spend from a chain's surplus, leaving `targetWei + reserve` behind.
    if (execute) {
      let ops = 0;
      // Recompute deltas iteratively.
      while (ops < maxBridgeOps) {
        const deficits = state
          .filter(s => s.deltaWei < 0n)
          .map(s => ({ ...s, needWei: 0n - s.deltaWei }))
          .sort((a, b) => (a.needWei > b.needWei ? -1 : a.needWei < b.needWei ? 1 : 0));
        const sources = state
          .map(s => {
            const reserveWei = sourceReserveWeiForTarget(s.targetWei);
            return { ...s, reserveWei, availWei: s.deltaWei - reserveWei };
          })
          .filter(s => s.availWei > 0n)
          .sort((a, b) => (a.availWei > b.availWei ? -1 : a.availWei < b.availWei ? 1 : 0));

        const dst = deficits[0];
        const src = sources[0];
        if (!dst || !src) break;
        if (dst.chainId === src.chainId) break;

        const amountWei = dst.needWei <= src.availWei ? dst.needWei : src.availWei;
        if (amountWei <= 0n) break;

        const srcChain = getChain(src.chainId, src.rpcUrl);
        const srcPublic = createPublicClient({ chain: srcChain, transport: http(src.rpcUrl) });
        const srcWallet = createWalletClient({
          chain: srcChain,
          transport: http(src.rpcUrl),
          account: paymasterAccount,
        });

        // Resolve native route (WETH addresses) + fees.
        const route = await getAcrossNativeRoute({ originChainId: src.chainId, destinationChainId: dst.chainId });
        const fees = await getAcrossSuggestedFees({
          originChainId: src.chainId,
          destinationChainId: dst.chainId,
          inputToken: route.originToken,
          outputToken: route.destinationToken,
          amount: amountWei,
          recipient: paymasterAccount.address,
        });

        const spokePoolAddress = requireAddress(fees?.spokePoolAddress, "across.suggested-fees.spokePoolAddress");
        const outputAmount = BigInt(String(fees?.outputAmount));
        const exclusiveRelayer =
          fees?.exclusiveRelayer && String(fees.exclusiveRelayer) !== "0x0000000000000000000000000000000000000000"
            ? requireAddress(fees.exclusiveRelayer, "across.suggested-fees.exclusiveRelayer")
            : ("0x0000000000000000000000000000000000000000" as Address);
        const quoteTimestamp = Number(fees?.timestamp);
        const fillDeadline = Number(fees?.fillDeadline);
        const exclusivityDeadline = Number(fees?.exclusivityDeadline ?? 0);

        if (!Number.isFinite(quoteTimestamp) || !Number.isFinite(fillDeadline) || outputAmount <= 0n) {
          throw new Error("Across suggested-fees response missing timestamp/fillDeadline/outputAmount");
        }

        const depositTxHash = await srcWallet.writeContract({
          address: spokePoolAddress,
          abi: SPOKEPOOL_V3_ABI,
          functionName: "depositV3",
          args: [
            paymasterAccount.address,
            paymasterAccount.address,
            route.originToken,
            route.destinationToken,
            amountWei,
            outputAmount,
            BigInt(dst.chainId),
            exclusiveRelayer,
            quoteTimestamp as any,
            fillDeadline as any,
            exclusivityDeadline as any,
            "0x",
          ],
          // Payable: send native ETH directly instead of wrapping WETH.
          value: amountWei,
        } as any);
        await srcPublic.waitForTransactionReceipt({ hash: depositTxHash });

        let status: any = null;
        try {
          status = await acrossGet("/deposit/status", { depositTxnRef: depositTxHash });
        } catch {
          status = null;
        }

        bridgeOps.push(
          jsonSafe({
            fromChainId: src.chainId,
            toChainId: dst.chainId,
            amountWei,
            outputAmount,
            spokePoolAddress,
            depositTxHash,
            status,
          }),
        );

        // Update local state optimistically: src decreases by amountWei; dst increases by outputAmount (best-effort).
        const srcIdx = state.findIndex(s => s.chainId === src.chainId);
        const dstIdx = state.findIndex(s => s.chainId === dst.chainId);
        if (srcIdx >= 0) {
          state[srcIdx].balanceWei -= amountWei;
          state[srcIdx].deltaWei = state[srcIdx].balanceWei - state[srcIdx].targetWei;
        }
        if (dstIdx >= 0) {
          state[dstIdx].balanceWei += outputAmount;
          state[dstIdx].deltaWei = state[dstIdx].balanceWei - state[dstIdx].targetWei;
        }

        ops += 1;
      }
    }

    // After optional bridging, sweep remaining surplus down near target.
    // Important: don't be too precise — leave a buffer so we don't waste gas trimming dust.
    for (const s of state) {
      const chainLogp = `${logp}[chainId=${s.chainId}]`;
      try {
        const chain = getChain(s.chainId, s.rpcUrl);
        const publicClient = createPublicClient({ chain, transport: http(s.rpcUrl) });
        const paymasterWallet = createWalletClient({ chain, transport: http(s.rpcUrl), account: paymasterAccount });

        const balanceBeforeWei = await publicClient.getBalance({ address: paymasterAccount.address });
        const targetWei = s.targetWei;
        // Sweep buffer: keep max(2% of target, 0.0002 ETH) above target to avoid dust-churn.
        const sweepBufferWei = (() => {
          const pct = targetWei / 50n; // 2%
          const min = parseEther("0.0002");
          return pct > min ? pct : min;
        })();

        let sweepTxHash: Hex | null = null;
        if (balanceBeforeWei > targetWei) {
          const fees = await publicClient.estimateFeesPerGas().catch(() => null);
          const maxFeePerGas = fees?.maxFeePerGas ?? (await publicClient.getGasPrice());
          const maxPriorityFeePerGas = fees?.maxPriorityFeePerGas ?? 0n;
          const gas = 21_000n;
          const txCost = (gas * maxFeePerGas * BigInt(10_000 + gasBufferBps)) / 10_000n;
          // Only sweep if we're meaningfully above target + buffer + tx cost.
          const sweepToWei = targetWei + sweepBufferWei;
          const maxSweepValue = balanceBeforeWei > sweepToWei + txCost ? balanceBeforeWei - sweepToWei - txCost : 0n;
          if (maxSweepValue > 0n && execute) {
            sweepTxHash = await paymasterWallet.sendTransaction({
              to: sweepAddress,
              value: maxSweepValue,
              gas,
              maxFeePerGas,
              maxPriorityFeePerGas,
            });
            await publicClient.waitForTransactionReceipt({ hash: sweepTxHash });
          }
        }

        const balanceAfterWei = await publicClient.getBalance({ address: paymasterAccount.address });
        results[s.chainId] = {
          ok: true,
          chainId: s.chainId,
          rpcUrl: s.rpcUrl,
          paymaster: paymasterAccount.address,
          sweepAddress,
          execute,
          targetWei,
          balanceBeforeWei,
          balanceAfterWei,
          deltaAfterWei: balanceAfterWei - targetWei,
          sweepTxHash,
        };
      } catch (e: any) {
        console.warn(chainLogp, "error", safeErr(e));
        results[s.chainId] = { ok: false, chainId: s.chainId, error: safeErr(e) };
      }
    }

    return NextResponse.json(
      jsonSafe({
        ok: Object.values(results).every((r: any) => r?.ok),
        execute,
        paymaster: paymasterAccount.address,
        sweepAddress,
        bridges: bridgeOps,
        results,
      }),
    );
  } catch (e: any) {
    console.error(logp, "fatal", safeErr(e));
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad request" }, { status: 400 });
  }
}
