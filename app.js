
/****************************************************
 * AUTO MONEY - FRONTEND APPLICATION
 * Frontend: GitHub Pages
 * Backend: Google Apps Script
 * Login: LINE LIFF + Student ID Binding
 *
 * เปลี่ยนเฉพาะระบบเลือกนักศึกษาเป็นระบบผูก LINE
 * ระบบ PromptPay / QR / Slip / Payment คงเดิม
 ****************************************************/


// ==================================================
// 1. CONFIGURATION
// ==================================================

const CONFIG = {
  GAS_WEB_APP_URL:
    'https://script.google.com/macros/s/AKfycby4GAoq5mkXVXWXvL4sd2eENyPUZ6XONYGzNQ3z3vXn_Ak2bJkWSW8NHKNdNnr5Quy5/exec',

  LIFF_ID: '2012645761-WmDBRWza',

  MAX_IMAGE_WIDTH: 800,
  IMAGE_QUALITY: 0.7,

  REQUEST_TIMEOUT: 60000,

  QR_SIZE: 240,

  QR_LIBRARY_URL:
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
};


// ==================================================
// 2. GLOBAL STATE
// ==================================================

const STATE = {
  idToken: '',
  lineUserId: 'GUEST',

  studentId: '',
  studentName: '',

  lookupStudentId: '',
  lookupStudentName: '',

  compressedBase64: '',

  items: [],
  promptPay: null,

  isLiffReady: false,
  isSubmitting: false,
  isLoadingItems: false,

  itemRequestId: 0,
  qrRenderId: 0
};


// ==================================================
// 3. INITIALIZE APPLICATION
// ==================================================

window.addEventListener('DOMContentLoaded', async function() {
  setupEventListeners();

  ensurePromptPaySection();

  try {
    showLoading('กำลังเชื่อมต่อ LINE...');

    const liffReady = await initLiff();

    if (liffReady === 'redirect') {
      return;
    }

    if (!liffReady) {
      throw new Error(
        'ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาเปิดผ่าน LINE อีกครั้ง'
      );
    }

    await checkLinkedAccount();

  } catch (error) {
    console.error('Application Init Error:', error);
    showError(error.message || error);
  }
});


// ==================================================
// 4. LOADING AND ERROR UI
// ==================================================

function showLoading(message) {
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.textContent = message || 'กำลังโหลดข้อมูล...';
    loadingEl.classList.remove('hidden');
  }
}


function hideLoading() {
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.classList.add('hidden');
  }
}


function showError(message) {
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.textContent = '⚠️ ' + message;
    loadingEl.classList.remove('hidden');
  }
}


function showLoginSection() {
  hideLoading();

  document.getElementById('loginSection')?.classList.remove('hidden');
  document.getElementById('paymentSection')?.classList.add('hidden');
}


function showPaymentSection() {
  hideLoading();

  document.getElementById('loginSection')?.classList.add('hidden');
  document.getElementById('paymentSection')?.classList.remove('hidden');
}


// ==================================================
// 5. INITIALIZE LINE LIFF
// ==================================================

async function initLiff() {
  if (!CONFIG.LIFF_ID || typeof liff === 'undefined') {
    throw new Error('ไม่พบ LINE LIFF SDK');
  }

  try {
    await liff.init({
      liffId: CONFIG.LIFF_ID
    });

    if (!liff.isLoggedIn()) {
      liff.login();
      return 'redirect';
    }

    STATE.idToken = liff.getIDToken();

    if (!STATE.idToken) {
      throw new Error(
        'ไม่พบ ID Token กรุณาตรวจสอบ LIFF Scope ว่าเปิด openid แล้ว'
      );
    }

    STATE.isLiffReady = true;

    // ใช้เพื่อแสดงข้อมูลเท่านั้น ไม่ใช้เป็นหลักฐานยืนยันตัวตน
    try {
      const profile = await liff.getProfile();

      if (profile && profile.userId) {
        STATE.lineUserId = profile.userId;
      }
    } catch (profileError) {
      console.warn('ไม่สามารถโหลด LINE Profile ได้', profileError);
    }

    console.log('LIFF Connected');

    return true;

  } catch (error) {
    console.error('LIFF Init Error:', error);
    throw error;
  }
}


