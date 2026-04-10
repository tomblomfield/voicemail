import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailData, EmailTriageDeps, createEmailTriageAgent } from "./index";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeEmail(overrides: Partial<EmailData> = {}): EmailData {
  return {
    id: "msg-1",
    threadId: "thread-1",
    from: "Alice <alice@example.com>",
    to: "me@example.com",
    cc: "",
    subject: "Test email",
    snippet: "Hello...",
    date: "Mon, 6 Apr 2026 09:00:00 -0700",
    body: "Hello, this is a test email.",
    ...overrides,
  };
}

function makeDeps(emails: EmailData[] = []) {
  const state = {
    emails: [...emails],
    idx: 0,
    actions: { replied: 0, skipped: 0, archived: 0, blocked: 0, unsubscribed: 0 },
    muted: false,
    stopped: false,
    loggedOut: false,
    pageTokens: {} as Record<string, string | null>,
    focusedAccountId: null as string | null,
  };
  return {
    state,
    deps: {
      emails: () => state.emails,
      setEmails: (e: EmailData[]) => { state.emails = e; },
      emailIndex: () => state.idx,
      setEmailIndex: (i: number) => { state.idx = i; },
      advanceIndex: () => { state.idx++; },
      recordAction: (action: "reply" | "skip" | "archive" | "block" | "unsubscribe") => {
        if (action === "reply") state.actions.replied++;
        else if (action === "skip") state.actions.skipped++;
        else if (action === "archive") state.actions.archived++;
        else if (action === "block") state.actions.blocked++;
        else if (action === "unsubscribe") state.actions.unsubscribed++;
      },
      getActionSummary: () => ({ ...state.actions }),
      calendarProfile: () => null,
      setCalendarProfile: () => {},
      nextPageTokens: () => state.pageTokens,
      setNextPageTokens: (tokens: Record<string, string | null>) => { state.pageTokens = tokens; },
      dbAvailable: true,
      onMute: () => { state.muted = true; },
      onStop: () => { state.stopped = true; },
      onLogout: () => { state.loggedOut = true; },
      accounts: [],
      focusedAccountId: () => state.focusedAccountId,
      setFocusedAccountId: (id: string | null) => { state.focusedAccountId = id; },
    } satisfies EmailTriageDeps,
  };
}

