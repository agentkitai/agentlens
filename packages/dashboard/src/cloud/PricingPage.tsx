/**
 * Pricing Page Component (S-9.4)
 *
 * Displays 4-tier pricing with annual/monthly toggle,
 * feature comparison table, and FAQ accordion.
 */

import React, { useState } from 'react';

// ─── Tier Data ───────────────────────────────────────────────

interface Tier {
  name: string;
  monthlyPrice: number | null; // null = custom
  annualMonthlyPrice: number | null;
  events: string;
  apiKeys: string;
  storage: string;
  retention: string;
  members: string;
  support: string;
  overageRate: string;
  cta: string;
  ctaVariant: 'default' | 'primary' | 'outline';
  highlighted?: boolean;
  features: string[];
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    events: '10,000',
    apiKeys: '2',
    storage: '1 GB',
    retention: '7 days',
    members: '1',
    support: 'Community',
    overageRate: 'Blocked',
    cta: 'Get Started',
    ctaVariant: 'outline',
    features: ['Session replay', 'LLM cost tracking', 'Guardrails', 'Benchmarks'],
  },
  {
    name: 'Pro',
    monthlyPrice: 29,
    annualMonthlyPrice: 23,
    events: '1,000,000',
    apiKeys: '10',
    storage: '100 GB',
    retention: '30 days',
    members: '5',
    support: 'Email',
    overageRate: '$0.10/1K',
    cta: 'Start Free Trial',
    ctaVariant: 'primary',
    highlighted: true,
    features: [
      'Session replay',
      'LLM cost tracking',
      'Guardrails',
      'Benchmarks',
      'Alerting',
    ],
  },
  {
    name: 'Team',
    monthlyPrice: 99,
    annualMonthlyPrice: 79,
    events: '10,000,000',
    apiKeys: '50',
    storage: '1 TB',
    retention: '90 days',
    members: 'Unlimited',
    support: 'Priority',
    overageRate: '$0.08/1K',
    cta: 'Start Free Trial',
    ctaVariant: 'primary',
    features: [
      'Session replay',
      'LLM cost tracking',
      'Guardrails',
      'Benchmarks',
      'Alerting',
      'RBAC',
      'Audit log',
    ],
  },
  {
    name: 'Enterprise',
    monthlyPrice: null,
    annualMonthlyPrice: null,
    events: '100,000,000+',
    apiKeys: '200+',
    storage: '10 TB+',
    retention: 'Custom',
    members: 'Unlimited',
    support: 'Dedicated + SLA',
    overageRate: 'Custom',
    cta: 'Contact Sales',
    ctaVariant: 'outline',
    features: [
      'Session replay',
      'LLM cost tracking',
      'Guardrails',
      'Benchmarks',
      'Alerting',
      'RBAC',
      'Audit log',
      'SSO / SAML',
      'SLA',
    ],
  },
];

// ─── FAQ Data ────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: 'What counts as an event?',
    a: 'Any data point sent to AgentLens: LLM calls, tool invocations, agent actions, errors, guardrail checks, benchmarks, or custom events.',
  },
  {
    q: 'What happens when I hit my event limit?',
    a: 'Free plans pause ingestion until the next cycle. Pro & Team plans incur overage charges automatically — you\'re never cut off.',
  },
  {
    q: 'Can I upgrade or downgrade at any time?',
    a: 'Yes. Upgrades are immediate with prorated billing. Downgrades take effect at the end of your billing period.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — Pro and Team plans include a 14-day free trial with full features. No credit card required.',
  },
  {
    q: 'How does annual billing work?',
    a: 'Annual plans save 20%. Pro: $276/year ($23/mo). Team: $948/year ($79/mo). Billed once per year.',
  },
  {
    q: 'Can I self-host instead?',
    a: 'Absolutely. AgentLens is open-source. The cloud offering adds managed infrastructure, team features, and billing.',
  },
];

// ─── Comparison Table Rows ───────────────────────────────────

const COMPARISON_ROWS: Array<{ label: string; values: [string, string, string, string] }> = [
  { label: 'Monthly events', values: ['10K', '1M', '10M', '100M+'] },
  { label: 'API keys', values: ['2', '10', '50', '200+'] },
  { label: 'Storage', values: ['1 GB', '100 GB', '1 TB', '10 TB+'] },
  { label: 'Data retention', values: ['7 days', '30 days', '90 days', 'Custom'] },
  { label: 'Team members', values: ['1', '5', 'Unlimited', 'Unlimited'] },
  { label: 'Session replay', values: ['✅', '✅', '✅', '✅'] },
  { label: 'LLM cost tracking', values: ['✅', '✅', '✅', '✅'] },
  { label: 'Guardrails', values: ['✅', '✅', '✅', '✅'] },
  { label: 'Benchmarks', values: ['✅', '✅', '✅', '✅'] },
  { label: 'Alerting', values: ['—', '✅', '✅', '✅'] },
  { label: 'RBAC', values: ['—', '—', '✅', '✅'] },
  { label: 'Audit log', values: ['—', '—', '✅', '✅'] },
  { label: 'SSO / SAML', values: ['—', '—', '—', '✅'] },
  { label: 'SLA', values: ['—', '—', '—', '✅'] },
  { label: 'Overage rate', values: ['Blocked', '$0.10/1K', '$0.08/1K', 'Custom'] },
];

