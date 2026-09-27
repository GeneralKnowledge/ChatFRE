import { nanoid } from "nanoid";
import type { QueueEntry, QueuePriority } from "../types";

const PRIORITY_WEIGHT: Record<QueuePriority, number> = {
  interactive: 0,
  normal: 1,
  background: 2,
};

export class RequestQueue {
  private entries: QueueEntry[] = [];

  enqueue(
    partial: Omit<QueueEntry, "id" | "createdAt" | "status"> & {
      id?: string;
      createdAt?: number;
      status?: QueueEntry["status"];
    },
  ): QueueEntry {
    const entry: QueueEntry = {
      id: partial.id ?? nanoid(),
      createdAt: partial.createdAt ?? Date.now(),
      priority: partial.priority,
      request: partial.request,
      deadline: partial.deadline,
      candidateProviders: partial.candidateProviders,
      status: partial.status ?? "queued",
      conversationId: partial.conversationId,
      resolve: partial.resolve,
      reject: partial.reject,
    };
    this.entries.push(entry);
    this.sort();
    return entry;
  }

  private sort(): void {
    this.entries.sort((a, b) => {
      const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pw !== 0) return pw;
      return a.createdAt - b.createdAt;
    });
  }

  peek(): QueueEntry | undefined {
    return this.entries.find((e) => e.status === "queued");
  }

  dequeue(): QueueEntry | undefined {
    const idx = this.entries.findIndex((e) => e.status === "queued");
    if (idx === -1) return undefined;
    const entry = this.entries[idx]!;
    entry.status = "running";
    return entry;
  }

  complete(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.status = "completed";
    this.entries = this.entries.filter(
      (e) => e.status === "queued" || e.status === "running",
    );
  }

  fail(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.status = "failed";
    this.entries = this.entries.filter(
      (e) => e.status === "queued" || e.status === "running",
    );
  }

  cancel(id: string): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    entry.status = "cancelled";
    this.entries = this.entries.filter((e) => e.id !== id);
    return true;
  }

  depth(): number {
    return this.entries.filter(
      (e) => e.status === "queued" || e.status === "running",
    ).length;
  }

  depthForProvider(providerId: string): number {
    return this.entries.filter(
      (e) =>
        (e.status === "queued" || e.status === "running") &&
        e.candidateProviders.includes(providerId),
    ).length;
  }

  list(): QueueEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