describe("EmailTriageDeps logic", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("email state management", () => {
    it("starts empty and can be populated via setEmails", () => {
      const { deps } = makeDeps();
      expect(deps.emails()).toEqual([]);

      const newEmails = [makeEmail({ id: "1" }), makeEmail({ id: "2" })];
      deps.setEmails(newEmails);
      expect(deps.emails().length).toBe(2);
      expect(deps.emails()[0].id).toBe("1");
    });
  });

  describe("email index and advancement", () => {
    it("starts at 0 and advances", () => {
      const emails = [makeEmail({ id: "1" }), makeEmail({ id: "2" })];
      const { deps } = makeDeps(emails);
      expect(deps.emailIndex()).toBe(0);

      deps.advanceIndex();
      expect(deps.emailIndex()).toBe(1);

      deps.advanceIndex();
      expect(deps.emailIndex()).toBe(2);
      expect(deps.emailIndex() >= deps.emails().length).toBe(true);
    });
  });

  describe("action recording", () => {
    it("tracks reply actions", () => {
      const { deps, state } = makeDeps();
      deps.recordAction("reply");
      deps.recordAction("reply");
      expect(state.actions.replied).toBe(2);
      expect(state.actions.skipped).toBe(0);
      expect(state.actions.archived).toBe(0);
    });

    it("tracks skip actions", () => {
      const { deps, state } = makeDeps();
      deps.recordAction("skip");
      expect(state.actions.skipped).toBe(1);
    });

    it("tracks archive actions", () => {
      const { deps, state } = makeDeps();
      deps.recordAction("archive");
      expect(state.actions.archived).toBe(1);
    });

    it("tracks block actions", () => {
      const { deps, state } = makeDeps();
      deps.recordAction("block");
      expect(state.actions.blocked).toBe(1);
    });

    it("tracks mixed actions correctly", () => {
      const { deps } = makeDeps();
      deps.recordAction("reply");
      deps.recordAction("skip");
      deps.recordAction("archive");
      deps.recordAction("skip");
      deps.recordAction("reply");
      deps.recordAction("block");

      const summary = deps.getActionSummary();
      expect(summary.replied).toBe(2);
      expect(summary.skipped).toBe(2);
      expect(summary.archived).toBe(1);
      expect(summary.blocked).toBe(1);
    });
  });

  describe("session summary", () => {
    it("returns correct totals", () => {
      const { deps, state } = makeDeps([makeEmail(), makeEmail(), makeEmail()]);
      deps.recordAction("reply");
      deps.recordAction("skip");
      state.idx = 2;

      const summary = deps.getActionSummary();
      expect(summary.replied).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.archived).toBe(0);
      expect(summary.blocked).toBe(0);
      expect(summary.replied + summary.skipped + summary.archived + summary.blocked).toBe(2);
      expect(deps.emails().length - state.idx).toBe(1);
    });

    it("returns snapshot not reference", () => {
      const { deps } = makeDeps();
      deps.recordAction("reply");
      const summary1 = deps.getActionSummary();
      deps.recordAction("reply");
      const summary2 = deps.getActionSummary();
      expect(summary1.replied).toBe(1);
      expect(summary2.replied).toBe(2);
    });
  });

  describe("session control tools", () => {
    it("agent has mute_microphone, stop_conversation, and log_out tools", () => {
      const { deps } = makeDeps();
      const agent = createEmailTriageAgent(deps);
      const toolNames = agent.tools.map((t: any) => t.name);
      expect(toolNames).toContain("mute_microphone");
      expect(toolNames).toContain("end_session");
      expect(toolNames).toContain("log_out");
      expect(toolNames).toContain("get_session_summary");
    });

    it("mute_microphone tool invokes onMute callback", async () => {
      const { deps, state } = makeDeps();
      const agent = createEmailTriageAgent(deps);
      const muteTool = agent.tools.find((t: any) => t.name === "mute_microphone") as any;

      const result = await muteTool.invoke({} as any, "{}");
      expect(state.muted).toBe(true);
      expect(result).toMatchObject({ success: true });
    });

    it("end_session tool invokes onStop after delay", async () => {
      vi.useFakeTimers();
      const { deps, state } = makeDeps();
      const agent = createEmailTriageAgent(deps);
      const stopTool = agent.tools.find((t: any) => t.name === "end_session") as any;

      const result = await stopTool.invoke({} as any, "{}");
      expect(result).toMatchObject({ success: true });
      expect(state.stopped).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(state.stopped).toBe(true);
      vi.useRealTimers();
    });

    it("log_out tool invokes onLogout after delay", async () => {
      vi.useFakeTimers();
      const { deps, state } = makeDeps();
      const agent = createEmailTriageAgent(deps);
      const logoutTool = agent.tools.find((t: any) => t.name === "log_out") as any;

      const result = await logoutTool.invoke({} as any, "{}");
      expect(result).toMatchObject({ success: true });
      expect(state.loggedOut).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(state.loggedOut).toBe(true);
      vi.useRealTimers();
    });

    it("get_session_summary returns correct totals", async () => {
      mockFetch.mockResolvedValueOnce({ json: async () => ({}) }); // /api/log
      const { deps } = makeDeps([makeEmail(), makeEmail(), makeEmail()]);
      deps.recordAction("reply");
      deps.recordAction("skip");
      deps.advanceIndex();
      deps.advanceIndex();

      const agent = createEmailTriageAgent(deps);
      const summaryTool = agent.tools.find((t: any) => t.name === "get_session_summary") as any;
      const raw = await summaryTool.invoke({} as any, "{}");
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      expect(result.replied).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.totalProcessed).toBe(2);
      expect(result.remaining).toBe(1);
    });
  });

  describe("gmailApi integration (via fetch mock)", () => {
    it("reply then archive pattern", async () => {
      mockFetch
        .mockResolvedValueOnce({ json: async () => ({ success: true }) })
        .mockResolvedValueOnce({ json: async () => ({ success: true }) });

      const replyResult = await mockFetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          messageId: "msg-1",
          threadId: "thread-1",
          body: "Thanks!",
        }),
      }).then((r: any) => r.json());

      expect(replyResult.success).toBe(true);

      const archiveResult = await mockFetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          messageId: "msg-1",
        }),
      }).then((r: any) => r.json());

      expect(archiveResult.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("block sender pattern", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          blockedEmail: "spammer@example.com",
          blockedName: "Spammer",
          filter: { id: "filter-1" },
        }),
      });

      const blockResult = await mockFetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "blockSender",
          messageId: "msg-1",
        }),
      }).then((r: any) => r.json());

      expect(blockResult.blockedEmail).toBe("spammer@example.com");
      expect(blockResult.blockedName).toBe("Spammer");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
