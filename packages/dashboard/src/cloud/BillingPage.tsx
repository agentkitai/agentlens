/**
 * Billing Page (S-7.5)
 *
 * Dashboard billing page showing:
 * - Current plan with pricing
 * - Usage summary (events used / quota)
 * - Trial status banner
 * - Upgrade/downgrade buttons
 * - Invoice history table
 * - Payment method management (Stripe portal link)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useOrg } from './OrgContext';
import {
  getBillingOverview,
  getBillingInvoices,
  upgradePlan,
  downgradePlan,
  createPortalSession,
  type BillingOverview,
  type InvoiceRecord,
} from './api';

const PLAN_ORDER = ['free', 'pro', 'team', 'enterprise'];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function BillingPage(): React.ReactElement {
  const { currentOrg } = useOrg();
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);
    setError(null);
    try {
      const [overview, inv] = await Promise.all([
        getBillingOverview(currentOrg.id),
        getBillingInvoices(currentOrg.id),
      ]);
      setBilling(overview);
      setInvoices(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing');
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => { load(); }, [load]);

  const handleUpgrade = useCallback(async (plan: string) => {
    if (!currentOrg) return;
    setActionLoading(true);
    try {
      await upgradePlan(currentOrg.id, plan);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upgrade failed');
    } finally {
      setActionLoading(false);
    }
  }, [currentOrg, load]);

  const handleDowngrade = useCallback(async () => {
    if (!currentOrg || !window.confirm('Downgrade to Free at end of billing period?')) return;
    setActionLoading(true);
    try {
      await downgradePlan(currentOrg.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Downgrade failed');
    } finally {
      setActionLoading(false);
    }
  }, [currentOrg, load]);

  const handleManagePayment = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const { url } = await createPortalSession(currentOrg.id);
      window.open(url, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open payment portal');
    }
  }, [currentOrg]);

  if (!currentOrg) return <div className="billing-page"><p>Select an organization</p></div>;
  if (loading) return <div className="billing-page"><p>Loading billing...</p></div>;
  if (error) return <div className="billing-page"><p className="error" role="alert">{error}</p></div>;
  if (!billing) return <div className="billing-page"><p>No billing data</p></div>;

  const usagePercent = billing.event_quota > 0
    ? Math.round((billing.current_usage / billing.event_quota) * 100)
    : 0;
  const currentPlanIdx = PLAN_ORDER.indexOf(billing.plan);

  return (
    <div className="billing-page">
      <h2>Billing</h2>

      {/* Trial Banner */}
      {billing.trial.is_trial && (
        <div className="trial-banner" role="status" data-testid="trial-banner">
          🎉 You're on a free trial! {billing.trial.days_remaining} days remaining
          (expires {billing.trial.trial_ends_at ? formatDate(billing.trial.trial_ends_at) : 'soon'}).
          Upgrade to keep your features.
        </div>
      )}

      {billing.trial.expired && (
        <div className="trial-banner expired" role="alert" data-testid="trial-expired-banner">
          ⚠️ Your trial has expired. Upgrade to restore Pro features.
        </div>
      )}

      {billing.pending_downgrade && (
        <div className="downgrade-banner" role="status" data-testid="downgrade-banner">
          📋 Your plan will downgrade to Free at the end of the current billing period.
        </div>
      )}

      {billing.payment_status === 'past_due' && (
        <div className="payment-warning" role="alert" data-testid="payment-warning">
          ⚠️ Payment past due. Please update your payment method.
        </div>
      )}

      {/* Current Plan */}
      <section className="current-plan" data-testid="current-plan">
        <h3>Current Plan: {billing.plan_name}</h3>
        <p>{billing.base_price_cents === 0 ? 'Free' : `${formatCents(billing.base_price_cents)}/mo`}</p>
      </section>

      {/* Usage Summary */}
      <section className="usage-summary" data-testid="usage-summary">
        <h3>Usage This Period</h3>
        <div className="usage-bar">
          <div className="usage-fill" style={{ width: `${Math.min(usagePercent, 100)}%` }} />
        </div>
        <p>{billing.current_usage.toLocaleString()} / {billing.event_quota.toLocaleString()} events ({usagePercent}%)</p>
        {usagePercent >= 80 && usagePercent < 100 && (
          <p className="warning">⚠️ Approaching quota limit</p>
        )}
        {usagePercent >= 100 && (
          <p className="warning">🚨 Quota exceeded — overage charges may apply</p>
        )}
      </section>

      {/* Plan Actions */}
      <section className="plan-actions" data-testid="plan-actions">
        <h3>Change Plan</h3>
        <div className="plan-buttons">
          {PLAN_ORDER.filter(p => p !== 'enterprise').map((plan, idx) => (
            <button
              key={plan}
              disabled={actionLoading || plan === billing.plan}
              onClick={() => {
                if (idx > currentPlanIdx) handleUpgrade(plan);
                else if (idx < currentPlanIdx) handleDowngrade();
              }}
              className={plan === billing.plan ? 'current' : idx > currentPlanIdx ? 'upgrade' : 'downgrade'}
              data-testid={`plan-btn-${plan}`}
            >
              {plan === billing.plan ? `${plan} (current)` : plan}
            </button>
          ))}
        </div>
      </section>

      {/* Payment Method */}
      <section className="payment-method" data-testid="payment-method">
        <h3>Payment Method</h3>
        {billing.has_payment_method ? (
          <button onClick={handleManagePayment} data-testid="manage-payment-btn">
            Manage Payment Method
          </button>
        ) : (
          <p>No payment method on file. Add one to upgrade.</p>
        )}
      </section>

      {/* Invoice History */}
      <section className="invoice-history" data-testid="invoice-history">
        <h3>Invoice History</h3>
        {invoices.length === 0 ? (
          <p>No invoices yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Interval</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} data-testid="invoice-row">
                  <td>{formatDate(inv.period_start)} – {formatDate(inv.period_end)}</td>
                  <td>{formatCents(inv.total_amount_cents)}</td>
                  <td className={`status-${inv.status}`}>{inv.status}</td>
                  <td>{inv.billing_interval}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default BillingPage;
