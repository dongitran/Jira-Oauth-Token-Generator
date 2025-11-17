# 🔐 Jira OAuth Token Generator

Simple web-based OAuth 2.0 token generator for Jira/Atlassian. Get your access token, refresh token in one click.

## ✨ Features

- 🚀 Simple one-click OAuth flow
- 🔒 Workspace validation (optional)
- 📋 Copy credentials as JSON
- 🎯 No database required
- ⚡ Lightweight and fast

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
JIRA_ATLASSIAN_CLIENT_ID=your_client_id
JIRA_ATLASSIAN_CLIENT_SECRET=your_client_secret
JIRA_REDIRECT_URI=http://localhost:3001/auth/callback
PORT=3001
ALLOWED_WORKSPACE=your-workspace-name  # Optional: restrict to specific workspace
```

### Run

```bash
# Development
npm run dev

# Production
npm start

# With PM2
pm2 start ecosystem.config.js
```

## 📖 Usage

1. Open http://localhost:3001
2. Click "Connect to Jira"
3. Authorize with your Atlassian account
4. Copy the MCP configuration JSON

### Output Format (MCP Server Config)

```json
{
  "jira": {
    "command": "jira-mcp-server",
    "args": [
      "--access_token",
      "eyJhbGc...",
      "--refresh_token",
      "eyJhbGc...",
      "--client_id",
      "your_client_id",
      "--client_secret",
      "your_client_secret"
    ],
    "env": {}
  }
}
```

### How to Use the Config

**For Claude Desktop:**
1. Open `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the config to `"mcpServers"` section:
```json
{
  "mcpServers": {
    "jira": {
      "command": "jira-mcp-server",
      "args": ["--access_token", "...", "--refresh_token", "...", "--client_id", "...", "--client_secret", "..."],
      "env": {}
    }
  }
}
```
3. Restart Claude Desktop

**For Cursor:**
1. Create `.cursor/mcp.json` in your project
2. Paste the config
3. Restart Cursor

**Note:** After first run, tokens are cached to `~/.jira-mcp/tokens.cache` and will auto-refresh. You only need to provide tokens once!

### OAuth Scopes

Default scopes:
- `read:jira-user` - Read user information
- `read:jira-work` - Read Jira issues and projects
- `manage:jira-project` - Manage projects
- `write:jira-work` - Create and update issues
- `offline_access` - Get refresh token
- `read:me` - Read account information

## 🛠️ API Endpoints

- `GET /` - Home page with OAuth button
- `GET /auth/start` - Start OAuth flow
- `GET /auth/callback` - OAuth callback (internal)
- `GET /health` - Health check

## 👨‍💻 Author

dongtran ✨

## 📄 License

MIT

---

Made with ❤️ to make your work life easier!
