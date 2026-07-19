import { describe, it, expect, vi } from "vitest";
import { normalizeEmail, resolveOrInviteBuyer, recordPendingLink } from "@/lib/hotmart/buyer-linking.server";

function makeFakeSupabase(opts: {
  existingUser?: { id: string } | null;
  lookupError?: { message: string } | null;
  inviteUser?: { id: string } | null;
  inviteError?: { message: string } | null;
  pendingLinkError?: { message: string } | null;
}) {
  const insertCalls: unknown[] = [];
  return {
    _insertCalls: insertCalls,
    from(table: string) {
      if (table === "users") {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => ({
                data: opts.existingUser && !opts.lookupError ? opts.existingUser : null,
                error: opts.lookupError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === "hotmart_pending_links") {
        return {
          insert: async (row: unknown) => {
            insertCalls.push(row);
            return { error: opts.pendingLinkError ?? null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({
          data: opts.inviteUser ? { user: opts.inviteUser } : null,
          error: opts.inviteError ?? null,
        }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Buyer@Example.COM  ")).toBe("buyer@example.com");
  });
});

describe("resolveOrInviteBuyer", () => {
  it("returns the existing user without inviting when an exact email match exists", async () => {
    const supabase = makeFakeSupabase({ existingUser: { id: "user-1" } });
    const inviteSpy = vi.spyOn(supabase.auth.admin, "inviteUserByEmail");
    const result = await resolveOrInviteBuyer(supabase, "user@example.com");
    expect(result).toEqual({ userId: "user-1", isNewUser: false });
    expect(inviteSpy).not.toHaveBeenCalled();
  });

  it("invites a new user (no password ever generated) when no existing account matches", async () => {
    const supabase = makeFakeSupabase({ existingUser: null, inviteUser: { id: "new-user-1" } });
    const result = await resolveOrInviteBuyer(supabase, "new@example.com");
    expect(result).toEqual({ userId: "new-user-1", isNewUser: true });
  });

  it("normalizes the email before both the lookup and the invite", async () => {
    const supabase = makeFakeSupabase({ existingUser: null, inviteUser: { id: "new-user-1" } });
    const inviteSpy = vi.spyOn(supabase.auth.admin, "inviteUserByEmail");
    await resolveOrInviteBuyer(supabase, "  Mixed.Case@Example.COM ");
    expect(inviteSpy).toHaveBeenCalledWith("mixed.case@example.com");
  });

  it("throws (never silently succeeds) when the lookup itself errors", async () => {
    const supabase = makeFakeSupabase({ lookupError: { message: "db down" } });
    await expect(resolveOrInviteBuyer(supabase, "user@example.com")).rejects.toThrow(/buyer lookup failed/);
  });

  it("throws when the invite call fails, so the caller can fall back to a pending link", async () => {
    const supabase = makeFakeSupabase({ existingUser: null, inviteError: { message: "auth unreachable" } });
    await expect(resolveOrInviteBuyer(supabase, "user@example.com")).rejects.toThrow(/buyer invite failed/);
  });
});

describe("recordPendingLink", () => {
  it("inserts a normalized-email pending link row", async () => {
    const supabase = makeFakeSupabase({});
    await recordPendingLink(supabase, {
      hotmartEventId: "event-1",
      buyerEmail: " Someone@Example.COM ",
      transactionId: "TXN-1",
      subscriptionId: null,
      productId: "PROD-1",
      offerId: "OFFER-1",
    });
    expect(supabase._insertCalls).toEqual([
      {
        hotmart_event_id: "event-1",
        buyer_email: "someone@example.com",
        transaction_id: "TXN-1",
        subscription_id: null,
        product_id: "PROD-1",
        offer_id: "OFFER-1",
      },
    ]);
  });

  it("throws when the insert fails", async () => {
    const supabase = makeFakeSupabase({ pendingLinkError: { message: "insert failed" } });
    await expect(
      recordPendingLink(supabase, {
        hotmartEventId: "event-1",
        buyerEmail: "x@example.com",
        transactionId: null,
        subscriptionId: null,
        productId: null,
        offerId: null,
      }),
    ).rejects.toThrow(/recording pending link failed/);
  });
});
