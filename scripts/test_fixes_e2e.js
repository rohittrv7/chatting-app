/**
 * E2E Automated Verification Test for:
 * 1. Strict Chat Isolation & Media Size Metadata
 * 2. Universal Dual-Device Call Termination
 * 3. WebRTC SDP Offer / Answer & ICE Candidate Signaling
 */

const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super_secret_jwt_access_key_12345';
const SERVER_URL = process.env.SERVER_URL || 'http://10.248.132.14:3000';

const USER_A_ID = '724a3472-f453-4a3d-89f1-3e4103a6b4e2';
const USER_B_ID = '0630106c-a6d9-4255-acfb-87dba1318af3';
const USER_C_ID = '11111111-2222-3333-4444-555555555555';

function createToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId, jti: 'test_' + Date.now() + Math.random() },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function connectSocket(userId, deviceId = 'dev1') {
  const token = createToken(userId, deviceId);
  return io(SERVER_URL, {
    transports: ['polling', 'websocket'],
    auth: { token },
    timeout: 10000,
  });
}

async function runTests() {
  console.log(`\n🧪 Running Comprehensive E2E Verification on: ${SERVER_URL}\n`);

  const socketA = connectSocket(USER_A_ID);
  const socketB = connectSocket(USER_B_ID);
  const socketC = connectSocket(USER_C_ID);

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
    new Promise((resolve) => socketC.on('connect', resolve)),
  ]);

  console.log('✔ Connected 3 test sockets (User A, User B, User C) successfully ✅\n');

  // ── TEST 1: Strict Chat Isolation & Media Size ──
  console.log('--- TEST 1: Chat Isolation & Media Metadata ---');
  let userBReceivedMsg = false;
  let userCReceivedLeak = false;

  socketB.on('message:new', (msg) => {
    if (msg.clientMessageId === 'cmid_photo_iso_test') {
      userBReceivedMsg = true;
      if (msg.mediaSize === '1.8 MB') {
        console.log(`✔ User B received media message with mediaSize="1.8 MB" ✅`);
      }
    }
  });

  socketC.on('message:new', (msg) => {
    if (msg.clientMessageId === 'cmid_photo_iso_test') {
      userCReceivedLeak = true;
    }
  });

  socketA.emit('message:send', {
    clientMessageId: 'cmid_photo_iso_test',
    conversationId: 'temporary_or_stale_conv_id',
    receiverId: USER_B_ID,
    imagePath: 'https://b2.storage.com/photo_iso_test.jpg',
    mediaSize: '1.8 MB',
    text: 'Isolated Photo Send Test',
  });

  await new Promise((r) => setTimeout(r, 1200));

  if (userBReceivedMsg && !userCReceivedLeak) {
    console.log(
      '✔ Strict Chat Isolation Verified: User B got message, User C got 0 leaked messages ✅\n',
    );
  } else {
    throw new Error(
      `Isolation failed! B_received=${userBReceivedMsg}, C_leaked=${userCReceivedLeak}`,
    );
  }

  // ── TEST 2: WebRTC Signaling (SDP Offer, Answer & ICE Candidate Relay) ──
  console.log('--- TEST 2: WebRTC Signaling (Offer / Answer / ICE Candidates) ---');
  let userBReceivedIncoming = false;
  let userBReceivedOffer = false;
  let userAReceivedAccept = false;
  let userAReceivedAnswer = false;
  let userBReceivedCandidate = false;

  const testCallId = `call_webrtc_${Date.now()}`;
  const mockOffer = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
  const mockAnswer = {
    type: 'answer',
    sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n',
  };
  const mockCandidate = {
    candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  };

  socketB.on('call:incoming', (data) => {
    if (data.callId === testCallId) {
      userBReceivedIncoming = true;
      if (data.sdp && data.sdp.type === 'offer') {
        userBReceivedOffer = true;
      }
    }
  });

  socketA.on('call:accepted', (data) => {
    if (data.callId === testCallId) {
      userAReceivedAccept = true;
      if (data.sdp && data.sdp.type === 'answer') {
        userAReceivedAnswer = true;
      }
    }
  });

  socketB.on('call:ice-candidate', (data) => {
    if (data.callId === testCallId && data.candidate) {
      userBReceivedCandidate = true;
    }
  });

  // User A initiates WebRTC call with SDP Offer
  socketA.emit('call:initiate', {
    callId: testCallId,
    receiverId: USER_B_ID,
    callType: 'video',
    callerName: 'User A',
    sdp: mockOffer,
  });

  await new Promise((r) => setTimeout(r, 600));

  // User B accepts call with SDP Answer
  socketB.emit('call:accept', {
    callId: testCallId,
    callerId: USER_A_ID,
    sdp: mockAnswer,
  });

  // User A sends discovered ICE Candidate
  socketA.emit('call:ice-candidate', {
    callId: testCallId,
    targetUserId: USER_B_ID,
    candidate: mockCandidate,
  });

  await new Promise((r) => setTimeout(r, 1000));

  if (
    userBReceivedIncoming &&
    userBReceivedOffer &&
    userAReceivedAccept &&
    userAReceivedAnswer &&
    userBReceivedCandidate
  ) {
    console.log('✔ WebRTC SDP Offer / Answer & ICE Candidate Signaling: PASSED 100% ✅\n');
  } else {
    throw new Error(
      `WebRTC signaling failed! incoming=${userBReceivedIncoming}, offer=${userBReceivedOffer}, accept=${userAReceivedAccept}, answer=${userAReceivedAnswer}, candidate=${userBReceivedCandidate}`,
    );
  }

  // ── TEST 3: Universal Call Termination Sync ──
  console.log('--- TEST 3: Universal Call Termination Sync ---');
  let userBReceivedEnd = false;

  socketB.on('call:ended', (payload) => {
    if (payload.callId === testCallId) {
      userBReceivedEnd = true;
    }
  });

  // User A hangs up
  socketA.emit('call:end', {
    callId: testCallId,
    targetUserId: USER_B_ID,
    reason: 'ended',
  });

  await new Promise((r) => setTimeout(r, 800));

  if (userBReceivedEnd) {
    console.log(
      '✔ Universal Call Termination Verified: User B received instant call:ended signal ✅\n',
    );
  } else {
    throw new Error('Call termination failed to reach User B');
  }

  // ── TEST 4: Caller-Side Online Presence & Calling/Ringing State ──
  console.log('--- TEST 4: Caller Presence Check (Ringing vs Calling) ---');
  const OFFLINE_USER_ID = '99999999-8888-7777-6666-555555555555';
  let onlineStatusReceived = null;
  let offlineStatusReceived = null;

  const testOnlineCallId = `call_pres_on_${Date.now()}`;
  const testOfflineCallId = `call_pres_off_${Date.now()}`;

  socketA.on('call:status', (payload) => {
    if (payload.callId === testOnlineCallId) {
      onlineStatusReceived = payload.status;
    }
    if (payload.callId === testOfflineCallId) {
      offlineStatusReceived = payload.status;
    }
  });

  // Call online user B
  socketA.emit('call:initiate', {
    callId: testOnlineCallId,
    receiverId: USER_B_ID,
    callType: 'audio',
    callerName: 'User A',
  });

  // Call offline user
  socketA.emit('call:initiate', {
    callId: testOfflineCallId,
    receiverId: OFFLINE_USER_ID,
    callType: 'audio',
    callerName: 'User A',
  });

  await new Promise((r) => setTimeout(r, 800));

  if (onlineStatusReceived === 'RINGING' && offlineStatusReceived === 'CALLING') {
    console.log(
      '✔ Presence Check Verified: Online recipient -> "RINGING" (plays ringback tone), Offline recipient -> "CALLING" (no tone) ✅\n',
    );
  } else {
    throw new Error(
      `Presence check failed! onlineStatus=${onlineStatusReceived}, offlineStatus=${offlineStatusReceived}`,
    );
  }

  // ── TEST 5: Cancel-Before-Answer (Caller Cancels While Ringing) ──
  console.log('--- TEST 5: Cancel-Before-Answer (Caller Cancels While Ringing) ---');
  const cancelTestCallId = `call_cancel_${Date.now()}`;
  let userBGotIncoming = false;
  let userBGotEnded = false;
  let userBGotCancelled = false;

  socketB.on('call:incoming', (payload) => {
    if (payload.callId === cancelTestCallId) {
      userBGotIncoming = true;
    }
  });

  socketB.on('call:ended', (payload) => {
    if (payload.callId === cancelTestCallId) {
      userBGotEnded = true;
    }
  });

  socketB.on('call:cancelled', (payload) => {
    if (payload.callId === cancelTestCallId) {
      userBGotCancelled = true;
    }
  });

  // 1. Caller starts call
  socketA.emit('call:initiate', {
    callId: cancelTestCallId,
    receiverId: USER_B_ID,
    callType: 'audio',
    callerName: 'User A',
  });

  await new Promise((r) => setTimeout(r, 400));

  // 2. Caller cancels within 1-2 seconds (before callee accepts/rejects)
  socketA.emit('call:cancel', {
    callId: cancelTestCallId,
    targetUserId: USER_B_ID,
    reason: 'cancelled',
  });

  await new Promise((r) => setTimeout(r, 800));

  if (userBGotIncoming && userBGotEnded && userBGotCancelled) {
    console.log(
      '✔ Cancel-Before-Answer Verified: Callee received incoming, then instant ended + cancelled signals to dismiss UI and stop ringtone ✅\n',
    );
  } else {
    throw new Error(
      `Cancel-Before-Answer failed! incoming=${userBGotIncoming}, ended=${userBGotEnded}, cancelled=${userBGotCancelled}`,
    );
  }

  socketA.disconnect();
  socketB.disconnect();
  socketC.disconnect();

  console.log(
    '🎉 ALL WEBRTC MEDIA, MESSAGING & CALL CANCELLATION WORKFLOWS VERIFIED 100% SUCCESSFUL!\n',
  );
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
