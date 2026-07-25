// `server-only` throws on import outside a server bundle, which is exactly its job — it is what
// stops a client component from pulling in the service-role key. Jest runs in jsdom, so it resolves
// the client-side export and would fail every suite that touches a server module. Stub it out.
export {};
