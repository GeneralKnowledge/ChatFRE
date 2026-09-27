import { describe, expect, it } from "vitest";
import {
  createEmptyRuntimeState,
  recordSuccess,
  recordFailure,
  beginRequest,
} from "@/server/llm/scheduler/runtime-state";

describe("Provider runtime state", () => {
  it("tracks requests and resets consecutive failures on success", () => {
    let state = createEmptyRuntimeState("groq");
    state = beginRequest(state);
    expect(state.activeRequests).toBe(1);
    state = recordFailure(state);
    expect(state.consecutiveFailures).toBe(1);
    state = beginRequest(state);
    state = recordSuccess(state, 100);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.requestsToday).toBe(1);
    expect(state.tokensToday).toBe(100);
  });
});
