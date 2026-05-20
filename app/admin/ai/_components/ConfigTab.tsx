'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface AiConfig {
  model: string;
  temperature: number;
  max_tokens: number | null;
  system_prompt: string;
  updated_at: string | null;
}

type Defaults = Omit<AiConfig, 'updated_at'>;

export default function ConfigTab() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/ai-config')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setConfig(data.data);
          setDefaults(data.defaults);
        } else {
          setMessage({ type: 'error', text: data.error || 'Failed to load config' });
        }
      })
      .catch(() => setMessage({ type: 'error', text: 'Failed to load config' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.max_tokens,
          system_prompt: config.system_prompt,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.data);
        setMessage({ type: 'success', text: 'AI configuration saved' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const ResetButton = ({ onClick, modified }: { onClick: () => void; modified: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!modified}
      title="Reset to default"
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <RotateCcw className="w-3 h-3" />
      Reset to default
    </button>
  );

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!config || !defaults)
    return <p className="text-red-600">{message?.text ?? 'No configuration available'}</p>;

  return (
    <div className="max-w-3xl">
      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded-md text-sm ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-lg shadow p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">Model</label>
            <ResetButton
              modified={config.model !== defaults.model}
              onClick={() => setConfig({ ...config, model: defaults.model })}
            />
          </div>
          <input
            type="text"
            value={config.model}
            onChange={e => setConfig({ ...config, model: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <p className="text-xs text-gray-400 mt-1">Default: {defaults.model}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">
                Temperature ({config.temperature})
              </label>
              <ResetButton
                modified={config.temperature !== defaults.temperature}
                onClick={() => setConfig({ ...config, temperature: defaults.temperature })}
              />
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={config.temperature}
              onChange={e => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
              className="w-full"
            />
            <p className="text-xs text-gray-400 mt-1">Default: {defaults.temperature}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">Max Output Tokens</label>
              <ResetButton
                modified={config.max_tokens !== defaults.max_tokens}
                onClick={() => setConfig({ ...config, max_tokens: defaults.max_tokens })}
              />
            </div>
            <input
              type="number"
              min={1}
              value={config.max_tokens ?? ''}
              placeholder="Unlimited"
              onChange={e =>
                setConfig({
                  ...config,
                  max_tokens: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Default: {defaults.max_tokens ?? 'Unlimited'}
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-gray-700">System Prompt</label>
            <ResetButton
              modified={config.system_prompt !== defaults.system_prompt}
              onClick={() => setConfig({ ...config, system_prompt: defaults.system_prompt })}
            />
          </div>
          <textarea
            value={config.system_prompt}
            onChange={e => setConfig({ ...config, system_prompt: e.target.value })}
            rows={12}
            className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {config.updated_at
              ? `Last updated ${new Date(config.updated_at).toLocaleString()}`
              : 'Not yet saved'}
          </span>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
