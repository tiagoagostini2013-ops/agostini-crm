'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function BootstrapForm({ onDone }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Não foi possível criar a conta.');
        return;
      }
      onDone();
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <h1>
        <img className="brand-logo" src="/logo.png" alt="Agostini" />
        CRM Agostini
      </h1>
      <p>
        Primeira vez por aqui — ainda não existe nenhum usuário cadastrado. Crie a conta do
        administrador (ela poderá cadastrar todo mundo depois).
      </p>
      {error && <div className="error">{error}</div>}
      <input type="text" placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input
        type="password"
        placeholder="Escolha uma senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        type="password"
        placeholder="Confirme a senha"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? 'Criando...' : 'Criar conta de administrador'}
      </button>
    </form>
  );
}

function LoginForm({ users }) {
  const [name, setName] = useState(users[0]?.name || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Não foi possível entrar.');
        return;
      }
      router.push(searchParams.get('next') || '/');
      router.refresh();
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={handleSubmit}>
      <h1>
        <img className="brand-logo" src="/logo.png" alt="Agostini" />
        CRM Agostini
      </h1>
      <p>Escolha seu nome e digite sua senha.</p>
      {error && <div className="error">{error}</div>}
      <select value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 12 }}>
        {users.map((u) => (
          <option key={u.name} value={u.name}>
            {u.name}
          </option>
        ))}
      </select>
      <input
        type="password"
        placeholder="Senha"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
      <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
        Sem acesso ainda? Fale com um administrador do painel.
      </p>
    </form>
  );
}

function LoginPageInner() {
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');

  async function loadContext() {
    try {
      const res = await fetch('/api/auth/context');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar.');
      setContext(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadContext();
  }, []);

  if (error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>
        <img className="brand-logo" src="/logo.png" alt="Agostini" />
        CRM Agostini
      </h1>
          <div className="error">{error}</div>
        </div>
      </div>
    );
  }

  if (!context) {
    return <div className="login-wrap" />;
  }

  return (
    <div className="login-wrap">
      {!context.hasUsers ? (
        <BootstrapForm onDone={() => (window.location.href = '/')} />
      ) : context.users.length === 0 ? (
        <div className="login-card">
          <h1>
        <img className="brand-logo" src="/logo.png" alt="Agostini" />
        CRM Agostini
      </h1>
          <p>Nenhum usuário ativo no momento. Peça para um administrador reativar seu acesso.</p>
        </div>
      ) : (
        <LoginForm users={context.users} />
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-wrap" />}>
      <LoginPageInner />
    </Suspense>
  );
}
