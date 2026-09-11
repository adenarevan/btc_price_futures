import { notFound } from "next/navigation";
import { guardPage } from "@/lib/auth";
import { Workspace } from "@/components/workspace";
const sections = [
  "dashboard",
  "signals",
  "positions",
  "journal",
  "evaluation",
  "settings",
  "system",
] as const;
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.some((s) => s === section)) notFound();
  await guardPage();
  return <Workspace section={section} />;
}
