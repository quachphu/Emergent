import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useSteps } from "@/lib/queries";
import type { Lane } from "@/lib/types";
import { SectionTitle } from "./common";
import { StepTimeline } from "./StepTimeline";

export function LaneSteps({ lane, limit = 12 }: { lane: Lane; limit?: number }) {
  const steps = useSteps({ lane });
  return (
    <Card className="p-5">
      <SectionTitle>Agent steps</SectionTitle>
      {steps.isLoading ? <Skeleton className="h-32" /> : <StepTimeline steps={(steps.data || []).slice(-limit)} newestFirst showLane={false} />}
    </Card>
  );
}
