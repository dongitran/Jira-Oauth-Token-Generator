require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const pendingAuths = new Map();

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

app.get('/auth/start', (req, res) => {
  const state = uuidv4();
  pendingAuths.set(state, { 
    timestamp: Date.now(),
    ip_address: req.ip,
    user_agent: req.get('user-agent')
  });

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: process.env.JIRA_ATLASSIAN_CLIENT_ID,
    scope: 'read:jira-user read:jira-work manage:jira-project write:jira-work offline_access read:me',
    redirect_uri: process.env.JIRA_REDIRECT_URI,
    state: state,
    response_type: 'code',
    prompt: 'consent'
  });

  const authUrl = `${ATLASSIAN_AUTH_URL}?${params.toString()}`;

  res.json({
    auth_url: authUrl,
    state: state
  });
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`Authentication failed: ${error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing authorization code or state');
  }

  const authData = pendingAuths.get(state);
  if (!authData) {
    return res.status(400).send('Invalid or expired state');
  }

  pendingAuths.delete(state);

  try {
    const tokenResponse = await axios.post(ATLASSIAN_TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: process.env.JIRA_ATLASSIAN_CLIENT_ID,
      client_secret: process.env.JIRA_ATLASSIAN_CLIENT_SECRET,
      code: code,
      redirect_uri: process.env.JIRA_REDIRECT_URI
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const { access_token, refresh_token, expires_in, scope } = tokenResponse.data;

    console.log('Getting user profile...');
    const userResponse = await axios.get('https://api.atlassian.com/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });

    const resources = resourcesResponse.data;

    // Validate workspace - check if user has access to allowed workspace
    const allowedWorkspace = process.env.ALLOWED_WORKSPACE;
    let allowedWorkspaceResource = null;
    
    if (allowedWorkspace) {
      allowedWorkspaceResource = resources.find(r => r.name.toLowerCase() === allowedWorkspace.toLowerCase());
      
      if (!allowedWorkspaceResource) {
        console.log(`Access denied for user ${userResponse.data.email} - not in ${allowedWorkspace} workspace`);
        return res.status(403).send(`
        <html>
          <head>
            <title>Access Denied</title>
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
              }
              .error { color: #ef4444; font-size: 48px; }
              h2 { color: #1f2937; margin: 20px 0; }
              p { color: #6b7280; line-height: 1.6; }
              .workspace-list { 
                background: #f3f4f6; 
                padding: 15px; 
                border-radius: 8px; 
                margin: 20px 0;
                text-align: left;
              }
            </style>
          </head>
          <body>
            <div class="error">🚫</div>
            <h2>Access Denied</h2>
            <p>Sorry, this OAuth application is restricted to <strong>${allowedWorkspace}</strong> workspace only.</p>
            ${resources.length > 0 ? `
              <div class="workspace-list">
                <strong>Your accessible workspaces:</strong>
                <ul>
                  ${resources.map(r => `<li>${r.name}</li>`).join('')}
                </ul>
              </div>
            ` : '<p>You don\'t have access to any Jira workspace.</p>'}
            <p>Please contact your administrator if you believe this is an error.</p>
          </body>
        </html>
      `);
      }
      
      console.log(`Access granted: User ${userResponse.data.email} has access to ${allowedWorkspace} workspace`);
    }

    // Use the allowed workspace resource or first available resource
    const workspaceToUse = allowedWorkspaceResource || resources[0];

    let jiraUser = null;
    if (workspaceToUse) {
      try {
        console.log('Getting Jira user details...');
        const jiraUserResponse = await axios.get(
          `https://api.atlassian.com/ex/jira/${workspaceToUse.id}/rest/api/3/myself`,
          {
            headers: {
              'Authorization': `Bearer ${access_token}`
            }
          }
        );
        jiraUser = jiraUserResponse.data;
      } catch (jiraError) {
        console.error('Could not fetch Jira user details:', jiraError.message);
      }
    }

    // MCP Server config format
    const mcpConfig = {
      "jira": {
        "command": "jira-mcp-server",
        "args": [
          "--access_token",
          access_token,
          "--refresh_token",
          refresh_token,
          "--client_id",
          process.env.JIRA_ATLASSIAN_CLIENT_ID,
          "--client_secret",
          process.env.JIRA_ATLASSIAN_CLIENT_SECRET
        ],
        "env": {}
      }
    };

    console.log(`Auth completed for user: ${userResponse.data.email} (workspace: ${workspaceToUse.name})`);

    res.send(`
            <html>
                <head>
                    <title>Authentication Successful</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            max-width: 900px; 
                            margin: 50px auto; 
                            padding: 20px; 
                            background: #f9fafb;
                        }
                        .success { color: #22c55e; text-align: center; }
                        .info { 
                            background: #ffffff; 
                            padding: 20px; 
                            border-radius: 8px; 
                            margin: 20px 0; 
                            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        }
                        .user-info { margin: 10px 0; }
                        .token-box {
                            background: #1f2937;
                            color: #f9fafb;
                            padding: 15px;
                            border-radius: 8px;
                            margin: 15px 0;
                            font-family: 'Courier New', monospace;
                            font-size: 11px;
                            word-break: break-all;
                            max-height: 400px;
                            overflow-y: auto;
                            white-space: pre-wrap;
                        }
                        .copy-btn {
                            background: #667eea;
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 14px;
                            margin: 5px;
                        }
                        .copy-btn:hover {
                            background: #5568d3;
                        }
                        .section {
                            margin: 20px 0;
                        }
                        h3 {
                            color: #374151;
                            margin-bottom: 10px;
                        }
                        .json-container {
                            position: relative;
                        }
                        .copy-all-btn {
                            position: absolute;
                            top: 10px;
                            right: 10px;
                            z-index: 10;
                        }
                        .warning-box {
                            background: #fef3c7;
                            border-left: 4px solid #f59e0b;
                            padding: 15px;
                            border-radius: 4px;
                            margin: 20px 0;
                            font-size: 13px;
                            color: #92400e;
                        }
                        .info-box {
                            background: #dbeafe;
                            border-left: 4px solid #3b82f6;
                            padding: 15px;
                            border-radius: 4px;
                            margin: 20px 0;
                            font-size: 13px;
                            color: #1e40af;
                        }
                        .steps {
                            background: #f3f4f6;
                            padding: 15px;
                            border-radius: 8px;
                            margin: 15px 0;
                        }
                        .steps ol {
                            margin: 10px 0 0 20px;
                            line-height: 1.8;
                        }
                        .steps code {
                            background: #e5e7eb;
                            padding: 2px 6px;
                            border-radius: 3px;
                            font-size: 12px;
                        }
                    </style>
                </head>
                <body>
                    <h2 class="success">✅ Authentication Successful!</h2>
                    <div class="info">
                        <div class="user-info"><strong>User:</strong> ${userResponse.data.name}</div>
                        <div class="user-info"><strong>Email:</strong> ${userResponse.data.email}</div>
                        <div class="user-info"><strong>Workspace:</strong> ${workspaceToUse.name}</div>
                    </div>

                    <div class="warning-box">
                        <strong>⚠️ Security Notice:</strong> These credentials are sensitive. Store them securely in your MCP server configuration. Do not share or commit them to version control.
                    </div>

                    <div class="section">
                        <h3>📋 MCP Server Configuration (Claude Desktop / Cursor)</h3>
                        <div class="info-box">
                            <strong>💡 Ready to use!</strong> Copy the JSON below and paste it into your MCP configuration file.
                        </div>
                        <div class="json-container">
                            <button class="copy-btn copy-all-btn" onclick="copyToClipboard('mcpConfig', this)">📋 Copy Config</button>
                            <div class="token-box" id="mcpConfig">${JSON.stringify(mcpConfig, null, 2)}</div>
                        </div>
                        
                        <div class="steps">
                            <strong>🚀 How to use:</strong>
                            <ol>
                                <li>Copy the JSON configuration above</li>
                                <li><strong>Claude Desktop:</strong> Open <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
                                <li><strong>Cursor:</strong> Open <code>.cursor/mcp.json</code> in your project</li>
                                <li>Paste the config into <code>"mcpServers"</code> section</li>
                                <li>Restart Claude Desktop or Cursor</li>
                                <li>✅ Done! Tokens will be cached automatically</li>
                            </ol>
                        </div>
                    </div>

                    <p style="text-align: center; color: #6b7280; margin-top: 30px;">
                        <em>You can now close this window.</em>
                    </p>

                    <script>
                        function copyToClipboard(elementId, button) {
                            const element = document.getElementById(elementId);
                            const text = element.textContent;
                            
                            navigator.clipboard.writeText(text).then(() => {
                                const originalText = button.textContent;
                                button.textContent = '✅ Copied!';
                                button.style.background = '#22c55e';
                                
                                setTimeout(() => {
                                    button.textContent = originalText;
                                    button.style.background = '#667eea';
                                }, 2000);
                            }).catch(err => {
                                alert('Failed to copy: ' + err);
                            });
                        }
                    </script>
                </body>
            </html>
        `);

  } catch (error) {
    console.error('Error during token exchange:', error.response?.data || error.message);

    res.status(500).send(`
            <html>
                <head>
                    <title>Authentication Failed</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            max-width: 600px; 
                            margin: 50px auto; 
                            padding: 20px; 
                        }
                        .error { color: #ef4444; }
                    </style>
                </head>
                <body>
                    <h2 class="error">❌ Authentication Failed</h2>
                    <p>There was an error during the authentication process.</p>
                    <p>Error: ${error.response?.data?.error || error.message}</p>
                </body>
            </html>
        `);
  }
});

