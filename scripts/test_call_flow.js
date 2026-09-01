const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_jwt_access_key_12345';
const SERVER_URL = process.env.SERVER_URL || 'http://10.96.71.14:3000';

const USER_A_ID = '724a3472-f453-4a3d-89f1-3e4103a6b4e2';
const USER_B_ID = '0630106c-a6d9-4255-acfb-87dba1318af3';

function createToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId, jti: 'test_' + Date.now() + Math.random() },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

async function runTest() {
  console.log(
    '🚀 Starting Complete Two-Way Audio & Video Call Flow Simulation Tests against ' +
      SERVER_URL +
      '...\n',
  );

  const tokenA = createToken(USER_A_ID, 'device_a');
  const tokenB = createToken(USER_B_ID, 'device_b');

  console.log('1. Connecting Client A and Client B to Socket.io server...');
  const clientA = io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    auth: { token: tokenA },
  });

  const clientB = io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    auth: { token: tokenB },
  });

  await Promise.all([
    new Promise((resolve, reject) => {
      clientA.on('connect', () => {
        console.log('✅ Client A connected (socketId: ' + clientA.id + ')');
        resolve(true);
      });
      clientA.on('connect_error', reject);
    }),
    new Promise((resolve, reject) => {
      clientB.on('connect', () => {
        console.log('✅ Client B connected (socketId: ' + clientB.id + ')');
        resolve(true);
      });
      clientB.on('connect_error', reject);
    }),
  ]);

  // --- TEST 1: AUDIO CALL FLOW (User A -> User B) ---
  console.log('\n--- TEST 1: USER A CALLS USER B (AUDIO CALL) ---');
  const callId1 = 'call_audio_' + Date.now();

  const bGotIncoming1 = new Promise((res) => clientB.once('call:incoming', res));
  const aGotRinging1 = new Promise((res) => {
    const handler = (p) => {
      if (p.status === 'RINGING') {
        clientA.off('call:status', handler);
        res(p);
      }
    };
    clientA.on('call:status', handler);
  });

  clientA.emit('call:initiate', {
    callId: callId1,
    receiverId: USER_B_ID,
    callType: 'audio',
    callerName: 'User A',
  });

  await Promise.all([bGotIncoming1, aGotRinging1]);
  console.log('✅ Client B received incoming audio call notification!');

  const aGotConnected1 = new Promise((res) => {
    const handler = (p) => {
      if (p.status === 'CONNECTED') {
        clientA.off('call:status', handler);
        res(p);
      }
    };
    clientA.on('call:status', handler);
  });

  clientB.emit('call:accept', {
    callId: callId1,
    callerId: USER_A_ID,
  });

  await aGotConnected1;
  console.log('✅ Client A successfully transitioned to CONNECTED!');

  const bGotAudio1 = new Promise((res) => clientB.once('call:audio-chunk', res));
  clientA.emit('call:audio-chunk', {
    callId: callId1,
    targetUserId: USER_B_ID,
    audioBase64: Buffer.from('VOICE_STREAM_DATA_A_TO_B').toString('base64'),
    chunkIndex: 1,
  });
  await bGotAudio1;
  console.log('✅ Live voice audio chunk received by Client B!');

  const bGotEnded1 = new Promise((res) => clientB.once('call:ended', res));
  clientA.emit('call:end', {
    callId: callId1,
    targetUserId: USER_B_ID,
    reason: 'ended',
  });
  await bGotEnded1;
  console.log('✅ Audio Call ended cleanly!');

  await new Promise((r) => setTimeout(r, 400));

  // --- TEST 2: VIDEO CALL FLOW (User B -> User A) ---
  console.log('\n--- TEST 2: USER B CALLS USER A (HD VIDEO CALL) ---');
  const callId2 = 'call_video_' + Date.now();

  const aGotIncoming2 = new Promise((res) => clientA.once('call:incoming', res));
  const bGotRinging2 = new Promise((res) => {
    const handler = (p) => {
      if (p.status === 'RINGING') {
        clientB.off('call:status', handler);
        res(p);
      }
    };
    clientB.on('call:status', handler);
  });

  clientB.emit('call:initiate', {
    callId: callId2,
    receiverId: USER_A_ID,
    callType: 'video',
    callerName: 'User B',
  });

  const incoming2Data = await aGotIncoming2;
  await bGotRinging2;
  console.log(
    '✅ Client A received incoming HD Video call notification (callType=' +
      incoming2Data.callType +
      ')!',
  );

  const bGotConnected2 = new Promise((res) => {
    const handler = (p) => {
      if (p.status === 'CONNECTED') {
        clientB.off('call:status', handler);
        res(p);
      }
    };
    clientB.on('call:status', handler);
  });

  clientA.emit('call:accept', {
    callId: callId2,
    callerId: USER_B_ID,
  });

  await bGotConnected2;
  console.log('✅ Client B successfully transitioned to CONNECTED (Video Mode Active)!');

  // Test Two-Way Video Frame Streaming
  const aGotVideoFrame = new Promise((res) => clientA.once('call:video-frame', res));
  clientB.emit('call:video-frame', {
    callId: callId2,
    targetUserId: USER_A_ID,
    frameBase64: 'data:image/jpeg;base64,SIMULATED_LIVE_CAMERA_FRAME_B_TO_A',
    timestamp: Date.now(),
  });
  const videoFrameData = await aGotVideoFrame;
  console.log(
    '✅ Client A received live camera video frame from Client B (' +
      videoFrameData.frameBase64.substring(0, 30) +
      '...)!',
  );

  // --- TEST 3: DYNAMIC MODE SWITCHING (VIDEO <-> AUDIO) ---
  console.log('\n--- TEST 3: DYNAMIC MODE SWITCHING (VIDEO -> AUDIO -> VIDEO) ---');

  // Switch to Audio
  const aGotVideoOff = new Promise((res) => clientA.once('call:switch-video', res));
  clientB.emit('call:switch-video', {
    callId: callId2,
    targetUserId: USER_A_ID,
    action: 'reject',
    isVideo: false,
  });
  const videoOffData = await aGotVideoOff;
  console.log('✅ Client A received switch to Audio mode (isVideo=' + videoOffData.isVideo + ')!');

  // Switch back to Video
  const aGotVideoOn = new Promise((res) => clientA.once('call:switch-video', res));
  clientB.emit('call:switch-video', {
    callId: callId2,
    targetUserId: USER_A_ID,
    action: 'request',
    isVideo: true,
  });
  const videoOnData = await aGotVideoOn;
  console.log(
    '✅ Client A received switch back to Video mode (isVideo=' + videoOnData.isVideo + ')!',
  );

  const aGotEnded2 = new Promise((res) => clientA.once('call:ended', res));
  clientB.emit('call:end', {
    callId: callId2,
    targetUserId: USER_A_ID,
    reason: 'ended',
  });
  await aGotEnded2;
  console.log('✅ Video Call ended cleanly!');

  console.log('\n================================================================');
  console.log('🎉 100% TWO-WAY AUDIO & VIDEO CALLING + MODE SWITCHING PASSED!');
  console.log('================================================================');

  clientA.disconnect();
  clientB.disconnect();
  process.exit(0);
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
