# Troubleshooting Guide

Common issues and how to fix them.

---

## 1. Server Won't Start

**Symptom:** `EADDRINUSE: address already in use :::3400` or the server exits immediately with no output.

**Cause:**
- Another process is already using port 3400
- Missing `.env` file (server can't read config)
- `JWT_SECRET` not set when `AUTH_DISABLED=false`

**Fix:**

```bash
# Check if port 3400 is in use
lsof -i :3400

# Kill the conflicting process or change PORT in .env
echo "PORT=3401" >> .env

# Ensure .env exists
cp .env.example .env

# If using auth, set a JWT secret
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# For local dev, you can disable auth
echo "AUTH_DISABLED=true" >> .env
```

---

## 2. Events Not Appearing in Dashboard

**Symptom:** You're sending events from the SDK but the dashboard shows nothing. No errors in the agent code.

**Cause:**
- Wrong or missing API key
- SDK pointing to wrong server URL
- CORS blocking browser requests to the API
- Events queued but back-pressure threshold hit

**Fix:**

```bash
# Verify your API key works
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3400/api/v1/sessions

# Check the server logs for rejected requests
docker compose logs server | grep -i "auth\|reject\|401"
```

In your Python SDK:
```python
import agentlensai
agentlensai.init(
    api_key="your-key-here",
    base_url="http://localhost:3400"  # Make sure this matches your server
)
```

For CORS issues, ensure your server's allowed origins include the dashboard URL.

---

## 3. Python SDK — Import or Installation Errors

**Symptom:** `ModuleNotFoundError: No module named 'agentlensai.ext.openai'` or similar import errors after installing.

**Cause:** The Python SDK uses optional extras for provider integrations. The base `pip install agentlensai` doesn't include them.

**Fix:**

```bash
# Install with the provider you need
pip install agentlensai[openai]
pip install agentlensai[anthropic]
pip install agentlensai[langchain]

# Or install all extras
pip install agentlensai[all]

# Verify installation
python -c "import agentlensai; print(agentlensai.__version__)"
```

If you're using a virtual environment, make sure it's activated before installing.

---

## 4. MCP Tool Server — Connection Refused

**Symptom:** Claude Desktop or Cursor shows "connection refused" or "MCP server not responding" when trying to use AgentLens tools.

**Cause:**
- MCP server not running or running on a different port
- MCP config block pointing to wrong address
- Firewall blocking the connection

**Fix:**

```bash
# Start the MCP server
npx @agentlensai/mcp --port 3401

# Verify it's running
curl http://localhost:3401/health
```

In your MCP client config (e.g., `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "agentlens": {
      "command": "npx",
      "args": ["@agentlensai/mcp", "--port", "3401"]
    }
  }
}
```

Make sure the port in the config matches the port the server is actually listening on. Restart the MCP client after changing config.

---

## 5. Docker Deployment Issues

**Symptom:** `docker compose up` fails, containers exit, or services can't reach each other.

**Cause:**
- Missing `.env` file
- Port conflicts with host services
- Database not ready when server starts
- Volume mount permission issues

**Fix:**

```bash
# Ensure .env exists
cp .env.example .env

# Start with fresh containers
docker compose down -v
docker compose up --build

# Check container status
docker compose ps

# View logs for a specific service
docker compose logs -f server
docker compose logs -f postgres
```

Common `.env` settings for Docker:
```env
DATABASE_URL=postgresql://agentlens:agentlens@postgres:5432/agentlens
REDIS_URL=redis://redis:6379
PORT=3400
```

Note: Inside Docker, use service names (`postgres`, `redis`) not `localhost` for hostnames.

---

## 6. Dashboard Blank or Shows Errors

**Symptom:** Dashboard loads but shows a blank page, spinner that never resolves, or console errors about failed API calls.

**Cause:**
- Frontend built against wrong API URL
- Frontend assets not built (`npm run build` not run)
- CORS blocking API requests from the dashboard origin
- API server is down

**Fix:**

```bash
# Rebuild the frontend
cd packages/dashboard
npm install
npm run build

# Check browser console (F12) for errors — look for:
# - CORS errors → configure allowed origins on the server
# - 401/403 → API key or auth misconfiguration
# - Network errors → API server not running

# Verify API is reachable from where the dashboard runs
curl http://localhost:3400/api/v1/health
```

If running the dashboard on a different host/port than the API, set the API URL environment variable before building:
```bash
VITE_API_URL=http://your-server:3400 npm run build
```

---

## 7. Hash Chain Verification Fails

**Symptom:** `Hash chain verification failed for session X` or integrity check errors in the audit log.

**Cause:**
- Events arrived or were inserted out of order
- Manual edits to the database broke the chain
- Gap in event sequence numbers (deleted events)
- Clock skew between distributed workers

**Fix:**

```bash
# Run the built-in verification tool
npx @agentlensai/server verify-chain --session SESSION_ID

# This will show exactly where the chain breaks:
# ✓ Event 1 → 2 → 3 → 4
# ✗ Event 4 → 5 (hash mismatch)
# ✗ Event 7 (gap: 5-6 missing)
```

**Prevention:**
- Never manually edit or delete rows in the events table
- If you must fix data, use the SDK's correction API which maintains the chain
- For distributed setups, ensure all workers use the same time source (NTP)

**If the chain is already broken:** The break point is logged. Events before the break are still verifiable. Events after will need to be re-anchored — consult the [configuration guide](./configuration.md) for `HASH_CHAIN_REANCHOR`.

---

## 8. High Memory or CPU Usage

**Symptom:** Server process consuming excessive memory or CPU, slow responses, or OOM kills in Docker.

**Cause:**
- `BACKPRESSURE_THRESHOLD` set too high, buffering too many events
- Too many concurrent SSE (Server-Sent Events) connections from dashboard tabs
- Large sessions with thousands of events being replayed

**Fix:**

```env
# Lower the back-pressure threshold (default: 1000)
BACKPRESSURE_THRESHOLD=500
```

```bash
# Check current connections
curl http://localhost:3400/api/v1/health

# In Docker, set memory limits
# docker-compose.yml:
# services:
#   server:
#     mem_limit: 512m
```

Close unused dashboard tabs — each tab holds an SSE connection.

---

## Still Stuck?

- Check the [Getting Started guide](./getting-started.md) to verify your setup
- Review [Configuration](./configuration.md) for all environment variables
- Open an issue on [GitHub](https://github.com/amitpaz/agentlens/issues) with:
  - Your environment (OS, Node version, Docker version)
  - Relevant logs
  - Steps to reproduce
