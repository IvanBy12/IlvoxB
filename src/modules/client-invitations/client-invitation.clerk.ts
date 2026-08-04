import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { ClerkInvitationGateway, VerifiedClerkUser } from "./client-invitation.types.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function verifiedEmails(user: Awaited<ReturnType<ClerkClient["users"]["getUser"]>>): string[] {
  return user.emailAddresses
    .filter((item) => item.verification?.status === "verified")
    .map((item) => normalizeEmail(item.emailAddress));
}

export class OfficialClerkInvitationGateway implements ClerkInvitationGateway {
  private readonly client: ClerkClient;

  constructor(secretKey: string) {
    this.client = createClerkClient({ secretKey });
  }

  async findVerifiedUserByEmail(normalizedEmail: string): Promise<VerifiedClerkUser | null> {
    const response = await this.client.users.getUserList({
      emailAddress: [normalizedEmail],
      limit: 10,
    });
    const exact = response.data
      .map((user) => ({ user, emails: verifiedEmails(user) }))
      .filter(({ emails }) => emails.includes(normalizedEmail));
    if (exact.length === 0) return null;
    if (exact.length > 1) throw new Error("Multiple Clerk identities share the verified email");
    return { clerkUserId: exact[0]!.user.id, verifiedEmails: exact[0]!.emails };
  }

  async getVerifiedEmails(clerkUserId: string): Promise<readonly string[]> {
    return verifiedEmails(await this.client.users.getUser(clerkUserId));
  }

  async createInvitation(input: {
    readonly email: string;
    readonly redirectUrl: string;
    readonly expiresInDays: number;
  }): Promise<{ readonly id: string }> {
    const invitation = await this.client.invitations.createInvitation({
      emailAddress: input.email,
      expiresInDays: input.expiresInDays,
      ignoreExisting: false,
      notify: true,
      redirectUrl: input.redirectUrl,
    });
    return { id: invitation.id };
  }

  async revokeInvitation(clerkInvitationId: string): Promise<void> {
    try {
      await this.client.invitations.revokeInvitation(clerkInvitationId);
    } catch (error) {
      if (!isClerkAPIResponseError(error)) throw error;
      const revoked = await this.client.invitations.getInvitationList({
        query: clerkInvitationId,
        status: "revoked",
        limit: 10,
      });
      if (revoked.data.some((invitation) => invitation.id === clerkInvitationId)) return;
      throw error;
    }
  }
}
