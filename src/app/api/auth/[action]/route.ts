import { type NextRequest } from "next/server";
import { authHandler } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  return authHandler(req, (await params).action);
}
export const POST = GET;
