/**
 * Org Service (S-7.1, S-7.2)
 *
 * Manages organizations, memberships, and invitations.
 * Used by dashboard routes for org switching and team management.
 */

import type { MigrationClient } from './migrate.js';
import { generateToken, hashToken } from './auth/tokens.js';

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
}

export interface OrgMember {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface OrgInvitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
  invited_by: string;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
}

export class OrgServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'OrgServiceError';
  }
}

export class OrgService {
  constructor(private db: MigrationClient) {}

  // ═══════════════════════════════════════════
  // Org CRUD (S-7.1)
  // ═══════════════════════════════════════════

  /** List orgs the user belongs to */
  async listUserOrgs(userId: string): Promise<Org[]> {
    const result = await this.db.query(
      `SELECT o.id, o.name, o.slug, o.plan, o.created_at
       FROM orgs o
       JOIN org_members om ON om.org_id = o.id
       WHERE om.user_id = $1
       ORDER BY o.name`,
      [userId],
    );
    return result.rows as Org[];
  }

  /** Create a new org and make the user the owner */
  async createOrg(userId: string, name: string): Promise<Org> {
    if (!name || name.trim().length === 0) {
      throw new OrgServiceError('invalid_name', 'Organization name is required');
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).slice(2, 8);

    const result = await this.db.query(
      `INSERT INTO orgs (name, slug) VALUES ($1, $2) RETURNING id, name, slug, plan, created_at`,
      [name.trim(), slug],
    );
    const org = (result.rows as Org[])[0];

    await this.db.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [org.id, userId],
    );

