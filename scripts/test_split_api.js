const http = require('http');

function post(urlPath, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('1. Requesting OTP...');
  const otpRes = await post('/api/v1/auth/otp/request', { phoneNumber: '+919876543210' });
  console.log('OTP response:', otpRes);
  const otp = otpRes.data?.data?.mockOtp || otpRes.data?.data?.otp || '123456';
  console.log('Extracted OTP:', otp);

  console.log('2. Verifying OTP...');
  const verifyRes = await post('/api/v1/auth/otp/verify', {
    phoneNumber: '+919876543210',
    otp,
    deviceId: 1,
    deviceName: 'Test',
    platform: 'ANDROID',
  });
  console.log('Verify response:', verifyRes.data);
  const token = verifyRes.data?.data?.accessToken;
  console.log('Token extracted:', token ? token.substring(0, 30) + '...' : 'NONE');

  console.log('3. Creating expense split for 3 people (You + 2 others)...');
  const splitRes = await post(
    '/api/v1/expenses/split',
    {
      title: 'Goa Trip Dinner',
      totalAmount: 3000,
      currency: 'INR',
      participantIds: ['+919876543211', '+919876543212'],
      autoCreateGroup: true,
    },
    {
      Authorization: `Bearer ${token}`,
    },
  );
  console.log('Split Result status:', splitRes.status);
  console.log('Split Result data:', JSON.stringify(splitRes.data, null, 2));
}

run().catch(console.error);
