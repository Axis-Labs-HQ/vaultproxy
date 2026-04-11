'use client';

export default function UsagePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-cream-900">Usage</h1>
      <p className="text-sm text-cream-600 mt-1">
        Monitor your proxy request volume
      </p>

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mt-6">
        <span>
          <span className="text-lg font-semibold text-cream-900 mr-1">0</span>
          <span className="text-sm text-cream-500">requests today</span>
        </span>
        <span>
          <span className="text-lg font-semibold text-cream-900 mr-1">0</span>
          <span className="text-sm text-cream-500">this month</span>
        </span>
        <span className="text-sm text-cream-500">avg latency: \u2014</span>
      </div>

      <div className="mt-12">
        <p className="text-sm text-cream-500 max-w-md">
          Usage charts will appear once you start proxying requests through VaultProxy. Point your SDK at your proxy alias to get started.
        </p>
      </div>
    </div>
  );
}