// ==================================================
// 6. API HELPERS
// ==================================================

function buildGasUrl(params) {
  const url = new URL(CONFIG.GAS_WEB_APP_URL);

  Object.keys(params || {}).forEach(function(key) {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.set(key, params[key]);
    }
  });

  url.searchParams.set('_ts', Date.now());

  return url.toString();
}


async function fetchJson(url, options) {
  const controller = new AbortController();

  const timeout = setTimeout(function() {
    controller.abort();
  }, CONFIG.REQUEST_TIMEOUT);

  let response;

  try {
    response = await fetch(url, {
      ...(options || {}),
      redirect: 'follow',
      signal: controller.signal
    });

  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);

  } catch (error) {
    console.error(
      'Invalid Server Response:',
      responseText.substring(0, 500)
    );

    throw new Error(
      'Apps Script ไม่ได้ส่งข้อมูล JSON กลับมา กรุณาตรวจสอบ URL และ Deployment'
    );
  }

  if (!response.ok) {
    throw new Error('HTTP Error: ' + response.status);
  }

  if (!data || data.status === 'error') {
    throw new Error(
      (data && data.message) ||
      'ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้'
    );
  }

  return data;
}


async function apiGet(params) {
  return fetchJson(buildGasUrl({
    ...params,
    idToken: STATE.idToken
  }));
}


async function apiPost(payload) {
  return fetchJson(CONFIG.GAS_WEB_APP_URL, {
    method: 'POST',

    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },

    body: JSON.stringify({
      ...payload,
      idToken: STATE.idToken
    })
  });
}


// ==================================================
// 7. CHECK LINKED ACCOUNT
// ==================================================

async function checkLinkedAccount() {
  showLoading('กำลังตรวจสอบบัญชี LINE...');

  const data = await apiGet({
    action: 'me'
  });

  if (data.status !== 'success') {
    throw new Error(data.message || 'ตรวจสอบบัญชีไม่สำเร็จ');
  }

  // รองรับข้อมูลนักศึกษาทั้งแบบ data.student และแบบ data ชั้นบน
  const student = data.student || data.member || data;

  const linked =
    data.linked === true ||
    data.isLinked === true ||
    !!(student && student.studentId && student.name);

  if (!linked) {
    STATE.studentId = '';
    STATE.studentName = '';

    showLoginSection();
    return;
  }

  STATE.studentId = String(student.studentId || '');
  STATE.studentName = String(student.name || '');

  if (!STATE.studentId) {
    showLoginSection();
    return;
  }

  showPaymentSection();

  const loggedInStudent = document.getElementById('loggedInStudent');

  if (loggedInStudent) {
    loggedInStudent.textContent =
      '👤 ' + STATE.studentName +
      ' (' + STATE.studentId + ')';
  }

  await loadItemsForStudent();
}


// ==================================================
// 8. LOOKUP STUDENT ID
// ==================================================

