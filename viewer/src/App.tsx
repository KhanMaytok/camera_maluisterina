import { useEffect, useState } from 'react';
import { fetchCameras, isLoggedIn, login, logout, pairCamera, register } from './api';
import { CameraSettings } from './CameraSettings';
import { EventsView } from './EventsView';
import { LiveView } from './LiveView';
import { subscribeToPush } from './push';
import type { Camera, User } from './types';

type Tab = 'cameras' | 'events';

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    setBusy(true);
    setError('');
    const action = creating
      ? register(username, password).then(() => login(username, password))
      : login(username, password);
    action
      .then(onLogin)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="login">
      <h1>Grabadora</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          placeholder="Usuario"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="Contraseña"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? '…' : creating ? 'Crear cuenta' : 'Entrar'}
        </button>
        <button type="button" className="ghost" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Ya tengo cuenta' : 'Primera vez: crear cuenta'}
        </button>
      </form>
    </div>
  );
}

function PairForm({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    setBusy(true);
    void pairCamera({ pairing_token: code, name, zone })
      .then(() => {
        setCode('');
        setName('');
        setZone('');
        onPaired();
      })
      .catch((e: Error) => alert(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="pair">
      <input
        placeholder="Código de la app cámara"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <input
        placeholder="Nombre (ej. Sala)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        placeholder="Zona (ej. Primer piso)"
        value={zone}
        onChange={(e) => setZone(e.target.value)}
      />
      <button onClick={submit} disabled={busy || code.length < 8 || !name}>
        Emparejar
      </button>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [tab, setTab] = useState<Tab>('cameras');
  const [showPair, setShowPair] = useState(false);
  const [pushState, setPushState] = useState('notificaciones');

  const reload = (): void => {
    void fetchCameras()
      .then(setCameras)
      .catch((e) => alert(e.message));
  };

  useEffect(reload, []);

  const enablePush = (): void => {
    void subscribeToPush()
      .then(() => setPushState('notificaciones activas'))
      .catch((e) => setPushState(`push no disponible: ${e.message}`));
  };

  return (
    <div>
      <header>
        <h1>Grabadora</h1>
        <div className="row">
          <button onClick={enablePush}>{pushState}</button>
          <button onClick={() => setTab(tab === 'cameras' ? 'events' : 'cameras')}>
            {tab === 'cameras' ? 'Eventos' : 'Cámaras'}
          </button>
          <span>{user.username}</span>
          <button onClick={onLogout}>Salir</button>
        </div>
      </header>

      {tab === 'cameras' ? (
        <main>
          <div className="row">
            <h2>Cámaras</h2>
            <button onClick={() => setShowPair((v) => !v)}>Agregar cámara</button>
          </div>
          {showPair && (
            <PairForm
              onPaired={() => {
                setShowPair(false);
                reload();
              }}
            />
          )}
          {cameras.map((camera) => (
            <article key={camera.id} className="card">
              <LiveView camera={camera} />
              <details>
                <summary>Configuración de {camera.name}</summary>
                <CameraSettings camera={camera} onSaved={reload} />
              </details>
            </article>
          ))}
          {cameras.length === 0 && <p className="empty">Aún no hay cámaras emparejadas.</p>}
        </main>
      ) : (
        <main>
          <h2>Eventos</h2>
          <EventsView cameras={cameras} />
        </main>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() =>
    isLoggedIn() ? { id: 0, username: '' } : null,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      void fetchCameras()
        .then(() => setLoaded(true))
        .catch(() => {
          logout();
          setLoaded(true);
        });
    } else {
      setLoaded(true);
    }
  }, []);

  if (!loaded) return <div className="login">Cargando…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <Dashboard
      user={user}
      onLogout={() => {
        logout();
        setUser(null);
      }}
    />
  );
}
