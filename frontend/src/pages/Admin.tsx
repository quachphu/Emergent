import { PageHeader } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { laneMeta } from "@/lib/format";

export default function Admin() {
  const meta = laneMeta("admin");
  return (
    <div className="space-y-8">
      <PageHeader emoji={meta.emoji} title={meta.label} subtitle={meta.blurb} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <LanePlan lane="admin" />
        <LaneSteps lane="admin" />
      </div>
    </div>
  );
}
