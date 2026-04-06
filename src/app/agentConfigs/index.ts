import { emailTriageScenario } from "./emailTriage";

import type { RealtimeAgent } from "@openai/agents/realtime";

export const allAgentSets: Record<string, RealtimeAgent[]> = {
  emailTriage: emailTriageScenario,
};

export const defaultAgentSetKey = "emailTriage";