async function handleStudentLookup() {
  const input = document.getElementById('studentIdInput');
  const confirmBox = document.getElementById('studentConfirm');
  const lookupBtn = document.getElementById('lookupBtn');
  const registerBtn = document.getElementById('registerBtn');
  const message = document.getElementById('loginMessage');

  const studentId = input ? input.value.trim() : '';

  if (!studentId) {
    if (message) message.textContent = 'กรุณากรอกรหัสนักศึกษา';
    return;
  }

  STATE.lookupStudentId = '';
  STATE.lookupStudentName = '';

  confirmBox?.classList.add('hidden');
  registerBtn?.classList.add('hidden');

  if (message) message.textContent = '';

  if (lookupBtn) {
    lookupBtn.disabled = true;
    lookupBtn.textContent = 'กำลังตรวจสอบ...';
  }

  try {
    const data = await apiGet({
      action: 'lookup_student',
      studentId: studentId
    });

    if (data.status !== 'success') {
      throw new Error(data.message || 'ไม่พบข้อมูลนักศึกษา');
    }

    const student = data.student || data.member || data;

    const returnedStudentId = String(
      student.studentId || student.id || studentId
    );

    const returnedName = String(
      student.name || student.studentName || ''
    );

    if (!returnedName) {
      throw new Error('ไม่พบชื่อนักศึกษาในระบบ');
    }

    STATE.lookupStudentId = returnedStudentId;
    STATE.lookupStudentName = returnedName;

    if (confirmBox) {
      confirmBox.textContent =
        'ตรวจสอบข้อมูลนักศึกษา\n' +
        'รหัสนักศึกษา: ' + returnedStudentId + '\n' +
        'ชื่อ: ' + returnedName +
        '\n\nกรุณาตรวจสอบว่าข้อมูลถูกต้องก่อนยืนยัน';

      confirmBox.classList.remove('hidden');
    }

    registerBtn?.classList.remove('hidden');

    if (message) {
      message.textContent = 'พบข้อมูลนักศึกษาแล้ว';
      message.style.color = '#16a34a';
    }

  } catch (error) {
    console.error('Student Lookup Error:', error);

    if (message) {
      message.textContent = '⚠️ ' + error.message;
      message.style.color = '#dc2626';
    }

  } finally {
    if (lookupBtn) {
      lookupBtn.disabled = false;
      lookupBtn.textContent = 'ตรวจสอบรหัสนักศึกษา';
    }
  }
}


// ==================================================
// 9. REGISTER LINE ACCOUNT
// ==================================================

async function handleRegisterLine() {
  const registerBtn = document.getElementById('registerBtn');
  const message = document.getElementById('loginMessage');

  if (!STATE.lookupStudentId) {
    if (message) message.textContent = 'กรุณาตรวจสอบรหัสนักศึกษาก่อน';
    return;
  }

  if (!STATE.idToken) {
    if (message) message.textContent = 'ไม่พบ LINE ID Token กรุณาเปิด LIFF ใหม่';
    return;
  }

  if (registerBtn) {
    registerBtn.disabled = true;
    registerBtn.textContent = 'กำลังผูกบัญชี...';
  }

  try {
    const result = await apiPost({
      action: 'register_line',
      studentId: STATE.lookupStudentId
    });

    if (result.status !== 'success') {
      throw new Error(result.message || 'ไม่สามารถผูกบัญชีได้');
    }

    if (message) {
      message.textContent = 'ผูกบัญชีสำเร็จ กำลังเข้าสู่ระบบ...';
      message.style.color = '#16a34a';
    }

    STATE.studentId = STATE.lookupStudentId;
    STATE.studentName = STATE.lookupStudentName;

    await checkLinkedAccount();

  } catch (error) {
    console.error('Register LINE Error:', error);

    if (message) {
      message.textContent = '⚠️ ' + error.message;
      message.style.color = '#dc2626';
    }

  } finally {
    if (registerBtn) {
      registerBtn.disabled = false;
      registerBtn.textContent = 'ยืนยันผูกบัญชี LINE';
    }
  }
}


// ==================================================
// 10. LOAD ITEMS FOR LINKED STUDENT
// ==================================================

