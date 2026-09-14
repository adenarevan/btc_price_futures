import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardRequest, verifyMutation, rateLimit } from "@/lib/auth";
import { AppError, ConfigurationError, safeError } from "@/lib/errors";
import * as service from "@/lib/services";
import { symbolSchema, displayQuote } from "@/lib/market";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ route: string[] }> },
) {
  const requestId = randomUUID();
  try {
    const segments = (await params).route,
      path = segments.join("/"),
      owner = await guardRequest(req, path === "me");
    const mutation = req.method !== "GET";
    if (mutation) verifyMutation(req);
    const key = req.headers.get("idempotency-key") ?? "";
    const query = req.nextUrl.searchParams;
    const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(25)
        .parse(query.get("limit") ?? 25),
      cursor = query.get("cursor") ?? undefined;
    const options = { limit, ...(cursor ? { cursor } : {}) };
    let data: unknown;
    if (!mutation) {
      if (path === "me")
        data = {
          username: "admin",
          role: owner.role,
          mustChangePassword: owner.passwordChangeRequired,
        };
      else if (path === "dashboard")
        data = await service.readDashboard(owner.uid);
      else if (path === "market") {
        data = await Promise.all(symbolSchema.options.map(async (symbol) => {
          try { return { ...await displayQuote(symbol), error: null }; }
          catch (error) { return { symbol, error: safeError(error).code }; }
        }));
      } else if (path === "manual-positions/preview") {
        const input = z.object({ symbol: symbolSchema, side: z.enum(["LONG", "SHORT"]) })
          .parse({ symbol: query.get("symbol"), side: query.get("side") });
        data = await service.previewManualPosition(owner.uid, input);
      } else if (path === "signals") {
        const symbol = query.get("symbol"),
          decision = query.get("decision");
        if (symbol && decision) throw new AppError("ONE_FILTER_ONLY");
        const filter: [string, string] | undefined = symbol
          ? ["symbol", symbolSchema.parse(symbol)]
          : decision
            ? [
                "decision",
                z
                  .enum(["LONG_CANDIDATE", "SHORT_CANDIDATE", "WAIT"])
                  .parse(decision),
              ]
            : undefined;
        data = await service.listSignals(owner.uid, {
          ...options,
          ...(filter ? { filter } : {}),
        });
      } else if (segments[0] === "signals" && segments.length === 2)
        data = await service.getSignal(owner.uid, segments[1]!);
      else if (path === "positions")
        data = await service.listPositions(owner.uid, options);
      else if (path === "settings") data = await service.getSettings(owner.uid);
      else if (path === "journal")
        data = await service.getJournal(owner.uid, options);
      else if (path === "journal/export")
        return new NextResponse(
          await service.exportJournal(
            owner.uid,
            Number(query.get("from")),
            Number(query.get("to")),
          ),
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="sinyallab-journal.csv"',
              "Cache-Control": "no-store",
            },
          },
        );
      else if (path === "evaluations")
        data = await service.listEvaluations(owner.uid);
      else if (segments[0] === "evaluations" && segments.length === 2)
        data = await service.getEvaluation(owner.uid, segments[1]!);
      else if (path === "system/runs")
        data = await service.listRuns(owner.uid, options);
      else if (path === "system/health")
        data = {
          database: (await service.getSettings(owner.uid))
            ? "CONNECTED"
            : "UNAVAILABLE",
          provider: "NOT_CHECKED",
          model: "NOT_CHECKED",
          automation: "MANUAL",
          strategyEvaluation: "NOT_TESTED",
        };
      else throw new AppError("NOT_FOUND", 404);
    } else {
      if (Number(req.headers.get("content-length") ?? 0) > 16384)
        throw new AppError("INPUT_TOO_LARGE", 413);
      const text = await req.text();
      if (text.length > 16384) throw new AppError("INPUT_TOO_LARGE", 413);
      const body: unknown = text ? JSON.parse(text) : {};
      if (path === "analysis" && req.method === "POST") {
        try { await rateLimit(req, `analysis-${owner.uid}`, 5, 5, 60000); }
        catch (error) { if (error instanceof AppError && error.code === "LOGIN_RATE_LIMITED") throw new AppError("ANALYSIS_RATE_LIMITED", 429, true); throw error; }
        const b = z.object({ symbol: symbolSchema }).strict().parse(body);
        data = await service.analyze(owner.uid, b.symbol);
      } else if (path === "positions" && req.method === "POST") {
        const b = z
          .object({
            signalId: z.string().max(128),
            leverage: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(5),
            ]),
          })
          .strict()
          .parse(body);
        data = await service.openPosition(
          owner.uid,
          b.signalId,
          b.leverage,
          key,
        );
      } else if (path === "manual-positions" && req.method === "POST") {
        const b = z
          .object({ symbol: symbolSchema, side: z.enum(["LONG", "SHORT"]) })
          .strict()
          .parse(body);
        data = await service.openManualPosition(owner.uid, b, key);
      } else if (path === "positions/refresh" && req.method === "POST")
        data = await service.refreshPositions(owner.uid);
      else if (path === "positions/auto-exit" && req.method === "POST")
        data = await service.refreshPositions(owner.uid, true);
      else if (
        segments[0] === "positions" &&
        segments[2] === "close" &&
        segments.length === 3 &&
        req.method === "POST"
      )
        data = await service.closePosition(owner.uid, segments[1]!, key);
      else if (path === "settings" && req.method === "PATCH")
        data = await service.updateSettings(owner.uid, body);
      else throw new AppError("NOT_FOUND", 404);
    }
    return NextResponse.json(
      { data, meta: { requestId, generatedAt: Date.now(), cached: false } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const e = safeError(error);
    if (e.code === "SERVICE_UNAVAILABLE" || !(error instanceof AppError)) {
      console.error("API Error in [...route]:", error);
    }
    return NextResponse.json(
      {
        error: { code: e.code, message: e.code, retryable: e.retryable, ...(e instanceof ConfigurationError ? { fields: e.fields } : {}) },
        meta: { requestId },
      },
      {
        status: e.status,
        headers: {
          "Cache-Control": "no-store",
          ...(e.status === 429 ? { "Retry-After": "60" } : {}),
        },
      },
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