// Home page with OAuth link generator
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Jira OAuth - Connect Your Account</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 100%;
            padding: 40px;
          }
          h1 {
            color: #1a202c;
            font-size: 28px;
            margin-bottom: 10px;
            text-align: center;
          }
          .subtitle {
            color: #718096;
            text-align: center;
            margin-bottom: 30px;
            font-size: 14px;
          }
          .btn-primary {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
          }
          .btn-primary:active {
            transform: translateY(0);
          }
          .info-box {
            background: #edf2f7;
            border-left: 4px solid #667eea;
            padding: 15px;
            border-radius: 4px;
            margin-top: 25px;
            font-size: 13px;
            color: #4a5568;
          }
          .info-box strong {
            color: #2d3748;
          }
          .jira-logo {
            text-align: center;
            margin-bottom: 20px;
            font-size: 48px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="jira-logo">🔗</div>
          <h1>Connect Jira Account</h1>
          <p class="subtitle">Link your Atlassian account to get your OAuth tokens</p>
          
          <button class="btn-primary" id="connectBtn">
            🚀 Connect to Jira
          </button>

          <div class="info-box">
            <strong>💡 How it works:</strong> Click the button above to authenticate with your Atlassian account. 
            After successful authentication, you'll receive your OAuth credentials.
          </div>
        </div>

        <script>
          const connectBtn = document.getElementById('connectBtn');

          connectBtn.addEventListener('click', () => {
            fetch('/auth/start')
              .then(res => res.json())
              .then(data => {
                if (data.auth_url) {
                  window.location.href = data.auth_url;
                } else {
                  alert('Failed to generate auth link');
                }
              })
              .catch(err => {
                console.error('Error:', err);
                alert('Error generating auth link');
              });
          });
        </script>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    pending_auths: pendingAuths.size
  });
});

setInterval(() => {
  const now = Date.now();
  const expiredTime = 10 * 60 * 1000;

  for (const [state, data] of pendingAuths.entries()) {
    if (now - data.timestamp > expiredTime) {
      pendingAuths.delete(state);
    }
  }
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Jira OAuth server running on http://localhost:${port}`);
  console.log(`Callback URL: http://localhost:${port}/auth/callback`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Start auth: http://localhost:${port}/auth/start`);
});