async function loadItemsForStudent() {
  const container = document.getElementById('itemsContainer');

  const requestId = ++STATE.itemRequestId;

  STATE.isLoadingItems = true;

  if (container) {
    container.innerHTML = '<p>กำลังโหลดรายการชำระเงิน...</p>';
  }

  try {
    const data = await apiGet({
      action: 'payment_items'
    });

    if (requestId !== STATE.itemRequestId) {
      return;
    }

    if (
      data.status !== 'success' ||
      !Array.isArray(data.items)
    ) {
      throw new Error(
        data.message || 'ไม่สามารถโหลดรายการชำระเงินได้'
      );
    }

    STATE.items = data.items;

    if (data.promptPay) {
      STATE.promptPay = data.promptPay;
    }

    // เผื่อ backend ส่งข้อมูลนักศึกษามาพร้อมรายการ
    if (data.student) {
      STATE.studentId = data.student.studentId || STATE.studentId;
      STATE.studentName = data.student.name || STATE.studentName;
    }

    renderItemsCheckboxes(STATE.items);

    if (STATE.items.length === 0 && container) {
      container.innerHTML =
        '<p>ไม่มีรายการที่ต้องชำระในขณะนี้ หรือชำระครบแล้ว</p>';
    }

  } catch (error) {
    if (requestId !== STATE.itemRequestId) {
      return;
    }

    console.error('Load Student Items Error:', error);

    STATE.items = [];
    renderItemsCheckboxes([]);

    if (container) {
      container.textContent = '⚠️ ' + error.message;
    }

  } finally {
    if (requestId === STATE.itemRequestId) {
      STATE.isLoadingItems = false;
      calculateTotal();
    }
  }
}


// ==================================================
// 11. RENDER PAYMENT ITEMS WITH STATUS
// ==================================================

function renderItemsCheckboxes(items) {
  const container = document.getElementById('itemsContainer');

  if (!container) {
    throw new Error('ไม่พบ itemsContainer ใน HTML');
  }

  container.innerHTML = '';

  if (!items || items.length === 0) {
    const message = document.createElement('p');

    message.textContent = 'ไม่มีรายการชำระเงินในขณะนี้';

    container.appendChild(message);

    calculateTotal();
    return;
  }

  items.forEach(function(item) {
    const price = Number(item.amount);

    if (!Number.isFinite(price) || price <= 0) {
      return;
    }

    const status = item.status || '❌';

    const isApproved = status === '✅';
    const isPending = status === '⚠️';

    const canPay =
      item.canPay !== false &&
      !isApproved &&
      !isPending;

    const div = document.createElement('div');

    div.className = 'checkbox-item';

    div.style.padding = '12px';
    div.style.marginBottom = '8px';
    div.style.border = '1px solid #e5e7eb';
    div.style.borderRadius = '10px';
    div.style.boxSizing = 'border-box';

    if (!canPay) {
      div.style.backgroundColor = '#f9fafb';
      div.style.opacity = '0.85';
    }

    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.id = item.id;
    checkbox.value = String(price);

    checkbox.dataset.title = item.title;
    checkbox.dataset.amount = String(price);

    checkbox.disabled = !canPay;

    const label = document.createElement('label');

    label.htmlFor = item.id;

    label.textContent =
      item.title +
      ' — ' +
      price.toLocaleString('en-US') +
      ' บาท';

    const statusElement = document.createElement('span');

    statusElement.className = 'payment-status';

    if (isApproved) {
      statusElement.textContent = '✅ จ่ายแล้ว';
      statusElement.style.color = '#16a34a';

    } else if (isPending) {
      statusElement.textContent = '⚠️ รอตรวจสอบ';
      statusElement.style.color = '#d97706';

    } else {
      statusElement.textContent = '❌ ยังไม่จ่าย';
      statusElement.style.color = '#dc2626';
    }

    statusElement.style.display = 'block';
    statusElement.style.fontSize = '13px';
    statusElement.style.fontWeight = '600';
    statusElement.style.marginTop = '5px';

    div.appendChild(checkbox);
    div.appendChild(label);
    div.appendChild(statusElement);

    container.appendChild(div);
  });

  calculateTotal();
}


// ==================================================
// 12. PROMPTPAY QR - CRC16
// ==================================================

function crc16(data) {
  let crc = 0xFFFF;

  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) << 8);

    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}


// ==================================================
// 13. PROMPTPAY QR - TLV HELPER
// ==================================================

function makeTLV(tag, value) {
  const text = String(value);

  if (text.length > 99) {
    throw new Error('ข้อมูล QR ยาวเกินกำหนด');
  }

  return tag + String(text.length).padStart(2, '0') + text;
}


