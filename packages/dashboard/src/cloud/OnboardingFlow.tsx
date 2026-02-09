/**
 * Onboarding Flow (S-7.7)
 *
 * First-time user wizard:
 * Step 1: Create organization
 * Step 2: Generate first API key
 * Step 3: Show SDK install snippet
 * Step 4: Verify first event received
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useOrg } from './OrgContext';
import {
  createApiKey,
  getOnboardingStatus,
  verifyFirstEvent,
  type OnboardingStatus,
  type CreateApiKeyResponse,
} from './api';

type Step = 'create-org' | 'generate-key' | 'install-sdk' | 'verify-event' | 'complete';

const SDK_SNIPPET = `# Install
npm install @agentlens/sdk

# Initialize in your code
import { AgentLens } from '@agentlens/sdk';

const lens = new AgentLens({
  apiKey: 'YOUR_API_KEY',
  endpoint: 'https://cloud.agentlens.dev',
});

// Track an event
await lens.track({
  type: 'agent.action',
  sessionId: 'my-session',
  data: { action: 'hello-world' },
});`;

function stepIndex(step: Step): number {
  const order: Step[] = ['create-org', 'generate-key', 'install-sdk', 'verify-event', 'complete'];
  return order.indexOf(step);
}

export function OnboardingFlow(): React.ReactElement {
  const { currentOrg, createOrg } = useOrg();
  const [step, setStep] = useState<Step>('create-org');
  const [orgName, setOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyResponse, setKeyResponse] = useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check initial status
  useEffect(() => {
    getOnboardingStatus()
      .then((status: OnboardingStatus) => {
        if (status.has_first_event) setStep('complete');
        else if (status.has_api_key) setStep('install-sdk');
        else if (status.has_org) setStep('generate-key');
        else setStep('create-org');
      })
      .catch(() => setStep('create-org'));
  }, []);

  // If org already exists, skip step 1
  useEffect(() => {
    if (currentOrg && step === 'create-org') {
      setStep('generate-key');
    }
  }, [currentOrg, step]);

  const handleCreateOrg = useCallback(async () => {
    if (!orgName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createOrg(orgName.trim());
      setStep('generate-key');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create org');
    } finally {
      setCreating(false);
    }
  }, [orgName, createOrg]);

  const handleGenerateKey = useCallback(async () => {
    if (!currentOrg) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createApiKey(currentOrg.id, 'onboarding-key', 'production');
      setKeyResponse(result);
      setStep('install-sdk');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setCreating(false);
    }
  }, [currentOrg]);

  const handleCopyKey = useCallback(() => {
    if (keyResponse) {
      navigator.clipboard.writeText(keyResponse.fullKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [keyResponse]);

  const handleCopySnippet = useCallback(() => {
    const snippet = keyResponse
      ? SDK_SNIPPET.replace('YOUR_API_KEY', keyResponse.fullKey)
      : SDK_SNIPPET;
    navigator.clipboard.writeText(snippet);
  }, [keyResponse]);

  const handleVerify = useCallback(async () => {
    if (!currentOrg) return;
    setVerifying(true);
    setError(null);

    // Poll every 2 seconds for up to 30 seconds
    let attempts = 0;
    const maxAttempts = 15;

    const poll = async () => {
      try {
        const result = await verifyFirstEvent(currentOrg.id);
        if (result.received) {
          setVerified(true);
          setStep('complete');
          if (pollRef.current) clearInterval(pollRef.current);
          setVerifying(false);
          return true;
        }
      } catch {
        // ignore poll errors
      }
      attempts++;
      if (attempts >= maxAttempts) {
        setVerifying(false);
        setError('No events received yet. Make sure your SDK is configured and sending events.');
        if (pollRef.current) clearInterval(pollRef.current);
      }
      return false;
    };

    // Immediate check
    const found = await poll();
    if (!found) {
      pollRef.current = setInterval(poll, 2000);
    }
  }, [currentOrg]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSkipVerify = useCallback(() => {
    setStep('complete');
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const currentStep = stepIndex(step);

  return (
    <div className="onboarding-flow" data-testid="onboarding-flow">
      <h2>Welcome to AgentLens Cloud! 🚀</h2>

      {/* Progress indicator */}
      <div className="progress-steps" data-testid="progress-steps">
        {['Create Org', 'Generate Key', 'Install SDK', 'Verify'].map((label, idx) => (
          <span
            key={label}
            className={`step ${idx < currentStep ? 'done' : idx === currentStep ? 'active' : ''}`}
            data-testid={`step-${idx}`}
          >
            {idx < currentStep ? '✅' : `${idx + 1}.`} {label}
          </span>
        ))}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {/* Step 1: Create Org */}
      {step === 'create-org' && (
        <section className="onboarding-step" data-testid="step-create-org">
          <h3>Step 1: Create Your Organization</h3>
          <p>An organization is where your team's data lives. You can invite teammates later.</p>
          <input
            type="text"
            placeholder="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            data-testid="org-name-input"
            aria-label="Organization name"
          />
          <button
            onClick={handleCreateOrg}
            disabled={creating || !orgName.trim()}
            data-testid="create-org-btn"
          >
            {creating ? 'Creating...' : 'Create Organization'}
          </button>
        </section>
      )}

      {/* Step 2: Generate Key */}
      {step === 'generate-key' && (
        <section className="onboarding-step" data-testid="step-generate-key">
          <h3>Step 2: Generate Your First API Key</h3>
          <p>You'll need an API key to send events from your application.</p>
          <button
            onClick={handleGenerateKey}
            disabled={creating}
            data-testid="generate-key-btn"
          >
            {creating ? 'Generating...' : 'Generate API Key'}
          </button>
        </section>
      )}

      {/* Step 3: Install SDK */}
      {step === 'install-sdk' && (
        <section className="onboarding-step" data-testid="step-install-sdk">
          <h3>Step 3: Install the SDK</h3>

          {keyResponse && (
            <div className="key-display" data-testid="key-display">
              <p><strong>Your API Key:</strong></p>
              <code data-testid="api-key-value">{keyResponse.fullKey}</code>
              <button onClick={handleCopyKey} data-testid="copy-key-btn">
                {copied ? '✅ Copied!' : '📋 Copy'}
              </button>
              <p className="warning">⚠️ Save this key now — you won't see it again!</p>
            </div>
          )}

          <div className="sdk-snippet" data-testid="sdk-snippet">
            <pre>{keyResponse ? SDK_SNIPPET.replace('YOUR_API_KEY', keyResponse.fullKey) : SDK_SNIPPET}</pre>
            <button onClick={handleCopySnippet} data-testid="copy-snippet-btn">
              📋 Copy Snippet
            </button>
          </div>

          <button onClick={() => setStep('verify-event')} data-testid="next-verify-btn">
            I've installed the SDK →
          </button>
        </section>
      )}

      {/* Step 4: Verify Event */}
      {step === 'verify-event' && (
        <section className="onboarding-step" data-testid="step-verify-event">
          <h3>Step 4: Verify Your First Event</h3>
          <p>Run your application and send a test event. We'll detect it automatically.</p>

          <button
            onClick={handleVerify}
            disabled={verifying}
            data-testid="verify-btn"
          >
            {verifying ? '🔍 Checking for events...' : 'Check for Events'}
          </button>

          <button
            onClick={handleSkipVerify}
            className="secondary"
            data-testid="skip-verify-btn"
          >
            Skip for now
          </button>
        </section>
      )}

      {/* Complete */}
      {step === 'complete' && (
        <section className="onboarding-step" data-testid="step-complete">
          <h3>🎉 You're all set!</h3>
          <p>
            {verified
              ? 'We received your first event! Your AgentLens Cloud is ready.'
              : 'Your org and API key are set up. Send your first event when ready.'}
          </p>
          <p>Next steps:</p>
          <ul>
            <li>Explore the <strong>Sessions</strong> page to see your agent activity</li>
            <li>Invite your team from <strong>Team Management</strong></li>
            <li>Set up <strong>Guardrails</strong> for safety monitoring</li>
          </ul>
        </section>
      )}
    </div>
  );
}

export default OnboardingFlow;
