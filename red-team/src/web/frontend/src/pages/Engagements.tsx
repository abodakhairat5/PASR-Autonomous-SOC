import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreateEngagementInput } from '../api/types';
import { EngagementCard } from '../components/EngagementCard';
import { useCreateEngagement, useEngagements } from '../hooks/useApi';

export function EngagementsPage() {
  const { data: engagements, isLoading, error } = useEngagements();
  const createEng = useCreateEngagement();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateEngagementInput>({
    name: '',
    targetUrl: '',
    description: '',
    backend: '',
    model: '',
    thinkingEnabled: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createEng.mutateAsync(form);
    setShowForm(false);
    setForm({
      name: '',
      targetUrl: '',
      description: '',
      backend: '',
      model: '',
      thinkingEnabled: false,
    });
    navigate(`/engagements/${result.id}`);
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Engagements</h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          style={{
            background: '#7c5cff',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ New Engagement'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: '#111122',
            border: '1px solid #1a1a2e',
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field
              label="Name"
              required
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <Field
              label="Target URL"
              required
              value={form.targetUrl}
              onChange={(v) => setForm({ ...form, targetUrl: v })}
            />
            <Field
              label="Description"
              value={form.description ?? ''}
              onChange={(v) => setForm({ ...form, description: v })}
            />
            <Field
              label="Backend"
              value={form.backend ?? ''}
              onChange={(v) => setForm({ ...form, backend: v })}
            />
            <Field
              label="Model"
              value={form.model ?? ''}
              onChange={(v) => setForm({ ...form, model: v })}
            />
            <div style={{ display: 'flex', alignItems: 'end', paddingBottom: 4 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: '#aaa',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.thinkingEnabled ?? false}
                  onChange={(e) => setForm({ ...form, thinkingEnabled: e.target.checked })}
                />
                Enable thinking
              </label>
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={!form.name || !form.targetUrl || createEng.isPending}
              style={{
                background: '#7c5cff',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: createEng.isPending ? 'wait' : 'pointer',
                opacity: createEng.isPending ? 0.6 : 1,
              }}
            >
              {createEng.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
          {createEng.isError && (
            <p style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>
              {createEng.error.message}
            </p>
          )}
        </form>
      )}

      {isLoading && <p style={{ color: '#888' }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444' }}>Failed to load engagements</p>}

      <div style={{ display: 'grid', gap: 12 }}>
        {engagements?.map((eng) => (
          <button
            key={eng.id}
            type="button"
            onClick={() => navigate(`/engagements/${eng.id}`)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <EngagementCard engagement={eng} />
          </button>
        ))}
        {engagements && engagements.length === 0 && (
          <p style={{ color: '#666', textAlign: 'center', padding: 40 }}>
            No engagements yet. Create one to get started.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const inputId = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label
        htmlFor={inputId}
        style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}
      >
        {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      <input
        id={inputId}
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#0a0a0f',
          border: '1px solid #1a1a2e',
          borderRadius: 6,
          padding: '8px 12px',
          color: '#e0e0e0',
          fontSize: 14,
          outline: 'none',
        }}
      />
    </div>
  );
}
