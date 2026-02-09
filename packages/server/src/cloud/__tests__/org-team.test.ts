/**
 * Org & Team Tests (S-7.1, S-7.2)
 *
 * Unit tests for OrgService and route handlers.
 * Integration tests run when DATABASE_URL is set.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OrgService, OrgServiceError } from '../org-service.js';
import { createOrgRouteHandlers } from '../routes/org-routes.js';
import { AuthService } from '../auth/auth-service.js';
import { runMigrations, type MigrationClient } from '../migrate.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');
const DATABASE_URL = process.env.DATABASE_URL;

// ═══════════════════════════════════════════
// Unit Tests — OrgServiceError
// ═══════════════════════════════════════════

describe('S-7.1/S-7.2: OrgServiceError', () => {
  it('captures code, message, and statusCode', () => {
    const err = new OrgServiceError('test_code', 'test message', 422);
    expect(err.code).toBe('test_code');
    expect(err.message).toBe('test message');
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe('OrgServiceError');
  });

  it('defaults statusCode to 400', () => {
    const err = new OrgServiceError('bad', 'bad input');
    expect(err.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════
// Unit Tests — Route handler structure
// ═══════════════════════════════════════════

describe('S-7.1/S-7.2: Route handler creation', () => {
  it('createOrgRouteHandlers returns all expected handlers', () => {
    // Create with a mock db
    const mockDb = { query: async () => ({ rows: [] }) } as any;
    const handlers = createOrgRouteHandlers({ db: mockDb });

    expect(typeof handlers.listOrgs).toBe('function');
    expect(typeof handlers.createOrg).toBe('function');
    expect(typeof handlers.switchOrg).toBe('function');
    expect(typeof handlers.listMembers).toBe('function');
    expect(typeof handlers.listInvitations).toBe('function');
    expect(typeof handlers.inviteMember).toBe('function');
    expect(typeof handlers.cancelInvitation).toBe('function');
    expect(typeof handlers.changeMemberRole).toBe('function');
    expect(typeof handlers.removeMember).toBe('function');
    expect(typeof handlers.transferOwnership).toBe('function');
  });
});

// ═══════════════════════════════════════════
// Integration Tests (require DATABASE_URL)
// ═══════════════════════════════════════════

const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('S-7.1: Org Management (integration)', () => {
  let db: MigrationClient;
  let orgService: OrgService;
  let userId: string;

  beforeAll(async () => {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    db = {
      query: (text: string, params?: any[]) => pool.query(text, params),
      end: () => pool.end(),
    };
    await runMigrations(db, MIGRATIONS_DIR);
    orgService = new OrgService(db);

    // Create a test user
    const userResult = await db.query(
      `INSERT INTO users (email, email_verified, display_name)
       VALUES ($1, TRUE, $2) RETURNING id`,
      [`orgtest-${Date.now()}@test.com`, 'Test User'],
    );
    userId = (userResult.rows as any[])[0].id;
  });

  afterAll(async () => {
    if (db) await db.end!();
  });

  it('creates an org and makes user the owner', async () => {
    const org = await orgService.createOrg(userId, 'Test Org');
    expect(org.name).toBe('Test Org');
    expect(org.slug).toBeTruthy();
    expect(org.plan).toBe('free');

    // Verify membership
    const members = await orgService.listMembers(org.id);
    expect(members).toHaveLength(1);
    expect(members[0].user_id).toBe(userId);
    expect(members[0].role).toBe('owner');
  });

  it('lists user orgs', async () => {
    const orgs = await orgService.listUserOrgs(userId);
    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(orgs[0].name).toBeTruthy();
  });

  it('rejects empty org name', async () => {
    await expect(orgService.createOrg(userId, '')).rejects.toThrow('Organization name is required');
  });
});

describeDb('S-7.2: Team Management (integration)', () => {
  let db: MigrationClient;
  let orgService: OrgService;
  let ownerId: string;
  let orgId: string;
  let memberId: string;

  beforeAll(async () => {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    db = {
      query: (text: string, params?: any[]) => pool.query(text, params),
      end: () => pool.end(),
    };
    await runMigrations(db, MIGRATIONS_DIR);
    orgService = new OrgService(db);

    // Create owner
    const ownerResult = await db.query(
      `INSERT INTO users (email, email_verified, display_name)
       VALUES ($1, TRUE, $2) RETURNING id`,
      [`teamowner-${Date.now()}@test.com`, 'Team Owner'],
    );
    ownerId = (ownerResult.rows as any[])[0].id;

    // Create org
    const org = await orgService.createOrg(ownerId, 'Team Test Org');
    orgId = org.id;

    // Create a second user to be added as member
    const memberResult = await db.query(
      `INSERT INTO users (email, email_verified, display_name)
       VALUES ($1, TRUE, $2) RETURNING id`,
      [`teammember-${Date.now()}@test.com`, 'Team Member'],
    );
    memberId = (memberResult.rows as any[])[0].id;

    // Add them directly as member
    await db.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'member')`,
      [orgId, memberId],
    );
  });

  afterAll(async () => {
    if (db) await db.end!();
  });

  it('lists members with roles', async () => {
    const members = await orgService.listMembers(orgId);
    expect(members.length).toBeGreaterThanOrEqual(2);
    const owner = members.find((m) => m.user_id === ownerId);
    expect(owner?.role).toBe('owner');
  });

  it('invites a member by email', async () => {
    const email = `invite-${Date.now()}@test.com`;
    const { invitation, token } = await orgService.inviteMember(orgId, ownerId, email, 'viewer');
    expect(invitation.email).toBe(email);
    expect(invitation.role).toBe('viewer');
    expect(token).toBeTruthy();
  });

  it('rejects duplicate invitation', async () => {
    const email = `dup-invite-${Date.now()}@test.com`;
    await orgService.inviteMember(orgId, ownerId, email, 'member');
    await expect(
      orgService.inviteMember(orgId, ownerId, email, 'member'),
    ).rejects.toThrow('already pending');
  });

  it('changes a member role', async () => {
    await orgService.changeMemberRole(orgId, memberId, 'admin', 'owner');
    const members = await orgService.listMembers(orgId);
    const member = members.find((m) => m.user_id === memberId);
    expect(member?.role).toBe('admin');

    // Revert
    await orgService.changeMemberRole(orgId, memberId, 'member', 'owner');
  });

  it('prevents removing the sole owner', async () => {
    await expect(
      orgService.removeMember(orgId, ownerId),
    ).rejects.toThrow('only owner');
  });

  it('transfers ownership', async () => {
    await orgService.transferOwnership(orgId, ownerId, memberId);
    const members = await orgService.listMembers(orgId);
    const newOwner = members.find((m) => m.user_id === memberId);
    const oldOwner = members.find((m) => m.user_id === ownerId);
    expect(newOwner?.role).toBe('owner');
    expect(oldOwner?.role).toBe('admin');
  });

  it('lists pending invitations', async () => {
    const invitations = await orgService.listInvitations(orgId);
    expect(Array.isArray(invitations)).toBe(true);
  });

  it('cancels an invitation', async () => {
    const email = `cancel-${Date.now()}@test.com`;
    const { invitation } = await orgService.inviteMember(orgId, ownerId, email, 'member');
    const cancelled = await orgService.cancelInvitation(orgId, invitation.id);
    expect(cancelled).toBe(true);
  });
});