// ==================================================
// 14. GENERATE PROMPTPAY PAYLOAD
// ==================================================

function generatePromptPayPayload(target, amount) {
  const sanitized = String(target || '').replace(/\D/g, '');

  let targetType = '';
  let formattedTarget = '';

  if (sanitized.length === 10 && sanitized.startsWith('0')) {
    targetType = '01';
    formattedTarget = '0066' + sanitized.substring(1);

  } else if (sanitized.length === 13) {
    targetType = '02';
    formattedTarget = sanitized;

  } else {
    throw new Error(
      'เลข PromptPay ต้องเป็นเบอร์โทรศัพท์ 10 หลัก หรือเลขประจำตัว 13 หลัก'
    );
  }

  const paymentAmount = Number(amount);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error('ยอดเงินไม่ถูกต้อง');
  }

  const amountText = paymentAmount.toFixed(2);

  const merchantAccount =
    makeTLV('00', 'A000000677010111') +
    makeTLV(targetType, formattedTarget);

  const tag29 = makeTLV('29', merchantAccount);

  let payload =
    '000201' +
    '010212' +
    tag29 +
    '5303764' +
    makeTLV('54', amountText) +
    '5802TH';

  payload += '6304';
  payload += crc16(payload);

  return payload;
}


// ==================================================
// 15. LOAD QR CODE LIBRARY
// ==================================================

function loadQRCodeLibrary() {
  return new Promise(function(resolve, reject) {
    if (typeof QRCode !== 'undefined') {
      resolve();
      return;
    }

    const existingScript = document.querySelector(
      'script[data-promptpay-qrcode]'
    );

    if (existingScript) {
      existingScript.addEventListener('load', function() {
        if (typeof QRCode !== 'undefined') {
          resolve();
        } else {
          reject(new Error('โหลด QR Code Library ไม่สำเร็จ'));
        }
      }, { once: true });

      existingScript.addEventListener('error', function() {
        reject(new Error('ไม่สามารถโหลด QR Code Library ได้'));
      }, { once: true });

      return;
    }

    const script = document.createElement('script');

    script.src = CONFIG.QR_LIBRARY_URL;
    script.async = true;
    script.dataset.promptpayQrcode = 'true';

    script.onload = function() {
      if (typeof QRCode !== 'undefined') {
        resolve();
      } else {
        reject(new Error('ไม่พบ QRCode Library'));
      }
    };

    script.onerror = function() {
      reject(new Error('ไม่สามารถเชื่อมต่อ QR Code Library ได้'));
    };

    document.head.appendChild(script);
  });
}


// ==================================================
// 16. CREATE PROMPTPAY SECTION
// ==================================================