// ─── Component ───────────────────────────────────────────────

export const PricingPage: React.FC = () => {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        Simple, transparent pricing
      </h1>
      <p style={{ textAlign: 'center', color: '#666', marginBottom: '2rem' }}>
        Start free. Scale as you grow. All plans include the full AgentLens feature set.
      </p>

      {/* Annual/Monthly Toggle */}
      <div
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}
        role="radiogroup"
        aria-label="Billing period"
      >
        <span style={{ fontWeight: annual ? 400 : 600 }}>Monthly</span>
        <button
          onClick={() => setAnnual(!annual)}
          role="switch"
          aria-checked={annual}
          aria-label="Toggle annual billing"
          style={{
            width: 48,
            height: 26,
            borderRadius: 13,
            border: '2px solid #4f46e5',
            background: annual ? '#4f46e5' : '#e5e7eb',
            position: 'relative',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span
            style={{
              display: 'block',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: 2,
              left: annual ? 24 : 2,
              transition: 'left 0.2s',
            }}
          />
        </button>
        <span style={{ fontWeight: annual ? 600 : 400 }}>
          Annual <span style={{ color: '#16a34a', fontSize: '0.85em' }}>Save 20%</span>
        </span>
      </div>

      {/* Tier Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.5rem',
          marginBottom: '3rem',
        }}
      >
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            style={{
              border: tier.highlighted ? '2px solid #4f46e5' : '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '1.5rem',
              position: 'relative',
              background: '#fff',
            }}
          >
            {tier.highlighted && (
              <div
                style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#4f46e5',
                  color: '#fff',
                  padding: '2px 12px',
                  borderRadius: 10,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Most Popular
              </div>
            )}
            <h3 style={{ margin: '0 0 0.5rem' }}>{tier.name}</h3>
            <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              {tier.monthlyPrice === null
                ? 'Custom'
                : tier.monthlyPrice === 0
                  ? '$0'
                  : `$${annual ? tier.annualMonthlyPrice : tier.monthlyPrice}`}
              {tier.monthlyPrice !== null && tier.monthlyPrice > 0 && (
                <span style={{ fontSize: '0.875rem', fontWeight: 400, color: '#666' }}>/mo</span>
              )}
            </div>
            {annual && tier.monthlyPrice !== null && tier.monthlyPrice > 0 && (
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
                billed annually
              </div>
            )}
            <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
              {tier.events} events/mo
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem', fontSize: '0.85rem' }}>
              {tier.features.map((f) => (
                <li key={f} style={{ padding: '2px 0' }}>✓ {f}</li>
              ))}
            </ul>
            <button
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: 8,
                border: tier.ctaVariant === 'primary' ? 'none' : '1px solid #4f46e5',
                background: tier.ctaVariant === 'primary' ? '#4f46e5' : 'transparent',
                color: tier.ctaVariant === 'primary' ? '#fff' : '#4f46e5',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              {tier.cta}
            </button>
          </div>
        ))}
      </div>

      {/* Feature Comparison Table */}
      <h2 style={{ textAlign: 'center', marginBottom: '1rem' }}>Feature Comparison</h2>
      <div style={{ overflowX: 'auto', marginBottom: '3rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #e5e7eb' }}></th>
              {TIERS.map((t) => (
                <th
                  key={t.name}
                  style={{
                    textAlign: 'center',
                    padding: '0.5rem',
                    borderBottom: '2px solid #e5e7eb',
                    fontWeight: 600,
                  }}
                >
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row, i) => (
              <tr key={row.label} style={{ background: i % 2 === 0 ? '#f9fafb' : '#fff' }}>
                <td style={{ padding: '0.5rem', fontWeight: 500 }}>{row.label}</td>
                {row.values.map((v, j) => (
                  <td key={j} style={{ textAlign: 'center', padding: '0.5rem' }}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FAQ */}
      <h2 style={{ textAlign: 'center', marginBottom: '1rem' }}>Frequently Asked Questions</h2>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {FAQ_ITEMS.map((item, i) => (
          <div
            key={i}
            style={{ borderBottom: '1px solid #e5e7eb', padding: '0.75rem 0' }}
          >
            <button
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              aria-expanded={openFaq === i}
              style={{
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.95rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.25rem 0',
              }}
            >
              {item.q}
              <span>{openFaq === i ? '−' : '+'}</span>
            </button>
            {openFaq === i && (
              <p style={{ margin: '0.5rem 0 0', color: '#555', fontSize: '0.9rem', lineHeight: 1.5 }}>
                {item.a}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PricingPage;
