CREATE TABLE app.lic_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  name text NOT NULL,
  phone text NOT NULL,
  store_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  duration_days integer NOT NULL DEFAULT 30,
  activated_at timestamptz,
  expires_at timestamptz,
  last_seen_at timestamptz,
  app_version text,
  platform text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.lic_codes (
  code_hash text PRIMARY KEY,
  code_prefix text NOT NULL,
  client_id uuid NOT NULL REFERENCES app.lic_clients (id),
  duration_days integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX lic_codes_client_idx ON app.lic_codes (client_id);

CREATE TABLE app.lic_sessions (
  token_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE app.lic_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

CREATE TABLE app.lic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.lic_clients (id),
  kind text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lic_events_client_idx ON app.lic_events (client_id, created_at);