function ensurePromptPaySection() {
  let section = document.getElementById('promptPaySection');

  if (section) {
    return section;
  }

  const itemsContainer = document.getElementById('itemsContainer');

  if (!itemsContainer) {
    return null;
  }

  section = document.createElement('section');

  section.id = 'promptPaySection';

  section.style.display = 'none';
  section.style.margin = '20px 0';
  section.style.padding = '20px';
  section.style.border = '1px solid #e5e7eb';
  section.style.borderRadius = '16px';
  section.style.background = '#ffffff';
  section.style.textAlign = 'center';
  section.style.boxSizing = 'border-box';

  const heading = document.createElement('h3');

  heading.textContent = 'ชำระเงินผ่าน PromptPay';

  heading.style.margin = '0 0 8px';
  heading.style.fontSize = '18px';
  heading.style.fontWeight = '700';
  heading.style.color = '#111827';

  const description = document.createElement('p');

  description.id = 'promptPayDescription';
  description.textContent = 'สแกน QR Code เพื่อชำระเงิน';

  description.style.fontSize = '13px';
  description.style.color = '#6b7280';
  description.style.margin = '0 0 16px';

  const qrContainer = document.createElement('div');

  qrContainer.id = 'promptPayQRCode';
  qrContainer.style.width = CONFIG.QR_SIZE + 'px';
  qrContainer.style.minHeight = CONFIG.QR_SIZE + 'px';
  qrContainer.style.maxWidth = '100%';
  qrContainer.style.margin = '0 auto 16px';
  qrContainer.style.display = 'flex';
  qrContainer.style.justifyContent = 'center';
  qrContainer.style.alignItems = 'center';

  const accountName = document.createElement('div');

  accountName.id = 'promptPayAccountName';
  accountName.style.fontSize = '15px';
  accountName.style.fontWeight = '700';
  accountName.style.color = '#111827';
  accountName.style.marginBottom = '6px';

  const amountText = document.createElement('div');

  amountText.id = 'promptPayAmount';
  amountText.style.fontSize = '28px';
  amountText.style.fontWeight = '800';
  amountText.style.color = '#16a34a';
  amountText.style.marginBottom = '12px';

  const note = document.createElement('p');

  note.id = 'promptPayNote';
  note.textContent = 'กรุณาตรวจสอบชื่อบัญชีและยอดเงินก่อนชำระ';

  note.style.fontSize = '12px';
  note.style.color = '#6b7280';
  note.style.margin = '0';

  section.appendChild(heading);
  section.appendChild(description);
  section.appendChild(qrContainer);
  section.appendChild(accountName);
  section.appendChild(amountText);
  section.appendChild(note);

  itemsContainer.insertAdjacentElement('afterend', section);

  return section;
}


// ==================================================
// 17. RENDER PROMPTPAY QR
// ==================================================

async function renderPromptPayQR(amount) {
  const section = ensurePromptPaySection();

  if (!section) return;

  const qrContainer = document.getElementById('promptPayQRCode');
  const accountName = document.getElementById('promptPayAccountName');
  const amountText = document.getElementById('promptPayAmount');
  const description = document.getElementById('promptPayDescription');
  const note = document.getElementById('promptPayNote');

  const renderId = ++STATE.qrRenderId;

  if (!Number.isFinite(amount) || amount <= 0) {
    section.style.display = 'none';

    if (qrContainer) qrContainer.innerHTML = '';

    return;
  }

  section.style.display = 'block';

  if (!STATE.promptPay) {
    qrContainer.textContent =
      'ไม่พบข้อมูล PromptPay กรุณาตรวจสอบชีตตั้งค่า';

    accountName.textContent = '';
    amountText.textContent = '';

    return;
  }

  try {
    const payload = generatePromptPayPayload(
      STATE.promptPay.promptPay,
      amount
    );

    if (accountName) {
      accountName.textContent =
        'ชื่อบัญชี: ' + STATE.promptPay.accountName;
    }

    if (amountText) {
      amountText.textContent =
        '฿' + amount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
    }

    if (description) {
      description.textContent =
        'สแกน QR Code เพื่อชำระยอดตามรายการที่เลือก';
    }

    if (note) {
      note.textContent =
        'QR นี้ระบุยอดเงินไว้แล้ว กรุณาตรวจสอบชื่อบัญชีก่อนยืนยันการโอน';
    }

    qrContainer.innerHTML = '';
    qrContainer.textContent = 'กำลังสร้าง QR Code...';

    await loadQRCodeLibrary();

    if (renderId !== STATE.qrRenderId) return;

    qrContainer.innerHTML = '';

    new QRCode(qrContainer, {
      text: payload,
      width: CONFIG.QR_SIZE,
      height: CONFIG.QR_SIZE,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    console.log('PromptPay QR Generated:', amount);

  } catch (error) {
    if (renderId !== STATE.qrRenderId) return;

    console.error('PromptPay QR Error:', error);

    qrContainer.textContent = '⚠️ ' + error.message;

    if (description) {
      description.textContent =
        'ไม่สามารถสร้าง QR Code ได้ กรุณาลองใหม่';
    }
  }
}


// ==================================================
// 18. CALCULATE TOTAL AMOUNT
// ==================================================

function calculateTotal() {
  let total = 0;

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );

  checkedBoxes.forEach(function(checkbox) {
    total += Number(checkbox.value) || 0;
  });

  total = Number(total.toFixed(2));

  const totalElement = document.getElementById('totalAmount');

  if (totalElement) {
    totalElement.textContent =
      total.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      });
  }

  renderPromptPayQR(total);

  return total;
}


