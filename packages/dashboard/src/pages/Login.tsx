import React from 'react';

export function Login(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg text-center">
        <div className="mb-6">
          <span className="text-4xl">🔍</span>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">AgentLens</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>
        </div>
        <a
          href="/auth/login"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          Sign in with SSO
        </a>
      </div>
    </div>
  );
}

export default Login;
