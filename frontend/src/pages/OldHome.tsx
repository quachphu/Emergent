import { PageHeader } from "@/components/common";
import { LanePlan } from "@/components/LanePlan";
import { LaneSteps } from "@/components/LaneSteps";
import { laneMeta } from "@/lib/format";

export default function OldHome() {
  const meta = laneMeta("old_home");
  return (
    <div className="space-y-8">
      <PageHeader emoji={meta.emoji} title={meta.label} subtitle={meta.blurb} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <LanePlan lane="old_home" />
        <LaneSteps lane="old_home" />
      </div>
    </div>
  );
}