// ==================================================
// 19. SETUP EVENT LISTENERS
// ==================================================

function setupEventListeners() {
  const itemsContainer = document.getElementById('itemsContainer');
  const slipInput = document.getElementById('slipInput');
  const paymentForm = document.getElementById('paymentForm');

  const lookupBtn = document.getElementById('lookupBtn');
  const registerBtn = document.getElementById('registerBtn');
  const studentIdInput = document.getElementById('studentIdInput');

  if (lookupBtn) {
    lookupBtn.addEventListener('click', handleStudentLookup);
  }

  if (registerBtn) {
    registerBtn.addEventListener('click', handleRegisterLine);
  }

  if (studentIdInput) {
    studentIdInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleStudentLookup();
      }
    });

    studentIdInput.addEventListener('input', function() {
      STATE.lookupStudentId = '';
      STATE.lookupStudentName = '';

      document.getElementById('studentConfirm')?.classList.add('hidden');
      document.getElementById('registerBtn')?.classList.add('hidden');

      const message = document.getElementById('loginMessage');

      if (message) message.textContent = '';
    });
  }

  if (itemsContainer) {
    itemsContainer.addEventListener('change', calculateTotal);
  }

  if (slipInput) {
    slipInput.addEventListener('change', handleImageUpload);
  }

  if (paymentForm) {
    paymentForm.addEventListener('submit', handleFormSubmit);
  }

  console.log('Event Listeners Ready');
}


// ==================================================
// 20. HANDLE IMAGE UPLOAD
// ==================================================

function handleImageUpload(event) {
  const file = event.target.files[0];

  if (!file) {
    STATE.compressedBase64 = '';
    return;
  }

  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');

    event.target.value = '';
    STATE.compressedBase64 = '';

    return;
  }

  const reader = new FileReader();

  reader.onload = function(readerEvent) {
    const img = new Image();

    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');

        let width = img.width;
        let height = img.height;

        if (width > CONFIG.MAX_IMAGE_WIDTH) {
          const ratio = CONFIG.MAX_IMAGE_WIDTH / width;

          width = CONFIG.MAX_IMAGE_WIDTH;
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error('ไม่สามารถประมวลผลรูปภาพได้');
        }

        ctx.drawImage(img, 0, 0, width, height);

        STATE.compressedBase64 = canvas.toDataURL(
          'image/jpeg',
          CONFIG.IMAGE_QUALITY
        );

        const preview = document.getElementById('preview');

        if (preview) {
          preview.src = STATE.compressedBase64;
          preview.style.display = 'block';
          preview.classList.remove('hidden');
        }

        console.log('Image Compressed Successfully');

      } catch (error) {
        console.error('Image Compression Error:', error);

        alert('ไม่สามารถบีบอัดรูปภาพได้ กรุณาลองใหม่');

        STATE.compressedBase64 = '';
      }
    };

    img.onerror = function() {
      alert('ไม่สามารถอ่านรูปภาพได้ กรุณาเลือกรูปใหม่');
      STATE.compressedBase64 = '';
    };

    img.src = readerEvent.target.result;
  };

  reader.onerror = function() {
    alert('ไม่สามารถอ่านไฟล์ได้');
    STATE.compressedBase64 = '';
  };

  reader.readAsDataURL(file);
}


// ==================================================
// 21. HANDLE PAYMENT FORM SUBMISSION
// ==================================================

