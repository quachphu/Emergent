import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, post } from "./api";
import type {
  Config,
  Doc,
  Item,
  Job,
  Listing,
  Match,
  Move,
  Room,
  Run,
  Step,
  Summary,
  Task,
  Vendor,
} from "./types";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => api<Config>("/config"), staleTime: 60_000 });
export const useMove = () => useQuery({ queryKey: ["move"], queryFn: () => api<Move>("/moves/current") });
export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/moves/current/summary") });
export const useItems = () => useQuery({ queryKey: ["items"], queryFn: () => api<Item[]>("/items") });
export const useRooms = () => useQuery({ queryKey: ["rooms"], queryFn: () => api<Room[]>("/rooms") });
export const useTasks = (lane?: string) =>
  useQuery({ queryKey: ["tasks", lane ?? "all"], queryFn: () => api<Task[]>(`/tasks${lane ? `?lane=${lane}` : ""}`) });
export const useSteps = (params: { lane?: string; run_id?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ["steps", qs], queryFn: () => api<Step[]>(`/steps${qs ? `?${qs}` : ""}`) });
};
export const useRun = () => useQuery({ queryKey: ["run"], queryFn: () => api<Run | null>("/runs/current") });
export const useInbox = () =>
  useQuery({ queryKey: ["inbox"], queryFn: () => api<{ waiting: Step[]; requests: any[]; messages: any[] }>("/inbox") });
export const useListings = () => useQuery({ queryKey: ["listings"], queryFn: () => api<Listing[]>("/listings") });
export const useMatches = () => useQuery({ queryKey: ["matches"], queryFn: () => api<Match[]>("/matches") });
export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/jobs") });
export const useVendors = () => useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/vendors") });
export const useDocuments = () =>
  useQuery({ queryKey: ["documents"], queryFn: () => api<{ documents: Doc[]; notice: string; reminders: any[] }>("/documents") });

/** Invalidate everything the agents can change. Cheap: queries refetch only when mounted. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({
      predicate: (q) => !["config"].includes(q.queryKey[0] as string),
    });
}

export function useAction<TArgs = void, TOut = any>(
  fn: (args: TArgs) => Promise<TOut>,
  opts: { success?: string | ((out: TOut) => string | undefined); onSuccess?: (out: TOut) => void } = {},
) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      const msg = typeof opts.success === "function" ? opts.success(out) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(out);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "That didn't work. Try again."),
  });
}

export const approveStep = (id: string, message?: string) => post<Step>(`/steps/${id}/approve`, message ? { message } : {});
