'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function NewUserForm({ mondayUsers, onCreated }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(false);
  const [mondayUserId, setMondayUserId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, admin, mondayUserId: mondayUserId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar usuário.');
      setName('');
      setPassword('');
      setAdmin(false);
      setMondayUserId('');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="metrics-section" onSubmit={submit}>
      <h3>Novo usuário</h3>
      {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="field-row">
        <div className="field">
          <label>Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
        </div>
        <div className="field">
          <label>Senha inicial</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 4 caracteres"
          />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Qual pessoa do monday.com é essa?</label>
        <select value={mondayUserId} onChange={(e) => setMondayUserId(e.target.value)}>
          <option value="">— Não vincular por enquanto —</option>
          {(mondayUsers || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: '0.76rem', color: 'var(--ink-soft)', marginTop: 4 }}>
          Só quem estiver vinculado aqui aparece no filtro de "responsável" e pode ser escolhido pra receber leads.
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: '0.85rem' }}>
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
        Também é administrador (pode gerenciar outros usuários)
      </label>
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Criando...' : 'Criar usuário'}
      </button>
    </form>
  );
}

function UserRow({ user, mondayUsers, onChanged }) {
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function patch(body) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao atualizar.');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 4) {
      setError('A senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    await patch({ password: newPassword });
    setResetting(false);
    setNewPassword('');
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>
        <select
          value={user.mondayUserId || ''}
          disabled={busy}
          onChange={(e) => patch({ mondayUserId: e.target.value || null })}
        >
          <option value="">— Não vinculado —</option>
          {(mondayUsers || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          checked={user.admin}
          disabled={busy}
          onChange={(e) => patch({ admin: e.target.checked })}
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={user.ativo}
          disabled={busy}
          onChange={(e) => patch({ ativo: e.target.checked })}
        />
      </td>
      <td>
        {!resetting ? (
          <button className="btn-link" onClick={() => setResetting(true)}>
            Redefinir senha
          </button>
        ) : (
          <form onSubmit={submitReset} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Nova senha"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ width: 140, padding: '4px 8px' }}
              autoFocus
            />
            <button className="btn btn-secondary" type="submit" style={{ padding: '4px 10px' }}>
              Salvar
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setResetting(false);
                setNewPassword('');
              }}
            >
              Cancelar
            </button>
          </form>
        )}
        {error && <div style={{ color: 'var(--danger)', fontSize: '0.76rem', marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState(null);
  const [mondayUsers, setMondayUsers] = useState(null);
  const [error, setError] = useState('');

  async function loadMe() {
    const res = await fetch('/api/auth/me');
    if (res.ok) setMe(await res.json());
    else setMe({ admin: false });
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar usuários.');
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadMondayUsers() {
    try {
      const res = await fetch('/api/admin/monday-users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar pessoas do monday.com.');
      setMondayUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadMe();
    loadUsers();
    loadMondayUsers();
  }, []);

  const unlinkedCount = (users || []).filter((u) => u.ativo && !u.mondayUserId).length;

  if (me && !me.admin) {
    return (
      <div className="metrics-scroll">
        <div className="banner banner-error">
          Só administradores podem acessar essa página. {' '}
          <button className="btn-link" onClick={() => router.push('/')}>
            Voltar para o CRM
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Agostini" />
          CRM Agostini — Gerenciar usuários
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => router.push('/')}>
            ← Voltar para o CRM
          </button>
        </div>
      </div>

      <div className="metrics-scroll">
        {error && <div className="banner banner-error">{error}</div>}

        {unlinkedCount > 0 && (
          <div className="banner banner-warning">
            ⚠ {unlinkedCount} usuário(s) ativo(s) ainda sem vínculo com uma pessoa do monday.com — enquanto isso,
            essa pessoa não aparece no filtro de "responsável" nem pode ser escolhida ao criar/editar um lead. Use a
            coluna "Vendedor no monday.com" abaixo para vincular.
          </div>
        )}

        <div className="metrics-section">
          <h3>Quem tem acesso ao painel</h3>
          {!users && <div style={{ color: 'var(--ink-soft)' }}>Carregando...</div>}
          {users && (
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Vendedor no monday.com</th>
                  <th>Admin</th>
                  <th>Ativo</th>
                  <th>Senha</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} mondayUsers={mondayUsers} onChanged={loadUsers} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <NewUserForm mondayUsers={mondayUsers} onCreated={loadUsers} />
      </div>
    </div>
  );
}