async function handleFormSubmit(event) {
  event.preventDefault();

  if (STATE.isSubmitting) return;

  if (STATE.isLoadingItems) {
    alert('กรุณารอโหลดรายการชำระเงินให้เสร็จก่อน');
    return;
  }

  if (!STATE.studentId) {
    alert('ไม่พบข้อมูลบัญชีนักศึกษา กรุณาเข้าสู่ระบบใหม่');
    return;
  }

  if (!STATE.idToken) {
    alert('ไม่พบ LINE ID Token กรุณาเปิด LIFF ใหม่');
    return;
  }

  if (!STATE.compressedBase64) {
    alert('กรุณาแนบรูปสลิปการโอนเงิน');
    return;
  }

  const checkedBoxes = document.querySelectorAll(
    '#itemsContainer input[type="checkbox"]:checked'
  );

  if (checkedBoxes.length === 0) {
    alert('กรุณาเลือกอย่างน้อย 1 รายการที่ต้องการชำระ');
    return;
  }

  const selectedItems = [];

  checkedBoxes.forEach(function(checkbox) {
    selectedItems.push({
      id: checkbox.id,
      title: checkbox.dataset.title
    });
  });

  const invalidSelection = selectedItems.find(function(selected) {
    const item = STATE.items.find(function(current) {
      return current.id === selected.id;
    });

    return !item ||
      item.status === '⚠️' ||
      item.status === '✅' ||
      item.canPay === false;
  });

  if (invalidSelection) {
    alert(
      'มีรายการที่กำลังรอตรวจสอบหรือชำระแล้ว กรุณาโหลดรายการใหม่'
    );

    await loadItemsForStudent();
    return;
  }

  const totalAmount = calculateTotal();

  if (totalAmount <= 0) {
    alert('ยอดชำระเงินไม่ถูกต้อง');
    return;
  }

  if (!STATE.promptPay) {
    alert('ไม่พบข้อมูล PromptPay กรุณาติดต่อผู้ดูแลระบบ');
    return;
  }

  const btn = document.getElementById('submitBtn');

  if (!btn) {
    alert('ไม่พบปุ่มส่งข้อมูล');
    return;
  }

  STATE.isSubmitting = true;

  btn.disabled = true;
  btn.textContent = 'กำลังอัปโหลดข้อมูล...';

  try {
    const result = await apiPost({
      action: 'submit_payment',

      studentId: STATE.studentId,

      selectedItems: selectedItems,

      selectedItemsNames: selectedItems.map(function(item) {
        return item.title;
      }).join(', '),

      totalAmount: totalAmount,

      imageBase64: STATE.compressedBase64
    });

    if (result.status === 'success') {
      alert(
        '✅ ส่งสลิปเรียบร้อยแล้ว!\n\n' +
        'รหัสรายการ: ' + result.txId + '\n' +
        'ชื่อ: ' + (result.name || STATE.studentName) + '\n' +
        'ยอดชำระ: ' +
        Number(result.totalAmount || totalAmount).toLocaleString('en-US') +
        ' บาท\n\n' +
        'กรุณารอแอดมินตรวจสอบ'
      );

      if (result.notificationWarning) {
        console.warn(result.notificationWarning);
      }

      if (
        typeof liff !== 'undefined' &&
        liff.isInClient()
      ) {
        liff.closeWindow();

      } else {
        location.reload();
      }

    } else {
      throw new Error(result.message || 'ไม่สามารถส่งข้อมูลได้');
    }

  } catch (error) {
    console.error('Submit Error:', error);

    if (error.name === 'AbortError') {
      alert(
        'การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจสอบสถานะรายการก่อนส่งซ้ำ'
      );

    } else {
      alert('เกิดข้อผิดพลาด: ' + error.message);
    }

    resetSubmitButton(btn);
  }
}


// ==================================================
// 22. RESET SUBMIT BUTTON
// ==================================================

function resetSubmitButton(button) {
  STATE.isSubmitting = false;

  if (!button) return;

  button.disabled = false;
  button.textContent = 'ยืนยันการส่งสลิป';
}
