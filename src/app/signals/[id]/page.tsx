import { guardPage } from "@/lib/auth";
import { Workspace } from "@/components/workspace";
export default async function SignalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await guardPage();
  return <Workspace section="signal-detail" id={(await params).id} />;
}
