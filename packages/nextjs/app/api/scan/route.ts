import { NextResponse } from "next/server";
import { rateLimit } from "~~/utils/recovery/rateLimit";
import { requireAddress, requireObject } from "~~/utils/recovery/validation";
import { fetchZerionScanData } from "~~/utils/recovery/zerion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rl = rateLimit({ key: `scan:${ip}`, limit: 20, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const body = requireObject(await req.json().catch(() => ({})));
    const compromisedAddress = requireAddress(body.compromisedAddress, "compromisedAddress");
    const chainIds = Array.isArray(body.chainIds)
      ? body.chainIds.filter((x): x is number => typeof x === "number")
      : undefined;

    const { assets, positionsView, nfts } = await fetchZerionScanData({ compromisedAddress, chainIds });

    return NextResponse.json({
      compromisedAddress,
      assets,
      positionsView,
      nfts,
      manualSchema: {
        standard: ["erc20", "erc721", "erc1155"],
        fields: ["chainId", "standard", "contract", "tokenId?", "amount?"],
        notes: "For MVP, amounts/tokenIds are treated as raw integer strings. Use manual add for local assets.",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
