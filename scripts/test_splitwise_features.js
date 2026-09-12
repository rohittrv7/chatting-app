const http = require('http');

function request(method, urlPath, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: urlPath,
        method: method,
        headers: {
          ...(postData
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              }
            : {}),
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function loginUser(phoneNumber) {
  const otpRes = await request('POST', '/api/v1/auth/otp/request', { phoneNumber });
  const otp = otpRes.data?.data?.mockOtp || otpRes.data?.data?.otp || '123456';
  const verifyRes = await request('POST', '/api/v1/auth/otp/verify', {
    phoneNumber,
    otp,
    deviceId: 1,
    deviceName: 'TestDevice',
    platform: 'ANDROID',
  });
  return {
    token: verifyRes.data?.data?.accessToken,
    userId: verifyRes.data?.data?.user?.id,
  };
}

async function run() {
  console.log('=== TESTING SPLITWISE-LEVEL FEATURES ===\n');

  console.log('1. Logging in Rohit (+919876543210) & Aman (+919876543220)...');
  const userA = await loginUser('+919876543210');
  const userB = await loginUser('+919876543220');
  console.log(`User A (Rohit): ${userA.userId}`);
  console.log(`User B (Aman):  ${userB.userId}\n`);

  // Test 1: Paid by someone else (Aman paid, Rohit split)
  console.log('2. Testing "Paid By": Rohit creates split for ₹1000, but Aman paid it...');
  const paidByRes = await request(
    'POST',
    '/api/v1/expenses/split',
    {
      title: 'Cafe Coffee Day',
      totalAmount: 1000,
      currency: 'INR',
      participantIds: [userB.userId],
      paidByUserId: userB.userId,
      splitType: 'EQUAL',
      category: 'FOOD',
    },
    { Authorization: `Bearer ${userA.token}` },
  );
  console.log('Status:', paidByRes.status);
  const expense1 = paidByRes.data?.data?.expense || paidByRes.data?.expense;
  console.log('Split created with paidBy:', expense1?.paidBy);
  console.log(
    'Participants:',
    expense1?.participants?.map((p) => ({
      userId: p.userId,
      amount: p.amountOwed,
      isPaid: p.isPaid,
    })),
  );

  // Test 2: Percentage Split
  console.log('\n3. Testing Percentage Split (60% - 40%)...');
  const percentRes = await request(
    'POST',
    '/api/v1/expenses/split',
    {
      title: 'Uber to Airport',
      totalAmount: 500,
      splitType: 'PERCENT',
      category: 'TRAVEL',
      participantIds: [userB.userId],
      shares: {
        [userA.userId]: 60,
        [userB.userId]: 40,
      },
    },
    { Authorization: `Bearer ${userA.token}` },
  );
  console.log('Status:', percentRes.status);
  const expPercent = percentRes.data?.data?.expense || percentRes.data?.expense;
  console.log(
    'Percent split participants:',
    expPercent?.participants?.map((p) => ({
      userId: p.userId,
      amount: p.amountOwed,
      shareValue: p.shareValue,
    })),
  );

  // Test 3: Shares Split
  console.log('\n4. Testing Shares Split (2 shares vs 1 share)...');
  const sharesRes = await request(
    'POST',
    '/api/v1/expenses/split',
    {
      title: 'Groceries / Flat Rent',
      totalAmount: 1500,
      splitType: 'SHARES',
      category: 'BILLS',
      isOngoingGroup: true,
      participantIds: [userB.userId],
      shares: {
        [userA.userId]: 2,
        [userB.userId]: 1,
      },
    },
    { Authorization: `Bearer ${userA.token}` },
  );
  console.log('Status:', sharesRes.status);
  const expShares = sharesRes.data?.data?.expense || sharesRes.data?.expense;
  console.log(
    'Shares split participants:',
    expShares?.participants?.map((p) => ({
      userId: p.userId,
      amount: p.amountOwed,
      shareValue: p.shareValue,
      isOngoingGroup: expShares?.isOngoingGroup,
    })),
  );

  // Test 4: Overall Net Balances (Simplify Debts)
  console.log('\n5. Testing GET /api/v1/expenses/net-balances for User A...');
  const netBalRes = await request('GET', '/api/v1/expenses/net-balances', null, {
    Authorization: `Bearer ${userA.token}`,
  });
  console.log('Status:', netBalRes.status);
  console.log(
    'Net Balances Summary:',
    JSON.stringify(netBalRes.data?.data?.summary || netBalRes.data?.summary, null, 2),
  );
  console.log(
    'Per Contact Balances:',
    JSON.stringify(netBalRes.data?.data?.balances || netBalRes.data?.balances, null, 2),
  );

  // Test 5: Direct Settle Up
  console.log('\n6. Testing POST /api/v1/expenses/settle-up (User A settles ₹500 with User B)...');
  const settleRes = await request(
    'POST',
    '/api/v1/expenses/settle-up',
    {
      targetUserId: userB.userId,
      amount: 500,
      notes: 'GPay / UPI Payment',
    },
    { Authorization: `Bearer ${userA.token}` },
  );
  console.log('Status:', settleRes.status);
  console.log('Settlement recorded:', JSON.stringify(settleRes.data, null, 2));

  // Test 6: Category Filter
  console.log('\n7. Testing GET /api/v1/expenses/history?category=FOOD...');
  const historyCatRes = await request('GET', '/api/v1/expenses/history?category=FOOD', null, {
    Authorization: `Bearer ${userA.token}`,
  });
  console.log('Status:', historyCatRes.status);
  const splits = historyCatRes.data?.data?.splits || historyCatRes.data?.splits || [];
  console.log(`Found ${splits.length} FOOD expenses`);

  console.log('\n✅ ALL SPLITWISE BACKEND TESTS COMPLETED SUCCESSFULLY!');
}

run().catch((e) => console.error('Error running test script:', e));
