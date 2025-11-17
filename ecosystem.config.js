module.exports = {
  apps: [{
    name: 'jira-oauth-web-only',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    env_file: '.env',
    error_file: './logs/jira-oauth-web-only-error.log',
    out_file: './logs/jira-oauth-web-only-out.log',
    log_file: './logs/jira-oauth-web-only-combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
