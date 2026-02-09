/**
 * Team Management Page (S-7.2)
 *
 * Dashboard page for managing org members:
 * - List members with roles
 * - Invite by email with role selection
 * - Change roles (owner/admin only)
 * - Remove members
 * - Pending invitations list
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useOrg } from './OrgContext';
import {
  getOrgMembers,
  getOrgInvitations,
  inviteMember,
  cancelInvitation,
  changeMemberRole,
  removeMember,
  transferOwnership,
  type CloudOrgMember,
  type CloudInvitation,
} from './api';

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;

export function TeamManagement(): React.ReactElement {
  const { currentOrg } = useOrg();
  const [members, setMembers] = useState<CloudOrgMember[]>([]);
  const [invitations, setInvitations] = useState<CloudInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const orgId = currentOrg?.id;

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        getOrgMembers(orgId),
        getOrgInvitations(orgId),
      ]);
      setMembers(m);
      setInvitations(i);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await inviteMember(orgId, inviteEmail.trim(), inviteRole);
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      fetchData();
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvitation = async (invId: string) => {
    if (!orgId) return;
    try {
      await cancelInvitation(orgId, invId);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!orgId) return;
    try {
      await changeMemberRole(orgId, userId, newRole);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!orgId) return;
    if (!confirm(`Remove ${name} from the organization?`)) return;
    try {
      await removeMember(orgId, userId);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTransfer = async (userId: string, name: string) => {
    if (!orgId) return;
    if (!confirm(`Transfer ownership to ${name}? You will become an admin.`)) return;
    try {
      await transferOwnership(orgId, userId);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!currentOrg) {
    return (
      <div className="text-gray-500 text-center py-12">
        Select an organization to manage team members.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto" data-testid="team-management">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Team Management</h2>
      <p className="text-sm text-gray-500 mb-6">
        Manage members of <strong>{currentOrg.name}</strong>
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* ─── Invite Form ───────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Invite Member</h3>
        <form onSubmit={handleInvite} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
                         focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg
                         focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg
                       hover:bg-brand-700 disabled:opacity-50"
          >
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
        {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
        {inviteSuccess && <p className="mt-2 text-sm text-green-600">{inviteSuccess}</p>}
      </div>

      {/* ─── Members List ──────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            Members ({members.length})
          </h3>
        </div>
        {loading ? (
          <div className="p-6 text-gray-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Member</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Joined</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td className="px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {m.display_name || m.email.split('@')[0]}
                      </p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.user_id, e.target.value)}
                      className="text-sm border border-gray-200 rounded px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {new Date(m.joined_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => handleTransfer(m.user_id, m.display_name || m.email)}
                          className="text-xs text-gray-500 hover:text-brand-600"
                          title="Transfer ownership"
                        >
                          👑
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(m.user_id, m.display_name || m.email)}
                        className="text-xs text-red-500 hover:text-red-700"
                        title="Remove member"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Pending Invitations ───────────────────────────────── */}
      {invitations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Pending Invitations ({invitations.length})
            </h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Invited By</th>
                <th className="px-6 py-3">Expires</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-6 py-3 text-sm text-gray-900">{inv.email}</td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {inv.invited_by_name || 'Unknown'}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleCancelInvitation(inv.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TeamManagement;
