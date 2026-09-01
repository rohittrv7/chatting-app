const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_jwt_access_key_12345';
const LIVE_URL = 'https://chatting-app-rme6.onrender.com';

function createToken() {
  return jwt.sign(
    { sub: '724a3472-f453-4a3d-89f1-3e4103a6b4e2', deviceId: 'test_dev' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

async function testLive() {
  console.log('Testing connection to:', LIVE_URL);
  const token = createToken();

  console.log('\n--- 1. Testing with transports: ["polling", "websocket"] ---');
  await testSocket(['polling', 'websocket'], token);

  console.log('\n--- 2. Testing with transports: ["websocket"] ---');
  await testSocket(['websocket'], token);
}

function testSocket(transports, token) {
  return new Promise((resolve) => {
    const s = io(LIVE_URL, {
      transports,
      auth: { token },
      timeout: 10000,
      reconnectionAttempts: 2,
    });

    s.on('connect', () => {
      console.log(
        `✅ Connected successfully with transports: [${transports.join(', ')}]! Socket ID: ${s.id}`,
      );
      s.disconnect();
      resolve(true);
    });

    s.on('connect_error', (err) => {
      console.log(`❌ connect_error with transports [${transports.join(', ')}]:`, err.message);
      s.disconnect();
      resolve(false);
    });

    setTimeout(() => {
      console.log(`⏱️ Timeout with transports [${transports.join(', ')}]`);
      s.disconnect();
      resolve(false);
    }, 12000);
  });
}

testLive().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
});