    return org;
  }

  // ═══════════════════════════════════════════
  // Team Management (S-7.2)
  // ═══════════════════════════════════════════

  /** List members of an org */
  async listMembers(orgId: string): Promise<OrgMember[]> {
    const result = await this.db.query(
      `SELECT om.user_id, u.email, u.display_name, u.avatar_url, om.role, om.joined_at
       FROM org_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1
       ORDER BY om.joined_at`,
      [orgId],
    );
    return result.rows as OrgMember[];
  }

  /** Invite a user by email */
  async inviteMember(
    orgId: string,
    invitedByUserId: string,
    email: string,
    role: 'admin' | 'member' | 'viewer',
  ): Promise<{ invitation: OrgInvitation; token: string }> {
    // Check if already a member
    const existing = await this.db.query(
      `SELECT 1 FROM org_members om JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1 AND u.email = $2`,
      [orgId, email],
    );
    if ((existing.rows as any[]).length > 0) {
      throw new OrgServiceError('already_member', 'This user is already a member of the organization');
    }

    // Check for existing pending invitation
    const pendingInv = await this.db.query(
      `SELECT 1 FROM org_invitations
       WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > now()`,
      [orgId, email],
    );
    if ((pendingInv.rows as any[]).length > 0) {
      throw new OrgServiceError('already_invited', 'An invitation is already pending for this email');
    }

    const token = generateToken();
    const tokenHash = hashToken(token);

    const result = await this.db.query(
      `INSERT INTO org_invitations (org_id, email, role, invited_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')
       RETURNING id, org_id, email, role, invited_by, expires_at, created_at`,
      [orgId, email, role, invitedByUserId, tokenHash],
    );
    const invitation = (result.rows as any[])[0];

    // Get inviter name
    const inviterResult = await this.db.query(
      `SELECT display_name FROM users WHERE id = $1`,
      [invitedByUserId],
    );
    invitation.invited_by_name = (inviterResult.rows as any[])[0]?.display_name ?? null;

    return { invitation, token };
  }

  /** Accept an invitation by token */
  async acceptInvitation(token: string, userId: string): Promise<{ orgId: string; role: string }> {
    const tokenHash = hashToken(token);
    const result = await this.db.query(
      `SELECT id, org_id, email, role FROM org_invitations
       WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    if ((result.rows as any[]).length === 0) {
      throw new OrgServiceError('invalid_invitation', 'Invalid or expired invitation', 404);
    }

    const inv = (result.rows as any[])[0];

    // Mark accepted
    await this.db.query(
      `UPDATE org_invitations SET accepted_at = now() WHERE id = $1`,
      [inv.id],
    );

    // Add membership
    await this.db.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [inv.org_id, userId, inv.role],
    );

    return { orgId: inv.org_id, role: inv.role };
  }

  /** List pending invitations for an org */
  async listInvitations(orgId: string): Promise<OrgInvitation[]> {
    const result = await this.db.query(
      `SELECT i.id, i.org_id, i.email, i.role, i.invited_by,
              u.display_name as invited_by_name, i.expires_at, i.created_at
       FROM org_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
       ORDER BY i.created_at DESC`,
      [orgId],
    );
    return result.rows as OrgInvitation[];
  }

  /** Cancel a pending invitation */
  async cancelInvitation(orgId: string, invitationId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM org_invitations
       WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL
       RETURNING id`,
      [invitationId, orgId],
    );
    return (result.rows as any[]).length > 0;
  }

  /** Change a member's role */
  async changeMemberRole(
    orgId: string,
    targetUserId: string,
    newRole: string,
    actorRole: string,
  ): Promise<void> {
    // Only owner can set owner role
    if (newRole === 'owner' && actorRole !== 'owner') {
      throw new OrgServiceError('forbidden', 'Only the owner can transfer ownership', 403);
    }

    // Can't change the role of the sole owner
    if (newRole !== 'owner') {
      const currentRole = await this.db.query(
        `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
        [orgId, targetUserId],
      );
      if ((currentRole.rows as any[])[0]?.role === 'owner') {
        // Check there's another owner
        const ownerCount = await this.db.query(
          `SELECT COUNT(*) as cnt FROM org_members WHERE org_id = $1 AND role = 'owner'`,
          [orgId],
        );
        if (parseInt((ownerCount.rows as any[])[0].cnt) <= 1) {
          throw new OrgServiceError('last_owner', 'Cannot change role of the only owner. Transfer ownership first.', 400);
        }
      }
    }

    await this.db.query(
      `UPDATE org_members SET role = $1 WHERE org_id = $2 AND user_id = $3`,
      [newRole, orgId, targetUserId],
    );
  }

  /** Remove a member from org */
  async removeMember(orgId: string, targetUserId: string): Promise<void> {
    // Can't remove the sole owner
    const currentRole = await this.db.query(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, targetUserId],
    );
    if ((currentRole.rows as any[])[0]?.role === 'owner') {
      const ownerCount = await this.db.query(
        `SELECT COUNT(*) as cnt FROM org_members WHERE org_id = $1 AND role = 'owner'`,
        [orgId],
      );
      if (parseInt((ownerCount.rows as any[])[0].cnt) <= 1) {
        throw new OrgServiceError('last_owner', 'Cannot remove the only owner', 400);
      }
    }

    await this.db.query(
      `DELETE FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, targetUserId],
    );
  }

  /** Transfer ownership to another member */
  async transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void> {
    // Verify from is owner
    const fromRole = await this.db.query(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, fromUserId],
    );
    if ((fromRole.rows as any[])[0]?.role !== 'owner') {
      throw new OrgServiceError('not_owner', 'Only the owner can transfer ownership', 403);
    }

    // Verify target is a member
    const toMember = await this.db.query(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
      [orgId, toUserId],
    );
    if ((toMember.rows as any[]).length === 0) {
      throw new OrgServiceError('not_member', 'Target user is not a member of this organization', 400);
    }

    // Transfer: demote current owner to admin, promote target to owner
    await this.db.query(
      `UPDATE org_members SET role = 'admin' WHERE org_id = $1 AND user_id = $2`,
      [orgId, fromUserId],
    );
    await this.db.query(
      `UPDATE org_members SET role = 'owner' WHERE org_id = $1 AND user_id = $2`,
      [orgId, toUserId],
    );
  }
}
