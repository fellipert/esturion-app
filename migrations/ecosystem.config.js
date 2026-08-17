module.exports = {
  apps: [
    {
      name: 'esturion-app',
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
    },
  ],
};
