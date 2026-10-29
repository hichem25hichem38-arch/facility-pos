import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createApp } from './app.mjs';

// Credentials and routing come from the Worker-injected SDK, never from request JSON.
const app = createApp({ db: createDatabaseClient(), env: (name) => Deno.env.get(name) });

Deno.serve((request) => {
  // The platform context carries the routable request; the raw one may already
  // be consumed by the gateway, which breaks body reads inside the handler.
  const context = createSiteContext(request);
  return app(context.request).catch((error) => errorResponse(error, context?.requestId));
});
