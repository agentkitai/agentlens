/**
 * Settings Page — main entry point with tab routing (cq-002)
 *
 * Route: /settings
 */

import React, { useState } from 'react';
import { ApiKeysTab } from './ApiKeysTab';
import { ConfigTab } from './ConfigTab';
import { IntegrationsTab } from './IntegrationsTab';

type SettingsTab = 'keys' | 'config' | 'integrations';

export default function Settings(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SettingsTab>('keys');

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'keys', label: 'API Keys' },
    { id: 'config', label: 'Configuration' },
    { id: 'integrations', label: 'Integrations' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Tab Switcher */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 pb-3 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'keys' && <ApiKeysTab />}
      {activeTab === 'config' && <ConfigTab />}
      {activeTab === 'integrations' && <IntegrationsTab />}
    </div>
  );
}
